# 10 · 에러 계약

> **기획서 추출이 아닌 구현 결정입니다.** [08-api.md](../common/08-14-api.md)의 `TODO(미정): 에러 계약`을 채운 것입니다.
> 바꿀 때는 spec을 직접 고치지 말고 RFC → ADR 절차를 거칩니다.
>
> **2026-08-17 §1의 예외 계층을 Python 에서 TypeScript 로 옮겼습니다** —
> [ADR-021](../../decisions/028-runtime-and-module-shape.md)로 언어가 확정됐기 때문입니다.
> **계약은 하나도 바뀌지 않았습니다** — 예외 14개, `code` 값, HTTP 번호, `retryable` 여부가 전부 그대로입니다.
> 바뀐 것은 표기(`http_status` → `httpStatus`)와 `detail` 을 받는 방식뿐입니다 → §1.1.

## 원칙 셋

**1. 실패를 조용히 넘기지 않습니다.** 특히 PII 경계에서의 실패는 요청을 중단시킵니다. 통과시키고 로그만 남기는 경로를 만들지 않습니다.

**2. 에러 메시지에 PII를 넣지 않습니다.** 무엇이 남았는지 값으로 알려주지 않습니다.

**3. 사용자를 막지 않는 실패는 에러가 아닙니다.** [02-slot-tiering.md](08-14-slot-tiering.md)가 "자동 추출 실패는 정상 경로입니다. 예외로 처리하지 말고 질문 경로로 흘려보내세요"라고 정했습니다. 이 원칙이 아래 §4에 반영됩니다.

---

## 1. 예외 계층

> **구현 위치는 `src/lib/errors.ts` 입니다.** 모든 모듈이 쓰므로 `src/modules/` 밖의 공용에 둡니다
> → [ADR-021](../../decisions/028-runtime-and-module-shape.md). 아래가 그 파일의 계약입니다.

```ts
/**
 * FinAlly 서버의 모든 예외의 기반.
 *
 * retryable 로 재시도 가능 여부를 표시한다. retry-checker 가 이 값만 보고
 * 재시도를 결정하므로, 예외 종류마다 반드시 값을 정한다.
 */
export class AppError extends Error {
  readonly code: string = 'INTERNAL'
  readonly httpStatus: number = 500
  readonly retryable: boolean = false

  /** 감사 로그용. 응답 본문에 넣지 않는다 */
  readonly detail: Record<string, unknown>

  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = new.target.name
    this.detail = detail
  }
}

// ── PII 경계 (../common/08-14-pii-boundary.md) ─────────────────────────

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

// ── KB (08-14-kb-operations.md) ──────────────────────────────

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
 * 그건 실패가 아니라 슬롯 질문 경로다 → §4.2
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
 * 보통 예외로 던지지 않고 빈 결과로 반환한다 (§4 참조).
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

// ── 사건 처리 ──────────────────────────────────────────────

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
 * 05-completion-hook.md 의 증거 연쇄.
 */
export class ArtifactRequiredError extends CaseError {
  readonly code: string = 'ARTIFACT_REQUIRED'
  readonly httpStatus: number = 409
}

// ── 외부 의존 ──────────────────────────────────────────────

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

// ── 유입 제어 ──────────────────────────────────────────────

/**
 * 속도 제한에 걸렸다 → 08-api.md §1.3
 *
 * 서버가 재시도하지 않는다. 기다렸다가 사용자가 다시 누른다.
 */
export class RateLimitedError extends AppError {
  readonly code: string = 'RATE_LIMITED'
  readonly httpStatus: number = 429
  readonly retryable: boolean = false
}
```

### 1.1 필드 이름과 타입 표기

**`http_status` 를 `httpStatus` 로 씁니다.** 값과 뜻은 그대로이고 표기만 TypeScript 관례를 따릅니다.
아래 §3 표의 `code` 값과 HTTP 번호는 **하나도 바뀌지 않았습니다.**

