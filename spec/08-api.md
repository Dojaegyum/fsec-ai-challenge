# 80 · API 계약

기획서 v1.2에는 엔드포인트 수준의 계약이 없어 추출할 것이 없었습니다.
**아래는 구현 결정입니다** — [RFC-0003](../rfc/0003-사건-스토어-선택.md)의 스키마 위에서 설계했습니다.
바꿀 때는 spec을 직접 고치지 말고 RFC → ADR 절차를 거칩니다.

## 기획서에서 이미 정해진 제약

API를 설계할 때 지켜야 하는 것들입니다. 이건 정해져 있습니다.

- **PII 경계** — 외부 LLM으로 나가는 페이로드는 토큰화된 텍스트만. 스크러버를 우회하는 경로를 만들 수 없습니다 → [04](04-pii-boundary.md)
- **복원 매핑은 서버에 저장하지 않음** — 서버 API는 토큰만 다룹니다
- **세션 격리 · TTL 24h** — 사건 스토어의 수명
- **감사 로그** — 모든 LLM 호출 기록 (토큰화 텍스트 기준)
- **KB 인용 강제** — 플랜 생성 응답은 근거·시행일을 함께 반환해야 합니다 → [07](07-kb-operations.md)

> ⚠️ 위 둘째·셋째는 [RFC-0002](../rfc/0002-복원-매핑-보관-위치.md)에서 재검토 중입니다.
> **아래 계약은 현행 규칙(서버는 토큰만)을 전제로 작성했습니다.** RFC-0002가 채택되면 §3.9가 추가되고 나머지는 그대로입니다.

## 서버 구성 요소

| 구성 요소 | 역할 | 관련 |
| --- | --- | --- |
| API Gateway | 진입 | 이 문서 |
| Ingest 서비스 | STT(화자분리)·OCR | `F-02` |
| 2차 PII 스크러버 | NER → 토큰화. **격리 경계** | [04](04-pii-boundary.md) |
| 분석 오케스트레이터 | 파이프라인 조율 | `F-04` `F-05` |
| 슬롯 체커 | 필수 정보 검사 | [02](02-slot-tiering.md) |
| Case Store | 사건 상태 | [09](09-data-model.md) |
| 감사 로그 | 토큰화 텍스트 기준 | [09](09-data-model.md) §10 |

---

## 1. 공통 규약

| 항목 | 값 |
| --- | --- |
| 기본 경로 | `/api` |
| 형식 | JSON. `Content-Type: application/json` |
| 인코딩 | UTF-8 |
| 시각 | ISO 8601, **시간대 포함** (`2026-08-16T14:30:00+09:00`) |
| 사건 식별 | 경로 파라미터 `{case_id}` (ULID) |
| 세션 식별 | `X-Session-Id` 헤더 |

**모든 시각에 시간대를 포함합니다.** 기한 계산이 날짜 경계에 걸리면 시간대 하나로 하루가 어긋납니다.

### 1.1 계측 헤더

모든 응답에 붙습니다. **PII 보호가 작동한다는 것을 응답 자체가 증명합니다** → [04](04-pii-boundary.md) "작동할 뿐 아니라 보여야 합니다".

| 헤더 | 예 | 뜻 |
| --- | --- | --- |
| `X-Pii-Token-Count` | `account=1;name=2` | 유형별 토큰화 건수 |
| `X-Pii-Egress-Residual` | `0` | 송출 직전 잔여 건수. 정상은 `0` |
| `X-Kb-Version` | `2026.08.1` | 이 응답이 인용한 KB 버전 |
| `X-Audit-Id` | `01J8XKR2...` | 감사 로그 식별자 |

**건수만 담습니다. 값을 담지 않습니다.**

### 1.2 환경변수

**비밀 값을 코드나 설정 파일에 넣지 않습니다.** 전부 환경변수로 받습니다.

