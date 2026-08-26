# spec — 구현 계약

`assets/artifacts/plans/08-13-service-plan.html`(v1.2)에서 추출한 **구현이 따라야 할 계약**입니다.
코드를 쓰기 전에 여기를 읽고, 구현이 spec과 어긋나면 코드가 아니라 spec이 먼저 고쳐집니다.

> 이 폴더는 구 명칭(골든30) 시점에 기획서 v1.2에서 추출한 것입니다. 포지셔닝 전환(긴급 진입 → 사건 관리)은
> 아래 「개정해야 할 것」 표대로 **대부분 반영됐습니다**(2026-08-26 기준 미반영은 합성 데이터 한 줄).
> 다만 코드가 문서보다 앞서간 자리가 남아 있습니다 — 어느 문서가 어디서 뒤처졌는지는
> [doc-gardening 계획](../docs/plans/08-26-doc-gardening.md)이 추적합니다. 절차 사실은 **출처와 시행일이 붙은 것만** 믿으세요.

## 폴더 — 누가 지키는 계약인가

| 폴더 | 무엇 | 누가 읽나 |
| --- | --- | --- |
| [`common/`](common/) | 양쪽이 함께 지키는 것 — 용어, 기능명세, PII 경계, API 계약 | 백엔드·프론트 모두 |
| [`backend/`](backend/) | 서버에서 도는 판단·데이터 계약 | 백엔드 |
| [`frontend/`](frontend/) | 화면·상호작용 계약 | 프론트 |

한쪽만 지켜서 되는 게 아니면 `common/`입니다. 특히 **PII 경계는 클라이언트에서 토큰화하고
서버가 그 상태를 유지하는 것이라 양쪽이 같이 지켜야** 하므로 `common/`에 둡니다.

## 파일명 규약 — `MM-dd-{title}.md`

규약은 [RFC-001](../rfc/001-repo-structure.md), 그렇게 정한 근거는 [ADR-003](../decisions/003-spec-layout.md).

```
spec/backend/08-14-channel-matrix.md
             └┬─┘ └──────┬──────┘
              │          └─ 영문 kebab-case 제목
              └─ 최초 작성한 월-일
```

- **`MM-dd`는 최초 작성일입니다. 문서를 개정해도 바꾸지 않습니다** — 바꾸면 이 문서를 가리키는
  모든 링크와 `CLAUDE.md`의 ID 표가 한꺼번에 깨집니다. 날짜는 순서가 아니라 **출생기록**입니다.
- 제목은 영문 kebab-case. 문서 안 H1은 한국어로 씁니다.
- 같은 날 같은 제목이 겹치면 제목을 더 구체적으로 바꿉니다(`08-14-api.md` → `08-14-api-case.md`).

## 목차

### `common/` — 양쪽 공통

| 파일 | 내용 |
| --- | --- |
| [08-14-glossary.md](common/08-14-glossary.md) | 용어 — 사건·슬롯·부산물·토큰. 코드 식별자 대응표 포함 |
| [08-14-features.md](common/08-14-features.md) | 기능명세 F-01 ~ F-11, 우선순위 |
| [08-14-pii-boundary.md](common/08-14-pii-boundary.md) | PII 격리 경계·토큰 규격·인젝션 방어 |
| [08-16-domain-model.md](common/08-16-domain-model.md) | 엔티티·관계·상태 집합·저장 경계. **DB 스키마 설계의 입력** |
| [08-16-module-boundaries.md](common/08-16-module-boundaries.md) | 모듈 33개의 **받는 것 · 내놓는 것 · 절대 하지 않는 것**. 새 모듈의 금지는 코드보다 먼저 여기에 — `types.ts` 머리가 이 표의 줄을 옮겨 적습니다 |
| [08-16-deadline-rules.md](common/08-16-deadline-rules.md) | 기한을 어떻게 세는가 — 기산점·영업일·표시 규칙 |
| [08-16-module-names.md](common/08-16-module-names.md) | 모듈 명칭 — 동작 단위의 이름. 서버 네 층 + **브라우저 층 C** |
| [08-14-api.md](common/08-14-api.md) | API 계약 — 엔드포인트 13개(관리자 2개는 미구현), 요청·응답, 계측 헤더. 라우트 12개가 머리말에서 이 문서를 정본으로 인용합니다 |
| [08-17-service-concept.md](common/08-17-service-concept.md) | **서비스 골자** — 무엇이고 무엇이 아닌가, 누가 어디서 들어와 어떻게 돌아오는가. 기획서 §0을 대체 |
| [08-20-automation-boundary.md](common/08-20-automation-boundary.md) | **자동화의 경계** — 어디까지 대신해 주고 어디서 멈추는가. 넘으면 인허가가 필요한 것들 |
| [08-21-user-journeys.md](common/08-21-user-journeys.md) | **사용자 여정 — 경우별.** 갈림길 여덟과 여정 열둘. 골자의 세로축(시간)에 대한 **가로축(경우)**. `src/` 를 읽어 세웠습니다 |

