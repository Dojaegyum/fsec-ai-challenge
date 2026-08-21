/**
 * case-reader — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/common/08-14-features.md `F-04` · spec/common/08-16-module-boundaries.md 서버 표
 *       spec/common/08-14-pii-boundary.md 「인젝션 방어」
 * 근거: ADR-014(이름) · ADR-028(모듈 모양)
 *
 * **이 모듈의 판정은 절차를 가르지 않습니다.** 분기축은 경유 서비스 하나이고,
 * 여기 결과는 **화면 표시와 관리자 조회에서만** 소비됩니다
 * → 12-module-names.md · 디자인 토큰 문서.
 *
 * 절대 하지 않는 것: 근거 없이 판정하기 · 분류 목록을 지어내기 ·
 * 모델이 지어낸 근거를 통과시키기 · 토큰화되지 않은 텍스트를 모델에 보내기
 */

/**
 * 판정의 근거가 된 구간 하나.
 *
 * **정본이 이것을 필수로 못 박았습니다** — *"F-04는 근거 스팬 인용이 필수입니다.
 * 판정만 내고 근거를 못 대는 응답은 스펙 위반입니다"*.
 */
export interface EvidenceSpan {
  readonly start: number
  readonly end: number
  /** 입력 텍스트의 그 구간 **그대로**. 모델이 고쳐 쓴 것은 근거가 아닙니다 */
  readonly quote: string
}

/** 판정 하나 */
export interface Analysis {
  /** 무슨 수법인가. ⬜ 값 목록의 정본이 없어 밖에서 받습니다 */
  readonly category: string
  /** 얼마나 위험한가. ⬜ 값 목록의 정본이 없어 밖에서 받습니다 */
  readonly risk: string
  /** **비어 있을 수 없습니다.** 하나 이상 */
  readonly spans: readonly EvidenceSpan[]
}

/**
 * 판정이 안 나온 이유.
 *
 * **에러 코드가 아닙니다.** 08-16-errors.md §3 의 표와 무관한 내부 진단값이고,
 * 관리자 조회에서 「왜 판정이 비었나」를 설명하는 데 씁니다.
 */
export type RejectReason =
  /** ⬜ 분류·위험도 목록이 안 붙어 있습니다 */
  | 'no_taxonomy'
  /** 모델이 형식을 안 지켰습니다 */
  | 'unreadable'
  /** 목록 밖 분류·위험도를 냈습니다 */
  | 'unknown_value'
  /** 근거를 못 댔거나, 댄 근거가 입력에 없습니다 */
  | 'no_span'

export interface ReadResult {
  /**
   * 판정. **못 내면 `null` 입니다.**
   *
   * 근거를 못 대는 판정은 스펙 위반이라 내보내지 않습니다. 대신 **멈추지도
   * 않습니다** — 이 값은 절차를 가르지 않아 없어도 사용자가 막히지 않습니다
   * → CLAUDE.md 불변 규칙 5.
   */
  readonly analysis: Analysis | null
  /** `analysis` 가 `null` 일 때만 채워집니다 */
  readonly rejected?: RejectReason
  /**
   * 버린 근거의 수. **값은 담지 않습니다.**
   *
   * 세 가지를 함께 셉니다 — 인용이 비었거나, 입력에 없거나(지어냈거나 고쳐 썼거나),
   * 같은 대목을 이미 다 썼거나. ⬜ 이유별로 나눠 세면 지시문을 어느 쪽으로 고칠지가
   * 더 또렷해집니다. 지금은 한 숫자입니다.
   */
  readonly droppedSpans: number
}

/**
 * 이 모듈이 밖에 요구하는 것 — 쓸 수 있는 판정 값.
 *
 * ⬜ **정본에 값 목록이 없습니다.** `F-04` 가 「수법 분류·위험도」라고만 적었고
 * 어떤 분류가 있는지는 어디에도 없습니다.
 *
 * **여기서 지어내지 않습니다.** 지어낸 분류가 피해자 화면에 뜨면 그건 근거 없는
 * 판정이고, 이 모듈이 막으려는 바로 그것입니다.
 *
 * **비어 있으면 아무 판정도 내지 않습니다** — 검증할 기준이 없는데 통과시키면
 * 목록을 두는 뜻이 없어집니다.
 */
export interface Taxonomy {
  readonly categories: readonly string[]
  readonly riskLevels: readonly string[]
}

/** 이 모듈이 밖에 요구하는 것 — 모델 한 번 부르기 */
export interface LlmClient {
  complete(prompt: { system: string; user: string }): Promise<{ text: string }>
}

export interface ReadInput {
  /**
   * **토큰화된** 전사·OCR 텍스트.
   *
   * ⚠️ 원문을 넣지 마세요 → 04-pii-boundary.md 불변 규칙 2.
   */
  readonly maskedText: string
}

export interface CaseReader {
  /**
   * 수법과 위험도를 판정하고 근거를 낸다.
   *
   * **근거를 못 대면 판정을 내보내지 않습니다.** 던지지도 않습니다 —
   * 이 값은 절차를 가르지 않아 없어도 사용자가 막히지 않습니다.
   *
   * @throws LlmError 모델 호출 자체가 실패했을 때. 그건 판정 실패가 아니라
   *         시스템 실패라 재시도 판단으로 넘어갑니다 → 10-errors.md §2.
   */
  read(input: ReadInput): Promise<ReadResult>
}