| 변수 | 무엇 | 필수 | 정의된 곳 |
| --- | --- | :---: | --- |
| `DATABASE_URL` | 관계형 DB 접속 | Y | [09](09-data-model.md) |
| `KV_URL` | 볼트 저장소 접속 | Y | [09](09-data-model.md) §11 |
| `VAULT_MASTER_KEY` | 볼트 마스터 키 | Y | [04](04-pii-boundary.md) |
| `BLOB_TOKEN` | 객체 저장소 접근 | Y | [09](09-data-model.md) §3 |
| `XAI_API_KEY` | Grok API 키 | Y | §4 |
| `ADMIN_USERNAME` | 관리자 아이디 | Y | §5.1 |
| `ADMIN_PASSWORD_HASH` | 관리자 비밀번호 **해시** | Y | §5.1 |
| `CASE_PURGE_DAYS` | 사건 보관 기간. 기본 90 | N | [ADR-0004](../decisions/0004-사건-스토어-선택.md) |
| `KB_FETCH_CRON` | 수집 실행 주기. 기본 하루 1회 | N | [09](09-data-model.md) §12.4 |

**`VAULT_MASTER_KEY`가 노출되면 볼트 암호문이 전부 풀립니다.** 다른 값보다 취급을 엄하게 합니다.

**`ADMIN_PASSWORD_HASH`는 해시입니다.** 평문 비밀번호를 환경변수에도 넣지 않습니다.

**언어모델은 Grok(xAI)입니다.** OpenAI 호환 API라 `base_url`을 `https://api.x.ai/v1`로 잡습니다.

> ⬜ TODO(미정): 모델명과 단가. 공식 문서에서 현재 제공 모델을 확인해 채웁니다.

### 1.3 에러

전체 규격은 [10-errors.md](10-errors.md).

```json
{ "error": { "code": "EGRESS_BLOCKED", "message": "...", "audit_id": "01J..." } }
```

---

## 2. 엔드포인트

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| `POST` | `/api/cases` | 사건 생성 |
| `GET` | `/api/cases/{case_id}` | 사건 전체 상태 |
| `POST` | `/api/cases/{case_id}/evidence` | 증거 업로드 (`F-01`) |
| `GET` | `/api/cases/{case_id}/evidence/{evidence_id}` | 전사·분석 진행 상태 (`F-02`) |
| `GET` | `/api/cases/{case_id}/slots` | 슬롯 목록 + 다음 질문 (`F-05b`) |
| `PATCH` | `/api/cases/{case_id}/slots/{slot_key}` | 슬롯 응답 (`F-05b`) |
| `GET` | `/api/cases/{case_id}/plan` | 플랜 조회 (`F-05`) |
| `GET` | `/api/cases/{case_id}/deadlines` | 기한 목록 (`F-06`) |
| `POST` | `/api/cases/{case_id}/steps/{step_id}/artifacts` | 부산물 제출 (`F-06b`) |
| `POST` | `/api/cases/{case_id}/messages` | 대응 비서 챗 (`F-07`) |

---

## 3. 계약

### 3.1 `POST /api/cases`

```jsonc
// 요청
{ "track": "victim" }          // victim | frozen_account

// 응답 201
{
  "case_id": "01J8XKQZ3M7N2P4R6T8V0W2Y4A",
  "track": "victim",
  "status": "intake",
  "opened_at": "2026-08-16T14:30:00+09:00",
  "plan": {                     // T0 공통 안전 절차가 즉시 붙는다
    "is_superset": true,
    "steps": [
      { "step_id": "01J...", "seq": 1, "title": "112에 신고하기",
        "state": "not_started", "actor": "victim",
        "citation": { "kb_entry_id": "report-112", "kb_version": "2026.08.1",
                      "source_url": "https://...", "effective_from": "2020-01-01" } }
    ]
  }
}
```

**사건을 만드는 즉시 T0 공통 안전 절차가 붙습니다.** 슬롯이 하나도 없어도 그렇습니다 → [02](02-slot-tiering.md) "진입 자체로 충분".

### 3.2 `POST /api/cases/{case_id}/evidence`

업로드는 **presigned URL 방식**입니다. 파일이 API 서버를 거치지 않고 객체 저장소로 직접 갑니다.

