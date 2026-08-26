# 아키텍처 — FinAlly가 어떻게 구성되는가

> **상태: 채워짐(2026-08-16).** 백엔드 정의가 끝나 각 절이 실제 선택을 가리킵니다.
> **모듈의 물리 배치와 언어는 [ADR-028](decisions/028-runtime-and-module-shape.md)로 해소됐습니다** —
> Next.js 안, 전부 TypeScript입니다. 남은 미결은 §10에 있습니다.

## 이 문서의 자리

| 문서 | 답하는 질문 |
| --- | --- |
| **`ARCHITECTURE.md`** (여기) | **무엇이 어디서 어떻게 도는가** — 기술 선택·모듈 배치·저장소·배포 |
| [`spec/`](spec/) | 제품이 **무엇을 만족해야 하는가** (계약) |
| [`rfc/`](rfc/) | 파일을 **어디에 두는가** (작업 규약) |
| [`decisions/`](decisions/) | **왜 그렇게 정했나** (이력) |

**spec에 있는 것을 여기 다시 적지 마세요.** 계약은 spec이 정본이고, 여기는 그 계약을 **무엇으로 구현하는가**입니다.
어긋나면 spec이 이깁니다. 구조를 바꾸는 결정을 내렸다면 `decisions/`에 ADR을 남기고 여기를 고칩니다.

**먼저 읽을 것** — [모듈 명칭](spec/common/08-16-module-names.md)(이름의 정본·네 층) ·
[모듈 경계](spec/common/08-16-module-boundaries.md)(책임·금지) ·
[PII 격리 경계](spec/common/08-14-pii-boundary.md)(협상 대상 아님).

---

## 1. 한눈에

```mermaid
flowchart TB
    subgraph CLIENT["브라우저 · 층 C"]
        OPEN["case-opener · URL이 곧 열쇠"]
        UI["보여주고 작업하는 것 · §4"]
        MASK["pii-masker · 1차 마스킹"]
        KEY["key-handler · 복호화 키"]
        REST["pii-restorer · 복원은 여기서만"]
    end

    subgraph SERVER["Vercel 서버리스"]
        API["API 라우트 · 엔드포인트 10 + 관리자 2"]
        BOUND["pii-tokenizer · 격리 경계"]
        CORE["동작 단위 네 층 · §4"]
        AUDIT["audit-logger"]
    end

    subgraph STORE["저장소 셋"]
        PG[("Supabase Postgres · 사건 상태 · KB")]
        KV[("볼트 · 암호문만 · 제품 미결")]
        BLOB[("Supabase Storage · 업로드 원본")]
    end

    subgraph EXT["외부"]
        GROK["Grok · xAI"]
        LAW["국가법령정보 API · 금융위 RSS"]
    end

    UI --> MASK --> API
    API --> BOUND --> CORE
    CORE --> PG
    CORE --> KV
    CORE --> BLOB
    CORE -- "토큰화 텍스트만" --> GROK
    CORE --> AUDIT --> PG
    CORE --> UI
    UI --> REST
    KEY --> REST
    LAW --> CORE

    style BOUND fill:#fde68a,stroke:#b45309,color:#111
    style REST fill:#bfdbfe,stroke:#1d4ed8,color:#111
    style GROK fill:#e5e7eb,stroke:#6b7280,color:#111
    style LAW fill:#e5e7eb,stroke:#6b7280,color:#111
```

**노란 칸이 격리 경계입니다.** 여기를 지나지 않은 텍스트가 외부로 나가면
[PII 격리 경계](spec/common/08-14-pii-boundary.md) 위반입니다.

**파란 칸은 서버에 없습니다.** 복원은 브라우저에서만 일어납니다 — 서버에는 복호화 키가 없어
복원 자체가 **구조적으로 불가능**합니다 → [ADR-009](decisions/009-restore-mapping-location.md).

## 2. 기술 스택

