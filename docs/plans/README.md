# plans — 구현 계획

**무엇을 어떤 순서로 만들지**를 적는 곳입니다. Markdown만 둡니다.

| 문서 | 내용 |
| --- | --- |
| [08-23-qa-readiness.md](08-23-qa-readiness.md) | **QA 까지 남은 일** — 태스크 8개와 순서. 막혀서 범위 밖인 것 셋. **세션이 바뀌면 여기부터.** |
| [08-18-backend-baseline.md](08-18-backend-baseline.md) | 백엔드 착수 기준선 — 무엇이 서 있고 무엇이 막혀 있나. §2 다섯 중 둘(층 4 Cron · NER)이 아직 남아 살아 있습니다 |
| [08-26-doc-gardening.md](08-26-doc-gardening.md) | **문서 손질 백로그** — 코드보다 뒤처진 spec 의 갱신 순서, 은퇴 문서에서 꺼낸 미결, 문서로는 안 닫히는 코드 문제. 손질 절차는 `.claude/skills/doc-gardening/` |

## 은퇴 — 역할이 끝난 계획

**계획은 끝나도 지우지 않습니다.** `CLAUDE.md`·spec·코드 주석이 이 주소들을 가리키고 있어 지우면 링크가 깨집니다.
대신 머리에 **은퇴** 배너를 달고 여기로 내립니다 — 왜 끝났고 남은 일이 어디로 갔는지는 배너가 말합니다.
더 갱신하지 않습니다 (→ [RFC-001 「은퇴」](../../rfc/001-repo-structure.md)).

| 문서 | 왜 끝났나 |
| --- | --- |
| [08-16-backend-handoff.md](08-16-backend-handoff.md) | 선행 결정 넷이 전부 ADR 로 내려감 (②는 [ADR-021](../../decisions/021-reentry-and-identity.md)) |
| [08-20-api-routes.md](08-20-api-routes.md) | 라우트 12개·핸들러 13개 완성. 남은 미결은 [doc-gardening](08-26-doc-gardening.md) 으로 |
| [08-22-layer-c-viewers.md](08-22-layer-c-viewers.md) | 태스크 9개 전부 끝남(2026-08-23) |
| [08-22-layer-c-transport.md](08-22-layer-c-transport.md) | 태스크 10개 전부 끝남(2026-08-23) |
| [08-24-oracle-account-handoff.md](08-24-oracle-account-handoff.md) | 목적(무료 ARM 자리 확보) 달성. 재구축은 `deploy/oci-provision.py` |

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
