/**
 * citation-checker — 입출력 타입.
 *
 * 정본: spec/backend/08-16-chat-context.md §6.2 · §6.3
 * 근거: ADR-015 (참조 번호를 자료 전체에 붙이고, 근거가 없으면 되묻는다) · ADR-028
 *
 * 이 모듈은 밖에서 받아올 것이 없다. 판단에 필요한 것을 전부 입력으로 받는다 —
 * 조회도 저장도 하지 않으므로 contract 에 인터페이스가 없다.
 *
 * 절대 하지 않는 것: 「이번 답변이 절차를 말했는가」를 판정하기 · 인용이 비었다고 에러 내기
 */

/**
 * 모델이 낸 인용 하나.
 *
 * **모델이 쓰는 것은 ref 와 why 뿐이다** → 08-16-chat-context.md §5.
 * label·kb_entry_id·kb_version 은 서버가 ref 로 찾아 채우므로 모델에게 요구하지 않는다.
 */
export interface ModelCitation {
  readonly ref?: string
  readonly why?: string
}

/** 검증 대상이 되는 모델 응답의 부분 */
export interface ModelReply {
  /** 모델이 답할 근거가 없다고 밝힌 것 → §5.2 */
  readonly insufficient: boolean
  readonly citations: readonly ModelCitation[]
}

export interface CitationInput {
  readonly reply: ModelReply

  /**
   * 이번 턴에 서버가 프롬프트에 넣으며 붙인 번호 전부.
   *
   * 접두로 무엇인지 갈린다 → §3.4
   *   kb-    절차 항목
   *   case-  사건 정보 — 슬롯·단계·기한·부산물
   *   t-     사건 대화 한 줄
   */
  readonly issued: readonly string[]

  /**
   * KB 조회 결과가 0건이었는가.
   *
   * 조회 실패(KbUnavailableError)와 다르다 — 그쪽은 챗을 멈추므로
   * 이 모듈에 도달하지 않는다 → 08-16-errors.md §4.1
   */
  readonly kbResultEmpty: boolean
}

/** 무엇을 어겼나. 감사 로그와 재생성 프롬프트에 쓴다 */
export type Violation =
  /** 이번 턴에 발급하지 않은 번호를 썼다 — 지어낸 참조 */
  | { readonly rule: 'unknown_ref'; readonly ref: string }
  /** why 가 비어 있다 — 형식 위반 */
  | { readonly rule: 'why_empty'; readonly ref: string }

/**
 * 판정 결과 넷. 어느 갈래로도 에러가 나가지 않는 것이 둘이다 →
 * ARCHITECTURE §4 층 2 흐름도 · ADR-015
 */
export type CitationOutcome =
  /** 통과. 응답을 그대로 내보낸다 */
  | { readonly kind: 'pass' }
  /** 형식 위반. 같은 프롬프트로 다시 생성한다 (최대 2회) → 08-16-errors.md §4.2 */
  | { readonly kind: 'retry'; readonly violations: readonly Violation[] }
  /** KB 조회가 0건이라 되물어도 안 나온다. 절차를 말하지 않고 1332 안내 → §6.3 */
  | { readonly kind: 'guide_1332' }
  /** 조회는 됐는데 근거를 못 찾았다. slot-checker 로 넘겨 질문 한 문항을 낸다 → §6.3 */
  | { readonly kind: 'ask_slot' }

export interface CitationChecker {
  check(input: CitationInput): CitationOutcome
}
