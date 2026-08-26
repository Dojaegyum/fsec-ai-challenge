# ADR-053. 배포는 `main` 머지에서 GitHub Actions 가 한다 — Vercel Git 연동은 쓰지 않는다

- 상태: **채택**
- 날짜: 2026-08-25
- 결정: @Dojaegyum
- 관련 문서: [`deploy/README.md`](../deploy/README.md) (올리는 순서) ·
  [`ARCHITECTURE.md`](../ARCHITECTURE.md) §8 (배포) ·
  [RFC-001](../rfc/001-repo-structure.md) 「CI가 강제합니다」 ·
  [ADR-016](016-retention-and-datastore.md) (Supabase · 서울) ·
  [ADR-045](045-kb-release-pin.md) (`KB_VERSION` — 배포와 릴리스가 따로 논다)

## 맥락

**대회 제출물 다섯 중 하나가 「배포된 웹서비스 주소」입니다.** 2026-08-25 에 `src/` 에서
`npx vercel deploy --prod` 를 손으로 한 번 돌려 `fin-ally-khaki.vercel.app` 이 떴습니다.

그 뒤로 `main` 은 계속 앞서가는데 주소는 그 자리에 서 있습니다. 워크플로 일곱이 다
**검사**만 하고, 어느 것도 올리지 않습니다. 누군가 기억해서 다시 돌리기 전까지는
심사위원이 여는 화면이 며칠 전 것입니다.

이 저장소는 **브랜치 보호가 없습니다** — 비공개 저장소의 Free 플랜에서는 켤 수
없습니다(API 가 403 을 돌려줍니다). 검사가 빨간 PR 도 머지될 수 있다는 뜻입니다.

## 결정

### A. `main` 에 푸시되면 GitHub Actions 가 올린다

`.github/workflows/deploy.yml` — `src/**` 가 바뀐 `main` 푸시마다 돕니다.

1. `npm run typecheck` · `npm test` — `code-check` 와 **같은 명령**을 다시 돕니다.
   브랜치 보호가 없으니 게이트는 배포 잡 안에 있어야 합니다.
2. `npx vercel deploy --prod` — 손으로 돌리던 것과 같은 명령. 소스를 올리고
   **빌드는 Vercel 이** 합니다. 빌드가 실패하면 이전 배포가 그대로 남습니다.

`workflow_dispatch` 도 엽니다 — 환경변수(`KB_VERSION` 등)만 바꾸고 같은 커밋을 다시
올려야 할 때 Actions 탭에서 손으로 돌립니다.

### B. PR 미리보기(Preview)는 만들지 않는다

올라가는 것은 `main` 뿐입니다. `SUPABASE_SERVICE_ROLE_KEY` 가 행 단위 접근 제어를
통과하므로, 미리보기 주소마다 같은 키가 들어가면 **PR 하나가 운영 데이터를 여는
문**이 됩니다 ([`deploy/README.md`](../deploy/README.md) §1).

### C. 시크릿 셋 — `VERCEL_TOKEN` 은 사람이 넣는다

| 이름 | 어디서 |
| --- | --- |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens. **사람이 만들어 넣습니다** — 계정 권한이라 저장소에 둘 수 없습니다 |
| `VERCEL_ORG_ID` · `VERCEL_PROJECT_ID` | `src/.vercel/project.json`. 이 둘이 있으면 CLI 가 `vercel link` 없이 그 프로젝트로 갑니다 |

### D. 손으로 올리는 길은 남긴다

`deploy/README.md` 의 CLI 명령은 그대로 둡니다. Actions 가 막혔을 때의 우회로이고,
워크플로가 하는 일이 정확히 그 명령이라는 것을 사람이 눈으로 맞춰 볼 수 있어야 합니다.

## 근거

**검사를 통과한 것만 올라갑니다.** Vercel 이 직접 빌드하는 길은 `next build` 만 보고
`vitest` 를 안 봅니다 — 렌더의 금지 규칙(`{렌더}.test.tsx`)이 깨진 채 올라갈 수 있습니다.

**사람이 돌리는 명령과 CI 가 같아야 게이트가 문지기가 아니라 안전망이 됩니다** —
다른 워크플로 일곱과 같은 원칙입니다 ([RFC-001](../rfc/001-repo-structure.md)).

**배포와 릴리스는 따로 놉니다** — 코드가 올라가도 `KB_VERSION` 을 바꾸기 전엔 앱이
옛 매뉴얼을 인용합니다 ([ADR-045](045-kb-release-pin.md)). 이 결정은 그 경계를 건드리지 않습니다.

### 검토한 대안

| 대안 | 왜 아닌가 |
| --- | --- |
| **Vercel Git 연동** — 대시보드에서 저장소를 붙이면 워크플로 파일 없이 `main` 푸시 → Production, PR → Preview | PR 마다 Preview 가 생깁니다 (→ B). 우리 게이트를 안 지납니다 — `next build` 만 봅니다. 그리고 Root Directory 를 `src` 로 잡는 설정이 대시보드에만 남아 저장소에서 안 보입니다 |
| **`code-check` 가 초록이면 뒤이어 도는 `workflow_run`** | `code-check` 는 경로 필터가 있어 안 도는 푸시가 있고, PR 브랜치의 실행에도 반응해서 걸러야 합니다. 사슬이 하나 더 있으면 끊긴 자리를 찾기 어렵습니다. 같은 명령을 잡 안에서 다시 도는 쪽이 몇 분 비싸고 훨씬 단순합니다 |
| **Actions 에서 빌드하고 `--prebuilt` 로 올린다** | 빌드 시점 환경변수를 `vercel pull` 로 받아 와야 하고, 손으로 올리던 길과 달라집니다. 지금 이득이 없습니다 — Vercel 빌드가 느려지면 그때 |

## 결과

**쉬워지는 것** — 머지가 곧 배포입니다. 심사위원이 여는 주소가 `main` 과 같습니다.
누가 언제 무엇을 올렸는지 Actions 이력에 남습니다.

**어려워지는 것** — `main` 에 올리는 것이 곧 공개입니다. 시연 직전에는 머지를 멈추거나,
브랜치에서 확인하고 머지해야 합니다. `VERCEL_TOKEN` 은 만료·회수되면 배포가 조용히
멈춥니다 — 워크플로가 첫 단계에서 없는 시크릿을 이름으로 알려 주지만, **토큰이 있는데
죽은 경우**는 Vercel 의 401 로만 보입니다.

**재검토 트리거** — PR 미리보기가 필요해지면 B 를 다시 봅니다. 그때는 Preview 환경에
`service_role` 을 넣지 않는 것부터입니다 (`ARCHITECTURE.md` §10 「환경 분리」).