**필드에 타입을 명시(`: string`)하는 이유**는 생략하면 리터럴 타입(`'PII_BOUNDARY'`)으로 좁혀져
하위 클래스에서 다른 값으로 덮어쓸 때 타입이 어긋나기 때문입니다.

**`detail` 을 두 번째 인자로 받습니다.** Python 의 키워드 전용 인자를 그대로 옮길 수 없어
위치 인자로 바꿨습니다. **응답 본문에 넣지 않는다는 규칙은 그대로입니다** → §3.

---

## 2. 재시도 규칙

**판단하는 자리를 `retry-checker` 라고 부릅니다** → [12-module-names.md](../common/08-16-module-names.md).

`retry-checker` 는 `retryable` 값만 보고 판단합니다. **예외 종류를 따로 분기하지 않습니다.**

> **한때 `08-api.md` 가 「분석 오케스트레이터」라고 부르던 것과 다릅니다.** 그쪽은 `F-04`·`F-05` 실행 순서를 조율하는 자리였고 지금은 `case-reader`·`slot-extractor`·`planner` 셋으로 갈렸습니다 → [12](../common/08-16-module-names.md). `retry-checker` 는 **어느 모듈이 던진 예외든 같은 판단을 하므로 층에 속하지 않습니다** — `audit-logger` 와 같은 자리입니다.

| 예외 | 재시도 | 왜 |
| --- | :---: | --- |
| `PiiBoundaryError` 계열 | ✗ | PII 처리 실패를 다시 시도하지 않습니다 |
| `PiiTokenizerUnavailableError` | ✓ | 서비스 장애는 일시적일 수 있습니다. 최대 2회 |
| `KbCitationMissingError` | ✓ | **`ref` 검증 위반일 때만.** 최대 2회 → §4.2. `insufficient` 는 재시도하지 않습니다 |
| `LlmError` | ✓ | 일시적 실패가 흔합니다. 최대 2회 |
| `LlmBadRequestError` | ✗ | 같은 요청은 같은 결과 |
| `CaseError` 계열 | ✗ | 입력 상태 문제라 재시도로 안 풀립니다 |
| `IngestError` | ✓ | 최대 1회. 실패하면 사용자에게 재업로드 안내 |
| `StoreError` | ✓ | 커넥션 일시 실패. 최대 2회 |
| `RateLimitedError` | ✗ | **서버가 재시도하면 제한의 뜻이 없어집니다.** 기다렸다가 사용자가 누릅니다 |

### 2.1 대기 간격과 전체 예산

> 2026-08-16 확정.

**횟수만으로는 부족합니다. 전체 시간 상한을 함께 둡니다.**

Vercel 서버리스 함수에는 실행 시간 제한이 있습니다. **챗 한 턴에서 LLM을 최대 3회 부르는데(원 1회 + 재시도 2회) 한 번이 3~8초라면, 대기 시간까지 더해 함수가 먼저 끊길 수 있습니다.** 끊기면 사용자는 아무 안내도 못 받고, 재시도한 사실조차 기록에 안 남습니다.

| 예외 | 1차 대기 | 2차 대기 | 왜 |
| --- | ---: | ---: | --- |
| `StoreError` | 200ms | 600ms | 커넥션 회복이 가장 빠릅니다 |
| `LlmError` | 500ms | 1,500ms | 상대 서비스의 일시 장애 |
| `PiiTokenizerUnavailableError` | 1s | 3s | 모델 서비스 기동에 시간이 걸립니다 |
| `IngestError` | 2s | — | 1회만. 배경 작업이라 여유가 있습니다 |
| `KbCitationMissingError` | **0** | **0** | 아래 |

**`KbCitationMissingError`만 대기가 없습니다.** 이건 상대 서비스가 아픈 것이 아니라 **모델이 형식을 틀린 것**이라, 기다린다고 나아지지 않습니다. 생성 자체가 이미 수 초 걸리므로 그 시간이 간격 역할을 합니다.

**대기에 무작위 흔들림(jitter)을 ±20% 줍니다.** 동시에 실패한 요청들이 같은 시각에 몰려 다시 때리는 것을 막습니다.

