/**
 * slot-checker — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-14-slot-tiering.md (티어·최소 질문 원칙)
 *       spec/common/08-14-api.md §3.4 (next_question 구조)
 *       spec/backend/08-16-data-model.md §5.1 §5.2 (슬롯 이름·상태)
 * 근거: ADR-014 (이름) · ADR-015 (되묻기) · ADR-028 (모듈 모양)
 *
 * **설계 원칙: 미확정 슬롯이 있어도 절대 멈추지 않는다.**
 * 어떤 경우에도 예외를 던지지 않습니다 — 슬롯 미충족은 정상 경로입니다.
 *
 * 절대 하지 않는 것: 슬롯 미충족을 이유로 진행을 막기 · 어떤 입력에든 예외 던지기 · 「모름」을 다시 묻기
 */

/** 08-16-data-model.md §5.1 의 목록. 여기 없는 이름은 쓰지 않습니다 */
export type SlotKey =
  | 'transferred'
  | 'channel'
  | 'org_name'
  | 'amount'
  | 'occurred_at'
  | 'elapsed_hint'
  | 'contact_method'
  | 'counterpart_account'
  | 'impersonated_org'
  | 'freeze_requested_at'
  | 'relief_applied_at'
  | 'report_filed_at'
  | 'objection_submitted_at'

export type SlotTier = 'T1' | 'T2'

/** 08-16-data-model.md §5.2 */
export type SlotState =
  /** 아직 없음. **질문 대상은 이것뿐입니다** */
  | 'empty'
  /** LLM 이 뽑았고 확인 전 */
  | 'extracted'
  /** 사용자가 확인·입력함 */
  | 'confirmed'
  /** 사용자가 "모름" 선택. **실패가 아니라 정상 상태입니다** */
  | 'unknown'

export interface SlotSnapshot {
  readonly slotKey: SlotKey
  readonly tier: SlotTier
  readonly state: SlotState
}

/**
 * 티어가 얼마나 채워졌나.
 *
 * `satisfied` 는 그 티어의 슬롯이 전부 값을 가진 상태입니다 — `confirmed` 든
 * `extracted` 든 값이 있으면 셉니다. **`unknown` 은 값이 아닙니다** —
 * 더 묻지는 않지만 채워진 것도 아니라, 슈퍼셋 플랜으로 갑니다.
 */
export type TierStatus = 'satisfied' | 'partial' | 'unsatisfied'

/** 08-14-api.md §3.4 — **정의는 그 절 하나이고 여기는 그것을 옮긴 것입니다** */
export interface NextQuestion {
  readonly slotKey: SlotKey
  readonly text: string
  readonly input: 'buttons' | 'text' | 'date' | 'amount'
  /** `input === 'buttons'` 일 때 필수. **「모름」 선택지가 반드시 들어갑니다** */
  readonly options?: readonly string[]
}

/** 질문 문구와 선택지를 빼면 남는 것 */
export type QuestionForm = Omit<NextQuestion, 'slotKey'>

/**
 * 이 모듈이 밖에 요구하는 것 — 슬롯별 질문 문구와 선택지.
 *
 * **문구의 정본이 아직 없습니다.** 코드 상수인지 슬롯 정의 테이블인지 KB 인지가
 * 정해지지 않았습니다 → docs/plans/08-16-backend-handoff.md ⑤.
 * 그래서 이 모듈은 문구를 갖지 않고 받아 씁니다 — 정해지면 구현만 바뀝니다.
 */
export interface QuestionSource {
  /** 그 슬롯을 물을 문구. 물을 수 없는 슬롯이면 undefined */
  formFor(slotKey: SlotKey): QuestionForm | undefined
}

export interface SlotCheckInput {
  readonly slots: readonly SlotSnapshot[]
}

export interface SlotCheckResult {
  readonly t1: TierStatus
  readonly t2: TierStatus

  /**
   * 다음에 물을 한 문항. 물을 것이 없으면 `null`.
   *
   * **`null` 이어도 실행 보드는 열립니다** — 슬롯 미충족으로 진입을 막지 않습니다
   * → 08-14-api.md §3.4.
   */
  readonly nextQuestion: NextQuestion | null

  /**
   * 슈퍼셋 플랜으로 가야 하는가.
   *
   * T1 이 satisfied 가 아니면 참입니다. 「모름」으로 확정된 경우도 포함합니다 —
   * 낫게 안내하지 못할 바에 넓게 안내합니다 → 08-14-slot-tiering.md.
   */
  readonly needsSupersetPlan: boolean
}

export interface SlotChecker {
  check(input: SlotCheckInput): SlotCheckResult
}
