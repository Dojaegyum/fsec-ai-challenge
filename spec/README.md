# spec — 구현 계약

`assets/artifacts/plans/08-13-service-plan.html`(v1.2)에서 추출한 **구현이 따라야 할 계약**입니다.
코드를 쓰기 전에 여기를 읽고, 구현이 spec과 어긋나면 코드가 아니라 spec이 먼저 고쳐집니다.

> ⚠️ **개정 대기 중.** 이 폴더는 구 명칭(골든30) 시점에 기획서 v1.2에서 추출한 것이라
> **30분 긴급 대응에 무게가 실려 있습니다.** 주제와 이름은 확정됐고([ADR-001](../decisions/001-topic-selection.md)·
> [ADR-002](../decisions/002-project-name.md)), 포지셔닝이 **긴급 진입 → 사건 관리**로 옮겨졌습니다.
> 아래 「개정해야 할 것」을 반영하기 전까지, 여기 적힌 절차 사실을 그대로 믿지 마세요.

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
| [08-16-module-boundaries.md](common/08-16-module-boundaries.md) | 모듈의 책임·입출력·금지. 모듈 역할 정의의 입력 |
| [08-16-deadline-rules.md](common/08-16-deadline-rules.md) | 기한을 어떻게 세는가 — 기산점·영업일·표시 규칙 |
| [08-16-module-names.md](common/08-16-module-names.md) | 모듈 명칭 — 동작 단위의 이름과 네 층 구분 |
| [08-14-api.md](common/08-14-api.md) | API 계약 — 엔드포인트 10개 + 관리자 2개, 요청·응답, 계측 헤더 |

### `backend/` — 서버

| 파일 | 내용 |
| --- | --- |
| [08-14-slot-tiering.md](backend/08-14-slot-tiering.md) | 슬롯 티어링 T0/T1/T2 — 정보가 없어도 멈추지 않는 규칙 |
| [08-14-channel-matrix.md](backend/08-14-channel-matrix.md) | 경유 서비스 8유형별 절차 분기 매트릭스 |
| [08-14-completion-hook.md](backend/08-14-completion-hook.md) | 완수 검증 — 부산물 기반 완료 판정 상태 머신 |
| [08-14-kb-operations.md](backend/08-14-kb-operations.md) | 매뉴얼 KB 스키마와 운영 파이프라인 |
| [08-16-data-model.md](backend/08-16-data-model.md) | 데이터 모델 — 테이블 DDL, 관계, 상태 전이, KB 조회 우선순위 |
| [08-16-errors.md](backend/08-16-errors.md) | 에러 계약 — 예외 계층, HTTP 코드, 재시도, 에러가 아닌 실패 |
| [08-16-chat-context.md](backend/08-16-chat-context.md) | 챗 컨텍스트 조립 — 프롬프트에 무엇을 어떤 순서로 넣는가 |

### `frontend/` — 화면

| 파일 | 내용 |
| --- | --- |
| [08-14-screens.md](frontend/08-14-screens.md) | 화면 S-01 ~ S-03, 3-패널 레이아웃 |
| [design-system/](frontend/design-system/) | 디자인 계약 — 토큰 의미론·컴포넌트 규칙·접근성 기준. **뼈대만** |

## 개정해야 할 것 (최종 후보 보드 기준)

| 무엇 | 어디 | 상태 |
| --- | --- | --- |
| **"서면 신청"은 틀린 표현** — 2026년 7월부터 은행 앱 비대면 신청, 계좌번호·거래내역 자동 입력 | [channel-matrix](backend/08-14-channel-matrix.md) [completion-hook](backend/08-14-completion-hook.md) [screens](frontend/08-14-screens.md) | channel-matrix만 반영됨 |
| **통장묶기 트랙 신설** — 피해자가 아니라 억울하게 묶인 사람. 5월부터 소명자료 제출 시 5영업일 내 결과 | [channel-matrix](backend/08-14-channel-matrix.md) | 반영됨 |
| **기한 계산에 LLM 금지** — 규칙으로 | [channel-matrix](backend/08-14-channel-matrix.md) | 반영됨 |
| **자율배상은 "대상인지 진단"** — 1년 4개월간 41건·피해액의 0.1%·평균 116일 | [channel-matrix](backend/08-14-channel-matrix.md) | 반영됨 |
| 포지셔닝 전환 — 112 이후를 맡는 사건 관리, 상담 종료 후 링크 유입 | [screens](frontend/08-14-screens.md) 전반 | **미반영** |
| 데이터: 한국어 공개 데이터 0건 → 합성 불가피 | [glossary](common/08-14-glossary.md) | **미반영** |
| ~~보존 기간 충돌~~ | [pii-boundary](common/08-14-pii-boundary.md) [data-model](backend/08-16-data-model.md) | **해소됨** — [ADR-010](../decisions/010-case-store.md) 으로 통일, [ADR-016](../decisions/016-retention-and-datastore.md) 으로 **마지막 활동일부터 180일** 확정 (경로 10종 실측) |
| ~~저장소 제품~~ — `Vercel Postgres` 는 폐지된 제품 (2024-12 → Neon, 서울 리전 없음) | [ADR-016](../decisions/016-retention-and-datastore.md) | **해소됨** — Supabase(서울)로 결정하고 `ARCHITECTURE.md`·`data-model`·`api` 반영 완료. **볼트 제품만 미결** |

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
| §0 전제, §1 파이프라인 | glossary, features |
| §2 슬롯 티어링 | slot-tiering |
| §3 PII 격리 | pii-boundary |
| §4 매뉴얼 매트릭스·KB 운영 | channel-matrix, kb-operations |
| §5 완수 검증 | completion-hook |
| §6 화면 설계 | screens |
| §7 기능명세 | features |
| §8 데모 시나리오 | (추출 안 함 — 발표용이라 기획서에서 직접) |
| §9 기술 스택 | glossary |