```jsonc
// 1단계 — 업로드 자리 요청
{ "kind": "audio", "mime_type": "audio/m4a", "byte_size": 4210553 }

// 응답 201
{
  "evidence_id": "01J8XKR6...",
  "upload_url": "https://...",     // 유효기간 있는 직접 업로드 URL
  "upload_method": "PUT",
  "expires_at": "2026-08-16T14:35:00+09:00"
}

// 2단계 — 클라이언트가 upload_url 로 직접 PUT

// 3단계 — 업로드 완료 통지
// POST /api/cases/{case_id}/evidence/{evidence_id}/complete
// 응답 202 — Ingest 시작됨
{ "evidence_id": "01J8XKR6...", "ingest_status": "processing" }
```

**presigned 방식을 쓰는 이유:** Vercel 서버리스 함수는 요청 본문 크기와 실행 시간에 제한이 있습니다. 녹음 파일이 수십 MB일 수 있어 API 서버를 통과시키면 한계에 걸립니다.

### 3.3 `GET /api/cases/{case_id}/evidence/{evidence_id}`

전사·분석 진행 상태입니다. **폴링 방식**입니다.

```jsonc
// 응답 200 — 처리 중
{
  "evidence_id": "01J8XKR6...",
  "ingest_status": "processing",
  "progress": { "phase": "stt", "percent": 62 },
  "poll_after_ms": 1500
}

// 응답 200 — 완료
{
  "evidence_id": "01J8XKR6...",
  "ingest_status": "done",
  "transcript": [
    { "speaker": "A", "text": "[이름-1] 고객님 되시죠", "start_ms": 0 },
    { "speaker": "B", "text": "네 맞는데요", "start_ms": 2100 }
  ],
  "pii_tokens": [
    { "token": "[이름-1]", "kind": "name" },
    { "token": "[계좌-1]", "kind": "account" }
  ],
  "extracted_slots": [
    { "slot_key": "org_name", "value": "국민은행", "confidence": 0.91 }
  ]
}
```

**`transcript`는 토큰화된 상태로 내려갑니다.** 브라우저가 자기 매핑으로 복원해 화면에 표시합니다.

**`pii_tokens`는 어떤 토큰이 있는지 알려줄 뿐 원문을 담지 않습니다.** 브라우저가 파란 토큰으로 표시할 때 씁니다 → [04](04-pii-boundary.md) UI 절.

> 폴링을 택한 이유: Vercel 서버리스는 장시간 연결을 유지하는 스트리밍에 제약이 있습니다.
> `poll_after_ms`로 서버가 다음 호출 시점을 지시해 부하를 조절합니다.
>
> TODO(미정): 챗(`3.9`)에만 스트리밍을 쓸지. 전사와 달리 응답이 짧아 다른 판단이 가능합니다.

### 3.4 `GET /api/cases/{case_id}/slots`

```jsonc
// 응답 200
{
  "slots": [
    { "slot_key": "transferred", "tier": "T1", "state": "confirmed", "value": true },
    { "slot_key": "channel",     "tier": "T1", "state": "confirmed", "value": "CH-bank" },
    { "slot_key": "org_name",    "tier": "T2", "state": "extracted",
      "value": "국민은행", "confidence": 0.91, "source_ref": "01J8XKR6..." },
    { "slot_key": "amount",      "tier": "T2", "state": "empty", "value": null }
  ],
  "tier_status": { "T1": "satisfied", "T2": "partial" },
  "next_question": {
    "slot_key": "amount",
    "text": "얼마를 보내셨나요?",
    "input": "buttons",
    "options": ["100만원 미만","100~500만원","500~1000만원","1000만원 이상","모름·기억 안 남"]
  }
}
```

**`next_question`은 한 번에 하나입니다.** 질문 순서는 플랜을 가장 크게 바꾸는 슬롯부터입니다 → [02](02-slot-tiering.md) 최소 질문 원칙.

**`options`에 「모름·기억 안 남」이 항상 들어갑니다.** 없으면 스펙 위반입니다.