#### 전체 예산

| | 값 | 넘으면 |
| --- | ---: | --- |
| 사용자를 기다리게 하는 경로 (챗·플랜) | **20초** | 재시도를 멈추고 그 시점의 예외를 그대로 반환 |
| 배경 경로 (전사·수집) | **120초** | 같음 |

**예산을 넘으면 재시도 횟수가 남아 있어도 멈춥니다.** 충격 상태의 사용자를 화면 앞에 20초 넘게 세워두는 것보다, 무엇이 안 됐는지 알려주고 다시 누르게 하는 편이 낫습니다.

**감사 로그에 시도 횟수와 총 소요를 남깁니다** → §5.

---

## 3. HTTP 응답 형식

```json
{
  "error": {
    "code": "EGRESS_BLOCKED",
    "message": "개인정보가 남아 있어 요청을 중단했습니다.",
    "audit_id": "01J8XKR2N4P6T8V0W2Y4A6C8E0"
  }
}
```

`detail`은 **감사 로그에만** 들어갑니다. 응답 본문에 넣지 않습니다.

| `code` | HTTP | 사용자에게 보일 문구 |
| --- | --- | --- |
| `EGRESS_BLOCKED` | 422 | 개인정보가 남아 있어 요청을 중단했습니다. 다시 시도해 주세요. |
| `RESTORE_DENIED` | 403 | 요청하신 정보를 표시할 수 없습니다. |
| `PII_TOKENIZER_UNAVAILABLE` | 503 | 지금은 분석할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| `KB_CITATION_MISSING` | 502 | 안내를 만들지 못했습니다. 다시 시도해 주세요. |
| `KB_ENTRY_NOT_FOUND` | 404 | 해당하는 절차 정보를 찾지 못했습니다. |
| `KB_UNAVAILABLE` | 503 | 지금은 절차를 안내할 수 없습니다. 급하시면 1332(금융감독원)로 연락해 주세요. |
| `SLOT_NOT_CONFIRMED` | 409 | 먼저 확인이 필요한 항목이 있습니다. |
| `ARTIFACT_REQUIRED` | 409 | 앞 단계의 접수번호가 필요합니다. |
| `LLM_UNAVAILABLE` | 503 | 지금은 응답할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| `LLM_BAD_REQUEST` | 500 | 처리 중 문제가 발생했습니다. |
| `INGEST_FAILED` | 422 | 파일을 읽지 못했습니다. 다른 파일로 시도해 주세요. |
| `STORE_ERROR` | 503 | 지금은 저장할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| `RATE_LIMITED` | 429 | 요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요. |
| `INTERNAL` | 500 | 처리 중 문제가 발생했습니다. |

### 3.1 `Retry-After` — 503 에만 붙입니다

> 2026-08-16 확정.

**서버가 이미 재시도한 뒤에 나가는 응답입니다.** 그래서 클라이언트가 또 시도해야 하는지를 응답이 알려줘야 합니다.

| HTTP | `Retry-After` | 뜻 |
| --- | :---: | --- |
| **503** (`PII_TOKENIZER_UNAVAILABLE`·`KB_UNAVAILABLE`·`LLM_UNAVAILABLE`·`STORE_ERROR`) | **붙임** | 상대 서비스가 아픕니다. 시간이 지나면 나을 수 있습니다 |
| **429** (`RATE_LIMITED`) | **붙임** | 남은 창(window) 시간을 그대로 넣습니다 → [08-api.md](../common/08-14-api.md) §1.3 |
| **502** (`KB_CITATION_MISSING`) | 안 붙임 | 서버가 두 번 시도해 같은 결과였습니다. 기다린다고 달라지지 않습니다 |
| 4xx 전부 | 안 붙임 | 요청이나 상태의 문제라 시간이 안 고칩니다 |

**503 의 값은 `10`(초)입니다.** 서버가 이미 최대 3초까지 기다려봤으므로(§2.1), 그보다 넉넉히 둡니다. **429 는 계산된 값**이라 남은 창 시간을 그대로 넣습니다.

