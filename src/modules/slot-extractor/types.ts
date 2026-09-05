/**
 * slot-extractor — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-14-slot-tiering.md (자동 추출 우선 · 실패는 정상 경로)
 *       spec/backend/08-16-data-model.md §5 §5.1 §5.2 (슬롯 이름·값 타입·상태)
 *       spec/common/08-16-module-boundaries.md 서버 표
 * 근거: ADR-014(이름) · ADR-028(모듈 모양)
 *
 * **`slot-checker` 와 다른 모듈입니다.** 값을 뽑는 것은 LLM 이 하고(층 1),
 * 충분한지 판정하고 다음 질문을 고르는 것은 규칙이 합니다(층 3)
 * → 12-module-names.md. 한 이름으로 묶으면 LLM 을 쓰는 곳과 쓰지 않는 곳의
 * 경계가 이름에서 사라집니다.
 *
 * 절대 하지 않는 것: 추출 실패를 에러로 올리기 · 목록 밖 슬롯 이름을 쓰기 ·
 * 토큰화되지 않은 텍스트를 모델에 보내기 · 뽑은 값을 `confirmed` 로 올리기
 */

/** 09-data-model.md §5.1 의 목록. **여기 없는 이름은 적재가 거부됩니다** */
export type SlotKey =
  | 'transferred'
  | 'channel'
  | 'org_name'
  | 'amount'
  /** 금액 구간. **뽑지 않습니다** — 버튼으로만 받는 값입니다 (SLOT_HINT 참고) */
  | 'amount_hint'
  | 'occurred_at'
  | 'elapsed_hint'
  | 'contact_method'
  | 'counterpart_account'
  | 'impersonated_org'
  | 'freeze_requested_at'
  | 'relief_applied_at'
  | 'report_filed_at'
  | 'objection_submitted_at'
  /** 피해자 본인 계좌의 토큰 — 이체 내역의 「보낸 계좌」 → ADR-070 */
  | 'victim_account'
  /** 피해자 본인 이름의 토큰 — 2차 탐지가 만든 `[이름-N]` 이 있을 때만 → ADR-070 */
  | 'victim_name'

/** 09-data-model.md §5.1 */
export type SlotValueType = 'datetime' | 'decimal' | 'string' | 'enum' | 'bool'

/**
 * 슬롯마다 정해진 값 타입 → 09-data-model.md §5.1 의 표를 그대로 옮긴 것입니다.
 *
 * **모델이 정하지 않습니다.** 타입은 스키마가 이미 정했고, 모델은 값만 냅니다 —
 * 모델에게 타입까지 물으면 `case_slot.value_type` 의 `CHECK` 를 어기는 값이 옵니다.
 */
export const SLOT_VALUE_TYPE: Readonly<Record<SlotKey, SlotValueType>> = {
  transferred: 'bool',
  channel: 'enum',
  org_name: 'string',
  amount: 'decimal',
  amount_hint: 'string',
  occurred_at: 'datetime',
  elapsed_hint: 'string',
  contact_method: 'string',
  counterpart_account: 'string',
  impersonated_org: 'string',
  freeze_requested_at: 'datetime',
  relief_applied_at: 'datetime',
  report_filed_at: 'datetime',
  objection_submitted_at: 'datetime',
  victim_account: 'string',
  victim_name: 'string',
}

/** 뽑아낸 값 하나 — `case_slot` 한 행이 됩니다 */
export interface ExtractedSlot {
  readonly slotKey: SlotKey
  /**
   * 토큰화된 값. **원문이 아닙니다** — 칼럼 이름이 `value_masked` 인 이유입니다
   * → 09-data-model.md §5. 모델이 본 것이 이미 토큰화된 텍스트라 그 상태 그대로입니다.
   */
  readonly valueMasked: string
  readonly valueType: SlotValueType
  /** 0~1. **임계값 판단은 여기서 하지 않습니다** — 아래 참고 */
  readonly confidence: number
  /** 어느 증거에서 나왔나. `case_slot.source_ref` */
  readonly sourceRef: string | null
}