**`next_question`이 `null`이어도 실행 보드는 열립니다.** 슬롯 미충족으로 진입을 막지 않습니다.

### 3.5 `PATCH /api/cases/{case_id}/slots/{slot_key}`

```jsonc
// 요청 — 값 입력
{ "action": "answer", "value": "3000000" }

// 요청 — 모름
{ "action": "unknown" }

// 응답 200
{
  "slot": { "slot_key": "amount", "state": "confirmed", "value": "3000000" },
  "plan_regenerated": true,
  "next_question": null,
  "changed_deadlines": [
    { "deadline_id": "01J...", "kind": "primary",
      "due_at": "2026-08-21T23:59:59+09:00",
      "changed_from": "2026-08-20T23:59:59+09:00" }
  ]
}
```

**슬롯이 채워지면 플랜을 자동 재생성합니다** → [02](02-slot-tiering.md).

**재생성 시 이미 완료된 단계와 부산물은 보존됩니다** → [09](09-data-model.md) §6.1.

**기한이 바뀌면 `changed_from`을 함께 보냅니다.** 안내한 날짜가 조용히 바뀌면 사용자가 이전 날짜를 계속 믿습니다.

### 3.6 `GET /api/cases/{case_id}/plan`

```jsonc
// 응답 200
{
  "is_superset": false,
  "generated_at": "2026-08-16T14:33:00+09:00",
  "kb_version": "2026.08.1",
  "channels": [
    { "channel_id": "CH-bank",
      "org_id": "kb-bank",        // 서버가 해석한 기관. null 이면 미특정
      "org_name": "국민은행",      // 표시용 이름
      "amount": 3000000, "confidence": 0.94 }
  ],
  "steps": [
    {
      "step_id": "01J8XKR7...",
      "seq": 2,
      "title": "송금한 은행에 지급정지 요청",
      "actor": "victim",
      "state": "done_verified",
      "conditional": null,
      "body": { "text": "...", "contact": "1588-9999", "channel": ["phone"] },
      "citation": {
        "kb_entry_id": "bank-freeze-request",
        "kb_version": "2026.08.1",
        "legal_basis": "통신사기피해환급법 제4조",
        "source_url": "https://www.law.go.kr/...",
        "effective_from": "2020-01-01"
      },
      "artifacts": [
        { "artifact_id": "01J...", "kind": "sms_capture",
          "verify_level": "L2", "verify_result": "passed" }
      ],
      "required_artifact": { "kind": "sms_capture",
                             "label": "은행 접수 문자 캡처" }
    }
  ]
}
```

**모든 `steps[]` 에 `citation`이 있습니다. 없으면 응답을 만들지 않습니다** → `CLAUDE.md` 불변 규칙 1.

**`org_id`가 `null`이면 기관을 특정하지 못한 것입니다.** 클라이언트는 이때 "어느 은행인지 확인해 주세요"를 띄울 수 있습니다. `org_name`만으로는 서버가 표기를 어떻게 해석했는지 알 수 없어 이 판단이 불가능합니다 → [09](09-data-model.md) §4.1.

**슈퍼셋 플랜이면 `is_superset: true`이고 조건부 단계에 `conditional` 라벨이 붙습니다.**

```jsonc
{ "title": "간편송금 사업자에 지급정지 요청",
  "conditional": "카카오페이로 보냈다면" }
```

### 3.7 `GET /api/cases/{case_id}/deadlines`

```jsonc
// 응답 200
{
  "deadlines": [
    {
      "deadline_id": "01J8XKR8...",
      "step_id": "01J8XKR7...",
      "title": "피해구제 신청서 제출",
      "kind": "primary",
      "due_at": "2026-08-20T23:59:59+09:00",
      "status": "open",
      "computed_from": "freeze_requested_at",
      "on_miss": "이 날짜를 넘기면 금융회사가 14일을 추가로 통지합니다"
    },
    {
      "deadline_id": "01J8XKR9...",
      "step_id": "01J8XKR7...",
      "title": "피해구제 신청서 제출 (추가 기간)",
      "kind": "grace",
      "due_at": "2026-09-03T23:59:59+09:00",
      "status": "open",
      "condition": "3영업일을 넘겼을 때 주어지는 기간입니다. 이때도 안 내면 지급정지가 무효가 됩니다"
    },
    {
      "deadline_id": "01J8XKRA...",
      "title": "채권소멸공고",
      "kind": "info",
      "due_at": "2026-10-20T23:59:59+09:00",
      "status": "open",
      "note": "금융감독원이 진행합니다. 사용자가 할 일은 없습니다"
    }
  ]
}
```

