/**
 * chat-receiver — 발화를 받아 층 2의 순서를 부른다
 *
 * 계약: spec/backend/08-16-chat-context.md §1 §5 §6 §9
 * 근거: ADR-022 「절대 하지 않는 것」 · ADR-015 · ADR-028
 *
 * 절대 하지 않는 것 (ADR-022 결정 하나의 핵심 조항):
 * - **갈래를 판정하지 않습니다.** 답변인지 1332 안내인지 슬롯 질문인지는
 *   `citation-checker` 가 가릅니다
 * - **조회·조립·토큰화를 직접 하지 않습니다.** 부르기만 합니다
 * - **응답 형태를 만들지 않습니다.** `chat-publisher` 의 일입니다
 * - **저장하지 않습니다.** 감사 로그도 여기서 쓰지 않습니다
 *
 * **이 조항이 없으면 반드시 비대해집니다.** 재시도 판단·감사 로그·캐싱 경계·
 * 예외 전달이 전부 이 자리로 몰릴 힘이 있습니다 → ADR-022.
 */

/** 09-data-model.md §2 */
export type Track = 'victim' | 'frozen_account'

/** 모델이 쓰는 것 — 다섯 뿐입니다 → 11-chat-context.md §5 */
export interface ModelReply {
  /** 판단 근거. **사용자에게 나가지 않습니다** → 08-api.md §5.4 */
  readonly reasoning?: string
  /** 답할 근거를 못 찾았다는 선언. **에러가 아닙니다** → §6.3 */
  readonly insufficient: boolean
  readonly citations: readonly { ref: string; why: string }[]
  readonly reply?: string
  /**
   * 이 호출에 대해 **모델이 스스로 밝힌 것** — 답한 모델 이름과 토큰 수.
   *
   * 감사 기록 `llm.called` 의 `model`·`token_in` 이 여기서 옵니다
   * → 09-data-model.md §10.2. **부르는 쪽이 남깁니다**(ADR-022) — 이 모듈은
   * 실어 나르기만 합니다.
   *
   * **환경변수의 모델 이름을 쓰면 안 됩니다.** 후보를 차례로 시도하는 구조라
   * 거기 적힌 것과 실제로 답한 것이 다를 수 있고, 그러면 감사 기록이 거짓이 됩니다.
   * 제공자가 안 밝히면 `null` 입니다 — 지어내지 않습니다.
   */
  readonly call?: {
    readonly model: string | null
    readonly tokenIn: number | null
    readonly tokenOut: number | null
  }
}

/**
 * 이 모듈이 밖에 요구하는 것 — 모델 한 번 부르기.
 *
 * **도구를 부르지 않습니다.** 조회 조건은 서버가 전부 알고 있어 모델에게
 * 물어볼 이유가 없습니다 → 11-chat-context.md §1.
 */
export interface LlmClient {
  complete(prompt: { system: string; user: string }): Promise<ModelReply>
}

/**
 * 이 모듈이 밖에 요구하는 것 — 개인정보 토큰화.
 *
 * **여기가 격리 경계입니다.** 우회 경로를 만들면 규칙 위반입니다
 * → 04-pii-boundary.md 불변 규칙 2.
 */
export interface PiiTokenizer {
  /**
   * `allowedTerms` 는 **토큰화하지 않을 낱말**입니다 → 04-pii-boundary.md
   * 「토큰화 제외 목록」. 기관명이 여기 들어가고 **NER 결과보다 우선**합니다 —
   * 안 넘기면 「토스로 보냈어요」가 「[이름-1]로 보냈어요」가 되어
   * 경유 서비스를 특정할 수 없습니다.
   *
   * `mappings` 는 **이 사건에서 이미 쓰인 이름표**입니다 → 04-pii-boundary.md
   * 「번호의 단위」. 안 넘기면 발화마다 번호가 1부터라, 브라우저가 앞서 붙인
   * `[계좌-1]` 과 서버가 이번에 붙인 `[계좌-1]` 이 **다른 계좌인데 같은
   * 이름표**가 되고 복원이 엉뚱한 값을 되살립니다.
   */
  tokenize(
    text: string,
    ctx?: {
      allowedTerms?: readonly string[]
      mappings?: readonly IssuedToken[]
    },
  ): Promise<{ masked: string }>
}

