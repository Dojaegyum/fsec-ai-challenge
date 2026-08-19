/**
 * planner — KB 를 인용해 `plan_step` 을 확정한다
 *
 * 계약: spec/backend/08-16-data-model.md §6 §6.1 §11.4 ·
 *       spec/backend/08-14-slot-tiering.md
 * 근거: CLAUDE.md 불변 규칙 1·5 · ADR-014 · ADR-028
 *
 * 절대 하지 않는 것: 근거 없는 단계를 만들기 · 절차 문장을 쓰기 ·
 * 날짜를 계산하기 · 완료된 단계를 덮어쓰기
 */

/** 09-data-model.md §6 */
export type StepState =
  | 'not_started'
  | 'in_progress'
  | 'done_verified'
  | 'unconfirmed'
  | 'skipped'

/**
 * 이 단계를 **누가** 하나 → 09-data-model.md §6.
 *
 * **기본값을 두지 않습니다.** 채권소멸공고는 금감원이 하는 일인데 `victim` 으로
 * 떨어지면 사용자가 자기 할 일로 오인합니다 → §8.3.
 */
export type Actor =
  | 'victim'
  | 'police'
  | 'bank'
  | 'prosecutor'
  | 'carrier'
  | 'issuer'

/** 09-data-model.md §5.2 */
export type SlotState = 'empty' | 'extracted' | 'confirmed' | 'unknown'

/**
 * KB 항목 본문 중 이 모듈이 보는 것 → 09-data-model.md §11.4.
 *
 * 나머지 필드(`summary`·`steps[]`·`caveat` 등)는 그대로 `plan_step.body` 로 옮깁니다 —
 * **이 모듈은 절차 문장을 만들지도 고치지도 않습니다.**
 */
export interface KbStepBody {
  /** 이 슬롯들이 `confirmed` 여야 단계가 활성화됩니다 */
  readonly requiresSlots?: readonly string[]
  /** 이 `step_key` 들이 `done_verified` 여야 활성화됩니다 */
  readonly after?: readonly string[]
  /** 값이 있으면 슈퍼셋 플랜의 조건부 단계. `plan_step.conditional` 로 그대로 갑니다 */
  readonly conditional?: string | null
  /** 이 단계를 누가 하나. **비면 단계를 만들지 않습니다** */
  readonly actor?: Actor
  /** 본문의 나머지. 손대지 않고 옮깁니다 */
  readonly [key: string]: unknown
}

/** `kb-finder` 가 넘긴 항목 하나 */
export interface KbStep {
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly stepKey: string
  readonly stepSeq: number
  readonly channelId: string | null
  readonly title: string
  /** 비면 단계를 만들지 않습니다 → 09-data-model.md §6 */
  readonly sourceUrl: string
  /** 비면 단계를 만들지 않습니다 */
  readonly effectiveFrom: string
  readonly body: KbStepBody
}

/** 사건에 이미 있는 단계. 병합 판단에 씁니다 */
export interface ExistingStep {
  readonly stepKey: string
  readonly state: StepState
}

/** 사건의 슬롯 하나 */
export interface CaseSlot {
  readonly slotKey: string
  readonly state: SlotState
}

export interface PlanInput {
  readonly caseId: string
  /** `kb-finder` 의 적용 묶음 */
  readonly applied: readonly KbStep[]
  /** `kb-finder` 의 참고 묶음. 슈퍼셋 플랜에서만 씁니다 */
  readonly reference?: readonly KbStep[]
  readonly slots: readonly CaseSlot[]
  /** 이미 저장된 단계들. 처음이면 빈 배열 */
  readonly existing?: readonly ExistingStep[]
  /**
   * 슈퍼셋 플랜으로 만들 것인가.
   *
   * `slot-checker` 의 `needsSupersetPlan` 을 그대로 넣습니다. 참이면 참고 묶음의
   * 조건부 단계가 함께 들어갑니다 → 02-slot-tiering.md.
   */
  readonly superset?: boolean
}

/** 저장할 단계 하나. `plan_step` 한 행과 같은 모양입니다 */
export interface PlannedStep {
  readonly caseId: string
  readonly seq: number
  readonly stepKey: string
  readonly title: string
  readonly actor: Actor
  readonly body: KbStepBody
  /** 슈퍼셋 플랜의 조건 라벨. 없으면 `null` */
  readonly conditional: string | null
  readonly state: StepState
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly sourceUrl: string
  readonly effectiveFrom: string
  readonly generatedAt: string
}

/** 내용은 그대로 두고 표시 순서만 갱신할 단계 */
export interface PreservedStep {
  readonly stepKey: string
  readonly seq: number
}

/**
 * 재생성 결과 → 09-data-model.md §6.1.
 *
 * **삭제 후 삽입이 아니라 `step_key` 기준 병합입니다.**
 */
export interface PlanResult {
  /** 저장할 것 — 새로 생겼거나 내용을 교체할 단계 */
  readonly upsert: readonly PlannedStep[]
  /**
   * 내용을 손대지 않을 단계.
   *
   * `done_verified` 와 `unconfirmed` 입니다. 완료된 단계를 덮으면 부산물이 끊기고,
   * `unconfirmed` 를 덮으면 리마인더 추적이 끊깁니다.
   *
   * **`seq` 는 갱신하세요.** 표시 순서는 새 플랜을 따라야 합니다 — 안 그러면
   * 단계를 하나 완료할 때마다 화면 순서가 어긋납니다.
   */
  readonly preserved: readonly PreservedStep[]
  /**
   * `skipped` 로 표시할 `step_key`.
   *
   * **지우지 않습니다.** 슬롯이 바뀌어 해당 없게 된 단계인데, 나중에 다시
   * 해당될 수 있고 사용자가 「사라졌다」고 느끼면 안 됩니다.
   */
  readonly skipped: readonly string[]
}

/** 이 모듈이 밖에 요구하는 것 — 서버 시계 */
export interface Clock {
  /** ISO 8601 · Asia/Seoul */
  now(): string
}

export interface Planner {
  /**
   * 플랜을 만든다. 이미 있으면 병합한다.
   *
   * **정보가 없다고 멈추지 않습니다.** 활성 조건을 못 넘긴 단계는 이번 플랜에
   * 안 들어갈 뿐이고, 빈 플랜도 정상입니다 → CLAUDE.md 불변 규칙 5.
   *
   * @throws KbError 근거 네 칸이나 `actor` 가 빈 KB 항목이 왔을 때.
   *         **버리고 넘어가지 않습니다** — 근거 없는 단계가 저장되면
   *         불변 규칙 1이 강제되지 않습니다 → 09-data-model.md §6.
   */
  build(input: PlanInput): PlanResult
}
