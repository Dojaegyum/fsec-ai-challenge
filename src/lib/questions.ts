/**
 * 문진 문구를 내주는 자리.
 *
 * 정본: spec/common/08-14-api.md §3.4 (next_question 구조)
 *       spec/backend/08-14-channel-matrix.md (8유형 — `channel` 선택지의 출처)
 *       spec/backend/08-16-data-model.md §5.1 (슬롯 이름·value_type)
 *       spec/backend/08-14-slot-tiering.md (최소 질문 원칙 · 「모름」의 처리)
 * 근거: docs/plans/08-16-backend-handoff.md ⑤ — **A(코드 상수)로 확정** (2026-08-20)
 *
 * ## 왜 코드 상수인가
 *
 * **문구는 절차 지식이 아닙니다.** KB 릴리스에 실으면 「법령이 바뀌어서 고치는 것」과
 * 「말이 어색해서 고치는 것」이 같은 검수 diff 에 섞입니다 — 사람 검수가 생략 불가인데
 * (spec/backend/08-14-kb-operations.md) 검수할 것이 흐려집니다.
 *
 * **DB 에 두는 것도 값이 없습니다.** 선택지가 8유형에 묶여 있어, 유형이 바뀌면
 * `ch-*.json` 도 같이 고쳐야 하고 그때는 어차피 배포가 따라옵니다.
 *
 * ## 왜 모듈이 아니라 여기인가
 *
 * `slot-checker` 는 층 3(사건 상태가 바뀔 때)이고 **화면에 보일 문장을 갖지 않습니다.**
 * 그래서 모듈은 `QuestionSource` 를 인터페이스로 선언만 하고(ADR-028), 구현은 조립
 * 층인 `src/lib/` 에 둡니다 — [container.ts](./container.ts) 가 끼웁니다.
 * 문구를 고칠 때 도메인 판정 코드를 열지 않아도 됩니다.
 *
 * ## 던지지 않습니다
 *
 * `slot-checker` 는 값이 빈 슬롯마다 이 자리를 부르므로, 던지면 **사건 생성이 통째로
 * 막힙니다** — `CLAUDE.md` 불변 규칙 5(정보가 없어도 멈추지 않는다)와 `slot-checker`
 * 자신의 계약(「어떤 입력에도 예외를 던지지 않습니다」)을 한꺼번에 깹니다.
 * 표에 없는 슬롯은 `undefined` 를 돌려주고, 부르는 쪽이 조용히 다음 슬롯으로 넘어갑니다.
 *
 * **비어 있다는 사실은 설정 현황에서 드러냅니다** → [config-report.ts](./config-report.ts).
 */

import 'server-only'

import { CONFIRM_NO, CONFIRM_YES } from '@/modules/slot-checker'
import type { QuestionForm, QuestionSource, SlotKey } from '@/modules/slot-checker'
import type { ChannelId } from '@/modules/slot-extractor'

/**
 * 「모름·기억 안 남」을 여기에 적지 않습니다.
 *
 * `slot-checker` 가 버튼 질문마다 붙여, 이 표에서 빠뜨려도 **계약 위반이 구조적으로
 * 일어나지 않게** 돼 있습니다 → check.ts `withUnknownOption`.
 */

/**
 * `channel` 선택지 — 08-14-channel-matrix.md 「8유형」 표의 경유 서비스 칸 그대로입니다.
 *
 * **하나라도 빼지 마세요.** 빠진 유형의 피해자는 자기 경로를 고를 수 없고, 그대로
 * 「모름」으로 떨어져 슈퍼셋 플랜을 받습니다 — 맞춤 안내가 있는데도 못 받는 것입니다.
 *
 * 순서는 매트릭스 표의 순서입니다. 환급법이 적용되는 넷이 앞이고 사각지대가 뒤인데,
 * 이건 표에서 온 것이지 발생 빈도로 정렬한 것이 아닙니다.
 *
 * **라벨과 값을 한 줄에 묶어 둡니다.** 화면에 나가는 것은 `label` 이고
 * `case_slot` 에 적재되는 것은 `value` 인데(08-14-api.md §3.4 는 `options` 가
 * `string[]`, §3.5 는 `value` 가 `"CH-bank"`), 두 표로 나누면 라벨만 고쳤을 때
 * 매핑이 조용히 비고 그 유형의 답이 버려집니다.
 */
const CHANNEL_CHOICES: readonly { readonly label: string; readonly value: ChannelId }[] = [
  { label: '시중은행 계좌이체', value: 'CH-bank' },
  { label: '인터넷은행 (토스뱅크 등)', value: 'CH-neobank' },
  { label: '증권사 계좌', value: 'CH-securities' },
  { label: '간편송금 (카카오페이·토스 등)', value: 'CH-easypay' },
  { label: '가상자산 (거래소 경유)', value: 'CH-crypto' },
  { label: '대면편취 (현금 전달)', value: 'CH-facetoface' },
  { label: '상품권 (핀번호 전달)', value: 'CH-giftcard' },
  { label: '휴대폰 소액결제', value: 'CH-carrier' },
  { label: '카드 부정사용·카드론', value: 'CH-card' },
]