/**
 * 이미 쓰인 이름표 하나 — **원문이 없습니다.**
 *
 * 짝을 봉한 열쇠는 브라우저에만 있어(ADR-027) 서버는 「어느 번호가 쓰였나」만
 * 압니다. 번호를 잇는 데 값이 필요 없다는 것이 요점이라, **원문을 받는 칸을
 * 여기 만들지 마세요** → `pii-tokenizer/ledger.ts`.
 */
export interface IssuedToken {
  /** `[계좌-1]` 형태 */
  readonly token: string
  readonly kind: string
  /** 종류별 일련번호. 1부터 */
  readonly seq: number
}

/** 이 모듈이 밖에 요구하는 것 — KB 조회 (`kb-finder`) */
export interface KbSource {
  find(query: {
    kbVersion: string
    track: Track
    channelId: string | null
    orgId: string | null
    asOf: string
  }): Promise<{ applied: readonly KbEntry[]; reference: readonly KbEntry[] }>
}

/** 프롬프트에 들어갈 절차 항목 하나 */
export interface KbEntry {
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly label: string
  readonly body: string
  /** 참고 절차에만 붙습니다. 조건 라벨을 붙일 근거가 됩니다 */
  readonly channelId?: string
}

/** 이 모듈이 밖에 요구하는 것 — 프롬프트 조립 (`prompt-builder`) */
export interface PromptSource {
  build(input: {
    kbApplied: readonly KbEntry[]
    kbReference: readonly KbEntry[]
    caseTalk: readonly { speaker: string; text: string }[]
    caseState: readonly {
      label: string
      value: string
      stepId?: string
      deadlineId?: string
    }[]
    history: readonly { speaker: 'user' | 'assistant'; text: string }[]
    currentDate: string
  }): {
    system: string
    user: string
    issued: readonly IssuedRef[]
    counts: { applied: number; reference: number }
  }
}

/** 이번 턴에 발급한 참조 번호 하나 */
export interface IssuedRef {
  readonly ref: string
  readonly label: string
  /** `case-` 줄이 단계일 때만 → §3.9 `referenced_steps` */
  readonly stepId?: string
  /** `case-` 줄이 기한일 때만 → §3.9 `referenced_deadlines` */
  readonly deadlineId?: string
  readonly kbEntryId?: string
  readonly kbVersion?: string
}

/** 이 모듈이 밖에 요구하는 것 — 인용 검증 (`citation-checker`) */
export interface CitationSource {
  check(input: {
    reply: { insufficient: boolean; citations: readonly { ref: string; why: string }[] }
    issued: readonly string[]
    kbResultEmpty: boolean
  }): CitationOutcome
}

/** 무엇을 어겼나 → `citation-checker` 의 `Violation` 과 같은 모양입니다 */
export type Violation =
  | { readonly rule: 'unknown_ref'; readonly ref: string }
  | { readonly rule: 'why_empty'; readonly ref: string }

/**
 * 인용 검증 결과 넷.
 *
 * **이 판정을 이 모듈이 하지 않습니다.** 그대로 실어 넘길 뿐입니다 → ADR-022.
 *
 * `retry` 만 이 모듈 안에서 소비됩니다 — 다시 부르거나, 예산이 끝나면 던집니다.
 * 나머지 셋은 `chat-publisher` 로 그대로 갑니다.
 */
export type CitationOutcome =
  | { readonly kind: 'pass' }
  | { readonly kind: 'retry'; readonly violations: readonly Violation[] }
  | { readonly kind: 'guide_1332' }
  | { readonly kind: 'ask_slot' }

/** 다시 부를 일이 없는 갈래 — `chat-publisher` 로 넘어갑니다 */
export type SettledOutcome = Exclude<CitationOutcome, { kind: 'retry' }>

/** 이 모듈이 밖에 요구하는 것 — 재시도 판단 (`retry-checker`) */
export interface RetryJudge {
  decide(input: {
    error: unknown
    attempts: number
    elapsedMs: number
    lane: 'interactive'
  }): { retry: boolean; delayMs?: number }
}

/** 이 모듈이 밖에 요구하는 것 — 서버 시계 */
export interface Clock {
  /** `YYYY-MM-DD` · Asia/Seoul. KB 조회 기준일 */
  today(): string
  /** 사람이 읽는 오늘. 프롬프트에 들어갑니다 (`2026년 8월 20일`) */
  todayLabel(): string
  /** 경과 시간을 재는 데 씁니다 */
  nowMs(): number
}