| 영역 | 선택 | 정본 |
| --- | --- | --- |
| **언어** | **TypeScript** — 화면·API·도메인 모듈 전부. 별도 백엔드 없음 | [ADR-028](decisions/028-runtime-and-module-shape.md) |
| 프론트 | Next.js (App Router) · React · Tailwind v4 · shadcn/ui | `src/package.json` |
| 디자인 토큰 | FinAlly 도메인 토큰 | `src/app/globals.css` · [design-system](spec/frontend/design-system/) |
| 백엔드 런타임 | **Vercel 서버리스 함수** | [API 계약](spec/common/08-14-api.md) |
| 관계형 DB | **Supabase Postgres** (`ap-northeast-2` 서울) — 사건 상태·KB | [ADR-016](decisions/016-retention-and-datastore.md) |
| 볼트 | 복원 매핑 암호문. **제품 미결** — 리전 확인 후 → §10 | [ADR-016](decisions/016-retention-and-datastore.md) |
| 객체 저장소 | **Supabase Storage** — 업로드 원본. 저장 시 암호화 | [ADR-016](decisions/016-retention-and-datastore.md) |
| 언어모델 | **Grok (xAI)** — OpenAI 호환 (`https://api.x.ai/v1`). **도구 호출 안 씀** | [챗 컨텍스트](spec/backend/08-16-chat-context.md) |
| KB 검색 | **조건 조회** — 벡터 유사도 아님 | [ADR-012](decisions/012-kb-collection.md) |
| 작업 큐·스케줄러 | **미정** → §10 | |

**서버리스라는 선택이 여러 계약을 이미 결정했습니다.** 함수의 본문 크기·실행 시간 제한 때문입니다.

| 계약 | 왜 그렇게 됐나 |
| --- | --- |
| 업로드는 **presigned URL** | 녹음이 수십 MB라 API 함수를 통과시키면 본문 한계에 걸립니다 |
| 챗은 **스트리밍 없이 응답 1회** | 장시간 연결 유지에 제약이 있습니다 |
| 전사 진행은 **폴링** | 위와 같은 이유 |
| LLM 재시도 최대 2회 | 3~8초짜리 호출을 반복하면 함수가 먼저 끊깁니다 → [에러 계약](spec/backend/08-16-errors.md) §2 |

## 3. 데이터 저장소

**셋으로 나눈 이유는 한 번의 유출로 암호문과 사건 구조가 함께 나가지 않게 하기 위해서입니다** → [ADR-010](decisions/010-case-store.md).

| 저장소 | 담는 것 | 원문 PII |
| --- | --- | :---: |
| Supabase Postgres | 사건 상태 — 슬롯·플랜·부산물·기한·대화·감사 · KB | **없음** |
| 볼트 (제품 미결) | 토큰↔원문 대응 (암호문) | 있음 — **서버는 키 없음** |
| Supabase Storage | 업로드된 증거 원본 | 있음 — 저장 시 암호화, 사건별 키 |

> **앱은 Vercel, 데이터는 Supabase입니다.** `Vercel Postgres`는 2024-12 폐지돼 Neon으로 이관됐고
> Neon에는 서울 리전이 없습니다 → [ADR-016](decisions/016-retention-and-datastore.md).
> **볼트만 미결**입니다 — ADR-010의 "다른 인스턴스에 둔다"는 분리 원칙을 지키면서 리전도 맞춰야 해서입니다.

- **DDL 위치** — [데이터 모델](spec/backend/08-16-data-model.md). 테이블 14개, **PostgreSQL 방언**입니다
- **마이그레이션 방식** — **`psql` + 순번 SQL 파일** → [`src/migrations/`](src/migrations/).
  ORM 을 끼우지 않는 이유는 **DDL 이 두 곳에 생기기 때문**입니다 — 정본이 이미 PostgreSQL
  방언으로 쓰여 있어, ORM 스키마와 갈라지면 어느 쪽이 맞는지 알 수 없게 됩니다.
  적용 이력은 `schema_migrations` 표에 남습니다. **아직 실제 데이터베이스에 적용해 보지는
  않았습니다** — Supabase 프로젝트가 없습니다
- **보존·파기** — `case.purge_after` **마지막 활동일부터 180일**(`CASE_PURGE_DAYS`).
  세 저장소가 **같은 날 함께** 죽습니다 → [ADR-016](decisions/016-retention-and-datastore.md)
  - 표준 트랙만 D+100이고(공고 2개월 + 환급금 결정 14일), 이의제기가 붙으면 D+160입니다 →
    [research/06](docs/research/06-경로별-실측조사.md) §5
  - 기산이 생성일이 아니라 **마지막 활동일**입니다. 공고 후에 피해를 알고 들어온 사람은 진입 시점에 이미 두 달이 지나 있습니다
