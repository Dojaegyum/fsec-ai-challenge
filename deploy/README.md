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

---

## 지금 올라가 있는 것 (2026-08-25)

| | |
| --- | --- |
| 프로젝트 | `finai/fin-ally` |
| **여는 주소** | **https://fin-ally-khaki.vercel.app** |
| 다른 별칭 | `fin-ally-finai.vercel.app` — **Vercel 인증 보호에 걸려 302 입니다** |

⚠️ **제출용 주소는 `fin-ally-khaki` 쪽입니다.** 팀 계정의 Deployment Protection 이
기본으로 켜져 있어 다른 별칭은 로그인 없이 안 열립니다. 보호를 끄려면
Project Settings → Deployment Protection → Vercel Authentication 을 Disabled 로
바꿔야 하고, **그건 주소를 완전히 공개하는 것이라 사람이 정합니다.**

CLI 로 올렸습니다 — 대시보드를 안 거칩니다.

```
cd src
npx vercel link --yes --project fin-ally --scope finai
npx vercel deploy --prod --yes
```

`vercel link` 를 **`src` 안에서** 부르면 그 디렉터리가 루트가 됩니다.

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