const CHANNEL_OPTIONS: readonly string[] = CHANNEL_CHOICES.map((one) => one.label)

/**
 * 슬롯별 질문 한 문항.
 *
 * **여기 없는 슬롯은 묻지 않습니다.** `counterpart_account`·`freeze_requested_at`
 * 같은 나머지 T2 는 증거와 부산물에서 오는 값이라 문진 대상이 아닙니다
 * → 08-14-slot-tiering.md.
 *
 * **묻는 순서는 여기가 아니라 `slot-checker` 가 정합니다** (check.ts `ASK_ORDER`).
 * 이 표는 「그 슬롯을 뭐라고 묻나」만 답합니다.
 */
const FORMS: Partial<Record<SlotKey, QuestionForm>> = {
  // ── T1 · 분기를 결정하는 둘 ──────────────────────────────────
  transferred: {
    text: '돈이 실제로 빠져나갔나요?',
    input: 'buttons',
    options: ['네, 돈이 나갔어요', '아니요, 나가지는 않았어요'],
  },
  channel: {
    text: '어떤 방법으로 보내셨나요?',
    input: 'buttons',
    options: CHANNEL_OPTIONS,
  },

  // ── T2 · 정밀화. 증거 추출이 우선이고 실패했을 때만 묻습니다 ──
  org_name: {
    // 기관 전용 KB 항목을 고르는 값이라 자유 입력입니다. 은행·거래소·통신사가
    // 다 들어오므로 버튼으로 좁히면 8유형 중 어딘가가 반드시 빠집니다
    text: '어느 기관이었나요? (은행·거래소·통신사 등)',
    input: 'text',
  },
  // ── 금액은 짝입니다 → 08-16-data-model.md §5.1 ──────────────
  //
  // 정확한 액수를 먼저 묻고, 「모름」으로 답했을 때만 구간을 묻습니다.
  // **아는 사람은 한 번에 끝나고, 모르는 사람은 버튼으로 답합니다** —
  // 어느 쪽도 금액 때문에 막히지 않습니다.
  //
  // 「모름」을 눌렀는지 보고 구간을 낼지 정하는 것은 `slot-checker` 입니다
  // (check.ts `ASK_ORDER` 의 `askWhen`). 이 표는 문장만 답합니다.
  amount: {
    // `case_slot.value_type` 이 decimal 이라 숫자로 받습니다.
    // 나중에 서류 기재 안내에 쓸 수 있는 값은 이쪽 하나입니다
    text: '얼마를 보내셨나요?',
    input: 'amount',
  },
  amount_hint: {
    // 선택지는 08-14-api.md §3.4 의 예시 그대로입니다.
    //
    // **정확한 액수를 대신하는 값이지 더 정밀한 값이 아닙니다.** 서류에 적을
    // 금액은 우리가 채우지 않고 사용자가 자기 이체내역을 보고 적습니다 → ADR-037.
    text: '대략 어느 정도였나요?',
    input: 'buttons',
    options: ['100만원 미만', '100~500만원', '500~1000만원', '1000만원 이상'],
  },
  occurred_at: {
    text: '언제 보내셨나요?',
    input: 'date',
  },
  elapsed_hint: {
    // 사용자 진술 그대로 담는 string 입니다. **기한 계산에 쓰지 않습니다** —
    // 법정 기한은 confirmed 상태의 날짜로만 셉니다 → CLAUDE.md 불변 규칙 7.
    // 그래서 아래 구간은 법정 기한이 아니라 「얼마나 급한 상황인지」를 받는 눈금입니다
    text: '그 일이 있고 얼마나 지났나요?',
    input: 'buttons',
    options: ['1시간 이내', '오늘 안에', '하루에서 사흘 사이', '일주일 넘음'],
  },
  contact_method: {
    text: '상대와 어떻게 연락하셨나요?',
    input: 'buttons',
    options: ['전화', '문자', '카카오톡', '다른 메신저', '이메일'],
  },

  // ── 이미 밟은 절차의 날짜 둘 ────────────────────────────────
  //
  // **법정 기한의 기산점입니다.** 이 둘이 비면 3영업일도 14일 유예도
  // 서지 않습니다 — 화면에 기한이 하나도 안 뜹니다.
  //
  // 왜 묻나: 우리는 112 를 대체하지 않고 **신고 이후**를 맡습니다(CLAUDE.md).
  // 들어오는 사람 상당수가 이미 지급정지를 걸었거나 피해구제를 신청했고,
  // 그 날짜는 **본인만 압니다** — 부산물에는 「올린 날」밖에 없어서,
  // 늦게 올리면 기한이 그만큼 늦게 잡힙니다(틀리는 방향이 나쁩니다 → ADR-054).
  //
  // 아직 안 했으면 「모름·기억 안 남」으로 넘어갑니다. **막지 않습니다** —
  // 「모름」은 실패가 아닙니다(불변 규칙 5). 그때는 절차 안내가 그대로 나가고,
  // 나중에 하고 나서 답하면 그때 기한이 섭니다.
  freeze_requested_at: {
    text: '지급정지는 언제 요청하셨나요? 아직이면 「모름」으로 넘어가세요',
    input: 'date',
  },
  relief_applied_at: {
    // **지급정지와 다른 사건입니다** → 09-data-model.md §8.0. 전화 한 통으로
    // 둘을 같이 신청해 같은 날이 되는 경우가 많지만, 지급정지만 걸고 피해구제
    // 신청을 안 했으면 3영업일이 아직 시작되지 않았습니다.
    text: '피해구제 신청은 언제 하셨나요? 지급정지와 다른 절차입니다',
    input: 'date',
  },
}