- **파기 실행 수단** — `case-purger`가 앱의 API 라우트로 돌고 **Vercel Cron이 깨웁니다**
  → [ADR-025](decisions/025-scheduled-jobs.md). ⚠️ **Storage에는 네이티브 만료가 없어**
  **직접 지우고 실제로 지워졌는지 검증**해야 합니다 — 세 저장소를 한 코드에서 다루려고 앱 안을 고른 이유입니다

> **DDL을 쓰기 전에** [저장 경계 표](spec/common/08-16-domain-model.md)를 확인하세요.
> 복원 매핑 원문·복호화 키를 담는 컬럼은 어떤 이유로도 만들지 않습니다.

## 4. 모듈

**이름의 정본은 [모듈 명칭](spec/common/08-16-module-names.md)이고, 책임과 금지는 [모듈 경계](spec/common/08-16-module-boundaries.md)입니다.**
여기에는 그 이름들이 **서로 어떻게 이어지는지**를 그립니다.

가르는 기준은 **언제 도는가**입니다 → [ADR-014](decisions/014-module-names.md).

### 층 1 · 증거가 들어올 때 (한 번)

```mermaid
flowchart LR
    UP["업로드 · presigned"] --> INTAKE["case-intake"]
    INTAKE --> TR["transcriber · STT · OCR"]
    TR --> TOK["pii-tokenizer · 격리 경계"]
    TOK --> READER["case-reader · 수법 · 위험도"]
    TOK --> SX["slot-extractor · 슬롯 값 추출"]
    READER --> DB[("Postgres")]
    SX --> DB
    TOK --> VAULT[("볼트 · 암호문")]

    style TOK fill:#fde68a,stroke:#b45309,color:#111
```

**`case-reader`의 산출물은 절차 분기에 쓰이지 않습니다.** 분기축은 경유 서비스 하나입니다 →
[채널 매트릭스](spec/backend/08-14-channel-matrix.md). 화면 표시와 관리자 조회에서만 소비됩니다.

**`slot-extractor`와 `slot-checker`는 다른 층입니다.** 값을 뽑는 것은 LLM이 하고(여기),
충분한지 판정하는 것은 규칙이 합니다(층 3).

### 층 2 · 사용자가 말할 때마다 (매 턴)

```mermaid
flowchart TB
    IN["사용자 발화"] --> RECV["chat-receiver · 순서를 부르는 자리"]
    RECV --> TOK2["pii-tokenizer"]
    TOK2 --> FIND["kb-finder · applied · reference 두 묶음"]
    FIND --> PB["prompt-builder · 7블록 조립 · 격리 태그"]
    PB --> LLM{{"Grok · 1회 호출"}}
    LLM --> CC["citation-checker"]

    CC -->|"인용 있음"| OUT["답변"]
    CC -->|"인용 없음 · KB 조회 0건"| G1332["1332 안내"]
    CC -->|"인용 없음 · 조회는 됐음"| SLOT["slot-checker · 질문 1문항"]

    OUT --> PUB["chat-publisher · 한 형태로 씌움<br/>판단 근거 분리 · 잔여 PII 검사"]
    G1332 --> PUB
    SLOT --> PUB

    PUB --> BROWSER["pii-restorer · 브라우저 · 부분 복원"]

    style TOK2 fill:#fde68a,stroke:#b45309,color:#111
    style PUB fill:#fde68a,stroke:#b45309,color:#111
    style BROWSER fill:#bfdbfe,stroke:#1d4ed8,color:#111
```

**세 갈래가 `chat-publisher` 하나로 모여 같은 껍데기로 나갑니다** — 화면이 갈래를 분기하지 않습니다
→ [ADR-022](decisions/022-chat-turn-boundaries.md). `chat-receiver`는 **부르기만 하고 판정하지 않습니다.**

**이 층에서 에러가 나가지 않는 경로가 둘입니다.** 근거를 못 찾으면 실패가 아니라
**되묻기**로 갑니다 → [ADR-015](decisions/015-citation-and-reask.md) · `CLAUDE.md` 불변 규칙 5.