**본 기한과 추가 기간을 별도 항목으로 반환합니다. 합치지 않습니다** → [09](09-data-model.md) §8.1.

**`kind: "info"`는 사용자가 지켜야 할 기한이 아닙니다.** `note`로 그렇게 밝힙니다 → [09](09-data-model.md) §8.3.

### 3.8 `POST /api/cases/{case_id}/steps/{step_id}/artifacts`

```jsonc
// 요청 — 접수번호 직접 입력
{ "kind": "receipt_no", "value": "2026-1234567" }

// 요청 — 캡처 업로드 (evidence 와 같은 presigned 흐름)
{ "kind": "sms_capture", "evidence_id": "01J8XKRB..." }

// 요청 — 자기 신고
{ "kind": "other", "self_reported": true }

// 응답 200 — L1 통과
{
  "artifact_id": "01J8XKRC...",
  "verify_level": "L1",
  "verify_result": "passed",
  "step_state": "done_verified",
  "unlocked_steps": [
    { "step_id": "01J8XKRD...", "title": "피해구제 신청서 작성",
      "reason": "112 사건접수번호가 확보되어 신청서를 만들 수 있습니다" }
  ]
}

// 응답 200 — L1 실패 (에러 아님)
{
  "artifact_id": "01J8XKRC...",
  "verify_level": "L1",
  "verify_result": "failed",
  "verify_detail": { "reason": "format_mismatch" },
  "step_state": "in_progress",
  "next_options": [
    { "level": "L2", "label": "접수 문자 캡처를 올려주세요" },
    { "level": "L3", "label": "번호 없이 접수했다고 표시" }
  ]
}

// 응답 200 — L3 자기 신고
{
  "artifact_id": "01J8XKRC...",
  "verify_level": "L3",
  "verify_result": "not_applicable",
  "step_state": "unconfirmed",
  "note": "완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요"
}
```

**L1 실패가 에러가 아닙니다.** L2 → L3 경로가 항상 열려 있습니다 → [05](05-completion-hook.md).

**L3만으로 `done_verified`가 되지 않습니다.** `unconfirmed`는 리마인더 추적 대상으로 남습니다.

**`unlocked_steps`는 증거 연쇄를 보여줍니다.** 부산물이 다음 단계의 입력이 되는 구조를 사용자가 이해하게 만듭니다.

### 3.9 `POST /api/cases/{case_id}/messages` — 대응 비서 챗 (`F-07`)

```jsonc
// 요청
{ "content": "지급정지는 걸었는데 이제 뭘 해야 하나요" }

// 응답 200
{
  "message_id": "01J8XKRE...",
  "reply": "지급정지를 거셨으면 다음은 피해구제 신청서 제출입니다. 8월 20일까지 하셔야 하고, 이 날짜를 넘기면 은행이 9월 3일까지 추가 기간을 줍니다. 두 날짜를 다 알려드리는 이유는, 20일을 넘겼다고 포기하실 필요는 없지만 추가 기간도 놓치면 지급정지가 무효가 되기 때문입니다.",
  "citations": [
    { "kb_entry_id": "relief-application",
      "kb_version": "2026.08.1",
      "legal_basis": "통신사기피해환급법 시행령 제3조 제2항·제3항",
      "source_url": "https://www.law.go.kr/...",
      "effective_from": "2026-07-01" }
  ],
  "referenced_steps": ["01J8XKRD..."],
  "referenced_deadlines": ["01J8XKR8...", "01J8XKR9..."]
}
```

#### 챗의 규칙