### `backend/` — 서버

| 파일 | 내용 |
| --- | --- |
| [08-14-slot-tiering.md](backend/08-14-slot-tiering.md) | 슬롯 티어링 T0/T1/T2 — 정보가 없어도 멈추지 않는 규칙 |
| [08-14-channel-matrix.md](backend/08-14-channel-matrix.md) | 경유 서비스 8유형별 절차 분기 매트릭스 |
| [08-14-completion-hook.md](backend/08-14-completion-hook.md) | 완수 검증 — 부산물 기반 완료 판정 상태 머신 |
| [08-16-data-model.md](backend/08-16-data-model.md) | 데이터 모델 — 테이블 DDL, 관계, 상태 전이, KB 스키마(§11)·수집(§12) |
| [08-16-errors.md](backend/08-16-errors.md) | 에러 계약 — 예외 계층, HTTP 코드, 재시도, 에러가 아닌 실패 |
| [08-16-chat-context.md](backend/08-16-chat-context.md) | 챗 컨텍스트 조립 — 프롬프트에 무엇을 어떤 순서로 넣는가 |
| [08-17-system-prompt.md](backend/08-17-system-prompt.md) | 시스템 지시문 — 모델에게 실제로 보내는 문장 전문 |

### `frontend/` — 화면

| 파일 | 내용 |
| --- | --- |
| [08-14-screens.md](frontend/08-14-screens.md) | **화면 여덟** `S-04`~`S-11` + `S-03` 백신. `/c/{token}` 하나를 **본문 셋**(챗·플랜·증거함)이 나눠 씁니다 |
| [08-17-workspace-panels.md](frontend/08-17-workspace-panels.md) | **워크스페이스 패널 `WS-*` 7유형** — 단계를 실제로 수행하는 자리와, 어느 패널을 열지 정하는 시그널 |
| [design-system/](frontend/design-system/) | 디자인 계약 — 토큰 의미론·컴포넌트 규칙·접근성 기준. **확정** (2026-08-18) |

### 은퇴 — 역할이 끝난 문서

파일은 링크를 지키려 제자리에 두고, 머리의 **은퇴** 배너가 왜 끝났고 이제 어디를 봐야 하는지 가리킵니다.
더 갱신하지 않습니다 (→ [RFC-001 「은퇴」](../rfc/001-repo-structure.md)).

| 파일 | 왜 끝났나 | 이제 볼 곳 |
| --- | --- | --- |
| [08-14-kb-operations.md](backend/08-14-kb-operations.md) | 승인→릴리스 파이프라인 전제가 폐기됨 — 사람이 `src/kb/*.json` 을 쓰고 `kb:load` 로 적재 | 작성 [RFC-002](../rfc/002-kb-authoring.md) · 스키마·수집 [data-model §11·§12](backend/08-16-data-model.md) · 소스 주소 [research/18](../docs/research/18-KB-소스-주소-실측.md) |

## 개정해야 할 것 (최종 후보 보드 기준)