**서버는 조회 조건을 전부 알고 있어 모델에게 묻지 않습니다** — `track`·`channel_id`·`org_id`·오늘 날짜·현재 KB 버전.
그래서 모델이 필터를 우회할 방법이 없습니다 → [데이터 모델](spec/backend/08-16-data-model.md) §11.2.

### 층 3 · 사건 상태가 바뀔 때

```mermaid
flowchart LR
    SC["slot-checker · T1 충족 판정"] --> PL["planner · KB 인용 · plan_step"]
    PL --> DC["date-checker · 규칙으로 기한 계산"]
    COMP["completion-checker · artifact 로 완료 판정"] --> DC
    COMP --> PL
    PL --> DOC["doc-builder · 신청서 초안 · P1"]

    style DC fill:#dcfce7,stroke:#15803d,color:#111
```

**초록 칸에 LLM을 쓰지 않습니다.** 3영업일·14일 유예·2개월 공고·5영업일은 전부 코드의 규칙입니다 →
`CLAUDE.md` 불변 규칙 7 · [기한 계산 규칙](spec/common/08-16-deadline-rules.md).

**`planner`는 근거 없는 단계를 저장할 수 없습니다.** `kb_entry_id`·`kb_version`·`source_url`·`effective_from`이
비면 적재가 거부됩니다 — 불변 규칙 1을 **스키마로** 강제하는 자리입니다.

### 층 4 · 하루 1회

```mermaid
flowchart LR
    LAW["국가법령정보 API · 조문 단위"] --> COL["kb-collector · 하루 1회 수집"]
    PRE["법제처 입법예고"] --> COL
    RSS["금융위 게시판"] --> COL
    HUMAN["기관 연락처 · 사람이 확인"] --> COL

    COL --> SNAP[("source_snapshot · 원문 그대로")]
    SNAP --> CHG[("source_change · 검수 큐")]
    CHG --> REV["kb-reviewer · 사람 승인"]
    REV --> KB[("kb_entry · 버전 릴리스")]

    style REV fill:#fecaca,stroke:#b91c1c,color:#111
```

**같은 층에 사건을 건드리는 잡이 둘 더 있습니다.** KB 운영과 달리 **사용자 데이터를 읽고 지웁니다.**

```mermaid
flowchart LR
    CRON{{"Vercel Cron"}} --> RS["reminder-sender · API 라우트"]
    CRON --> CP["case-purger · API 라우트"]

    RS --> DL[("deadline · plan_step<br/>다가온 기한 · 미확인")]
    RS --> MAIL["이메일 · 준 사람에게만"]

    CP --> PG[("사건 상태")]
    CP --> BLOB[("업로드 원본")]
    CP --> KV[("복원 매핑 암호문")]
    CP --> VERIFY["삭제 확인 · 한 층만 남으면 실패"]

    style CP fill:#fecaca,stroke:#b91c1c,color:#111
```

**둘 다 앱의 API 라우트로 돌고 Vercel Cron이 깨웁니다** → [ADR-025](decisions/025-scheduled-jobs.md).
`case-purger`가 **Postgres·Storage·볼트 셋을 지우고 확인해야 해서** 앱 SDK가 닿는 자리여야 했습니다.

**메일 발송 수단과 플랜별 실행 제약은 아직 확인 전입니다** → §10.

**빨간 칸을 건너뛰는 경로를 만들지 않습니다.** 수집기가 `kb_entry`를 직접 쓰지 않습니다 —
`kb_entry` 에 쓰는 길은 `npm run kb:load` 하나입니다 → [RFC-002](rfc/002-kb-authoring.md).

**변경 감지에 별도 비교 로직이 없습니다.** `source_snapshot`의 `(source_key, content_hash)` 유일 제약에
삽입이 성공하면 그것이 곧 변경입니다.

### 층 없음 · 항상

| 이름 | 맡는 일 |
| --- | --- |
| `audit-logger` | 모든 LLM 호출을 토큰화 텍스트 기준으로 기록. 해시 사슬로 사후 조작 검출 |
| `retry-checker` | 예외의 `retryable` 하나만 보고 재시도 판단. 예외 종류를 분기하지 않음 |

### 층 C · 브라우저 (서버가 대신할 수 없는 것)