**서버가 매 턴 KB를 조회해 프롬프트에 넣습니다.** 모델은 도구를 부르지 않고, 조회 조건에도 관여하지 않습니다. 조립 규칙은 [11-chat-context.md](11-chat-context.md), 조회 우선순위는 [09](09-data-model.md) §11.2.

**인용 허용 집합은 이번 요청 프롬프트에 실제로 들어간 KB 항목입니다.** 그 목록이 `message.kb_context_refs`에 저장됩니다. **프롬프트에 없던 항목을 인용하면 서버가 거부합니다** → [09](09-data-model.md) §9.1

**절차를 언급한 응답에 `citations`가 비면 안 됩니다.** 비면 `KB_CITATION_MISSING`으로 재시도합니다 → [10-errors.md](10-errors.md).

**조회 결과가 0건이면 절차를 말하지 않습니다.** 이때는 `citations`가 비어도 위반이 아닙니다 → [10-errors.md](10-errors.md) §4.1

```jsonc
{
  "reply": "말씀하신 경우에 대한 확인된 절차를 아직 갖고 있지 않습니다. 금융감독원 1332로 연락하시면 상담받으실 수 있습니다.",
  "citations": [],
  "kb_result": "empty"
}
```

**조회 자체가 실패하면 챗을 멈춥니다.** `KB_UNAVAILABLE`(503)입니다. 공통 안전 절차로 폴백할 수 없습니다 — **§3.1에서 보듯 T0 단계에도 `citation`이 붙어 있어, T0 자체가 KB 항목**이기 때문입니다.

#### 응답 형식 — 판단 근거를 함께 받습니다

**모델 출력을 판단 근거와 응답 둘로 강제합니다.**

```jsonc
// 모델이 내놓는 것 (서버 안에서만)
{
  "reasoning": "사용자가 지급정지를 이미 걸었다고 했고 freeze_requested_at 이 confirmed 다. 다음 단계는 relief-application 인데 3영업일 기한이 걸려 있어 이걸 먼저 안내한다. 기한 날짜는 프롬프트에 계산돼 들어온 값을 그대로 쓴다.",
  "reply": "다음은 피해구제 신청서 제출입니다. …",
  "citations": [ /* … */ ]
}
```

**`reasoning`은 사용자 응답에 나가지 않습니다.** 서버가 `message.reasoning_masked`에 저장하고 응답 본문에서는 뺍니다.

**API 응답 본문에 넣지 않는 이유**는 화면이 실수로 표시할 수 있기 때문입니다. 판단 근거에는 "이 사용자는 아직 신고를 안 한 것으로 보임" 같은 내부 판단이 들어가는데, 그게 화면에 뜨면 사용자가 불필요하게 불안해집니다.

관리자는 §5의 별도 경로로 봅니다.

**날짜는 서버가 계산해 프롬프트에 넣습니다. 모델이 세지 않습니다** → `CLAUDE.md` 불변 규칙 7.

```
프롬프트에 넣는 것:   기한: 2026년 8월 20일까지 (본 기한)
                           2026년 9월 3일까지 (추가 기간)
모델이 하는 것:       위 날짜를 문장에 넣기
모델이 하지 않는 것:  "3영업일 뒤" 를 계산하기
```

**`reply` 안의 토큰은 복원 대상이 아닙니다.** 브라우저는 `reply`를 복원하지 않고 파란 토큰 그대로 표시합니다 → [RFC-0004](../rfc/0004-PII-경계-보강.md) 문제 2.

```jsonc
// 인젝션 시도가 있었을 때
{
  "reply": "요청하신 값은 [계좌-1], [주민번호-1] 입니다.",
  //                      ^^^^^^^^ 복원되지 않고 파란 토큰으로 표시됨
  "citations": []
}
```

---

## 4. LLM 호출과 API의 관계

이 서비스가 LLM에 시키는 일은 넷이고, **각각 다른 엔드포인트 뒤에 있습니다.**