**클라이언트는 자동으로 다시 부르지 않습니다.** 헤더는 화면에 「10초 뒤 다시 시도할 수 있습니다」를 띄우는 데 쓰고, **누르는 것은 사용자가 합니다.** 자동 재시도를 넣으면 서버가 아픈 동안 요청이 배로 늘고, 사용자는 화면이 멈춘 이유를 모릅니다.

**`Retry-After` 가 없는 오류에 재시도 버튼을 띄우지 마세요.** 눌러도 같은 결과가 나오는데 사용자는 자기가 뭘 잘못했다고 생각합니다.

### 3.2 문구 원칙

**사용자를 탓하지 않습니다.** 충격 상태의 사용자를 상대합니다.

**할 수 있는 다음 행동을 함께 줍니다.** "다시 시도해 주세요", "다른 파일로 시도해 주세요"처럼 끝냅니다.

**기술 용어를 노출하지 않습니다.** 모듈 이름(`pii-tokenizer` 등)·"NER"·"토큰"은 사용자 문구에 쓰지 않습니다. 단 화면에 보이는 파란 토큰은 예외이며, 그건 [04-pii-boundary.md](../common/08-14-pii-boundary.md)가 정한 안내 문구를 씁니다.

---

## 4. 에러가 아닌 실패

`02-slot-tiering.md`의 **"모름은 실패가 아니라 정상 상태"** 원칙에 따라, 아래는 **200으로 응답하고 상태를 본문에 담습니다.**

| 상황 | 왜 에러가 아닌가 | 응답 |
| --- | --- | --- |
| 슬롯 자동 추출 실패 | 정상 경로. 질문으로 흘려보냅니다 | 200 + `slots[].state="empty"` + 다음 질문 |
| 사용자가 "모름" 선택 | 정상 상태. 슈퍼셋 플랜으로 진행 | 200 + `slots[].state="unknown"` |
| 경유 서비스 특정 실패 | T1 미충족. 슈퍼셋 플랜 | 200 + `plan.is_superset=true` |
| L1 자동 검증 실패 | L2·L3 경로가 열려 있어야 합니다 | 200 + `artifact.verify_result="failed"` + 다음 레벨 안내 |
| L3 자기 신고 | 완료가 아닐 뿐 실패가 아닙니다 | 200 + `state="unconfirmed"` |
| **KB 조회 결과 0건** | **조회는 성공했습니다. 해당 절차가 없는 것도 사실입니다** | 200 + 빈 결과 → §4.1 |
| **모델이 `insufficient: true`** | **답할 근거가 없다는 신호이지 시스템 실패가 아닙니다** | 200 + 슬롯 질문 → §4.2 |

### 4.1 KB 조회 결과 0건과 조회 실패는 다릅니다

**둘을 같게 처리하면 안 됩니다.**

| 상황 | 뜻 | 처리 |
| --- | --- | --- |
| **조회 성공 + 0건** | 그 조합에 해당하는 절차가 KB에 없다 | **200.** 절차를 말하지 않고 1332 안내로 넘김 |
| **조회 실패** (`KB_UNAVAILABLE`) | 있는지 없는지도 모름 | **503.** 챗을 멈춤 |

#### 0건일 때 — 절차를 말하지 않습니다

```json
{
  "reply": "말씀하신 경우에 대한 확인된 절차를 아직 갖고 있지 않습니다. 금융감독원 1332로 연락하시면 상담받으실 수 있습니다.",
  "citations": [],
  "kb_result": "empty"
}
```

**`citations`가 비어 있어도 규칙 위반이 아닙니다.** 절차를 언급하지 않았기 때문입니다. `CLAUDE.md` 불변 규칙 1은 "KB 근거 없이 절차를 창작하지 않는다"이지 "모든 응답에 인용이 있어야 한다"가 아닙니다.

**모델이 아는 절차로 채우면 규칙 위반입니다.** 0건일 때 무엇을 말하고 무엇을 말하면 안 되는지는 [11-chat-context.md](08-16-chat-context.md)에서 정합니다.

