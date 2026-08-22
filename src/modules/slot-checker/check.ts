/**
 * slot-checker — T1 충족 여부를 판정하고 다음 질문 1문항을 고른다.
 *
 * 정본: spec/backend/08-14-slot-tiering.md · spec/common/08-14-api.md §3.4
 *       spec/backend/08-16-data-model.md §5.1 §5.2
 * 근거: ADR-014 · ADR-015 · ADR-028
 *
 * **이 모듈은 어떤 입력에도 예외를 던지지 않습니다.** 슬롯이 하나도 없어도,
 * 물을 것이 없어도 정상 결과를 돌려줍니다 — 미충족은 정상 경로입니다.
 */

import type {
  NextQuestion,
  QuestionSource,
  SlotCheckInput,
  SlotCheckResult,
  SlotChecker,
  SlotKey,
  SlotState,
  TierStatus,
} from './types'

/** 08-16-data-model.md §5.1 의 T1 */
const T1_KEYS: readonly SlotKey[] = ['transferred', 'channel']

/**
 * 08-16-data-model.md §5.1 의 T2.
 *
 * **`amount_hint` 는 여기 없습니다.** `amount` 와 같은 사실의 다른 표현이라
 * 따로 세면 한 사실을 두 번 세게 됩니다. 게다가 둘 중 하나는 늘 비어 있어서
 * (정확한 액수를 알면 구간을 묻지 않고, 모르면 `amount` 가 `unknown` 입니다)
 * 넣으면 T2 가 `satisfied` 에 영영 도달하지 못합니다.
 */
const T2_KEYS: readonly SlotKey[] = [
  'org_name',
  'amount',
  'occurred_at',
  'elapsed_hint',
  'contact_method',
  'counterpart_account',
  'impersonated_org',
  'freeze_requested_at',
  'relief_applied_at',
  'report_filed_at',
  'objection_submitted_at',
]

/**
 * 물어보는 순서. **플랜을 가장 크게 바꾸는 슬롯부터**입니다 → 최소 질문 원칙.
 *
 * T1 이 먼저인 것은 분기 자체를 결정하기 때문이고, 그 안에서 `transferred` 가
 * 앞인 것은 보냈는지를 알아야 무엇으로 보냈는지가 뜻을 갖기 때문입니다.
 *
 * T2 는 08-14-slot-tiering.md 가 문진 대상으로 든 다섯입니다. 나머지 T2
 * (`counterpart_account` · `freeze_requested_at` 등)는 증거와 부산물에서 오므로
 * 여기 없습니다 — 물어서 채우는 값이 아닙니다.
 *
 * ⬜ TODO(미정): T2 안의 순서에 정본이 없습니다. 기관 전용 KB 항목을 고르는
 * `org_name` 이 조회 범위를 가장 크게 좁히고, `amount` 는 서류 필수 기재,
 * `occurred_at` 은 기한 기산점이라는 순서로 두었습니다. 근거가 정해지면 옮깁니다.
 */
interface AskStep {
  readonly slotKey: SlotKey
  /**
   * 물을 조건. 없으면 언제나 묻습니다.
   *
   * **문구가 아니라 판정입니다.** 「언제 묻나」는 이 모듈의 일이고, 밖의
   * `QuestionSource` 는 「뭐라고 묻나」만 답합니다 — 조건을 문구 쪽에 두면
   * 다른 슬롯의 상태를 문구 표가 알아야 합니다.
   */
  readonly askWhen?: (stateOf: (key: SlotKey) => SlotState) => boolean
}

const ASK_ORDER: readonly AskStep[] = [
  { slotKey: 'transferred' },
  { slotKey: 'channel' },
  { slotKey: 'org_name' },
  { slotKey: 'amount' },
  // 정확한 액수를 「모름」으로 답했을 때만 구간을 묻습니다 → 08-16-data-model.md §5.1.
  // **아는 것을 두 번 묻지 않습니다** — 사용자가 숫자를 적었거나 이체내역에서
  // 뽑았으면(`extracted`) 구간은 물을 이유가 없습니다
  {
    slotKey: 'amount_hint',
    askWhen: (stateOf) => stateOf('amount') === 'unknown',
  },
  { slotKey: 'occurred_at' },
  { slotKey: 'elapsed_hint' },
  { slotKey: 'contact_method' },
]

