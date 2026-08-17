/**
 * citation-checker — 입출력 타입.
 *
 * 정본: spec/backend/08-16-chat-context.md §6.2 · §6.3
 * 근거: ADR-015 (참조 번호를 자료 전체에 붙이고, 근거가 없으면 되묻는다) · ADR-021
 *
 * 이 모듈은 밖에서 받아올 것이 없다. 판단에 필요한 것을 전부 입력으로 받는다 —
 * 조회도 저장도 하지 않으므로 contract 에 인터페이스가 없다.
 */

/**
 * 서버가 이번 턴에 발급한 참조 번호 하나.
 *
 * 접두로 무엇인지 갈린다 → §3.4
 *   kb-    절차 항목 (프롬프트 블록 2·3)
 *   case-  사건 정보 — 슬롯·단계·기한·부산물 (블록 5)
 *   t-     전사 한 줄 (블록 4)
 */
export interface IssuedRef {
  readonly ref: string

  /**
   * kb- 항목에만 있다. 사건 정보와 전사는 지식 베이스 항목이 아니다 → §5
   */
  readonly kbEntryId?: string
  readonly kbVersion?: string
}

/** 모델이 낸 인용 하나. why·reply·insufficient 만 모델이 새로 쓴다 → §5 */
export interface ModelCitation {
  readonly ref?: string
  readonly label?: string
  readonly why?: string
  readonly kbEntryId?: string
  readonly kbVersion?: string
}

/** 검증 대상이 되는 모델 응답의 부분 */
export interface ModelReply {
  /** 모델이 답할 근거가 없다고 밝힌 것 → §5.2 */
  readonly insufficient: boolean
  readonly citations: readonly ModelCitation[]
}

export interface CitationInput {
  readonly reply: ModelReply

  /** 이번 턴에 서버가 프롬프트에 넣으며 붙인 번호 전부 */
  readonly issued: readonly IssuedRef[]

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
  /** kb- 항목의 kb_entry_id·kb_version 이 발급한 값과 다르다 — 인용 바꿔치기 */
  | { readonly rule: 'citation_swapped'; readonly ref: string }
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
