/**
 * chat-publisher — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/common/08-14-api.md §3.9 (갈래별 응답) · §5.4 (판단 근거 분리)
 *       spec/backend/08-16-chat-context.md §9 · spec/backend/08-16-errors.md §4.1
 * 근거: ADR-022 (이 모듈을 세운 결정) · ADR-021
 *
 * **나가는 것을 마지막으로 만지는 자리입니다.** 여기를 지나지 않고 응답이 나가면
 * 판단 근거 분리와 잔여 PII 검사가 통째로 빠집니다.
 */

/** 08-14-api.md §3.9 — `kb-` 항목에만 식별자가 붙습니다 */
export interface Citation {
  readonly ref: string
  readonly label?: string
  readonly why?: string
  readonly kb_entry_id?: string
  readonly kb_version?: string
  readonly legal_basis?: string
  readonly source_url?: string
  readonly effective_from?: string
}

/** 08-14-api.md §3.4 가 정의한 구조. 여기서는 그대로 실어 보내기만 합니다 */
export interface NextQuestion {
  readonly slot_key: string
  readonly text: string
  readonly input: 'buttons' | 'text' | 'date' | 'amount'
  readonly options?: readonly string[]
}

/**
 * 어느 갈래를 내보내는가. **판정은 `citation-checker` 가 하고 여기는 형태만 씌웁니다** —
 * 판정이 이쪽으로 새면 갈래가 두 곳에서 결정됩니다 → ADR-022.
 *
 * **판단 근거(`reasoning`)를 받는 자리가 아예 없습니다.** 넣을 수 없으니 샐 수도 없습니다
 * → 08-14-api.md §5.4.
 */
export type PublishInput =
  /** 인용이 붙은 정상 답변 */
  | {
      readonly kind: 'answer'
      readonly messageId: string
      readonly reply: string
      readonly citations: readonly Citation[]
      /** 답변과 함께 물을 것이 있으면. 보통 null */
      readonly nextQuestion?: NextQuestion | null
    }
  /** KB 조회가 0건. 절차를 말하지 않고 1332 로 안내 */
  | {
      readonly kind: 'guide_1332'
      readonly messageId: string
    }
  /** 근거를 못 찾아 되묻는다. 질문은 slot-checker 가 만든 것을 그대로 쓴다 */
  | {
      readonly kind: 'ask_slot'
      readonly messageId: string
      readonly nextQuestion: NextQuestion
    }

/**
 * 세 갈래가 같은 껍데기로 나갑니다 — **화면이 갈래를 분기하지 않게** 하려는 것입니다.
 *
 * ⬜ TODO(미정): 공통 형태의 정본이 없습니다. 08-14-api.md §3.9 가 갈래별 예시만
 * 적고 있어, 그 셋의 합집합으로 두었습니다 → ADR-022 「남은 것」.
 */
export interface ChatResponseBody {
  readonly message_id: string
  readonly reply: string
  /** 인용할 것이 없으면 빈 배열. **비어 있는 것 자체는 위반이 아닙니다** */
  readonly citations: readonly Citation[]
  /** 물을 것이 없으면 null. **null 이어도 실행 보드는 열립니다** */
  readonly next_question: NextQuestion | null
  /** 조회가 0건이었을 때만 붙습니다 → 08-16-errors.md §4.1 */
  readonly kb_result?: 'empty'
}

/**
 * 이 모듈이 밖에 요구하는 것 — 나가는 텍스트에 개인정보가 남았는지.
 *
 * 패턴의 정본이 아직 없어(04-pii-boundary.md TODO) 구현을 주입받습니다.
 * `pii-masker` 의 규칙을 재사용하는 구현을 넣으면 두 자리가 같은 기준으로 봅니다.
 */
export interface ResidualPiiScanner {
  /**
   * 종류별 건수. 비어 있으면 통과입니다.
   * **값을 담지 않습니다** — 무엇이 남았는지 값으로 알려주지 않는 것이 규칙입니다
   * → 08-16-errors.md 원칙 2.
   */
  scan(text: string): Readonly<Record<string, number>>
}

export interface ChatPublisher {
  /**
   * 갈래를 한 형태로 씌워 내보낸다.
   *
   * @throws EgressBlockedError 잔여 개인정보가 발견되면. **통과시키고 로그만 남기는
   *         경로를 만들지 않습니다** → 08-16-errors.md 원칙 1.
   */
  publish(input: PublishInput): ChatResponseBody
}
