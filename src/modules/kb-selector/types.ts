/**
 * kb-selector 의 어휘.
 *
 * 계약: spec/backend/08-16-chat-context.md §2.6 · 근거: ADR-089
 * 이름: spec/common/08-16-module-names.md 「층 2」
 *
 * ## 절대 하지 않는 것
 *
 * - **답을 쓰지 않는다.** 출력은 후보의 번호뿐이다. 문장·요약·해석을 만들지 않는다.
 * - **DB 를 모른다.** 후보 목록과 대화 내역을 받을 뿐, 어디서 왔는지 묻지 않는다.
 * - **원문을 보지 않는다.** 받는 대화 내역은 이미 토큰화된 것이어야 한다(불변 규칙 2).
 *   이 모듈은 그것을 검사하지 않는다 — 검사하면 경계가 둘이 된다.
 * - **답변을 막지 않는다.** 실패·시간 초과는 빈 선택으로 끝나고, 부르는 쪽은 그대로 답변으로 간다.
 */

/** 후보의 종류 — 프롬프트에는 「절차 · 연락처 · 조문」으로 적힌다 */
export type CandidateKind = 'kb' | 'org' | 'law'

/** 선별기에 보이는 후보 한 줄. `[번호] 종류 · 이름: 내용 앞부분` */
export interface SelectorCandidate {
  /** 부르는 쪽이 정한 열쇠. 제외 목록과 결과 대조에 쓴다 — 예: `kb:common-relief-documents` */
  readonly key: string
  readonly kind: CandidateKind
  /** 절차 제목 · 기관 이름 · 법령명 제n조 */
  readonly tag: string
  /** 본문 앞부분. 200자를 넘기면 여기서 자른다 */
  readonly preview: string
}

/** 선별 호출 한 번의 계측 — 제공자가 밝힌 값만 담는다. 모르면 null */
export interface SelectorCall {
  readonly model: string | null
  readonly tokenIn: number | null
  readonly tokenOut: number | null
}

/**
 * 선별 전용 언어모델. 답변 모델과 다른 것을 끼운다(ADR-089 ④).
 *
 * 시간 상한은 **부르는 쪽이 매번 준다** — 남은 예산이 호출마다 다르다.
 * 넘기면 던진다. 재시도는 이 모듈이 정한다(안 한다).
 */
export interface SelectorLlm {
  completeText(
    prompt: { system: string; user: string },
    opts: { timeoutMs: number },
  ): Promise<{ text: string; call: SelectorCall }>
}

export interface HistoryLine {
  readonly speaker: 'user' | 'assistant'
  /** 토큰화된 글 */
  readonly text: string
}

export interface SelectInput {
  /** 최근 대화. 마지막 줄이 이번 발화 */
  readonly history: readonly HistoryLine[]
  readonly candidates: readonly SelectorCandidate[]
  /** 이미 프롬프트에 든 것의 열쇠 — 후보에서 뺀다 */
  readonly exclude?: ReadonlySet<string>
  /** 최대 몇 개 고르나. 기본 5 */
  readonly topK?: number
}

/** 왜 끝까지 못 갔나. 없으면 정상 종료 */
export type SkipReason = 'empty_pool' | 'timeout' | 'error'

export interface SelectStats {
  /** 제외를 뺀 후보 수 */
  readonly pool: number
  /** 1단계 묶음 수 */
  readonly groups: number
  /** 2단계 라운드 수 */
  readonly rounds: number
  readonly ms: number
  /** 실제로 답을 받은 호출들 — 감사 `llm.called` 로 간다 */
  readonly calls: readonly SelectorCall[]
  readonly skipped?: SkipReason
}

export interface SelectResult {
  readonly picked: readonly SelectorCandidate[]
  readonly stats: SelectStats
}

export interface SelectorClock {
  nowMs(): number
}

export interface SelectorOptions {
  /** 기본 5 */
  readonly topK?: number
  /** 선별 전체의 상한. 기본 10,000 */
  readonly timeoutMs?: number
  /** 한 묶음의 글자 수 상한 — 토큰 3,000 을 글자로 어림한 값. 기본 6,000 */
  readonly maxGroupChars?: number
  /** 2단계 최대 라운드. 기본 6 */
  readonly maxRounds?: number
  /** 대화 내역을 몇 턴까지 보이나. 기본 6 */
  readonly historyTurns?: number
}

export interface KbSelector {
  select(input: SelectInput): Promise<SelectResult>
}
