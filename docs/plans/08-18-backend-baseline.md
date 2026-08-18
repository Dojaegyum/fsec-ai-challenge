# 백엔드 착수 기준선 — 무엇이 서 있고, 무엇이 막혀 있나

> **이 문서의 자리** — @kth9245 가 백엔드 모듈 초기 설계를 푸시하기 **전에**,
> 이쪽에서 확정해 둔 것과 착수 순서를 적어 둡니다. 설계가 오면 **이 문서 위에 고칩니다.**
>
> **계약을 여기서 새로 만들지 않습니다.** 정본은 `spec/`이고, 여기는 **순서와 의존**만 답합니다 —
> 무엇부터 만들 수 있고, 무엇이 무엇에 막혀 있는가.

**역할** — @kth9245 메인 백엔드 · @Dojaegyum 메인 프론트 + 서브 백엔드(계약 결정 권한).
미결 목록은 [ARCHITECTURE.md §10](../../ARCHITECTURE.md)이 정본입니다. 여기서 되풀이하지 않습니다.

## 1. 이미 서 있는 것 — 읽고 시작하면 됩니다

**빈칸을 채우는 작업이 아닙니다.** 아래는 확정된 계약이고, 어기면 제품이 틀립니다.

| 무엇 | 어디 |
| --- | --- |
| 테이블 14개 DDL · 슬롯 이름 · 부산물 | [09-data-model.md](../../spec/backend/08-16-data-model.md) |
| 엔드포인트 10 + 관리자 2 | [08-api.md](../../spec/common/08-14-api.md) |
| 모듈 이름·층·금지 사항 | [12-module-names.md](../../spec/common/08-16-module-names.md) · [13-module-boundaries.md](../../spec/common/08-16-module-boundaries.md) |
| PII 격리 경계 — 무엇이 어디를 넘나 | [04-pii-boundary.md](../../spec/common/08-14-pii-boundary.md) |
| 챗 한 턴의 절차 (7블록 · 모델 1회) | [11-chat-context.md](../../spec/backend/08-16-chat-context.md) |
| 기한 계산 규칙 — 영업일·초일 불산입 | [10-deadline-rules.md](../../spec/common/08-16-deadline-rules.md) |
| 완료 판정 L1·L2·L3 | [05-completion-hook.md](../../spec/backend/08-14-completion-hook.md) |
| 슬롯 티어 T0·T1·T2 | [02-slot-tiering.md](../../spec/backend/08-14-slot-tiering.md) |
| KB 조회 우선순위·시행일 분기 | [09](../../spec/backend/08-16-data-model.md) §11.2 §11.3 |
| KB 원본을 어디에 어떻게 쓰나 | [RFC-002](../../rfc/002-kb-authoring.md) |
| 에러 계약 | [14-errors.md](../../spec/backend/08-16-errors.md) |

**최근 확정돼 아직 못 보셨을 것들**

| 정한 것 | 백엔드에 무엇이 달라지나 |
| --- | --- |
| [ADR-021](../../decisions/021-reentry-and-identity.md) 익명 링크 토큰 | **`User` 테이블을 만들지 않습니다.** 이메일은 알림용 선택 항목입니다 |
| [ADR-024](../../decisions/024-step-action-and-url.md) `steps[].action` 일곱 + `url` | `plan_step.body`에 필드 둘이 늘었습니다. 화면 패널이 이 값으로 갈립니다 |
| [ADR-025](../../decisions/025-scheduled-jobs.md) Vercel Cron | **`pg_cron`을 쓰지 않습니다.** 층 4는 앱 라우트가 깨워집니다 |
| [ADR-026](../../decisions/026-raw-upload-retention.md) 원본 업로드 경계 | 서버에 닿는 파일은 **주민등록번호가 이미 가려진 사본**입니다. 스키마는 그대로 |
| [RFC-002](../../rfc/002-kb-authoring.md) KB 원본은 파일 | **`kb_entry`·`org`에 직접 INSERT 하지 않습니다.** `src/kb/`에서 적재합니다 |

## 2. 막혀 있는 것 — 무엇이 풀어야 하나

**막힌 것과 안 막힌 것을 가르는 게 이 문서의 요점입니다.** 아래 다섯만 대기 중이고, 나머지는 지금 갑니다.

| 막힌 것 | 무엇에 막혔나 | 누가 푸나 |
| --- | --- | --- |
| `src/kb/org.json` | 기관 연락처 **실값**. 자동 판독이 두 번 서로 다르게 읽어 한 줄도 쓰지 않았습니다 | **사람이 전사** — [research/04](../research/04-기관정보.md) |
| `org.contact` 키 구조 | 위와 같이 정해야 합니다. 값을 모른 채 키만 정하면 다시 바꿉니다 | 위와 같음 |
| 문진 선택지의 정본 | [핸드오프 ⑤](08-16-backend-handoff.md)가 아직 답이 없습니다 | @Dojaegyum |
| 층 4 실행 | Vercel Cron 플랜별 빈도·타임아웃 미확인 | @kth9245 |
| `pii-tokenizer` 2차 스크러빙 | NER 모델·서비스 미선택. **경계 그 자체라 우선순위가 높습니다** | @kth9245 |