/**
 * 모델이 내놓아야 하는 모양.
 *
 * **값과 확신도를 함께 요구합니다.** 확신도가 없으면 「뽑았다」와 「그럴 것 같다」를
 * 구분할 수 없고, 그 구분이 질문을 생략할지 말지를 가릅니다
 * → 08-14-slot-tiering.md 「T2 는 증거 자동 추출이 우선」.
 */
export interface ModelSlot {
  readonly slot_key?: unknown
  readonly value?: unknown
  readonly confidence?: unknown
}

/** `channel` 슬롯이 가질 수 있는 값 → 03-channel-matrix.md 의 9유형 */
export type ChannelId =
  | 'CH-bank'
  | 'CH-neobank'
  | 'CH-securities'
  | 'CH-easypay'
  | 'CH-crypto'
  | 'CH-facetoface'
  | 'CH-giftcard'
  | 'CH-carrier'
  /** 카드 부정사용·카드론. 근거법이 여신전문금융업법이라 별개입니다 → ADR-055 */
  | 'CH-card'

/** 이 모듈이 밖에 요구하는 것 — 모델 한 번 부르기 */
export interface LlmClient {
  complete(prompt: { system: string; user: string }): Promise<{ text: string }>
}

export interface ExtractInput {
  /**
   * **토큰화된** 전사·OCR 텍스트.
   *
   * ⚠️ 원문을 넣지 마세요. `pii-tokenizer` 를 지나지 않은 텍스트가 모델로 가면
   * 불변 규칙 2 위반입니다 → 04-pii-boundary.md.
   */
  readonly maskedText: string
  /** 어느 증거에서 왔나. 뽑은 값마다 그대로 붙습니다 */
  readonly evidenceId?: string
  /** 이미 채워진 슬롯. **다시 뽑지 않습니다** */
  readonly known?: readonly SlotKey[]
}

export interface ExtractResult {
  /**
   * 뽑힌 값들. **하나도 못 뽑는 것이 정상입니다.**
   *
   * 자동 추출 실패는 정상 경로라, 빈 배열이 나가고 `slot-checker` 가 질문으로
   * 흘려보냅니다 → 08-14-slot-tiering.md 「예외로 처리하지 말고 질문 경로로」.
   */
  readonly slots: readonly ExtractedSlot[]
  /**
   * 모델이 냈지만 버린 것의 수.
   *
   * 목록 밖 이름, 값이 빈 것, 확신도가 숫자가 아닌 것. **왜 안 뽑혔는지**를
   * 밖에서 볼 수 있어야 모델 프롬프트를 고칠 단서가 생깁니다. 값은 담지 않습니다.
   */
  readonly dropped: number
  /**
   * 모델 응답을 **아예 못 읽었는가.**
   *
   * 「모델이 아무것도 안 냈다」와 「우리가 못 읽었다」가 같은 빈 결과로 보이면,
   * 지시문이 망가진 것을 아무도 모른 채 사용자에게 이미 말한 것을 계속 되묻게
   * 됩니다. **던지지는 않습니다** — 그래도 추출 실패는 정상 경로입니다.
   */
  readonly unreadable: boolean
}

export interface SlotExtractor {
  /**
   * 전사에서 슬롯 값을 뽑는다.
   *
   * **어떤 경우에도 추출 실패로 던지지 않습니다.** 모델이 헛소리를 해도,
   * 아무것도 못 뽑아도 빈 결과가 나갑니다 → 13-module-boundaries.md
   * *"절대 하지 않는 것: 추출 실패를 에러로 올리기"*.
   *
   * @throws LlmError 모델 호출 자체가 실패했을 때. **그건 추출 실패가 아니라
   *         시스템 실패라 재시도 판단으로 넘어갑니다** → 10-errors.md §2.
   */
  extract(input: ExtractInput): Promise<ExtractResult>
}