| 무엇 | 어디 | 상태 |
| --- | --- | --- |
| ~~**"서면 신청"은 틀린 표현**~~ — 은행 앱 비대면 신청 | [channel-matrix](backend/08-14-channel-matrix.md) [completion-hook](backend/08-14-completion-hook.md) [screens](frontend/08-14-screens.md) | ⛔ **뒤집혔습니다** (2026-08-21) — 1차 출처로 보니 KB·NH 는 **영업점 서면**이고 나머지는 확인 실패입니다. **기관마다 다른 것**이라 `org.contact.submit` 배열로 내렸습니다 → [ADR-042](../decisions/042-submit-paths.md) |
| **통장묶기 트랙 신설** — 피해자가 아니라 억울하게 묶인 사람. 5월부터 소명자료 제출 시 5영업일 내 결과 | [channel-matrix](backend/08-14-channel-matrix.md) | 반영됨 |
| **기한 계산에 LLM 금지** — 규칙으로 | [channel-matrix](backend/08-14-channel-matrix.md) | 반영됨 |
| **자율배상은 "대상인지 진단"** — 1년 4개월간 41건·피해액의 0.1%·평균 116일 | [channel-matrix](backend/08-14-channel-matrix.md) | 반영됨 |
| 포지셔닝 전환 — 112 이후를 맡는 사건 관리 | [service-concept](common/08-17-service-concept.md) | **반영됨** — 골자를 다시 세웠습니다. 진입은 상담 링크가 아니라 **검색·직접 접속**으로 확정 ([ADR-021](../decisions/021-reentry-and-identity.md)) |
| 화면이 그 전환을 못 따라감 — `S-01`이 업로드 화면인 근거가 사라짐 | [screens](frontend/08-14-screens.md) 전반 | **반영됨** (2026-08-18) — `S-01`·`S-02` 폐기, 랜딩·`/start`·`/c/{token}` 흐름으로 재작성 |
| 데이터: 한국어 공개 데이터 0건 → 합성 불가피 | [glossary](common/08-14-glossary.md) | **미반영** |
| ~~보존 기간 충돌~~ | [pii-boundary](common/08-14-pii-boundary.md) [data-model](backend/08-16-data-model.md) | **해소됨** — [ADR-010](../decisions/010-case-store.md) 으로 통일, [ADR-016](../decisions/016-retention-and-datastore.md) 으로 **마지막 활동일부터 180일** 확정 (경로 10종 실측) |
| ~~저장소 제품~~ — `Vercel Postgres` 는 폐지된 제품 (2024-12 → Neon, 서울 리전 없음) | [ADR-016](../decisions/016-retention-and-datastore.md) | **해소됨** — Supabase(서울)로 결정하고 `ARCHITECTURE.md`·`data-model`·`api` 반영 완료. 볼트도 같은 Postgres 로 확정 ([ADR-049](../decisions/049-vault-in-postgres.md)) |

## 이 폴더의 규칙

- **고치기 전에 [`decisions/`](../decisions/)를 먼저 읽으세요.** 이미 결정된 것을 모르고 고치면
  ADR과 spec이 어긋납니다. 결정에 어긋나는 변경은 새 ADR 없이 하지 않습니다.
- **파일을 새로 만들 때는 [`rfc/`](../rfc/)의 규약을 따릅니다** — 위치·파일명·목차 등록.
- **정본은 기획서(HTML)입니다.** spec은 거기서 추출한 것이라, 둘이 어긋나면 기획서가 이깁니다.
  어긋난 걸 발견하면 임의 판단하지 말고 사람에게 알리세요.
- `TODO(...)`는 **기획서에 아직 없는 것**입니다. 추측으로 채우지 마세요.
- ID(F-xx, S-xx, CH-xxx)는 기획서와 같은 번호를 씁니다. 재사용·재정렬 금지.
- 절차·법령 내용을 spec에 적을 때는 **출처와 시행일**을 함께 적습니다.

## 추출 현황

기획서 v1.2 기준. 섹션 대응:

| 기획서 | spec |
| --- | --- |
| §0 전제 | **service-concept** — 그대로 옮긴 것이 아니라 확정된 결정에 맞춰 **다시 세운 것**입니다 |
| §1 파이프라인 | glossary, features |
| §2 슬롯 티어링 | slot-tiering |
| §3 PII 격리 | pii-boundary |
| §4 매뉴얼 매트릭스·KB 운영 | channel-matrix, ~~kb-operations~~ (은퇴 → RFC-002 · data-model §11·§12) |
| §5 완수 검증 | completion-hook |
| §6 화면 설계 | screens |
| §7 기능명세 | features |
| §8 데모 시나리오 | (추출 안 함 — 발표용이라 기획서에서 직접) |
| §9 기술 스택 | glossary |
