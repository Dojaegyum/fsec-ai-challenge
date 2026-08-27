# 배포 — 앱을 올리는 순서

> **대회 제출물 다섯 중 하나가 「배포된 웹서비스 주소」입니다.**
> 여기 적힌 것을 따라가면 그 주소가 나옵니다.

| 무엇 | 어디에 | 왜 거기인가 |
| --- | --- | --- |
| **앱** (Next.js) | **Vercel** · 서울(`icn1`) | [ARCHITECTURE §8](../ARCHITECTURE.md#8-배포) |
| **DB · 저장소** | **Supabase** · 서울(`ap-northeast-2`) | [ADR-016](../decisions/016-retention-and-datastore.md) |
| **전사·판독** | **OCI** · [`oci-provision.py`](oci-provision.py) | 모델을 서버리스 함수에 못 띄웁니다 → [ADR-028](../decisions/028-runtime-and-module-shape.md) |
| **벤치마크용 GPU** | **RunPod** · [`runpod-bench.md`](runpod-bench.md) | 합성 데이터만 올립니다 → [ADR-043](../decisions/043-gpu-hosting.md). **띄운 직후 확인할 것 둘**이 거기 있습니다 |

셋이 **같은 리전(서울)** 이어야 합니다. 「데이터가 어디 있느냐」가 심사 질문이고,
서버리스 함수와 DB 가 대륙을 건너면 요청마다 왕복이 붙습니다.

---

## 0. 한 번만 — Vercel 프로젝트를 만들 때

**루트 디렉터리를 `src` 로 잡아야 합니다.** 저장소 루트가 아닙니다 —
Next.js 앱이 `src/` 안에 있고, 루트에는 문서와 `deploy/` 가 있습니다.

```
Vercel → Add New Project → 이 저장소 선택
  Framework Preset   Next.js          (자동으로 잡힙니다)
  Root Directory     src              ← **이것을 안 바꾸면 빌드가 앱을 못 찾습니다**
  Build Command      (기본값)
  Node.js Version    22.x 이상
```

리전은 [`src/vercel.json`](../src/vercel.json) 이 `icn1` 로 고정합니다 —
대시보드에서 따로 안 만져도 됩니다.

---

## 1. 환경변수 — 이게 없으면 라우트가 전부 500

[`src/.env.example`](../src/.env.example) 이 무엇이 왜 필요한지의 정본입니다.
Vercel 대시보드 → Settings → Environment Variables 에 같은 이름으로 넣습니다.

**반드시 있어야 하는 것**

| 이름 | 없으면 |
| --- | --- |
| `DATABASE_URL` | 사건을 못 만듭니다. **볼트도 여기입니다** ([ADR-049](../decisions/049-vault-in-postgres.md)) |
| `SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` | 파일을 못 올립니다 |
| `XAI_API_KEY` 또는 `LLM_API_KEY` | **챗 한 턴이 통째로 500** 입니다 |
| `KB_VERSION` | 안내를 아예 안 만듭니다 ([ADR-045](../decisions/045-kb-release-pin.md)) |

**없어도 도는 것** — `TRANSCRIBER_URL`(비면 녹음이 글로 안 옮겨지고, **사건 진행은
그대로 돕니다**) · `CASE_PURGE_DAYS`(기본 180) · `ADMIN_*`(관리자 화면이 아직 없습니다).

> ✅ **켜기 전 조건이던 배선은 붙었습니다** (2026-08-27). 토큰화 제외 목록이
> 네 경로에 다 물렸고, 가장 나쁜 문장으로 다시 걸어 **경유 서비스 14곳이
> 14/14 살아남는 것**을 확인했습니다(붙이기 전에는 9곳이 가려졌습니다) →
> [09 §7.2](../docs/research/09-로컬모델-PII인식-실측.md)
>
> ⬜ **공공기관 셋은 아직 가려집니다**(금융감독원·보이스피싱 지킴이·서초경찰서).
> `org` 표에 못 들어가는 기관이라 사전에 없습니다 — 유형 분기에는 안 쓰이므로
> 절차는 안 틀어집니다.
>
> ⛔ **`NER_URL` 은 `TRANSCRIBER_URL` 과 다릅니다 — 채웠으면 그 서버가 살아 있어야 합니다.**
> `TRANSCRIBER_URL` 은 비면 **파일만** 안 되는데, 이쪽은 **경계**라 못 가리면
> 안 내보냅니다 — 서버가 죽으면 슬롯 저장이 `503 PII_TOKENIZER_UNAVAILABLE` 이
> 되어 **사건 진행이 멈춥니다**(설계대로). 빌린 GPU 는 끝나면 지우는 것이
> [ADR-043](../decisions/043-gpu-hosting.md) 이므로, **켜 둔 동안에만 채우는 값**입니다.
> 비워 두면 이름이 안 가려지고(1차 정규식만), 그 사실은 `nerApplied` 와
> 설정 현황에 남습니다. 세우는 절차는 [`runpod-bench.md`](runpod-bench.md).

> ⚠️ **`service_role` 키는 행 단위 접근 제어를 통과합니다.** Preview 환경까지
> 같은 키를 넣으면 PR 미리보기 주소로 운영 데이터가 열립니다. Production 에만 넣으세요.

### 언어모델을 갈아끼우려면

[`src/lib/llm.ts`](../src/lib/llm.ts) 가 **OpenAI 호환 `/chat/completions` 하나**만
부릅니다. 셋을 넣으면 그쪽으로 갑니다 — 셋 다 비면 xAI 입니다.

```
LLM_BASE_URL   https://generativelanguage.googleapis.com/v1beta/openai
LLM_MODEL      gemini-3-flash-preview,gemini-3.6-flash,gemini-3.7-flash
LLM_API_KEY    (그 제공자의 열쇠)
```

**`LLM_MODEL` 은 쉼표로 여럿을 적을 수 있습니다.** 앞엣것이 막히면 뒤엣것으로
넘어갑니다 — 무료 한도에서 필요합니다.

> ⛔ **무료 한도에서는 `503`(과부하)이 상시로 옵니다.** 2026-08-25 실측에서
> 어느 모델이 막히는지가 **몇 분 만에 바뀌었습니다** — 한 번은 `3.5`·`3.7` 이,
> 잠시 뒤엔 `3-flash-preview` 가 막혔습니다. 하나만 박아 두면 그때그때 챗이
> 통째로 멈춥니다. 재시도와 후보 순회는 45초 예산 안에서 두 바퀴까지 돕니다.

> ⚠️ **모델이 다르면 답도 다릅니다.** 같은 물음에 다른 모델이 답하면 재현이
> 안 됩니다 — **개발·시연용 설정입니다.** 제출본에서는 하나만 적으세요.

**형식을 못 지키는 모델은 200 을 받고도 `KB_CITATION_MISSING`(502) 이 됩니다.**
`gemini-2.5-flash` 가 그랬습니다 — 인용 번호로 프롬프트 안의 블록 이름(`history`)을
냈습니다. **모델을 바꾸면 챗 한 턴을 끝까지 돌려 보세요.** 재 본 값은
`src/.env.local` 주석에 있습니다.

⚠️ **바꾸면 토큰화된 사건 진술이 그 사업자에게 갑니다.** 개발 중에는 무료 제공자를
쓰더라도, **제출·시연에 무엇을 쓸지는 사람이 정합니다** → `CLAUDE.md` 불변 규칙 2.

---

## 2. 스키마 — 배포 전에 한 번

**Vercel 빌드는 마이그레이션을 안 돌립니다.** 표가 없으면 첫 요청이 500 입니다.

```
cd src
npm run migrate -- --dry-run    # 무엇이 적용될지만
npm run migrate                 # 실제로
```

`psql` 이 없어도 됩니다 — 앱이 이미 쓰는 드라이버로 돕니다
([`src/scripts/migrate.ts`](../src/scripts/migrate.ts)). `psql` 이 있으면
[`src/migrations/apply.sh`](../src/migrations/apply.sh) 도 같은 일을 합니다.

> **DDL 은 풀러로 못 보냅니다.** 마이그레이션에는 `DIRECT_URL`(5432)을 쓰세요.
> 지금 스크립트는 `DATABASE_URL` 을 읽으므로, 풀러 주소로 실패하면 그 변수에
> 직접 연결 주소를 넣고 한 번 돌립니다.

---

## 3. 매뉴얼 — 배포가 곧 릴리스입니다

```
cd src
npm run kb:load -- --version 2026.08.1 --dry-run
npm run kb:load -- --version 2026.08.1
```

**같은 값을 `KB_VERSION` 환경변수에 넣어야 합니다.** 적재만 하고 환경변수를 안
바꾸면 앱은 옛 릴리스를 계속 인용합니다 — 그게 [ADR-045](../decisions/045-kb-release-pin.md)
가 의도한 동작입니다(검수 전 버전이 피해자에게 안 나가게).

### ⛔ **배포 환경의 값까지 올려야 한 작업이 끝납니다**

로컬 `.env.local` 만 고치고 끝내면 **배포본만 옛 릴리스에 남습니다.** 2026-08-26 에
실제로 그랬습니다 — 운영이 카드·상품권·통신 유형이 없던 릴리스를 보고 있어서
**카드 피해자에게 환급법 절차와 3영업일 기한이 나가고 있었습니다.** 조용해서
아무도 몰랐고, 아홉 유형을 배포본에 걸어 보고서야 드러났습니다.

```bash
cd src
vercel env ls production                     # 지금 무엇이 박혀 있나
printf '2026.08.17' | vercel env add KB_VERSION production --force
vercel deploy --prod                         # ⚠️ 환경변수는 다시 빌드해야 반영됩니다
```

⚠️ **`rm` 하고 `add` 하지 마세요.** 그 사이 몇 분 동안 값이 없어 **운영이 멈춥니다**
— `pinnedKbVersion` 이 `unconfigured` 가 되어 `POST /api/cases` 가 응답하지 않습니다.
2026-08-26 에 그렇게 장애를 냈습니다. **`--force` 로 덮어쓰세요.**

---

## 지금 올라가 있는 것 (2026-08-27 갱신)

| | |
| --- | --- |
| **매뉴얼 릴리스** | **`2026.08.20`** — 절차 28건 · 기관 51곳 · 공공기관 5곳 |
| 코드 | `main` (배포는 머지가 곧 배포 → ADR-053) |
| `NER_URL` | **비어 있습니다** — 개발 중에는 GPU 를 안 켜기로 했습니다 (2026-08-27) |

### 전에 적어 둔 것 (2026-08-25)

| | |
| --- | --- |
| 프로젝트 | `finai/fin-ally` |
| **여는 주소** | **https://fin-ally-khaki.vercel.app** |
| 다른 별칭 | `fin-ally-finai.vercel.app` — **Vercel 인증 보호에 걸려 302 입니다** |

✅ **제출용 주소는 `fin-ally-khaki` 쪽입니다 — 그대로 갑니다** (2026-08-26 결정).

팀 계정의 Deployment Protection 이 기본으로 켜져 있어 다른 별칭은 로그인 없이 안
열립니다. **끄지 않기로 했습니다** — `fin-ally-khaki` 가 이미 로그인 없이 열려서
막히는 것이 없고, 보호를 끄는 것은 되돌리기 번거로운 공개 행위입니다.

```
fin-ally-khaki.vercel.app   200   <- 제출·시연은 여기
fin-ally-finai.vercel.app   302   <- 보호에 걸림. 그대로 둡니다
```

> 눌러서 확인한 값입니다(2026-08-26). **제출 전에 다시 한 번 누르세요** — 팀 설정이
> 바뀌면 여기도 302 가 될 수 있고, 그때는 심사위원이 로그인 화면을 봅니다.

끄려면 Project Settings → Deployment Protection → Vercel Authentication 을 Disabled
로 바꾸면 됩니다. **모든 별칭이 공개되므로 사람이 정할 일입니다.**

## 올리는 방법 — `main` 머지가 곧 배포

[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) 이 합니다 → [ADR-053](../decisions/053-deploy-on-merge.md).

```
main 에 src/** 가 푸시됨
  → 그 순간의 main 끝을 받음             (실행에 박힌 커밋이 아닙니다 — 아래 「막히는 두 가지」②)
  → npm run typecheck · npm test      (code-check 와 같은 명령 — 브랜치 보호가 없어 여기서 다시 봅니다)
  → npx vercel deploy --prod          (.git 없는 사본을 올리고 Vercel 이 빌드. 실패하면 이전 배포가 남습니다)
```

**PR 미리보기는 안 만듭니다** — 위 §1 의 `service_role` 경고가 그 이유입니다. 올라가는 것은 `main` 뿐입니다.

같은 커밋을 다시 올려야 할 때(환경변수만 바꿨을 때 등)는 Actions 탭 → `deploy` → **Run workflow**.

### 막히는 두 가지 — 2026-08-26 에 겪은 것

**① Vercel 팀이 Hobby 라 소유자가 아닌 작성자의 커밋을 안 받습니다.** 비공개 저장소의
Hobby 팀은 *"the commit author must be the owner of the Hobby team"* 입니다
([Vercel 문서](https://vercel.com/docs/deployments/troubleshoot-project-collaboration#team-configuration)).
kth9245 님이 머지한 #59 의 배포가 `BLOCKED`(`seatBlock: TEAM_ACCESS_REQUIRED`) 로 남았고,
CLI 는 `Building…` 에서 **2시간 48분**을 기다리다 취소됐습니다 — 그동안 뒤의 배포가 전부 섰습니다.

그래서 워크플로는 **`.git` 이 없는 사본**(`git archive HEAD:src`)을 올립니다. 배포 주체가
토큰 주인(소유자)이고 커밋 작성자는 검사 대상이 아닙니다. 올린 커밋은 잡 요약과
`vercel inspect` 의 `meta.commit` 에 남습니다. 잡에는 20분 제한이 있어 어느 쪽이 멈춰도
동시성 그룹을 붙들지 않습니다.

**제대로 된 답은 둘 중 하나이고, 사람이 정합니다** — Pro 플랜으로 올려 팀원을 추가하거나,
저장소를 공개로(공개 저장소는 협업이 무료). 그전까지 사본 배포는 우회입니다.

⚠️ **손으로 올릴 때도 같습니다** — `src` 안에서 `vercel deploy` 를 부르면 HEAD 의 작성자가
실립니다. HEAD 가 소유자 커밋이 아니면 막힙니다 → Run workflow 를 쓰거나, 사본에서 올리세요.

**② GitHub Actions 자체가 죽을 수 있습니다** — 그날 상태 페이지에 *Incident with Actions ·
Critical* 이 15:11Z 에 열렸습니다. 보이는 것과 할 일:

| 보이는 것 | 뜻 | 할 일 |
| --- | --- | --- |
| 머지했는데 `deploy` 실행이 **안 생김**, 또는 십몇 분 뒤에야 생김 | 이벤트가 밀려 있습니다 | Actions 탭 → `deploy` → **Run workflow**. 밀린 실행이 나중에 와도 `main` 끝을 올리니 겹쳐도 됩니다 |
| `queued` 인 채 러너가 안 붙음 · 0초 `startup_failure` · 주석 *"The job was not acquired by Runner of type hosted even after multiple attempts"* | **러너 장애입니다. 과금이 아닙니다** — 과금 소진은 *"spending limit"* 문구로 옵니다 | 기다립니다. 급하면 「손으로 올리려면」 |
| 장애 뒤에도 `queued` 로 남은 실행이 취소·삭제가 안 됨(409 *"has not been queued yet"* · 403) | 큐에 들어가지도 못한 유령입니다. 나중에 살아날 수 있습니다 | 워크플로가 **실행의 커밋이 아니라 `main` 끝**을 올리므로 살아나도 옛 커밋으로 돌아가지 않습니다 |

머지 전 검사는 그동안 `bash .github/scripts/gates.sh origin/main` 이 대신합니다.

### 시크릿 셋 — Settings → Secrets and variables → Actions

| 이름 | 값 | 상태 |
| --- | --- | --- |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens 에서 만든 것. Scope 는 `finai` 팀 | ✅ 2026-08-26 — 팀 범위 토큰이라 `/v2/user` 는 404, 프로젝트 조회(`/v9/projects/{id}?teamId=`)로 확인했습니다 |
| `VERCEL_ORG_ID` | `src/.vercel/project.json` 의 `orgId` | ✅ 2026-08-25 |
| `VERCEL_PROJECT_ID` | `src/.vercel/project.json` 의 `projectId` | ✅ 2026-08-25 |

셋 중 하나라도 비면 워크플로가 **첫 단계에서 이름을 찍고** 멈춥니다 — 검사를 다 돌고 나서 터지지 않습니다.

### 손으로 올리려면 — Actions 가 막혔을 때

워크플로가 하는 일이 정확히 이 명령입니다. 대시보드를 안 거칩니다.

```
cd src
npx vercel link --yes --project fin-ally --scope finai
npx vercel deploy --prod --yes
```

`vercel link` 를 **`src` 안에서** 부르면 그 디렉터리가 루트가 됩니다.
CI 에서는 `VERCEL_ORG_ID`·`VERCEL_PROJECT_ID` 환경변수가 그 링크를 대신합니다.

⚠️ HEAD 의 작성자가 팀 소유자가 아니면 `BLOCKED` 로 막힙니다 → 위 「막히는 두 가지」①.

## 4. 올린 뒤 — 한 바퀴 확인

```
B=https://<배포주소>
curl -s -X POST "$B/api/cases" -H 'content-type: application/json' -d '{"track":"victim"}'
```

돌려받은 `link_token` 으로 `GET $B/api/cases/{t}` · `/plan` · `/deadlines` 가
200 이면 표와 환경변수가 붙은 것입니다.

**챗은 따로 봅니다** — `POST $B/api/cases/{t}/messages` 의 서버 로그를 보세요.

| 로그 | 뜻 |
| --- | --- |
| `모델이 거절했습니다 (403)` | 열쇠는 살아 있는데 **잔액이 없습니다** |
| `모델이 거절했습니다 (503)` | 과부하. 후보를 다 돌고도 안 됐다는 뜻입니다 |
| `모델이 제때 답하지 않았습니다` | **예산(55초)을 넘겼습니다.** 잔액·한도와 무관합니다 — `[llm]` 줄이 실제 소요를 남깁니다 |
| `KB_CITATION_MISSING` | 모델이 답은 했는데 **인용 형식을 어겼습니다** — 모델을 바꾸세요 |

---

## 아직 여기 없는 것

| 무엇 | 왜 |
| --- | --- |
| **크론 둘** (파기 · KB 수집) | 라우트가 아직 없습니다. 만들면 `src/vercel.json` 에 `crons` 를 더합니다 → [ADR-025](../decisions/025-scheduled-jobs.md) |
| **Preview 환경 분리** | 미정 → [ARCHITECTURE §10](../ARCHITECTURE.md#10-아직-안-정해진-것). 지금은 Production 하나만 씁니다 |
| **스모크 시험** | 배포 주소가 있어야 돌아갑니다 → `docs/plans/08-23-qa-readiness.md` Task 8 |