/**
 * 문구가 붙은 문진 표를 내놓습니다.
 *
 * 문구를 고칠 때 부르는 쪽은 바뀌지 않습니다 — 이 파일만 고칩니다.
 */
export function createQuestionSource(): QuestionSource {
  return {
    formFor: (slotKey) => FORMS[slotKey],
    confirmFor: (slotKey, value) => confirmForm(slotKey, value),
  }
}

/**
 * 증거에서 뽑힌 값의 되묻기 문구 — 「이 값이 맞나요」(ADR-069).
 *
 * 값은 슬롯에 든 모양 그대로 옵니다. 사람이 읽을 모양으로 바꾸는 것이 여기 몫입니다 —
 * `32000000` 은 「32,000,000원」, `2026-09-01T14:22:41+09:00` 은 「2026-09-01 14:22」.
 * 계좌 토큰(`[계좌-1]`)은 **그대로** 둡니다 — 원문은 브라우저만 알고, 화면이 토큰 자리를
 * 되살립니다(`pii-restorer`). 여기서 번호를 쓸 수 있는 방법이 없고, 있어서도 안 됩니다.
 *
 * 선택지의 앞 둘은 **글자가 곧 계약**입니다 — `flows/answer-slot.ts` 가 그 글자로 가릅니다.
 */
const CONFIRM_LABEL: Readonly<Partial<Record<SlotKey, string>>> = {
  amount: '보낸 금액',
  occurred_at: '보낸 시각',
  counterpart_account: '받는 쪽 계좌',
  impersonated_org: '상대가 사칭한 곳',
  contact_method: '상대가 연락해 온 방법',
}

function confirmForm(slotKey: SlotKey, value: string): QuestionForm | undefined {
  const label = CONFIRM_LABEL[slotKey]
  if (!label) return undefined
  return {
    text: `올린 자료에서 찾은 ${label}입니다: ${shownValue(slotKey, value)}. 맞나요?`,
    input: 'buttons',
    options: [CONFIRM_YES, CONFIRM_NO],
  }
}

/** 슬롯 값 → 사람이 읽는 모양. 못 읽으면 값 그대로 — 감추지 않습니다 */
export function shownValue(slotKey: SlotKey, value: string): string {
  if (slotKey === 'amount' && /^\d+$/.test(value)) {
    return `${Number(value).toLocaleString('ko-KR')}원`
  }
  if (slotKey === 'occurred_at') {
    const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value)
    if (m) return m[2] ? `${m[1]} ${m[2]}` : m[1]!
  }
  return value
}

/**
 * 사용자가 고른 경유 서비스 라벨을 `case_slot` 에 적재할 값으로 되돌립니다.
 *
 * **8유형 밖의 값을 만들지 않습니다.** 표에 없으면 `undefined` 이고, 부르는 쪽이
 * 「답으로 못 받았다」로 다뤄야 합니다 — 임의 문자열이 `channel` 에 들어가면
 * KB 분기가 조용히 빗나가 **다른 유형의 절차가 안내됩니다.**
 *
 * 「모름·기억 안 남」도 여기서는 `undefined` 입니다. 모름은 값이 아니라 상태라,
 * `PATCH …/slots/{slot_key}` 의 `action: "unknown"` 으로 갑니다 → 08-14-api.md §3.5.
 */
export function channelForOption(option: string): ChannelId | undefined {
  return CHANNEL_CHOICES.find((one) => one.label === option)?.value
}

/** 문진 문구가 실제로 붙어 있는가. 설정 현황에 씁니다 */
export function questionsConfigured(source: QuestionSource): boolean {
  return source.formFor('transferred') !== undefined
}
