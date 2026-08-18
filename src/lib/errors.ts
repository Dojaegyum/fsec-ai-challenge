/**
 * FinAlly 예외 계층.
 *
 * 정본: spec/backend/08-16-errors.md §1
 * 근거: ADR-028 (TypeScript 로 옮긴 결정) · ADR-020 (문턱)
 *
 * 이 파일은 src/modules/ 밖에 있습니다. 모든 모듈이 쓰는 공용이고,
 * 도메인 판단을 하지 않기 때문입니다 → ADR-028.
 *
 * 브라우저에서도 씁니다 — pii-restorer 가 RestoreDeniedError 를 던집니다.
 * 그래서 server-only 표시를 달지 않습니다.
 */

/**
 * 모든 예외의 기반.
 *
 * retryable 로 재시도 가능 여부를 표시한다. retry-checker 가 이 값만 보고
 * 재시도를 결정하므로, 예외 종류마다 반드시 값을 정한다.
 */
export class AppError extends Error {
  readonly code: string = 'INTERNAL'
  readonly httpStatus: number = 500
  readonly retryable: boolean = false

  /** 감사 로그용. 응답 본문에 넣지 않는다 → 08-16-errors.md §3 */
  readonly detail: Record<string, unknown>

  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = new.target.name
    this.detail = detail
  }
}

// ── PII 경계 (spec/common/08-14-pii-boundary.md) ──────────────────────

/**
 * PII 처리 실패.
 *
 * 재시도하지 않는다. 실패한 요청을 다시 시도하면 같은 실패가 반복되거나,
 * 더 나쁘게는 부분 처리된 상태로 통과할 수 있다.
 */
export class PiiBoundaryError extends AppError {
  readonly code: string = 'PII_BOUNDARY'
  readonly httpStatus: number = 500
  readonly retryable: boolean = false
}

/** 송출 직전 검사에서 잔여 PII 발견. 외부 LLM 호출을 중단했다. */
export class EgressBlockedError extends PiiBoundaryError {
  readonly code: string = 'EGRESS_BLOCKED'
  readonly httpStatus: number = 422
}

/** 복원 거부. detail 에 거부 사유를 담는다 (ADR-011). */
export class RestoreDeniedError extends PiiBoundaryError {
  readonly code: string = 'RESTORE_DENIED'
  readonly httpStatus: number = 403
}

/**
 * pii-tokenizer(NER)를 쓸 수 없다.
 *
 * 토큰화 없이 LLM을 호출하는 우회 경로를 만들지 않는다.
 * pii-tokenizer 가 죽으면 LLM 기능 전체가 멈춘다 — 의도된 것이다.
 */
export class PiiTokenizerUnavailableError extends PiiBoundaryError {
  readonly code: string = 'PII_TOKENIZER_UNAVAILABLE'
  readonly httpStatus: number = 503
  readonly retryable: boolean = true
}

// ── KB (spec/backend/08-14-kb-operations.md) ──────────────────────────

export class KbError extends AppError {
  readonly code: string = 'KB_ERROR'
  readonly httpStatus: number = 500
}

/**
 * LLM 응답의 참조가 검증을 통과하지 못했다.
 *
 * 발급하지 않은 ref, kb_entry_id 바꿔치기, 어느 문장에도 안 쓰인 인용.
 * CLAUDE.md 불변 규칙 1 위반. 응답을 버리고 재시도한다.
 *
 * 모델이 insufficient: true 로 근거 없음을 밝힌 경우는 여기 오지 않는다.
 * 그건 실패가 아니라 슬롯 질문 경로다 → 08-16-errors.md §4.2
 */
export class KbCitationMissingError extends KbError {
  readonly code: string = 'KB_CITATION_MISSING'
  readonly httpStatus: number = 502
  readonly retryable: boolean = true
}

/**
 * 해당 시점에 유효한 KB 항목이 없다.
 *
 * 조회는 성공했고 결과가 0건인 경우다. 이건 정상 경로이므로
 * 보통 예외로 던지지 않고 빈 결과로 반환한다.
 * 조회 결과가 반드시 있어야 하는 자리에서만 던진다.
 */
export class KbEntryNotFoundError extends KbError {
  readonly code: string = 'KB_ENTRY_NOT_FOUND'
  readonly httpStatus: number = 404
}

/**
 * KB 조회 자체가 실패했다. DB 장애 등.
 *
 * 챗을 멈춘다. 근거 없는 답변보다 멈추는 편이 낫다.
 * PiiTokenizerUnavailableError 와 같은 논리다 — 통제를 우회하는
 * 폴백 경로를 만들지 않는다.
 *
 * KbEntryNotFoundError(404) 와 구분한다:
 *   - 404 = 조회는 됐고 해당 항목이 없다
 *   - 503 = 조회를 못 했다. 있는지 없는지도 모른다
 */