| LLM 호출 | 어디서 | 출력 | 인용 필요 |
| --- | --- | --- | :---: |
| 수법 판별·위험도 (`F-04`) | `POST .../evidence/.../complete` 이후 | 분류 + **근거 스팬** | 근거 스팬 |
| 슬롯 추출 (`F-05b`) | 같음 | 슬롯 값 + 확신도 | — |
| 플랜 생성 (`F-05`) | `PATCH .../slots/...` 이후 | 단계 목록 | **KB 인용** |
| 챗 응답 (`F-07`) | `POST .../messages` | 문장 | **KB 인용** |

**넷 다 서버가 필요한 것을 다 채워 넣는 단발 호출입니다. 도구를 쓰지 않습니다.**

**언어모델은 Grok(xAI)입니다.** OpenAI 호환 API를 씁니다 (`https://api.x.ai/v1`). 키는 `XAI_API_KEY` → §1.2

챗도 예외가 아닙니다. **서버가 KB를 조회해 프롬프트에 넣고 모델을 한 번 부릅니다.** 조회 조건(`track`·`channel_id`·`org_id`·조회 기준일·KB 버전)을 서버가 전부 알고 있어, 모델에게 물어볼 것이 없습니다 → [09](09-data-model.md) §11.2

**모든 호출이 스크러버를 통과한 페이로드로만 이루어집니다.** 우회 경로를 만들지 않습니다.

**기한 계산은 이 넷 어디에도 없습니다.** 코드의 규칙입니다.

---

## 5. 관리자 조회 — 왜 이런 응대가 나갔는지

**응답 하나를 놓고 "무엇을 보고 그렇게 답했는지"를 재현할 수 있어야 합니다.**

### 5.1 엔드포인트

| 메서드 | 경로 | 기능 |
| --- | --- | --- |
| `GET` | `/api/admin/cases/{case_id}/messages/{message_id}` | 그 턴의 프롬프트 전문·판단 근거·KB 항목 |
| `GET` | `/api/admin/cases/{case_id}/trace` | 사건 전체 턴의 요약 |

**일반 경로와 분리합니다.** `/api/admin/` 아래에만 둡니다.

#### 인증 — 관리자 계정 하나

**MVP 범위에서는 계정을 하나만 둡니다.** 사용자 계정 체계를 만들지 않습니다.

| 항목 | 값 |
| --- | --- |
| 계정 | 하나. 아이디·비밀번호를 환경변수로 받음 |
| 환경변수 | `ADMIN_USERNAME` · `ADMIN_PASSWORD_HASH` |
| 인증 방식 | 로그인 후 세션 쿠키 |
| 헤더 | `X-Session-Id`(사용자용)와 **별개** |

**비밀번호를 평문으로 저장하지 않습니다.** 해시만 환경변수로 받습니다.

**`/api/admin/` 아래 모든 경로에 인증을 겁니다.** 인증 없이 접근하면 `401`입니다. 미들웨어에서 경로 접두사로 일괄 처리하고, **엔드포인트마다 개별로 확인하지 않습니다** — 새 관리자 경로를 추가할 때 인증을 빠뜨리는 것을 막기 위해서입니다.

> 사용자 계정 체계는 대회 범위 밖입니다. 서비스가 실제로 운영되면 관리자 여럿·권한 분리가 필요하고, 그때는 이 결정을 뒤집는 새 ADR을 씁니다.

### 5.2 응답

```jsonc
// GET /api/admin/cases/{case_id}/messages/{message_id}
{
  "message_id": "01J8XKRE...",
  "turn_no": 4,
  "created_at": "2026-08-16T14:40:00+09:00",

  "prompt": "…이 턴에 실제로 보낸 프롬프트 전문 (토큰화 상태)…",
  "reasoning": "사용자가 지급정지를 이미 걸었다고 했고 freeze_requested_at 이 confirmed 다. 다음 단계는 relief-application …",
  "reply": "다음은 피해구제 신청서 제출입니다. …",

  "kb_context": [
    { "kb_entry_id": "bank-freeze-request", "kb_version": "2026.08.1", "group": "applied" },
    { "kb_entry_id": "easypay-freeze",      "kb_version": "2026.08.1", "group": "reference" }
  ],
  "citations": [
    { "kb_entry_id": "relief-application", "kb_version": "2026.08.1" }
  ],

  "model": "…", "token_in": 3200, "token_out": 480, "latency_ms": 2100,
  "masked_counts": { "account": 1, "name": 2 },
  "audit_id": "01J8XKR2..."
}
```