**시간축이 아니라 「무엇을 책임지는가」로 묶입니다** → [ADR-023](decisions/023-frontend-module-names.md).
화면이 열려 있는 동안 여러 가지가 동시에 돌아 시간축으로는 갈라지지 않습니다.

```mermaid
flowchart LR
    OPEN["case-opener<br/>URL 토큰으로 사건을 연다"]

    subgraph OUTBOUND["나가는 길"]
        MASK["pii-masker<br/>1차 마스킹"]
        SEND["file-sender<br/>증거·부산물 업로드"]
    end

    subgraph INBOUND["들어오는 길"]
        POLL["poll-checker<br/>poll_after_ms 로 재조회"]
        KEY["key-handler<br/>복호화 키 · 볼트 복호"]
        REST2["pii-restorer<br/>복원 심사"]
    end

    subgraph SHOW["보여주는 곳"]
        TV["transcript-viewer"]
        PV["plan-viewer"]
        DV["deadline-viewer"]
        CH["chat-handler"]
        WH["work-handler"]
        DF["doc-filler"]
    end

    OPEN --> SHOW
    SHOW --> MASK --> SEND --> SERVER[["서버"]]
    SERVER --> POLL --> REST2 --> SHOW
    KEY --> REST2
    KEY --> DF
```

| 이름 | 맡는 일 | 절대 하지 않는 것 |
| --- | --- | --- |
| `case-opener` | URL 토큰으로 사건을 열고 복사·공유를 제공 | 잃은 링크를 복구해 주는 척하기 |
| `pii-masker` | 나가기 전 정규식 1차 마스킹 | 마스킹 전 원문을 네트워크로 보내기 |
| `key-handler` | 복호화 키 보관 · 볼트 암호문 복호 | 키를 서버·로그·DB로 보내기 |
| `poll-checker` | `poll_after_ms` 로 재조회 · 재시도 판단 | 스트리밍·웹소켓 쓰기 |
| `file-sender` | 증거·부산물 업로드와 상태 추적 | `pii-masker` 를 건너뛴 경로 만들기 |
| `transcript-viewer` | 전사 표시 (**전체 복원** 허용) | 복원된 원문을 서버로 되돌리기 |
| `plan-viewer` | 타임라인·단계·배지 · T0 상시 노출 | 체크만으로 완료 표시 · T0 를 종속시키기 |
| `deadline-viewer` | 기한 표시 (`primary`·`grace`·`info`) | **날짜를 계산하기** |
| `chat-handler` | 발화 전송 · 응답·슬롯 질문 표시 | 인용 번호·판단 근거를 화면에 쓰기 |
| `work-handler` | 작업 차례 판정 + 유형별 패널 렌더 | 판정을 렌더 안에 섞기 |
| `doc-filler` | 초안에 원문을 채워 완성 | 서버가 만든 완성 문서를 그대로 받기 |

**`pii-masker` 가 1차, 서버의 `pii-tokenizer` 가 2차입니다.** 둘 다 지나야 외부 LLM에 닿습니다.

### 물리 배치

**Next.js 안입니다. 별도 백엔드를 두지 않습니다** → [ADR-028](decisions/028-runtime-and-module-shape.md).

| 무엇 | 어디 | 어디서 도나 |
| --- | --- | --- |
| 화면 | `src/app/**/page.tsx` | 브라우저 |
| API 진입점 | `src/app/api/**/route.ts` | 서버 (Vercel 함수) |
| 도메인 모듈 | `src/modules/{이름}/` | 층 1·2·3·4는 서버, **층 C는 브라우저** |
| 자원 접근 구현 | `src/lib/` | 서버 |

**진입점은 HTTP만 알고 판단은 모듈이 합니다.** `route.ts` 가 맡는 것은 요청 파싱·인증·
속도 제한·상태 코드·계측 헤더까지이고, 도메인 모듈은 **자기가 HTTP로 불렸는지 모릅니다.**
그래야 파기 배치나 리마인더처럼 다른 경로에서 같은 모듈을 부를 수 있습니다.

**각 모듈은 필요한 외부 자원을 인터페이스로 선언하고 구현을 주입받습니다.** NER 모델·
볼트 제품·공휴일 출처가 미정이어도 그 자리를 비워 두면 모듈을 완성할 수 있습니다.
**저장소 접근과 LLM 호출에는 모듈 이름을 만들지 않습니다** — 도메인 판단을 하지 않는
자원 접근입니다.

