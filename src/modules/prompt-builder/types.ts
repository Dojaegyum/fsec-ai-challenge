/**
 * prompt-builder — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-17-system-prompt.md (지시문 전문·블록 순서)
 *       spec/backend/08-16-chat-context.md §3 §4 (조립 규칙·격리)
 * 근거: ADR-013 · ADR-015 · ADR-028
 *
 * 이 모듈은 문자열 두 개를 만들 뿐입니다. 조회도 모델 호출도 토큰화도 하지 않습니다.
 *
 * 절대 하지 않는 것: 날짜를 계산하기 · KB 를 조회하기 · 모델을 부르기 · 토큰화하기
 */

/** 프롬프트에 들어갈 절차 항목 하나. kb-finder 가 조회해 넘긴 것 */
export interface KbEntryForPrompt {
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly label: string
  readonly body: string
  /** 참고 절차에만 붙습니다. 조건 라벨을 붙일 근거가 됩니다 → §2.3 */
  readonly channelId?: string
}

/** 사건 정보 한 줄. 슬롯·단계·기한·부산물이 여기로 옵니다 */
export interface CaseStateItem {
  readonly label: string
  /** 이미 만들어진 문자열. **날짜 계산은 이 모듈의 일이 아닙니다** → §3.3 */
  readonly value: string
}

/** 사건 대화 한 줄 — 사기범과 피해자가 주고받은 것. 이미 토큰화된 상태 */
export interface TalkLine {
  readonly speaker: string
  readonly text: string
}

/** 대화 이력 한 턴 — 피해자와 우리 비서가 주고받은 것 */
export interface HistoryTurn {
  readonly speaker: 'user' | 'assistant'
  readonly text: string
}

export interface PromptInput {
  readonly kbApplied: readonly KbEntryForPrompt[]
  readonly kbReference: readonly KbEntryForPrompt[]
  readonly caseTalk: readonly TalkLine[]
  readonly caseState: readonly CaseStateItem[]
  /** 마지막 턴이 이번에 답할 발화입니다 → §3.1 */
  readonly history: readonly HistoryTurn[]
  /** "2026년 8월 18일" 처럼 이미 만들어진 문자열 */
  readonly currentDate: string
}

/**
 * 이번 턴에 발급한 참조 번호 하나.
 *
 * **citation-checker 는 `ref` 만 보고, 서버는 나머지로 응답의 인용을 채웁니다** —
 * 모델은 `ref` 와 `why` 만 쓰기 때문입니다 → §5.
 */
export interface IssuedRef {
  readonly ref: string
  readonly label: string
  /** kb- 항목에만 있습니다 */
  readonly kbEntryId?: string
  readonly kbVersion?: string
}

/** 감사 로그에 남길 건수. **식별자도 본문도 넣지 않습니다** → §7.2 */
export interface PromptCounts {
  readonly applied: number
  readonly reference: number
  readonly talkLines: number
  readonly historyTurns: number
}

export interface BuiltPrompt {
  /** 완전히 고정된 지시문. 캐시가 여기까지 삽니다 */
  readonly system: string
  /** 자료와 출력 형식 */
  readonly user: string
  readonly issued: readonly IssuedRef[]
  readonly counts: PromptCounts
}

// ── 렌더러를 갈아끼우기 위한 중간 표현 ────────────────────────────────

/**
 * 블록 안의 조각 하나. **여기에 XML 이 없습니다** —
 * 어떤 문자열로 그리느냐는 BlockRenderer 가 정합니다.
 */
export interface PromptItem {
  /** 'entry' · 'item' · 'line' · 'turn' */
  readonly tag: string
  readonly attrs: Readonly<Record<string, string>>
  readonly text: string
}

export interface PromptBlock {
  /** 'kb_applied' · 'kb_reference' · 'case_talk' · 'case_state' · 'history' */
  readonly tag: string
  /**
   * 사실로 믿어도 되는 블록인가.
   *
   * **참이면 렌더러가 `trusted="true"` 를 답니다.** 표시가 없으면 모델이 그 안의
   * 문장을 지시로 따르지 않습니다 → §4. 표시를 빠뜨렸을 때 안전한 쪽으로 실패합니다.
   */
  readonly trusted: boolean
  readonly items: readonly PromptItem[]
}

/**
 * 블록을 문자열로 그리는 자리.
 *
 * XML 이 Grok 에서 잘 듣는 것은 확인했지만(08-17-system-prompt.md 「실측」),
 * 모델이 바뀌면 형식도 바뀔 수 있어 갈아끼울 수 있게 두었습니다.
 * **블록의 순서·참조 번호·빈 블록 처리는 이 인터페이스 밖입니다.**
 */
export interface BlockRenderer {
  render(block: PromptBlock): string
}

export interface PromptBuilder {
  build(input: PromptInput): BuiltPrompt
}