**연락처가 막혀도 KB는 절반 이상 진행됩니다.**
[§11.4.3](../../spec/backend/08-16-data-model.md#1143-연락처가-없을-때)이 「연락처가 없으면 절차만 안내한다」고
이미 정해 뒀습니다. `common.json`과 `ch-*.json`은 연락처 없이 쓸 수 있고, `org.json`만 대기합니다.

## 3. 착수 순서 — 막힌 것을 비켜 갑니다

```
①  DDL 적용 + src/migrations/ 체계          막는 것 없음 · 다른 전부의 선행
      ↓
②  date-checker                             막는 것 없음 · KB·LLM 무관
      ↓
③  층 1  case-intake → pii-tokenizer        NER 은 2차. 1차 정규식으로 먼저 선다
      ↓  → case-reader · slot-extractor
      ↓
④  층 3  slot-checker → planner             KB 필요 — common.json 부터
      ↓
⑤  층 2  챗 한 턴 (모델 1회 + citation)     ④ 가 서야 인용할 것이 생긴다
      ↓
⑥  층 4  reminder-sender · case-purger      Vercel Cron 확인 후
```

**① 을 먼저 하는 이유** — [ADR-019](../../decisions/019-module-code-sync.md)가 DDL 변경에
`src/migrations/` 동반을 CI로 강제합니다. 체계가 없는 상태로 스키마를 손대면 그때부터 게이트에 걸립니다.

**② date-checker 를 두 번째에 두는 이유** — 셋입니다.
**KB에도 LLM에도 의존하지 않고**, 규칙이 [어제 확정](../../spec/common/08-16-deadline-rules.md)됐으며,
**테스트가 결정적**이라 백엔드에서 가장 먼저 완결되는 조각입니다. 법정 기한을 규칙으로 처리한 것은
발표에서 밝힐 지점이기도 합니다 (`CLAUDE.md` 불변 규칙 7).

**③ 에서 NER을 기다리지 않습니다.** [04-pii-boundary.md](../../spec/common/08-14-pii-boundary.md)의
1차 정규식만으로 경계가 섭니다. NER은 2차 방어라 나중에 끼워 넣어도 구조가 안 바뀝니다 —
**다만 그 전에는 외부 모델에 실데이터를 보내지 않습니다.**

**⑤ 를 늦추는 이유** — 챗은 인용할 KB가 있어야 의미가 있습니다.
KB가 비면 [citation-checker](../../spec/backend/08-16-chat-context.md)가 전부 되묻기로 보냅니다.

## 4. 부딪히지 않게 나누기

| | @kth9245 | @Dojaegyum |
| --- | --- | --- |
| 코드 | `src/modules/` 층 1~4 · 라우트 · 배포 | `src/modules/` **층 C** · `src/app/` 화면 · `src/components/` |
| 데이터 | DDL 적용 · `src/migrations/` | **`src/kb/`** 매뉴얼 원본 |
| 문서 | [ARCHITECTURE.md](../../ARCHITECTURE.md) §2·§3·§8·§10 | `spec/` · `rfc/` · `decisions/` |

**같은 파일을 동시에 안 여는 것이 목표입니다.** 겹치는 자리는 `spec/common/`과
`ARCHITECTURE.md` 둘인데, **구현 선택은 `ARCHITECTURE.md`, 계약은 `spec/`**이라
[ADR-007](../../decisions/007-architecture-doc.md)이 이미 갈라 뒀습니다.

**계약을 바꿔야 하면 코드보다 문서가 먼저입니다.** 스펙을 안 고치고 구현을 바꾸면
어느 쪽이 정본인지 알 수 없게 됩니다 (`CLAUDE.md` 작업 규칙).

## 5. 설계가 오면 확인할 것

**CI가 잡는 것은 넘어갑니다.** 아래는 게이트가 못 보는 자리입니다.

- [ ] `pii-tokenizer` 를 **거치지 않고** 외부 모델로 나가는 경로가 없는가 (불변 규칙 2)
- [ ] 복호화 키가 서버·로그·DB에 닿는 코드가 없는가 (불변 규칙 3)
- [ ] 기한 계산에 모델이 끼어들지 않았는가 — `date-checker` 밖에서 날짜를 세는 곳 (불변 규칙 7)
- [ ] `kb_entry`·`org` 에 **직접 INSERT** 하는 코드가 없는가 ([RFC-002](../../rfc/002-kb-authoring.md))
- [ ] 전사·OCR 결과를 프롬프트에 넣을 때 **격리 태그**가 유지되는가 (불변 규칙 4)
- [ ] 정보가 없다고 **플랜 생성이 멈추는** 흐름이 없는가 (불변 규칙 5)
- [ ] `User` 테이블·로그인이 슬쩍 들어오지 않았는가 ([ADR-021](../../decisions/021-reentry-and-identity.md))
- [ ] [ARCHITECTURE.md §10](../../ARCHITECTURE.md)에서 채워진 항목이 `spec/`에도 반영됐는가

## 6. 이 문서는 언제 지우나

**@kth9245 의 초기 설계가 들어오고, 위 §2의 다섯이 다 풀리면 지웁니다.**
순서·의존은 그때 의미가 없어지고, 남는 것은 `spec/`과 `ARCHITECTURE.md`입니다.

[핸드오프 문서](08-16-backend-handoff.md)는 ⑤ 하나만 남아 있어 아직 못 지웁니다.