#### 조회 실패일 때 — 멈춥니다

**공통 안전 절차(T0)로 폴백할 수 없습니다.** [08-api.md](../common/08-14-api.md) §3.1을 보면 T0 단계에도 `citation`이 붙습니다. **T0 자체가 KB 항목**(`report-112` 등)이라, 조회가 안 되면 T0도 인용 없이 내보낼 수 없습니다.

`PiiTokenizerUnavailableError`와 같은 논리입니다 — **통제를 우회하는 폴백 경로를 만들지 않습니다.** 근거 없는 절차 안내보다 멈추는 편이 낫습니다.

다만 사용자를 빈손으로 두지 않도록 **에러 메시지에 1332를 넣습니다.** 이건 절차 안내가 아니라 연락처 안내라 인용이 필요 없습니다.

**위 다섯 경우에 4xx·5xx를 반환하면 `02-slot-tiering.md`의 설계 원칙을 어기는 것입니다.** 사용자가 막힙니다.

### 4.2 근거를 못 찾으면 되묻습니다

> 2026-08-16 [ADR-015](../../decisions/015-citation-and-reask.md) 로 신설.

**모델이 `insufficient: true`를 내면 에러가 아니라 질문이 나갑니다.**

```
insufficient: true
  → 슬롯 체커로 넘긴다
      → 안 채워진 슬롯 중 정보 이득이 가장 큰 것 하나를 버튼으로 질문
      → 채워지면 조회 범위가 좁아진 상태로 다시 답변
      → 채울 슬롯이 더 없으면 그때 1332 안내
```

**이 경로에서는 재시도하지 않습니다.** 형식 오류가 아니라 **모델이 근거가 없다고 선언한 것**이라, 같은 프롬프트로 다시 부르면 같은 답이 옵니다.

#### `KbCitationMissingError`가 남는 자리

**「인용이 비면 에러」가 아닙니다.** 그러면 인사말에도 발동합니다 → [11-chat-context.md](08-16-chat-context.md) §6.1.

| 상황 | 처리 |
| --- | --- |
| `ref` 검증 위반 (지어낸 참조·바꿔치기·`why` 누락) | **재시도 최대 2회.** 형식 오류라 다시 생성하면 고쳐질 수 있습니다 |
| `insufficient: true` | **재시도 없음.** 슬롯 질문 (§4.2) |
| 슬롯을 다 채웠는데도 근거를 못 찾음 | `KB_CITATION_MISSING` |
| KB 조회 0건 | 1332 안내 (§4.1) |

**재시도 대상이 좁아졌습니다.** 이전에는 인용이 비기만 하면 재시도했는데, 그중 대부분이 재시도로 안 풀리는 것(근거 부족)이었습니다.

> **`TURN_LIMIT`은 없앴습니다.** 도구 호출 반복 상한이었는데, 챗이 도구를 쓰지 않고 단발 호출로 바뀌면서 발동 조건이 사라졌습니다. 나중에 도구를 도입하면 그때 되살립니다. **발동하지 않는 에러 코드를 스펙에 남겨 두면 구현자가 무엇이 그걸 일으키는지 찾다가 시간을 씁니다.**

---

## 5. 감사 로그와의 관계

모든 에러 응답에 `audit_id`가 붙습니다. 같은 식별자로 `audit_log` 테이블에서 `detail`을 찾을 수 있습니다.

```
응답 본문:  {"code": "EGRESS_BLOCKED", "audit_id": "01J8XKR2..."}
                                        ↓
audit_log:  event_type = "pii.egress_blocked"
            detail = {"counts": {"resident_id": 1}}
                      ^^^^^^^^ 유형과 건수만. 값 없음
```

**`detail`에 PII를 넣지 않습니다** → [09-data-model.md](08-16-data-model.md) §10.1.

---

## 6. 예시

### (1) 송출 직전 검사 중단