/**
 * 버튼 질문에 반드시 들어가는 선택지 → 08-14-api.md §3.4.
 * **없으면 스펙 위반입니다.**
 */
const UNKNOWN_OPTION = '모름·기억 안 남'

export function createSlotChecker(deps: {
  questions: QuestionSource
}): SlotChecker {
  const { questions } = deps

  return {
    check(input: SlotCheckInput): SlotCheckResult {
      const known = new Map(input.slots.map((one) => [one.slotKey, one.state]))

      // 목록에 없는 슬롯은 empty 로 본다. 사건을 막 만든 직후가 그 상태다
      const stateOf = (key: SlotKey): SlotState => known.get(key) ?? 'empty'

      const t1 = tierStatus(T1_KEYS, stateOf)
      const t2 = tierStatus(T2_KEYS, stateOf)

      return {
        t1,
        t2,
        nextQuestion: pickQuestion(stateOf, questions),
        // 「모름」으로 확정된 경우도 여기 포함된다.
        // 낫게 안내하지 못할 바에 넓게 안내한다 → 08-14-slot-tiering.md
        needsSupersetPlan: t1 !== 'satisfied',
      }
    },
  }
}

/**
 * 값이 있는 슬롯의 비율로 판정한다.
 *
 * `extracted` 도 값으로 센다 — 흐름이 「자동 추출 → T1 충족?」 순서라,
 * 뽑힌 값이 있으면 플랜을 만들 수 있다.
 *
 * **`unknown` 은 값이 아니다.** 더 묻지는 않지만 채워진 것도 아니라
 * 슈퍼셋 플랜으로 간다.
 */
function tierStatus(
  keys: readonly SlotKey[],
  stateOf: (key: SlotKey) => SlotState,
): TierStatus {
  const filled = keys.filter((key) => {
    const state = stateOf(key)
    // `pii_pending` 은 세지 않습니다 — 개인정보인지 확인 전이라 절차 선택에
    // 쓸 수 없습니다. 확인 전에는 없는 값과 같습니다 → ADR-041
    return state === 'confirmed' || state === 'extracted'
  }).length

  if (filled === keys.length) return 'satisfied'
  if (filled === 0) return 'unsatisfied'
  return 'partial'
}

/**
 * 한 번에 한 슬롯만 고른다 → 최소 질문 원칙.
 *
 * 물을 것이 없으면 null 이고, 그래도 실행 보드는 열린다.
 */
function pickQuestion(
  stateOf: (key: SlotKey) => SlotState,
  questions: QuestionSource,
): NextQuestion | null {
  for (const { slotKey, askWhen } of ASK_ORDER) {
    // 질문 대상은 empty 뿐이다. 추출됐거나 「모름」으로 답한 것은 다시 묻지 않는다
    if (stateOf(slotKey) !== 'empty') continue

    // 다른 슬롯의 상태에 걸린 질문은 그 조건이 설 때만 묻는다
    if (askWhen && !askWhen(stateOf)) continue

    const form = questions.formFor(slotKey)
    // 문구를 주지 않는 슬롯은 물을 수 없다. 조용히 다음으로 넘어간다
    if (!form) continue

    return withUnknownOption({ slotKey, ...form })
  }

  return null
}

/**
 * 「모름」 선택지를 보장한다.
 *
 * 문구를 주는 쪽이 빠뜨려도 여기서 채워, **스펙 위반이 구조적으로 일어나지 않게** 한다.
 */
function withUnknownOption(question: NextQuestion): NextQuestion {
  if (question.input !== 'buttons') return question

  const options = question.options ?? []
  if (options.includes(UNKNOWN_OPTION)) return question

  return { ...question, options: [...options, UNKNOWN_OPTION] }
}
