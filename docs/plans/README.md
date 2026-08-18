# plans — 구현 계획

**무엇을 어떤 순서로 만들지**를 적는 곳입니다. Markdown만 둡니다.

| 문서 | 내용 |
| --- | --- |
| [08-16-backend-handoff.md](08-16-backend-handoff.md) | DDL·모듈 정의 전에 답이 필요한 선행 결정 넷. **일시 문서** — 답이 반영되면 지웁니다 |
| [08-17-module-build-order.md](08-17-module-build-order.md) | 모듈 21개 중 무엇이 막혀 있고 무엇부터 만드나. 병목 셋과 사람이 정해야 할 것. **일시 문서** |
| [08-18-backend-baseline.md](08-18-backend-baseline.md) | 백엔드 착수 기준선 — 무엇이 서 있고 무엇이 막혀 있나. 순서와 의존. **일시 문서** |

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