위 이름들은 **책임의 단위이지 서버의 개수가 아닙니다** → [모듈 경계](spec/common/08-16-module-boundaries.md).

## 5. 데이터 흐름

### 증거 업로드 — 원본이 API를 통과하지 않습니다

```mermaid
sequenceDiagram
    participant B as 브라우저
    participant A as API
    participant BL as Supabase Storage
    participant T as transcriber
    participant P as pii-tokenizer

    B->>A: POST /evidence (메타만)
    A-->>B: presigned URL + evidence_id
    B->>BL: 파일 직접 업로드
    B->>A: 업로드 완료 알림
    A->>T: 전사 요청
    T->>P: 전사 결과
    P->>A: 토큰화된 전사 + 매핑 암호문
    loop 폴링
        B->>A: GET /evidence/:id
        A-->>B: ingest_status
    end
```

### 챗 한 턴 — 모델 호출은 한 번뿐입니다

```mermaid
sequenceDiagram
    participant B as 브라우저
    participant A as API
    participant K as kb-finder
    participant G as Grok
    participant C as citation-checker

    B->>A: POST /messages (1차 마스킹된 발화)
    A->>A: pii-tokenizer
    A->>K: 조회 조건 (서버가 이미 앎)
    K-->>A: applied + reference
    A->>A: prompt-builder — 7블록 + 격리 태그
    A->>G: 1회 호출
    G-->>A: reply + citations
    A->>C: 인용 넷 검증
    alt 인용 있음
        C-->>B: 200 · 답변
    else KB 조회 0건
        C-->>B: 200 · 1332 안내
    else 인용 못 붙임
        C-->>B: 200 · 슬롯 질문
    end
    B->>B: pii-restorer — 부분 복원
```

**어느 갈래로도 에러가 나가지 않습니다.** 셋 다 200입니다 → [에러 계약](spec/backend/08-16-errors.md) §4.

## 6. 외부 의존

| 무엇 | 쓰임 | 선택 | 경계 |
| --- | --- | --- | :---: |
| LLM API | 수법 판별·절차 선택·플랜 문장·챗 | **Grok (xAI)** | 지남 — 토큰화 텍스트만 |
| STT | 녹음 전사(화자 분리) | **whisper medium 이상** (브라우저 디코더는 폐기 → [ADR-038](decisions/038-transcript-confirm.md)) | **경계 이전** ⚠️ |
| OCR | 이미지 → 텍스트 | **EasyOCR + 좌표 행 복원** → [research/11](docs/research/11-로컬OCR-PII인식-실측.md) | **경계 이전** ⚠️ |
| NER | 2차 PII 스크러빙 | **로컬 4B (gemma3:4b 급)** → [research/09](docs/research/09-로컬모델-PII인식-실측.md) | 경계 그 자체 |
| 법령 수집 | KB 파이프라인 | 국가법령정보 Open API · 법제처 입법예고 API | 해당 없음 |
| 공지 수집 | KB 파이프라인 | 금융위 RSS + 게시판 목록 | 해당 없음 |

> ⚠️ **STT·OCR은 `pii-tokenizer` 이전 단계라 외부 API를 쓰면 원문이 나갑니다.**
> 선택 전에 [경계 정의](spec/common/08-14-pii-boundary.md)를 확인하세요 — 이 자리가 경계의 가장 약한 고리입니다.
>
> **어디서 도는지도 같은 이유로 걸립니다** — 운영에서는 국내 하드웨어에서만 돌립니다 → [ADR-043](decisions/043-gpu-hosting.md).

**국가법령정보 API는 `efYd`(시행일) 파라미터로 과거 시점 조문을 재현합니다.** 조문마다 시행일이 따로 있어
`CH-crypto`의 2026-10-01 분기가 **배포 없이** 동작합니다 → [ADR-012](decisions/012-kb-collection.md).

## 7. 환경과 시크릿

정본은 [API 계약](spec/common/08-14-api.md)의 환경 변수 표입니다.