**`kb_context`의 `group`이 진단의 핵심입니다.** "은행 이체 사건인데 왜 간편송금 절차를 안내했나"를 조사할 때, 그 항목이 `reference`였다면 **모델이 조건 라벨을 빠뜨린 것**으로 원인이 바로 좁혀집니다.

`group` 값의 정의와 프롬프트 조립 규칙은 [11-chat-context.md](11-chat-context.md).

### 5.3 관리자도 원문 개인정보를 볼 수 없습니다

**이 설계의 핵심입니다.**

```
관리자가 보는 것:   "[계좌-1] 로 300만원을 보냈다고 하셨으니…"
관리자가 못 보는 것: 110-234-567890
```

프롬프트·판단 근거·응답이 전부 **토큰화된 상태로 저장**돼 있고, 복호화 키는 사용자 브라우저에만 있습니다 → [04](04-pii-boundary.md) 불변 규칙 1

**관리자에게도 키가 없습니다.** 관리자 화면에서 토큰을 복원하는 경로를 만들지 않습니다.

**감사 가능성과 개인정보 최소 취급이 보통 상충하는데, 이 구조에서는 둘이 동시에 성립합니다.**

### 5.4 판단 근거는 사용자 응답에 절대 넣지 않습니다

**이유가 둘인데, 두 번째가 더 급합니다.**

**첫째, 화면이 실수로 표시할 수 있습니다.** 판단 근거에는 "이 사용자는 아직 신고를 안 한 것으로 보임" 같은 내부 판단이 들어갑니다. 화면에 뜨면 사용자가 불필요하게 불안해집니다.

**둘째, 판단 근거에는 인용 강제가 걸리지 않습니다.**

인용 검증은 최종 응답의 `citations`에 대해서만 돕니다. 그런데 모델이 생각하는 도중에는 이런 문장이 나올 수 있습니다.

```
판단 근거: "이 사용자는 지급정지를 걸었으니 3영업일 안에 신청서를 내야 한다.
            아마 은행 앱으로도 될 것이다."
                ^^^^^^^^^^^^^^^^^^^^^ KB 근거 없음. 검증 안 받음
```

**최종 응답에서는 `CLAUDE.md` 불변 규칙 1이 지켜지는데 판단 근거에서 새는 상태**가 됩니다. 사용자는 둘을 구분해 읽지 않습니다.

**그래서 관리자 전용 경로 분리는 선택이 아니라 필수 조건입니다.** 일반 사용자 응답 본문에 어떤 형태로도 판단 근거가 들어가면 안 됩니다.

### 5.5 감사 로그와의 관계

관리자 조회 자체도 기록에 남깁니다.

| `event_type` | `detail` |
| --- | --- |
| `admin.message_viewed` | `{"message_id": "…", "viewer": "…"}` |

**누가 무엇을 열어 봤는지가 남아야** 관리자 권한이 통제 밖으로 나가지 않습니다. `detail`에 개인정보를 넣지 않는 규칙은 그대로입니다 → [09](09-data-model.md) §10.1

---

## TODO

- ~~TODO(미정): 인증~~ → **관리자는 §5.1 에서 확정** (계정 하나). 사용자 계정 체계는 대회 범위 밖
- TODO(미정): 챗에 스트리밍을 쓸지 (§3.3 참조)
- TODO(미정): 리마인더 발송 트리거 — 예약 실행인지 접근 시점 검사인지 → [09](09-data-model.md) §14와 같은 문제
- TODO(미정): 속도 제한 정책
- TODO(근거 필요): 기관별 접수번호 포맷 — `3.8`의 L1 포맷 체크가 여기 의존 → [05](05-completion-hook.md) TODO와 같은 항목