/** 사건에서 서버가 이미 아는 것들 → 11-chat-context.md §1 */
export interface CaseContext {
  readonly caseId: string
  readonly track: Track
  readonly channelId: string | null
  readonly orgId: string | null
  /** 토큰화된 사건 대화 (사기범과 주고받은 것) */
  readonly caseTalk: readonly { speaker: string; text: string }[]
  /**
   * 슬롯·단계·기한·부산물. **날짜는 이미 계산된 문자열입니다** → §3.3
   *
   * `stepId`·`deadlineId` 는 **프롬프트에 안 들어갑니다.** 모델이 그 줄을
   * 인용했을 때 서버가 무엇이었는지 되짚는 데만 씁니다 → §3.9.
   */
  readonly caseState: readonly {
    label: string
    value: string
    stepId?: string
    deadlineId?: string
  }[]
  /** 이전 턴들. 이번 발화는 여기 붙습니다 */
  readonly history: readonly { speaker: 'user' | 'assistant'; text: string }[]
}

export interface TurnInput {
  readonly caseContext: CaseContext
  /** 사용자가 방금 한 말. **아직 토큰화 전입니다** */
  readonly utterance: string
  /** 현재 KB 릴리스 */
  readonly kbVersion: string
  /**
   * 이 사건에서 이미 발급된 이름표 — **다음 번호는 여기 뒤에서** 나갑니다
   * → 04-pii-boundary.md 「번호의 단위」.
   *
   * **모으는 것은 부른 쪽입니다**(`flows/chat-turn.ts`). 이 모듈은 저장소를
   * 안 봅니다 → ADR-022 「조회를 직접 하지 않습니다」.
   */
  readonly issuedTokens?: readonly IssuedToken[]
}

/**
 * 한 턴의 결과.
 *
 * **응답 본문이 아닙니다.** 이걸 형태로 옮기는 것은 `chat-publisher` 이고,
 * 저장과 감사 로그는 부른 쪽이 합니다 → ADR-022.
 */
export interface TurnOutcome {
  /**
   * `citation-checker` 의 판정. 그대로 옮긴 것입니다.
   *
   * **`retry` 는 여기 오지 않습니다** — 이 모듈 안에서 다시 부르거나 던집니다.
   */
  readonly outcome: SettledOutcome
  readonly reply: ModelReply
  /** 이번 턴에 발급한 참조. `chat-publisher` 가 인용을 채울 때 씁니다 */
  readonly issued: readonly IssuedRef[]
  /** 프롬프트에 넣은 KB 항목. `message.kb_context_refs` 로 갑니다 → §7.1 */
  readonly kbContextRefs: readonly KbContextRef[]
  /** 이 턴에 보낸 프롬프트 전문. 토큰화 상태. `message.prompt_masked` 로 갑니다 */
  readonly promptMasked: string
  /** 토큰화된 사용자 발화. `message` 에 저장할 것은 이쪽입니다 */
  readonly utteranceMasked: string
  /** 감사 로그(`chat.context_built`)에 넣을 건수. **여기서 쓰지 않습니다** → §7.2 */
  readonly counts: { applied: number; reference: number; transcriptLines: number }
  /** 모델을 몇 번 불렀나. 1 또는 2입니다 */
  readonly attempts: number
}

/** `message.kb_context_refs` 한 줄 → 09-data-model.md §9 */
export interface KbContextRef {
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly group: 'applied' | 'reference'
}

export interface ChatReceiver {
  /**
   * 한 턴을 돈다 — 토큰화 → 조회 → 조립 → 모델 1회 → 인용 검증.
   *
   * **모델 호출은 한 번입니다.** 인용 형식을 어겼을 때만 한 번 더 부릅니다
   * → 11-chat-context.md §6.3. `insufficient: true` 로는 다시 부르지 않습니다 —
   * 같은 프롬프트로 다시 물으면 같은 답이 옵니다.
   *
   * @throws KbUnavailableError 조회 자체가 실패했을 때. **챗을 멈춥니다** → §9
   * @throws KbCitationMissingError 재시도 뒤에도 인용 형식을 못 맞췄을 때
   */
  receive(input: TurnInput): Promise<TurnOutcome>
}