| 변수 | 무엇 | 필수 |
| --- | --- | :---: |
| `DATABASE_URL` | 관계형 DB 접속. **볼트도 여기입니다** — `case_vault` 스키마 | Y |
| `BLOB_TOKEN` | 객체 저장소 접근 | Y |
| `XAI_API_KEY` | Grok API 키 | Y |
| `ADMIN_USERNAME` · `ADMIN_PASSWORD_HASH` | 관리자 1계정. **해시로만** | Y |
| `CASE_PURGE_DAYS` | 사건 보관 기간. 기본 **180** (마지막 활동일 기준) | N |
| `KB_FETCH_CRON` | 수집 주기. 기본 하루 1회 | N |

- **볼트를 여는 키는 이 표에 없습니다.** 복호화 키는 브라우저에만 있고 서버는 암호문을
  보관만 합니다 → [ADR-049](decisions/049-vault-in-postgres.md)
- **평문 비밀번호는 환경변수에도 넣지 않습니다**
- **타임존은 `Asia/Seoul` 고정** → [기한 계산 규칙](spec/common/08-16-deadline-rules.md).
  DB는 `TIMESTAMPTZ`로 UTC 저장하고 세션 타임존으로 렌더합니다
- `.env.example` 파일: **2026-08-20 작성** → `src/.env.example`
- **접속 문자열이 둘입니다** — 앱은 트랜잭션 풀러(`DATABASE_URL`, 6543),
  마이그레이션은 **세션 풀러**(`DIRECT_URL`, 5432). DDL 은 트랜잭션 풀러로 못 갑니다.
  ⚠️ Supabase 의 직접 연결(`db.{ref}.supabase.co`)은 **IPv6 전용**이라
  IPv4 환경에서 안 붙습니다 (2026-08-20 실측)
- **Supabase 가 키 이름을 바꿨습니다** — `anon` → Publishable, `service_role` → Secret.
  값은 새 이름(`sb_secret_…`)이고 변수 이름은 정본(`SUPABASE_SERVICE_ROLE_KEY`)을 씁니다

## 8. 배포

- **배포 대상: Vercel.** 대회 배포 URL 요건이 있습니다 → [용어와 전제](spec/common/08-14-glossary.md) §9
- **올리는 것은 GitHub Actions 입니다.** `main` 에 `src/**` 가 푸시되면 `deploy.yml` 이 typecheck·test 를
  돌고 `vercel deploy --prod` 로 올립니다. PR 미리보기는 만들지 않습니다 →
  [ADR-053](decisions/053-deploy-on-merge.md) · [`deploy/README.md`](deploy/README.md)
- **데이터는 Supabase(서울)입니다.** ADR-010이 "저장소가 전부 Vercel 제품이라 별도 설정이 없다"를
  이유로 들었지만, 그 대가가 **리전**이었습니다 — 계정·네트워크 설정이 하나 늘어나는 것을 감수합니다 →
  [ADR-016](decisions/016-retention-and-datastore.md)
- 환경 분리(로컬·데모): **미정** → §10
- 심사 데모용 시드 데이터: **미정** → §10.
  한국어 공개 데이터가 0건이라 **합성이 불가피합니다** → [용어와 전제](spec/common/08-14-glossary.md)

## 9. 관측

- **감사 로그** — `audit_log` 테이블. 모든 LLM 호출을 토큰화 텍스트 기준으로 기록하고,
  `prev_hash ‖ … ‖ created_at`의 SHA-256 사슬로 사후 조작을 검출합니다 →
  [데이터 모델](spec/backend/08-16-data-model.md) §10
- **감사 로그는 사건이 파기돼도 남습니다.** PII가 없으므로 남길 수 있습니다
- **수집기 생존 확인** — `source_registry.last_success_at`이 주기의 두 배를 넘으면 경고.
  조용히 멈춘 수집기가 가장 위험합니다
- 애플리케이션 로그: **미정** → §10

## 10. 아직 안 정해진 것

### 구조에 걸리는 것

