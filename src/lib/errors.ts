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
 *
 * ## ⚠️ 표의 열일곱 줄이 **하나도 빠지면 안 됩니다**
 *
 * 빠진 코드는 아래 `userMessageFor` 가 `INTERNAL`(「처리 중 문제가 발생했습니다」)로
 * 떨어뜨립니다. **조용히 그럴듯한 문장이 나가서** 코드를 읽어서는 안 보입니다.
 *
 * 2026-08-27 배포 서버에서 실제로 그랬습니다 — `CASE_NOT_FOUND`·`BAD_REQUEST`·
 * `UNAUTHORIZED` 셋이 이 표에 없었습니다. 그중 `CASE_NOT_FOUND` 는
 * **링크가 유일한 열쇠인 서비스에서 링크를 잃은 사람이 가장 먼저 보는 화면**인데,
 * 파기 안내(180일)를 담아 두었던 문구 대신 「처리 중 문제가 발생했습니다」가 나갔습니다.
 * 그러면 사용자는 **자기 사건이 아직 살아 있는 줄 알고 기다립니다.**
 *
 * 셋이 이 파일이 아니라 [http.ts](./http.ts) 에서 예외 클래스로 선언돼 있어
 * 눈에 안 띄었습니다. **표는 `code` 문자열로만 묶이므로** 클래스가 어디 있든
 * 이 표에 줄이 있어야 합니다 — `errors.test.ts` 가 열일곱을 세어 지킵니다.
 */
export const USER_MESSAGE: Readonly<Record<string, string>> = {
  EGRESS_BLOCKED: '개인정보가 남아 있어 요청을 중단했습니다. 다시 시도해 주세요.',
  RESTORE_DENIED: '요청하신 정보를 표시할 수 없습니다.',
  PII_TOKENIZER_UNAVAILABLE: '지금은 분석할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  KB_CITATION_MISSING: '안내를 만들지 못했습니다. 다시 시도해 주세요.',
  // **파기 안내를 문구가 함께 답니다** → §3 「없는 것과 파기된 것을 가르지 않습니다」.
  // API 를 나누면 「그 토큰이 한때 유효했다」가 새어 나가므로(ADR-021), 가르지 않는
  // 대신 **문구 하나가 둘 다 설명합니다**
  CASE_NOT_FOUND:
    '이 주소의 사건을 찾을 수 없습니다. 마지막 활동일부터 180일이 지나면 자동으로 파기됩니다.',
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
  BAD_REQUEST: '요청 형식이 올바르지 않습니다.',
  // **일부러 아무것도 알려주지 않습니다** → §3. 아이디가 틀렸는지 쿠키가 지났는지를
  // 구분해 주면 그게 곧 힌트가 됩니다. 이 경로의 상대는 피해자가 아니라 운영자입니다
  UNAUTHORIZED: '처리 중 문제가 발생했습니다.',
  INTERNAL: '처리 중 문제가 발생했습니다.',
}

/** 정의된 문구가 없으면 INTERNAL 문구로 떨어진다. 빈 문자열을 내보내지 않는다. */
export function userMessageFor(code: string): string {
  return USER_MESSAGE[code] ?? USER_MESSAGE.INTERNAL
}
