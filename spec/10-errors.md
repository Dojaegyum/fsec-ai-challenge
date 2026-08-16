# 10 · 에러 계약

> **기획서 추출이 아닌 구현 결정입니다.** [08-api.md](08-api.md)의 `TODO(미정): 에러 계약`을 채운 것입니다.
> 바꿀 때는 spec을 직접 고치지 말고 RFC → ADR 절차를 거칩니다.

## 원칙 셋

**1. 실패를 조용히 넘기지 않습니다.** 특히 PII 경계에서의 실패는 요청을 중단시킵니다. 통과시키고 로그만 남기는 경로를 만들지 않습니다.

**2. 에러 메시지에 PII를 넣지 않습니다.** 무엇이 남았는지 값으로 알려주지 않습니다.

**3. 사용자를 막지 않는 실패는 에러가 아닙니다.** [02-slot-tiering.md](02-slot-tiering.md)가 "자동 추출 실패는 정상 경로입니다. 예외로 처리하지 말고 질문 경로로 흘려보내세요"라고 정했습니다. 이 원칙이 아래 §4에 반영됩니다.

---

## 1. 예외 계층

```python
class AppError(Exception):
    """FinAlly 서버의 모든 예외의 기반.

    retryable 로 재시도 가능 여부를 표시한다. retry-checker 가 이 값만 보고
    재시도를 결정하므로, 예외 종류마다 반드시 값을 정한다.
    """

    code: str = "INTERNAL"
    http_status: int = 500
    retryable: bool = False

    def __init__(self, message: str, *, detail: dict | None = None):
        super().__init__(message)
        self.detail = detail or {}       # 감사 로그용. 응답 본문에 넣지 않는다


# ── PII 경계 (04-pii-boundary.md) ─────────────────────────
class PiiBoundaryError(AppError):
    """PII 처리 실패.

    재시도하지 않는다. 실패한 요청을 다시 시도하면 같은 실패가 반복되거나,
    더 나쁘게는 부분 처리된 상태로 통과할 수 있다.
    """
    code = "PII_BOUNDARY"
    http_status = 500
    retryable = False


class EgressBlockedError(PiiBoundaryError):
    """송출 직전 검사에서 잔여 PII 발견. 외부 LLM 호출을 중단했다."""
    code = "EGRESS_BLOCKED"
    http_status = 422


class RestoreDeniedError(PiiBoundaryError):
    """복원 거부. detail 에 거부 사유를 담는다 (RFC-0004)."""
    code = "RESTORE_DENIED"
    http_status = 403


class ScrubberUnavailableError(PiiBoundaryError):
    """2차 스크러버(NER)를 쓸 수 없다.

    스크러버 없이 LLM을 호출하는 우회 경로를 만들지 않는다.
    스크러버가 죽으면 LLM 기능 전체가 멈춘다 — 의도된 것이다.
    """
    code = "SCRUBBER_UNAVAILABLE"
    http_status = 503
    retryable = True


# ── KB (07-kb-operations.md) ──────────────────────────────
class KbError(AppError):
    code = "KB_ERROR"
    http_status = 500


class KbCitationMissingError(KbError):
    """LLM이 KB 근거 없이 절차를 생성했다.

    CLAUDE.md 불변 규칙 1 위반. 응답을 버리고 재시도한다.
    """
    code = "KB_CITATION_MISSING"
    http_status = 502
    retryable = True


class KbEntryNotFoundError(KbError):
    """해당 시점에 유효한 KB 항목이 없다.

    조회는 성공했고 결과가 0건인 경우다. 이건 정상 경로이므로
    보통 예외로 던지지 않고 빈 결과로 반환한다 (§4 참조).
    조회 결과가 반드시 있어야 하는 자리에서만 던진다.
    """
    code = "KB_ENTRY_NOT_FOUND"
    http_status = 404


class KbUnavailableError(KbError):
    """KB 조회 자체가 실패했다. DB 장애 등.

    챗을 멈춘다. 근거 없는 답변보다 멈추는 편이 낫다.
    ScrubberUnavailableError 와 같은 논리다 — 통제를 우회하는
    폴백 경로를 만들지 않는다.

    KbEntryNotFoundError(404) 와 구분한다:
      - 404 = 조회는 됐고 해당 항목이 없다
      - 503 = 조회를 못 했다. 있는지 없는지도 모른다
    """
    code = "KB_UNAVAILABLE"
    http_status = 503
    retryable = True


# ── 사건 처리 ──────────────────────────────────────────────
class CaseError(AppError):
    code = "CASE_ERROR"
    http_status = 400


class SlotNotConfirmedError(CaseError):
    """확정되지 않은 슬롯으로 기한을 계산하려 했다.

    CLAUDE.md 불변 규칙 7. extracted·unknown 상태로 계산하지 않는다.
    """
    code = "SLOT_NOT_CONFIRMED"
    http_status = 409


class ArtifactRequiredError(CaseError):
    """선행 단계의 부산물이 없어 다음 단계를 만들 수 없다.

    05-completion-hook.md 의 증거 연쇄.
    """
    code = "ARTIFACT_REQUIRED"
    http_status = 409


# ── 외부 의존 ──────────────────────────────────────────────
class LlmError(AppError):
    code = "LLM_UNAVAILABLE"
    http_status = 503
    retryable = True


class LlmBadRequestError(LlmError):
    """잘못된 요청. 같은 요청은 같은 결과가 나오므로 재시도하지 않는다."""
    code = "LLM_BAD_REQUEST"
    http_status = 500
    retryable = False


class IngestError(AppError):
    """STT·OCR 실패."""
    code = "INGEST_FAILED"
    http_status = 422
    retryable = True


class StoreError(AppError):
    code = "STORE_ERROR"
    http_status = 503
    retryable = True
```