| 무엇 | 왜 걸려 있나 | 어디에 |
| --- | --- | --- |
| **볼트 제품** | 분리 원칙(다른 인스턴스)과 리전을 함께 만족해야 합니다. Vercel KV 유지 여부 | [ADR-016](decisions/016-retention-and-datastore.md) |
| **Vercel Cron 실행 제약** | 플랜별 실행 빈도·타임아웃을 확인하지 않았습니다. 하루 1회가 되는지 | [ADR-025](decisions/025-scheduled-jobs.md) |
| **메일 발송 수단** | 리마인더를 무엇으로 보내나. 주기·문구도 미정 | [ADR-021](decisions/021-reentry-and-identity.md) |
| **`org.contact` 키 구조** | `call_center`·`app_path` 같은 이름. **연락처 값과 함께** 정해야 합니다 | [ADR-024](decisions/024-step-action-and-url.md) |
| **문진 선택지의 정본** | 질문 문구와 선택지를 어디서 가져오나 | [핸드오프 ⑤](docs/plans/08-16-backend-handoff.md) |

**재진입은 복호화 키와 직결됩니다.** 브라우저를 바꾸면 키가 없어 서류를 못 만듭니다 →
[ADR-009](decisions/009-restore-mapping-location.md). **2026-08-18 [ADR-027](decisions/027-session-key-storage.md)로 감수하기로 확정**했습니다 —
세션키는 꺼낼 수 없는 형태라 옮길 수 없습니다. **화면이 이 사실을 미리 알려야 합니다.**

### 채우면 되는 것

- ~~NER 모델·서비스 선택~~ → **모델은 gemma3:4b, 서비스는 RunPod Pod** (2026-08-26 확정).
  실측이 깨끗한 텍스트에서 누출 0%·과차단 0% 를 냈고([research/09](docs/research/09-로컬모델-PII인식-실측.md) R-1),
  두는 곳은 [ADR-043](decisions/043-gpu-hosting.md)의 개발·데모 조건 그대로입니다 —
  **합성 데이터만 올리고 끝나면 terminate.** CPU 로는 발화당 15~39초라 안 됩니다([09 §6.2](docs/research/09-로컬모델-PII인식-실측.md)).
  **양쪽 다 섰습니다** — 앱은 `NER_URL` 이 있으면 붙고 없으면 `null`(`src/lib/ner.ts`),
  서비스는 `POST /ner` 한 길(`services/transcriber/`). 2026-08-27 에 `echo` 대역으로
  **걸어서 확인**했습니다 — 「김민수」가 `[이름-1]` 로 바뀌고, 서비스를 끄면
  슬롯 답변이 `503 PII_TOKENIZER_UNAVAILABLE` 이 됩니다(설계대로).
  ~~⬜ 남은 것은 실제 모델입니다~~ → **2026-08-27 RTX 4090 에서 돌렸습니다.**
  15문항 합성 표본에서 **누출 0 · 요청당 0.18~0.40초**, 프롬프트 주입 셋을 다
  버텼습니다([09 §7](docs/research/09-로컬모델-PII인식-실측.md)).
  ⛔ **`FINALLY_WARMUP=1` 없이 열면 첫 요청이 실패합니다** — 첫 적재가 60초를 넘겨
  그대로 타임아웃했습니다. 뜰 때 미리 올리도록 고쳤습니다(`engines/warm_all`).
  ⛔ **배포본에 붙이면 안 됩니다 — 아직은.** 토큰화 제외 목록이 전사·챗·증거
  세 경로에 안 물려 있어, 켜면 **문장 안의 기관명이 `[이름-N]`** 이 됩니다(17곳 ×
  문장 다섯에서 **5~70%**)
  ([09 §7.2](docs/research/09-로컬모델-PII인식-실측.md)). 배선이 붙은 뒤에,
  그리고 **GPU 가 살아 있는 동안에만** 채우는 값입니다 → [운영 절차](deploy/runpod-bench.md)
- **GPU 를 어디에 두나** → 개발은 해외 대여, 운영은 국내 ([ADR-043](decisions/043-gpu-hosting.md)). **운영 벤더는 국내 단가 확인 후** ([research/13](docs/research/13-GPU-클라우드-단가.md) G-02)
- Grok 모델명과 단가
- 환경 분리 · 시드 데이터 · 애플리케이션 로그
  (마이그레이션 방식은 2026-08-18 확정 → §3, `.env.example` 과 스키마 적용은 2026-08-20 완료 → §7)

여기서 새로 생긴 미결은 각 절에 남기고, 결정되면 그 자리를 채우면서 근거를 `decisions/`에 ADR로 남깁니다.