```
POST /api/cases/01J8XKQZ.../messages
{"content": "..."}

← 422
X-Pii-Egress-Residual: 1
{
  "error": {
    "code": "EGRESS_BLOCKED",
    "message": "개인정보가 남아 있어 요청을 중단했습니다. 다시 시도해 주세요.",
    "audit_id": "01J8XKR2N4P6T8V0W2Y4A6C8E0"
  }
}

audit_log: {"event_type":"pii.egress_blocked",
            "detail":{"counts":{"resident_id":1}}}
```

**응답 어디에도 무엇이 남았는지 값이 없습니다.**

### (2) 확정 안 된 슬롯으로 기한 계산

```
GET /api/cases/01J8XKQZ.../deadlines
(freeze_requested_at 이 extracted 상태)

← 409
{
  "error": {
    "code": "SLOT_NOT_CONFIRMED",
    "message": "먼저 확인이 필요한 항목이 있습니다.",
    "audit_id": "01J8XKR3P5Q7S9U1W3Y5A7C9E1"
  }
}
```

추측한 날짜를 안내하지 않습니다.

### (3) 지어낸 참조 — 재시도 후 실패

```
1차 생성: LLM이 ref "kb-9" 를 씀. 이번 턴에 발급한 번호가 아님
          → KbCitationMissingError, 재시도 1/2
2차 생성: 여전히 발급 안 된 번호
          → 재시도 2/2
3차:      실패

← 502
{
  "error": {
    "code": "KB_CITATION_MISSING",
    "message": "안내를 만들지 못했습니다. 다시 시도해 주세요.",
    "audit_id": "01J8XKR4Q6R8T0V2X4Z6B8D0F2"
  }
}
```

**근거 없는 절차를 사용자에게 보여주느니 실패하는 편이 낫습니다.** `CLAUDE.md` 불변 규칙 1.

**이 경로는 형식 위반에만 해당합니다.** 모델이 `insufficient: true`로 근거 없음을 밝힌 경우는 여기 오지 않고 §4.2로 갑니다.

### (3-b) 근거 부족 — 에러 아님

```
LLM이 insufficient: true 를 냄
  → 재시도하지 않음
  → 슬롯 체커: channel 이 비어 있음

← 200
{
  "message_id": "01J8XKRF...",
  "reply": "정확한 안내를 위해 하나만 확인하겠습니다.",
  "citations": [],
  "next_question": { "slot_key": "channel", "…": "…" }   // 구조는 08-api.md §3.4
}
```

**사용자는 막히지 않습니다.** 무엇을 더 알려줘야 하는지가 질문으로 나옵니다.

### (4) 슬롯 추출 실패 — 에러 아님

```
POST /api/cases/01J8XKQZ.../evidence
(이체내역 OCR 에서 은행명을 못 읽음)

← 200
{
  "slots": [
    {"slot_key":"org_name","tier":"T2","state":"empty","value":null}
  ],
  "next_question": { "slot_key": "org_name", "…": "…" }   // 구조는 08-api.md §3.4
}
```

**200입니다.** 자동 추출 실패는 정상 경로입니다.

**`next_question` 구조의 정의는 [08-api.md](../common/08-14-api.md) §3.4 하나입니다.** 이 문서의 예시는 줄여 적습니다.

### (5) L1 검증 실패 — 에러 아님

```
POST /api/cases/01J8XKQZ.../steps/step-1/artifacts
{"kind":"receipt_no","value":"12345"}

← 200
{
  "artifact_id": "01J8XKR5...",
  "verify_level": "L1",
  "verify_result": "failed",
  "verify_detail": {"reason":"format_mismatch"},
  "step_state": "in_progress",
  "next_options": [
    {"level":"L2","label":"접수 문자 캡처를 올려주세요"},
    {"level":"L3","label":"번호 없이 접수했다고 표시"}
  ]
}
```

**사용자를 막지 않습니다.** L2 → L3 경로가 항상 열려 있습니다 → [05-completion-hook.md](08-14-completion-hook.md).

---

## TODO

- TODO(미정): 리마인더 발송 실패의 처리 → [05-completion-hook.md](08-14-completion-hook.md) TODO와 연동
