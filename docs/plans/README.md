# plans — 구현 계획

**무엇을 어떤 순서로 만들지**를 적는 곳입니다. Markdown만 둡니다.

| 문서 | 내용 |
| --- | --- |
| [08-16-backend-handoff.md](08-16-backend-handoff.md) | DDL·모듈 정의 전에 답이 필요한 선행 결정 넷. **일시 문서** — 답이 반영되면 지웁니다 |
| [08-18-backend-baseline.md](08-18-backend-baseline.md) | 백엔드 착수 기준선 — 무엇이 서 있고 무엇이 막혀 있나. 순서와 의존. **일시 문서** |
| [08-20-api-routes.md](08-20-api-routes.md) | API 라우트 설계도와 남은 것. 만드는 순서 14단계, 안 풀린 blocker 셋, 정본에 없어 채워야 할 것 열. **일시 문서** |
| [08-22-layer-c-viewers.md](08-22-layer-c-viewers.md) | 층 C **보여주는 넷** — `plan-viewer`·`deadline-viewer`·`transcript-viewer`·`doc-filler`. 태스크 12개. **서버 없이 완성됩니다** |
| [08-22-layer-c-transport.md](08-22-layer-c-transport.md) | 층 C **서버와 이야기하는 넷** — `case-opener`·`poll-checker`·`file-sender`·`chat-handler`. 태스크 10개. 라우트가 없어도 규칙을 시험까지 세웁니다 |

## 여기가 아닌 것

| 찾는 것 | 있는 곳 |
| --- | --- |
| 서비스 기획서(HTML) | [`assets/artifacts/plans/08-13-service-plan.html`](../../assets/artifacts/plans/08-13-service-plan.html) |
| 제품이 만족해야 할 계약 | [`spec/`](../../spec/) |
| 왜 그렇게 정했나 | [`decisions/`](../../decisions/) |
| 대회 일정·진행 상황 | [`../context/AGENDA.md`](../context/AGENDA.md) |

**계획은 `spec/`과 다릅니다.** spec은 *"완성되면 이래야 한다"*(계약)이고,
plans는 *"그걸 어떤 순서로 만든다"*(일정과 단계)입니다.

## 파일명

`MM-dd-{slug}.md` — `MM-dd`는 최초 작성일이며 개정해도 바꾸지 않습니다 (→ [RFC-001](../../rfc/001-repo-structure.md)).