---

## 2. 재시도 규칙

**판단하는 자리를 `retry-checker` 라고 부릅니다** → [12-module-names.md](12-module-names.md).

`retry-checker` 는 `retryable` 값만 보고 판단합니다. **예외 종류를 따로 분기하지 않습니다.**

> **`08-api.md` 의 「분석 오케스트레이터」와 다른 것입니다.** 그쪽은 `F-04`·`F-05` 실행 순서를 조율하는 자리이고 `case-reader`·`slot-extractor`·`planner` 셋으로 나뉩니다. `retry-checker` 는 **어느 모듈이 던진 예외든 같은 판단을 하므로 층에 속하지 않습니다** — `audit-logger` 와 같은 자리입니다.

| 예외 | 재시도 | 왜 |
| --- | :---: | --- |
| `PiiBoundaryError` 계열 | ✗ | PII 처리 실패를 다시 시도하지 않습니다 |
| `ScrubberUnavailableError` | ✓ | 서비스 장애는 일시적일 수 있습니다. 최대 2회 |
| `KbCitationMissingError` | ✓ | 다시 생성하면 인용이 붙을 수 있습니다. 최대 2회 |
| `LlmError` | ✓ | 일시적 실패가 흔합니다. 최대 2회 |
| `LlmBadRequestError` | ✗ | 같은 요청은 같은 결과 |
| `CaseError` 계열 | ✗ | 입력 상태 문제라 재시도로 안 풀립니다 |
| `IngestError` | ✓ | 최대 1회. 실패하면 사용자에게 재업로드 안내 |
| `StoreError` | ✓ | 커넥션 일시 실패. 최대 2회 |

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
| `SCRUBBER_UNAVAILABLE` | 503 | 지금은 분석할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| `KB_CITATION_MISSING` | 502 | 안내를 만들지 못했습니다. 다시 시도해 주세요. |
| `KB_ENTRY_NOT_FOUND` | 404 | 해당하는 절차 정보를 찾지 못했습니다. |
| `KB_UNAVAILABLE` | 503 | 지금은 절차를 안내할 수 없습니다. 급하시면 1332(금융감독원)로 연락해 주세요. |
| `SLOT_NOT_CONFIRMED` | 409 | 먼저 확인이 필요한 항목이 있습니다. |
| `ARTIFACT_REQUIRED` | 409 | 앞 단계의 접수번호가 필요합니다. |
| `LLM_UNAVAILABLE` | 503 | 지금은 응답할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| `LLM_BAD_REQUEST` | 500 | 처리 중 문제가 발생했습니다. |
| `INGEST_FAILED` | 422 | 파일을 읽지 못했습니다. 다른 파일로 시도해 주세요. |
| `STORE_ERROR` | 503 | 지금은 저장할 수 없습니다. 잠시 후 다시 시도해 주세요. |
| `INTERNAL` | 500 | 처리 중 문제가 발생했습니다. |