export class KbUnavailableError extends KbError {
  readonly code: string = 'KB_UNAVAILABLE'
  readonly httpStatus: number = 503
  readonly retryable: boolean = true
}

// ── 사건 처리 ─────────────────────────────────────────────────────────

export class CaseError extends AppError {
  readonly code: string = 'CASE_ERROR'
  readonly httpStatus: number = 400
}

/**
 * 확정되지 않은 슬롯으로 기한을 계산하려 했다.
 *
 * CLAUDE.md 불변 규칙 7. extracted·unknown 상태로 계산하지 않는다.
 */
export class SlotNotConfirmedError extends CaseError {
  readonly code: string = 'SLOT_NOT_CONFIRMED'
  readonly httpStatus: number = 409
}

/**
 * 선행 단계의 부산물이 없어 다음 단계를 만들 수 없다.
 *
 * spec/backend/08-14-completion-hook.md 의 증거 연쇄.
 */
export class ArtifactRequiredError extends CaseError {
  readonly code: string = 'ARTIFACT_REQUIRED'
  readonly httpStatus: number = 409
}

// ── 외부 의존 ─────────────────────────────────────────────────────────

export class LlmError extends AppError {
  readonly code: string = 'LLM_UNAVAILABLE'
  readonly httpStatus: number = 503
  readonly retryable: boolean = true
}

/** 잘못된 요청. 같은 요청은 같은 결과가 나오므로 재시도하지 않는다. */
export class LlmBadRequestError extends LlmError {
  readonly code: string = 'LLM_BAD_REQUEST'
  readonly httpStatus: number = 500
  readonly retryable: boolean = false
}

/** STT·OCR 실패. */
export class IngestError extends AppError {
  readonly code: string = 'INGEST_FAILED'
  readonly httpStatus: number = 422
  readonly retryable: boolean = true
}

export class StoreError extends AppError {
  readonly code: string = 'STORE_ERROR'
  readonly httpStatus: number = 503
  readonly retryable: boolean = true
}

// ── 유입 제어 ─────────────────────────────────────────────────────────

/**
 * 속도 제한에 걸렸다 → spec/common/08-14-api.md §1.3
 *
 * 서버가 재시도하지 않는다. 기다렸다가 사용자가 다시 누른다.
 */
export class RateLimitedError extends AppError {
  readonly code: string = 'RATE_LIMITED'
  readonly httpStatus: number = 429
  readonly retryable: boolean = false
}

// ── 사용자에게 보일 문구 ──────────────────────────────────────────────

/**
 * code → 사용자 문구. 정본은 08-16-errors.md §3 표입니다.
 *
 * 문구 원칙 (§3.2):
 *   - 사용자를 탓하지 않는다. 충격 상태의 사용자를 상대한다
 *   - 할 수 있는 다음 행동을 함께 준다
 *   - 기술 용어를 노출하지 않는다 (모듈 이름·NER·토큰)
 */
export const USER_MESSAGE: Readonly<Record<string, string>> = {
  EGRESS_BLOCKED: '개인정보가 남아 있어 요청을 중단했습니다. 다시 시도해 주세요.',
  RESTORE_DENIED: '요청하신 정보를 표시할 수 없습니다.',
  PII_TOKENIZER_UNAVAILABLE: '지금은 분석할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  KB_CITATION_MISSING: '안내를 만들지 못했습니다. 다시 시도해 주세요.',
  KB_ENTRY_NOT_FOUND: '해당하는 절차 정보를 찾지 못했습니다.',
  KB_UNAVAILABLE:
    '지금은 절차를 안내할 수 없습니다. 급하시면 1332(금융감독원)로 연락해 주세요.',
  SLOT_NOT_CONFIRMED: '먼저 확인이 필요한 항목이 있습니다.',
  ARTIFACT_REQUIRED: '앞 단계의 접수번호가 필요합니다.',
  LLM_UNAVAILABLE: '지금은 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  LLM_BAD_REQUEST: '처리 중 문제가 발생했습니다.',
  INGEST_FAILED: '파일을 읽지 못했습니다. 다른 파일로 시도해 주세요.',
  STORE_ERROR: '지금은 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  RATE_LIMITED: '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.',
  INTERNAL: '처리 중 문제가 발생했습니다.',
}

/** 정의된 문구가 없으면 INTERNAL 문구로 떨어진다. 빈 문자열을 내보내지 않는다. */
export function userMessageFor(code: string): string {
  return USER_MESSAGE[code] ?? USER_MESSAGE.INTERNAL
}