### 3.1 문구 원칙

**사용자를 탓하지 않습니다.** 충격 상태의 사용자를 상대합니다.

**할 수 있는 다음 행동을 함께 줍니다.** "다시 시도해 주세요", "다른 파일로 시도해 주세요"처럼 끝냅니다.

**기술 용어를 노출하지 않습니다.** "스크러버", "NER", "토큰"은 사용자 문구에 쓰지 않습니다. 단 화면에 보이는 파란 토큰은 예외이며, 그건 [04-pii-boundary.md](04-pii-boundary.md)가 정한 안내 문구를 씁니다.

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

**모델이 아는 절차로 채우면 규칙 위반입니다.** 0건일 때 무엇을 말하고 무엇을 말하면 안 되는지는 [11-chat-context.md](11-chat-context.md)에서 정합니다.

#### 조회 실패일 때 — 멈춥니다

**공통 안전 절차(T0)로 폴백할 수 없습니다.** [08-api.md](08-api.md) §3.1을 보면 T0 단계에도 `citation`이 붙습니다. **T0 자체가 KB 항목**(`report-112` 등)이라, 조회가 안 되면 T0도 인용 없이 내보낼 수 없습니다.

`ScrubberUnavailableError`와 같은 논리입니다 — **통제를 우회하는 폴백 경로를 만들지 않습니다.** 근거 없는 절차 안내보다 멈추는 편이 낫습니다.

다만 사용자를 빈손으로 두지 않도록 **에러 메시지에 1332를 넣습니다.** 이건 절차 안내가 아니라 연락처 안내라 인용이 필요 없습니다.

**위 다섯 경우에 4xx·5xx를 반환하면 `02-slot-tiering.md`의 설계 원칙을 어기는 것입니다.** 사용자가 막힙니다.

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

**`detail`에 PII를 넣지 않습니다** → [09-data-model.md](09-data-model.md) §10.1.

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

### (3) KB 인용 없는 응답 — 재시도 후 실패

```
1차 생성: LLM이 절차를 설명했으나 citations 가 빔
          → KbCitationMissingError, 재시도 1/2
2차 생성: 여전히 빔
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

### (4) 슬롯 추출 실패 — 에러 아님

```
POST /api/cases/01J8XKQZ.../evidence
(이체내역 OCR 에서 은행명을 못 읽음)

← 200
{
  "slots": [
    {"slot_key":"org_name","tier":"T2","state":"empty","value":null}
  ],
  "next_question": {
    "slot_key": "org_name",
    "text": "어느 은행으로 보내셨나요?",
    "options": ["국민은행","신한은행","우리은행","하나은행","모름·기억 안 남"]
  }
}
```

**200입니다.** 자동 추출 실패는 정상 경로입니다.

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

**사용자를 막지 않습니다.** L2 → L3 경로가 항상 열려 있습니다 → [05-completion-hook.md](05-completion-hook.md).

---

## TODO

- TODO(미정): 재시도 간격(백오프) 값
- TODO(미정): 클라이언트에 재시도를 맡길지 서버가 감출지 — `Retry-After` 헤더 사용 여부
- TODO(미정): 리마인더 발송 실패의 처리 → [05-completion-hook.md](05-completion-hook.md) TODO와 연동
