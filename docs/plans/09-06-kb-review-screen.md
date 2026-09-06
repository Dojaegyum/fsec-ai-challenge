# KB 검수 큐 화면 — 구현 계획

> **에이전트에게:** 이 계획은 `superpowers:subagent-driven-development` 또는 `superpowers:executing-plans` 로
> 태스크 하나씩 실행합니다. 단계는 체크박스(`- [ ]`)로 추적합니다.

**목표:** 수집기가 큐에 올린 조문 변경을 팀이 화면(`/admin/kb`)에서 보고 승인·거절·미룸을 남기게 한다.
반영은 지금처럼 파일을 고쳐 릴리스한다.

**구조:** 화면은 껍데기만 공개인 클라이언트 컴포넌트이고, 데이터는 전부 문지기 뒤의 `/api/admin/kb/*` 로 받는다.
라우트는 얇게 `handleRoute` 를 지나 `src/flows/kb-review.ts` 를 부르고, 판단은 있는 `kb-reviewer` 가 한다.
조문과 매뉴얼을 잇는 것은 `legal_basis` 글을 읽는 순수 규칙 하나다. 로그인만 문지기 밖(`/api/admin-login`)이고,
비밀번호 해시 형식을 scrypt 로 확정해 잠들어 있던 세션 쿠키 코드를 깨운다.

**기술:** Next 16 App Router · React 19 · TypeScript · `node:crypto`(scrypt) · postgres(`Sql`) · vitest · Tailwind v4 토큰.
새 의존성 없음.

**정본:** [ADR-088](../../decisions/088-kb-review-screen.md) · [화면 S-12](../../spec/frontend/08-14-screens.md) ·
[API §7](../../spec/common/08-14-api.md) · [에러 코드 표](../../spec/backend/08-16-errors.md) ·
[핸드오프 09-06-s12-kb-review](../../assets/artifacts/handoff/09-06-s12-kb-review/README.md)

## 전역 제약

- **KB 본문을 쓰는 경로를 만들지 않는다.** `kb_entry` 에 쓰는 코드는 `kb:load` 하나다 (RFC-002).
- **승인 단추 문구는 「승인」.** 판단 단추 어디에도 「반영」이라는 말이 없어야 한다 (ADR-088 「근거」).
- **`/api/admin/` 아래 라우트는 문지기가 자동으로 401 을 낸다.** 라우트에서 인증을 따로 확인하지 않는다 (§5.1).
  **`/api/admin-login` 만 밖**이고, 문지기 목록(`gated-paths.ts`)에 예외를 뚫지 않는다.
- **관리자 경로는 속도 제한을 걸지 않는다** (§1.3 · `request.ts` 가 이미 그렇게 한다). 로그인만 `adminLogin` 갈래로 IP당 10분에 10회.
- **`ADMIN_PASSWORD_HASH` 형식은 `scrypt$N$r$p$<salt base64>$<hash base64>`.** 비면 로그인이 전부 401.
- **`change_id` 는 `ulidParamOf` 로만 읽는다.** `route-contract` 검사기의 보호 세그먼트에 올린다.
- **새 라우트는 전부 `handleRoute` 를 지나고 `{ body, status }` 를 돌려준다.** POST 는 `rate:` 를 밝힌다 (R1 · R2 · R3).
- **`src/modules/` 에 새 폴더를 만들지 않는다.** 화면 쪽 파일은 `src/app/admin/kb/` 에, 서버 규칙은 `kb-reviewer/link.ts` 에.
- **12.5px 미만 글자 없음 · 누름 영역 44px · 다크 전용 · 상태는 색이 아니라 글자로** (tokens · ADR-032).
- **이 화면에 피해자 데이터를 두지 않는다.** 법령 원문과 검수 기록뿐이다.
- 명령은 전부 `src/` 안에서 돈다: `cd src && npx vitest run <파일>` · `npm run typecheck` · `npm run lint`.
- 커밋 메시지는 이 저장소의 결(한국어 제목 · 왜를 본문에)로 쓰고, 끝에 `Co-Authored-By` 를 단다.

---

## 파일 지도

| 파일 | 책임 | 태스크 |
| --- | --- | --- |
| `src/lib/admin-password.ts` (+ `.test.ts`) | scrypt 해시 만들기·대조 | 1 |
| `src/scripts/admin-hash.ts` · `package.json` | `npm run admin:hash -- <비밀번호>` | 1 |
| `src/lib/request.ts` · `src/lib/http.ts` (+ `request.headers.test.ts`) | `RouteResult.headers` — 라우트가 `Set-Cookie` 를 실을 자리 | 2 |
| `src/lib/rate-limit.ts` (+ `rate-limit.admin.test.ts`) | `adminLogin` 갈래 | 3 |
| `src/app/api/admin-login/route.ts` (+ `.test.ts`) · `src/app/api/admin/logout/route.ts` (+ `.test.ts`) · `src/proxy.test.ts` | 로그인·로그아웃 | 4 |
| `src/lib/errors.ts` · `src/modules/kb-reviewer/review.ts` (+ `review.test.ts`) | `KB_CHANGE_NOT_FOUND` 404 · `KB_CHANGE_DECIDED` 409 | 5 |
| `src/modules/kb-reviewer/link.ts` (+ `link.test.ts`) · `index.ts` | 조문 ↔ 매뉴얼 규칙 | 6 |
| `src/modules/kb-finder/types.ts` · `src/lib/db.ts` | `KbStore.listEntries(kbVersion)` | 7 |
| `src/lib/container.ts` · `src/flows/kb-review.ts` (+ `.test.ts`) | 조립과 흐름 다섯 | 8 |
| `src/app/api/admin/kb/{queue,entries,history}/route.ts` · `changes/[change_id]/route.ts` · `changes/[change_id]/decision/route.ts` (+ 각 `.test.ts`) · `.github/scripts/route-contract.py` | 라우트 다섯 | 9 |
| `src/app/admin/kb/load.ts` · `state.ts` (+ `state.test.ts`) | 클라이언트 모듈 — fetch 와 상태 리듀서 | 10 |
| `src/app/admin/kb/page.tsx` · `login.tsx` · `queue.tsx` · `detail.tsx` (+ `page.test.tsx`) | 화면 | 11 |
| `ARCHITECTURE.md` · `CLAUDE.md` · `spec/frontend/08-14-screens.md` · 핸드오프 README · `src/lib/config-report.ts` · `docs/plans/README.md` | 문서 동기화 | 12 |
| `.github/workflows/vercel-env.yml` · Vercel 환경변수 | 배포 | 13 |

---

### Task 0: 준비

**Files:** 없음 (브랜치와 의존성만)

- [ ] **Step 1: 브랜치 확인** — `feat/kb-review-screen` 이 `origin/main` 위에 있고 ADR-088 커밋(`8313541`)이 들어 있는지 봅니다.

```bash
git branch --show-current          # feat/kb-review-screen
git log --oneline -1               # 8313541 KB 검수 큐 화면을 만들기로 한다 …
```

- [ ] **Step 2: 의존성** — main 을 받은 뒤라 `node_modules` 가 뒤처졌을 수 있습니다.

```bash
cd src && npm install && npm run typecheck
```

Expected: 타입 오류 0.

---

### Task 1: 비밀번호 해시 — 만들기와 대조

**Files:**
- Create: `src/lib/admin-password.ts`
- Create: `src/lib/admin-password.test.ts`
- Create: `src/scripts/admin-hash.ts`
- Modify: `src/package.json` (`scripts` 에 한 줄)

**Interfaces:**
- Produces: `hashPassword(plain: string): string` — `scrypt$N$r$p$<salt>$<hash>` 문자열.
  `verifyPassword(plain: string, stored: string | null | undefined): boolean` — 형식이 아니거나 비면 `false`, 던지지 않음.

- [ ] **Step 1: 실패하는 시험**

```ts
// src/lib/admin-password.test.ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './admin-password'

describe('scrypt 해시 — API §7.1', () => {
  it('만든 것은 통과한다', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('다른 비밀번호는 막힌다', () => {
    const stored = hashPassword('one')
    expect(verifyPassword('two', stored)).toBe(false)
  })

  it('같은 비밀번호도 솔트가 달라 해시가 다르다', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })

  it('형식이 아니면 던지지 않고 막힌다', () => {
    expect(verifyPassword('x', 'admin')).toBe(false)
    expect(verifyPassword('x', 'scrypt$16384$8$1$notbase64!$zz')).toBe(false)
    expect(verifyPassword('x', null)).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
  })

  it('해시 한 글자를 건드리면 막힌다', () => {
    const stored = hashPassword('pw')
    const parts = stored.split('$')
    const last = parts[5]!
    parts[5] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1)
    expect(verifyPassword('pw', parts.join('$'))).toBe(false)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run lib/admin-password.test.ts`
Expected: FAIL — `Cannot find module './admin-password'`

- [ ] **Step 3: 구현**

```ts
// src/lib/admin-password.ts
/**
 * 관리자 비밀번호 해시 — API §7.1 · ADR-088.
 *
 * 형식 `scrypt$N$r$p$<salt base64>$<hash base64>`. `node:crypto` 만 씁니다 — 의존성을 늘리지
 * 않으려는 것이고, scrypt 는 Node 가 내장합니다. **대조는 어떤 입력에도 던지지 않습니다** —
 * 형식이 아니면 그냥 `false` 입니다. 로그인 경로가 500 을 내면 그 자체가 힌트가 됩니다.
 */
import 'server-only'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const PREFIX = 'scrypt'
const KEY_LENGTH = 32
const DEFAULT = { N: 16384, r: 8, p: 1 } as const

export function hashPassword(plain: string, params: { N: number; r: number; p: number } = DEFAULT): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEY_LENGTH, params)
  return [PREFIX, params.N, params.r, params.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (typeof stored !== 'string' || stored.length === 0) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![N, r, p].every((one) => Number.isSafeInteger(one) && one > 0)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4]!, 'base64')
    expected = Buffer.from(parts[5]!, 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  let actual: Buffer
  try {
    actual = scryptSync(plain, salt, expected.length, { N, r, p })
  } catch {
    // N·r·p 가 메모리 한도를 넘는 값이면 scrypt 가 던집니다 — 닫힌 쪽으로
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd src && npx vitest run lib/admin-password.test.ts`
Expected: PASS (5)

- [ ] **Step 5: 명령 — 값을 만드는 자리**

```ts
// src/scripts/admin-hash.ts
/**
 * 관리자 비밀번호 해시를 만든다 — `npm run admin:hash -- <비밀번호>`.
 *
 * 출력을 배포 환경변수 `ADMIN_PASSWORD_HASH` 에 넣습니다 (API §1.2 · §7.1 · ADR-088).
 * 비밀번호는 **인자로만** 받고 어디에도 기록하지 않습니다. 셸 히스토리에 남는 것이 싫으면
 * 앞에 공백을 두고 치세요(bash 의 HISTCONTROL=ignorespace).
 */
import { hashPassword } from '@/lib/admin-password'

const plain = process.argv.slice(2).find((one) => !one.startsWith('--'))
if (!plain || plain.length < 12) {
  console.error('사용법: npm run admin:hash -- <비밀번호>   (12자 이상 · 무작위 문자열을 권합니다)')
  process.exit(1)
}
console.log(hashPassword(plain))
```

`src/package.json` 의 `scripts` 에 `"kb:review"` 줄 아래 한 줄:

```json
    "admin:hash": "tsx --conditions=react-server scripts/admin-hash.ts",
```

- [ ] **Step 6: 손으로 한 번**

Run: `cd src && npm run admin:hash -- "correct horse battery staple"`
Expected: `scrypt$16384$8$1$…$…` 한 줄. 짧은 인자면 사용법과 함께 exit 1.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/admin-password.ts src/lib/admin-password.test.ts src/scripts/admin-hash.ts src/package.json
git commit -m "관리자 비밀번호 해시 형식을 scrypt 로 확정한다 — 만들기·대조·명령 (API §7.1 · ADR-088)"
```

---

### Task 2: 껍데기에 헤더 자리 — 라우트가 `Set-Cookie` 를 실을 수 있게

지금 `RouteResult` 는 `{ body, status }` 뿐이라 로그인 라우트가 쿠키를 못 굽습니다. `route-contract` R2 가
`Response` 를 직접 만드는 것을 막으므로 **껍데기를 넓힙니다.**

**Files:**
- Modify: `src/lib/request.ts` — `RouteResult` 에 `headers?` · `handleRoute` 가 넘김
- Modify: `src/lib/http.ts` — `ok()` 가 헤더를 합침
- Create: `src/lib/request.headers.test.ts`

**Interfaces:**
- Produces: `RouteResult.headers?: Readonly<Record<string, string>>` — 계측 헤더·`Cache-Control` 뒤에 덧붙습니다. 같은 이름이면 라우트 것이 이깁니다.

- [ ] **Step 1: 실패하는 시험**

```ts
// src/lib/request.headers.test.ts
import { describe, expect, it } from 'vitest'
import { createContainer } from './container'
import { readEnv } from './env'
import { handleRoute } from './request'

describe('라우트가 헤더를 실을 수 있다 — Set-Cookie 자리', () => {
  it('body 옆의 headers 가 응답에 붙고, 계측 헤더는 그대로다', async () => {
    const res = await handleRoute(
      new Request('http://x/api/ping'),
      async () => ({ body: { ok: true }, headers: { 'Set-Cookie': 'a=b; Path=/' } }),
      { container: createContainer(readEnv({})) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBe('a=b; Path=/')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run lib/request.headers.test.ts`
Expected: FAIL — `Set-Cookie` 가 `null` (타입 오류가 먼저 날 수도 있습니다 — 그것도 실패입니다)

- [ ] **Step 3: 구현**

`src/lib/request.ts` 의 `RouteResult`:

```ts
export interface RouteResult {
  readonly body: unknown
  readonly status?: number
  /**
   * 라우트가 덧붙일 헤더 — 지금은 로그인·로그아웃의 `Set-Cookie` 하나뿐입니다 (§7.1 · ADR-088).
   * 계측 헤더·`Cache-Control` 뒤에 붙고, 같은 이름이면 라우트 것이 이깁니다.
   * **`Response` 를 직접 만들지 않으려는 것입니다** — 그러면 계측 헤더가 빠집니다 (route-contract R2)
   */
  readonly headers?: Readonly<Record<string, string>>
}
```

`handleRoute` 의 성공 자리:

```ts
    const result = await handler(ctx)
    return ok(result.body, {
      status: result.status,
      telemetry: telemetry.snapshot(),
      headers: result.headers,
    })
```

`src/lib/http.ts` 의 `ok`:

```ts
export function ok(
  body: unknown,
  init: { status?: number; telemetry?: Telemetry; headers?: Readonly<Record<string, string>> } = {},
): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: { ...baseHeaders(init.telemetry ?? {}), ...(init.headers ?? {}) },
  })
}
```

- [ ] **Step 4: 통과 확인 + 회귀**

Run: `cd src && npx vitest run lib/request.headers.test.ts lib/ && npm run typecheck`
Expected: PASS · 기존 lib 시험 전부 통과 · 타입 오류 0

- [ ] **Step 5: 커밋**

```bash
git add src/lib/request.ts src/lib/http.ts src/lib/request.headers.test.ts
git commit -m "껍데기가 라우트의 헤더를 실어 준다 — 로그인이 Set-Cookie 를 굽는 자리 (route-contract R2 를 지키면서)"
```

---

### Task 3: 상한 갈래 `adminLogin`

**Files:**
- Modify: `src/lib/rate-limit.ts` — `RateBucket` 유니온과 `RATE_RULES`
- Create: `src/lib/rate-limit.admin.test.ts`

**Interfaces:**
- Produces: `'adminLogin'` 갈래 — `scope: 'ip'` · 10회 / 10분. `UpfrontRateBucket` 에 자동으로 포함됩니다(case 범위가 아니므로).

- [ ] **Step 1: 실패하는 시험**

```ts
// src/lib/rate-limit.admin.test.ts
import { describe, expect, it } from 'vitest'
import { RATE_RULES } from './rate-limit'

describe('관리자 로그인 상한 — API §1.3', () => {
  it('IP 기준 10분에 10회다', () => {
    expect(RATE_RULES.adminLogin).toEqual({
      bucket: 'adminLogin',
      scope: 'ip',
      limit: 10,
      windowMs: 10 * 60_000,
      what: '관리자 로그인',
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run lib/rate-limit.admin.test.ts`
Expected: FAIL — `adminLogin` 이 `undefined`

- [ ] **Step 3: 구현**

```ts
export type RateBucket = 'chat' | 'slot' | 'vault' | 'caseCreate' | 'read' | 'notFound' | 'adminLogin'
```

`RATE_RULES` 의 `notFound` 아래:

```ts
  // 계정이 하나라 IP 로 셉니다. 무차별 대입 방어 → §7.1 · ADR-088.
  // `/api/admin/*` 은 제한하지 않지만(§1.3) 로그인은 그 접두사 밖이라 여기가 걸립니다
  adminLogin: {
    bucket: 'adminLogin',
    scope: 'ip',
    limit: 10,
    windowMs: 10 * MINUTE,
    what: '관리자 로그인',
  },
```

- [ ] **Step 4: 통과 확인**

Run: `cd src && npx vitest run lib/rate-limit && npm run typecheck`
Expected: PASS · 기존 rate-limit 시험 통과 (`satisfies Record<RateBucket, RateRule>` 가 빠진 갈래를 잡습니다)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/rate-limit.ts src/lib/rate-limit.admin.test.ts
git commit -m "관리자 로그인 상한 갈래 — IP당 10분에 10회 (API §1.3 · §7.1)"
```

---

### Task 4: 로그인·로그아웃 라우트

**Files:**
- Create: `src/app/api/admin-login/route.ts` · `route.test.ts`
- Create: `src/app/api/admin/logout/route.ts` · `route.test.ts`
- Modify: `src/proxy.test.ts` — `/api/admin-login` 이 문지기 밖임을 시험 하나로 못 박음

**Interfaces:**
- Consumes: Task 1 `verifyPassword` · Task 2 `RouteResult.headers` · Task 3 `'adminLogin'` · `issueAdminSession` / `adminSessionSetCookie` / `adminSessionClearCookie` (`@/lib/session-cookie`) · `serverClock.nowMs()` (`@/lib/clock`).
- Produces: `POST /api/admin-login` `{password}` → 200 `{ ok: true }` + `Set-Cookie`; 401 `UNAUTHORIZED`. `POST /api/admin/logout` → 200 `{ ok: true }` + 지우는 `Set-Cookie`.

- [ ] **Step 1: 실패하는 시험 — 로그인**

```ts
// src/app/api/admin-login/route.test.ts
import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { ADMIN_SESSION_COOKIE } from '@/lib/session-cookie'
import { POST } from './route'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

const HASH = hashPassword('correct horse battery staple')

function wire(env: Record<string, string> = { ADMIN_PASSWORD_HASH: HASH }) {
  holder.container = createContainer(readEnv(env))
}

function ask(body: unknown) {
  return new Request('http://x/api/admin-login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('로그인 — §7.1', () => {
  it('맞는 비밀번호면 쿠키를 굽는다', async () => {
    wire()
    const res = await POST(ask({ password: 'correct horse battery staple' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const cookie = res.headers.get('Set-Cookie') ?? ''
    expect(cookie.startsWith(`${ADMIN_SESSION_COOKIE}=`)).toBe(true)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })

  it('틀리면 401 이고 쿠키가 없다 — 이유는 말하지 않는다', async () => {
    wire()
    const res = await POST(ask({ password: 'wrong' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('Set-Cookie')).toBeNull()
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
  })

  it('해시가 없는 서버는 닫혀 있다', async () => {
    wire({})
    expect((await POST(ask({ password: 'anything' }))).status).toBe(401)
  })

  it('본문이 형식이 아니면 400', async () => {
    wire()
    expect((await POST(ask({ nope: 1 }))).status).toBe(400)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run app/api/admin-login`
Expected: FAIL — `./route` 없음

- [ ] **Step 3: 구현 — 로그인**

```ts
// src/app/api/admin-login/route.ts
/**
 * 관리자 로그인 — API §7.1 · ADR-088.
 *
 * **문지기 밖입니다.** `/api/admin/` 접두사에 안 걸리는 이름을 일부러 골랐습니다 — 문지기 목록에
 * 예외를 뚫으면 다음 예외가 쉬워집니다. 대신 상한(`adminLogin` · IP 기준)이 걸립니다.
 *
 * 틀렸는지 비었는지 말하지 않습니다 — 문지기의 401 과 같은 문구입니다.
 */
import { verifyPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { BadRequestError, UnauthorizedError } from '@/lib/errors'
import { handleRoute } from '@/lib/request'
import { adminSessionSetCookie, issueAdminSession } from '@/lib/session-cookie'

export async function POST(request: Request) {
  return handleRoute(
    request,
    async (ctx) => {
      const body = (await ctx.request.json().catch(() => null)) as { password?: unknown } | null
      if (!body || typeof body.password !== 'string') {
        throw new BadRequestError('비밀번호가 없습니다', { param: 'password' })
      }
      const stored = ctx.container.env.values.ADMIN_PASSWORD_HASH
      // 해시가 없는 서버는 닫혀 있습니다 — verifyPassword 가 빈 값에 false 를 냅니다
      if (!verifyPassword(body.password, stored)) {
        throw new UnauthorizedError('관리자 인증에 실패했습니다', { gate: 'admin-login' })
      }
      const session = issueAdminSession(ctx.container.env, serverClock.nowMs())
      if (!session) throw new UnauthorizedError('관리자 인증에 실패했습니다', { gate: 'admin-login' })
      return {
        body: { ok: true },
        headers: { 'Set-Cookie': adminSessionSetCookie(session.value, session.maxAgeSeconds) },
      }
    },
    { rate: 'adminLogin' },
  )
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd src && npx vitest run app/api/admin-login`
Expected: PASS (4)

- [ ] **Step 5: 실패하는 시험 — 로그아웃**

```ts
// src/app/api/admin/logout/route.test.ts
import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import { POST } from './route'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

const env = readEnv({ ADMIN_PASSWORD_HASH: hashPassword('pw-pw-pw-pw-pw') })

function ask(cookie?: string) {
  return new Request('http://x/api/admin/logout', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
  })
}

describe('로그아웃 — §7.1', () => {
  it('세션이 있으면 지우는 쿠키를 돌려준다', async () => {
    holder.container = createContainer(env)
    const session = issueAdminSession(env, serverClock.nowMs())!
    const res = await POST(ask(`${ADMIN_SESSION_COOKIE}=${session.value}`))
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('세션이 없으면 401 — 문지기 안이다', async () => {
    holder.container = createContainer(env)
    expect((await POST(ask())).status).toBe(401)
  })
})
```

- [ ] **Step 6: 구현 — 로그아웃**

```ts
// src/app/api/admin/logout/route.ts
/** 관리자 로그아웃 — §7.1. 문지기 안이라 세션이 있어야 부를 수 있습니다 — 그대로 맞습니다 */
import { handleRoute } from '@/lib/request'
import { adminSessionClearCookie } from '@/lib/session-cookie'

export async function POST(request: Request) {
  return handleRoute(
    request,
    async () => ({ body: { ok: true }, headers: { 'Set-Cookie': adminSessionClearCookie() } }),
    // 관리자 경로는 제한하지 않습니다(§1.3) — 껍데기가 어차피 건너뜁니다. 검사기(R3)에 밝히는 것입니다
    { rate: 'none' },
  )
}
```

- [ ] **Step 7: 문지기 시험 한 줄** — `src/proxy.test.ts` 의 `describe('어디에 거는가')` 안에 추가:

```ts
  it('/api/admin-login 은 관리자 갈래가 아니다 — 로그인은 문지기 밖 (§7.1)', () => {
    expect(isAdminPath('/api/admin-login')).toBe(false)
  })
```

(`isAdminPath` 가 그 파일에 import 되어 있지 않으면 `import { isAdminPath } from '@/lib/gated-paths'` 를 더합니다.)

- [ ] **Step 8: 통과 확인 + 검사기**

Run: `cd src && npx vitest run app/api/admin proxy.test.ts && cd .. && python .github/scripts/route-contract.py`
Expected: PASS · 라우트 규약 위반 0

- [ ] **Step 9: 커밋**

```bash
git add src/app/api/admin-login src/app/api/admin/logout src/proxy.test.ts
git commit -m "관리자 로그인·로그아웃 — 로그인만 문지기 밖, 상한은 IP 기준 (API §7.1 · ADR-088)"
```

---

### Task 5: 에러 코드 둘 — 못 찾음 404 · 이미 판단됨 409

지금 `kb-reviewer` 는 둘 다 `KbError`(500)로 던집니다. 화면이 「이미 판단된 건」을 가려 보여 주려면 코드가 있어야 합니다.

**Files:**
- Modify: `src/lib/errors.ts` — 클래스 둘 · `USER_MESSAGE` 두 줄
- Modify: `src/modules/kb-reviewer/review.ts` — 던지는 자리 셋
- Modify: `src/modules/kb-reviewer/review.test.ts` — 단언 둘

**Interfaces:**
- Produces: `KbChangeNotFoundError` (`KB_CHANGE_NOT_FOUND` · 404) · `KbChangeDecidedError` (`KB_CHANGE_DECIDED` · 409). 둘 다 `KbError` 를 상속해 기존 `toThrow(KbError)` 단언은 그대로 통과합니다.

- [ ] **Step 1: 실패하는 시험** — `review.test.ts` 에서 「그 변경을 찾지 못했습니다」와 「이미 판단이 끝난 변경입니다」를 보는 `it` 의 단언을 클래스로 바꿉니다:

```ts
import { KbChangeDecidedError, KbChangeNotFoundError } from '@/lib/errors'
// …
await expect(reviewer.review({ changeId: 'nope', status: 'approved', reviewedBy: '김태현' }))
  .rejects.toBeInstanceOf(KbChangeNotFoundError)
// …
await expect(reviewer.review({ changeId: approved.changeId, status: 'rejected', reviewedBy: '김태현' }))
  .rejects.toBeInstanceOf(KbChangeDecidedError)
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run modules/kb-reviewer`
Expected: FAIL — import 없음

- [ ] **Step 3: 구현** — `src/lib/errors.ts` 의 `KbError` 아래:

```ts
/** 검수 큐의 변경 하나를 못 찾음 — 관리자 API §7.3 (ADR-088) */
export class KbChangeNotFoundError extends KbError {
  readonly code: string = 'KB_CHANGE_NOT_FOUND'
  readonly httpStatus: number = 404
}
/** 승인·거절이 끝난 변경을 다시 판단하려 함 — 데이터 모델 §12.2 · ADR-044 */
export class KbChangeDecidedError extends KbError {
  readonly code: string = 'KB_CHANGE_DECIDED'
  readonly httpStatus: number = 409
}
```

`USER_MESSAGE` 의 `ARTIFACT_REQUIRED` 아래:

```ts
  KB_CHANGE_NOT_FOUND: '그 변경을 찾지 못했습니다.',
  KB_CHANGE_DECIDED: '이미 판단이 끝난 변경입니다.',
```

`review.ts`: `import { KbChangeDecidedError, KbChangeNotFoundError, KbError } from '@/lib/errors'` 로 바꾸고,
「그 변경을 찾지 못했습니다」 둘은 `new KbChangeNotFoundError(...)`, 「이미 판단이 끝난 변경입니다」는
`new KbChangeDecidedError(...)` 로. 나머지(검수자 비었음 · 승인되지 않음 · 버전 비었음)는 `KbError` 그대로.

- [ ] **Step 4: 통과 확인**

Run: `cd src && npx vitest run modules/kb-reviewer lib/errors && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/errors.ts src/modules/kb-reviewer/review.ts src/modules/kb-reviewer/review.test.ts
git commit -m "검수 큐 에러에 코드를 준다 — 못 찾음 404 · 이미 판단됨 409 (에러 표 · ADR-088)"
```

---

### Task 6: 조문 ↔ 매뉴얼 규칙 — `link.ts`

**Files:**
- Create: `src/modules/kb-reviewer/link.ts` · `link.test.ts`
- Modify: `src/modules/kb-reviewer/index.ts` — export

**Interfaces:**
- Produces:
  - `parseSourceKey(sourceKey: string): { lawId: string; article: string } | null` — `law:011359:제3조` → `{ lawId: '011359', article: '제3조' }`. `page:` 등 다른 접두사는 `null`.
  - `LAWS: Readonly<Record<string, { word: '법' | '시행령'; name: string }>>` — `011359` · `011448`.
  - `sourceLabelOf(sourceKey: string): string` — `법 011359 · 통신사기피해환급법` / 모르는 접두사는 그대로.
  - `articleRefsOf(legalBasis: string): ReadonlySet<string>` — `"법 제3조"` 꼴의 키 집합.
  - `linkEntries(sourceKey: string, entries: readonly { kbEntryId: string; legalBasis: string }[]): readonly string[]` — 닿는 `kbEntryId` 들, 입력 순서.

- [ ] **Step 1: 실패하는 시험** — 실제 KB 파일로 봅니다.

```ts
// src/modules/kb-reviewer/link.test.ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { articleRefsOf, linkEntries, parseSourceKey, sourceLabelOf } from './link'

type KbFile = { entries: { kb_entry_id: string; legal_basis: string }[] }
const load = (name: string): KbFile =>
  JSON.parse(readFileSync(new URL(`../../kb/${name}`, import.meta.url), 'utf8')) as KbFile
const ENTRIES = [...load('common.json').entries, ...load('frozen-account.json').entries, ...load('ch-easypay.json').entries]
  .map((one) => ({ kbEntryId: one.kb_entry_id, legalBasis: one.legal_basis }))

describe('source_key 읽기', () => {
  it('법령 번호와 조를 뽑는다', () => {
    expect(parseSourceKey('law:011359:제3조')).toEqual({ lawId: '011359', article: '제3조' })
    expect(parseSourceKey('law:011448:제11조의3')).toEqual({ lawId: '011448', article: '제11조의3' })
  })
  it('다른 접두사는 모른다', () => {
    expect(parseSourceKey('page:kfb-vphishing')).toBeNull()
    expect(parseSourceKey('law:011359')).toBeNull()
  })
  it('라벨은 말로', () => {
    expect(sourceLabelOf('law:011359:제3조')).toBe('법 011359 · 통신사기피해환급법')
    expect(sourceLabelOf('law:011448:제3조')).toBe('시행령 011448 · 통신사기피해환급법 시행령')
    expect(sourceLabelOf('page:x')).toBe('page:x')
  })
})

describe('legal_basis 에서 조 번호를 뽑는다', () => {
  it('법 이름이 앞에 붙은 것은 「법」으로 읽고 항·호는 버린다', () => {
    const refs = articleRefsOf('통신사기피해환급법 제3조제1항(피해구제 신청) · 제4조제1항제1호')
    expect(refs).toEqual(new Set(['법 제3조', '법 제4조']))
  })
  it('시행령은 따로 센다', () => {
    const refs = articleRefsOf('시행령 제3조제1항 단서 · 법 제5조제2항')
    expect(refs).toEqual(new Set(['시행령 제3조', '법 제5조']))
  })
  it('「법 제N조」 없이 「제N조」만 이어지면 앞의 법령을 따른다', () => {
    const refs = articleRefsOf('법 제9조제1항 · 제9조제2항 · 제10조제1항 후단')
    expect(refs).toEqual(new Set(['법 제9조', '법 제10조']))
  })
  it('법정 절차가 아닌 항목은 비어 있다', () => {
    expect(articleRefsOf('법정 절차가 아닙니다. 수사 개시와 …').size).toBe(0)
  })
})

describe('닿는 매뉴얼 — 실제 KB 로', () => {
  it('법 제3조는 지급정지 · 피해구제 신청 · 서류 제출 셋에 닿는다', () => {
    expect(linkEntries('law:011359:제3조', ENTRIES)).toEqual([
      'common-freeze-request',
      'common-relief-apply',
      'common-relief-documents',
    ])
  })
  it('법 제7조는 통장묶기 둘에 닿는다', () => {
    expect(linkEntries('law:011359:제7조', ENTRIES)).toEqual(['frozen-objection-file', 'frozen-objection-result'])
  })
  it('시행령 제3조는 서류 제출에 닿고 법 제3조 항목엔 안 닿는다', () => {
    const hit = linkEntries('law:011448:제3조', ENTRIES)
    expect(hit).toContain('common-relief-documents')
    expect(hit).not.toContain('common-freeze-request')
  })
  it('새 조문은 아무 데도 안 닿는다', () => {
    expect(linkEntries('law:011359:제13조의4', ENTRIES)).toEqual([])
  })
  it('기관 페이지는 이 규칙 밖이다', () => {
    expect(linkEntries('page:kfb-vphishing', ENTRIES)).toEqual([])
  })
})
```

> 실제 파일의 `legal_basis` 가 위 기대와 다르면 **시험을 고치지 말고 파일을 읽어 기대를 맞추세요** — 규칙이
> 틀린 것인지 기대가 틀린 것인지를 그때 가립니다. `common-relief-apply` 의 근거가 「시행령 제3조제1항 단서」를
> 함께 적고 있어 시행령 제3조 시험의 `not.toContain` 은 `common-freeze-request` 로 두었습니다.

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run modules/kb-reviewer/link.test.ts`
Expected: FAIL — `./link` 없음

- [ ] **Step 3: 구현**

```ts
// src/modules/kb-reviewer/link.ts
/**
 * 조문 ↔ 매뉴얼 — API §7.4 · ADR-088 ④.
 *
 * `source_key`(`law:011359:제3조`)의 법령 번호와 조를 `kb_entry.legal_basis` 글에서 뽑은
 * 「법 제N조」「시행령 제N조」와 대조합니다. **모델을 쓰지 않습니다** — 규칙이라 시험이 되고,
 * 틀리면 사람이 봅니다. 화면은 「(추정)」을 붙입니다. 항·호는 버립니다 — 스냅샷의 단위가 조입니다(ADR-012).
 * 읽을 때 계산하고 `source_change.impact` 에 쓰지 않습니다 — 저장하면 규칙이 바뀔 때 옛 값이 남습니다.
 */

export const LAWS: Readonly<Record<string, { readonly word: '법' | '시행령'; readonly name: string }>> = {
  '011359': { word: '법', name: '통신사기피해환급법' },
  '011448': { word: '시행령', name: '통신사기피해환급법 시행령' },
}

const SOURCE_KEY = /^law:(\d+):(제\d+조(?:의\d+)?)$/
const ARTICLE = /(법|시행령)?\s*(제\d+조(?:의\d+)?)/g
const NAMED_LAW = /통신사기피해환급법(?!\s*시행령)/g
const NAMED_DECREE = /통신사기피해환급법\s*시행령/g

export function parseSourceKey(sourceKey: string): { lawId: string; article: string } | null {
  const m = SOURCE_KEY.exec(sourceKey)
  return m ? { lawId: m[1]!, article: m[2]! } : null
}

export function sourceLabelOf(sourceKey: string): string {
  const parsed = parseSourceKey(sourceKey)
  const law = parsed ? LAWS[parsed.lawId] : undefined
  if (!parsed || !law) return sourceKey
  return `${law.word} ${parsed.lawId} · ${law.name}`
}

/**
 * 「법 제3조」「시행령 제11조의3」 꼴의 키 집합.
 *
 * 법령 이름이 앞에 붙은 자리(「통신사기피해환급법 제3조」)는 이름을 「법」/「시행령」으로 바꿔 읽고,
 * 「제N조」만 이어지면 **바로 앞에서 마지막으로 나온 법령**을 따릅니다. 아무 법령도 안 나왔으면 「법」입니다.
 */
export function articleRefsOf(legalBasis: string): ReadonlySet<string> {
  const text = legalBasis.replace(NAMED_DECREE, '시행령').replace(NAMED_LAW, '법')
  const refs = new Set<string>()
  let current: '법' | '시행령' = '법'
  for (const m of text.matchAll(ARTICLE)) {
    const word = m[1] as '법' | '시행령' | undefined
    if (word) current = word
    refs.add(`${current} ${m[2]}`)
  }
  return refs
}

export function linkEntries(
  sourceKey: string,
  entries: readonly { readonly kbEntryId: string; readonly legalBasis: string }[],
): readonly string[] {
  const parsed = parseSourceKey(sourceKey)
  const law = parsed ? LAWS[parsed.lawId] : undefined
  if (!parsed || !law) return []
  const wanted = `${law.word} ${parsed.article}`
  return entries.filter((one) => articleRefsOf(one.legalBasis).has(wanted)).map((one) => one.kbEntryId)
}
```

`index.ts` 에 한 줄: `export { articleRefsOf, LAWS, linkEntries, parseSourceKey, sourceLabelOf } from './link'`

- [ ] **Step 4: 통과 확인**

Run: `cd src && npx vitest run modules/kb-reviewer`
Expected: PASS. 실패하면 위 인용문대로 KB 파일의 `legal_basis` 를 읽고 **어느 쪽이 틀렸는지** 적은 뒤 고칩니다.

- [ ] **Step 5: 커밋**

```bash
git add src/modules/kb-reviewer/link.ts src/modules/kb-reviewer/link.test.ts src/modules/kb-reviewer/index.ts
git commit -m "조문과 매뉴얼을 규칙으로 잇는다 — legal_basis 의 「법 제N조」 대조, 모델 없이 (API §7.4)"
```

---

### Task 7: `KbStore.listEntries(kbVersion)`

**Files:**
- Modify: `src/modules/kb-finder/types.ts` — `KbStore` 에 메서드 하나
- Modify: `src/lib/db.ts` — `createKbStore` 에 구현

**Interfaces:**
- Produces: `listEntries(kbVersion: string): Promise<readonly KbRow[]>` — 그 릴리스의 항목 전부, `channel_id, org_id, step_seq` 순.

- [ ] **Step 1: 타입** — `KbStore`:

```ts
export interface KbStore {
  findApplied(query: KbQuery): Promise<readonly KbRow[]>
  findReference(query: KbQuery): Promise<readonly KbRow[]>
  /** 한 릴리스의 항목 전부 — 검수 화면의 매뉴얼 렌즈용 (API §7.3). 시행일로 거르지 않습니다 */
  listEntries(kbVersion: string): Promise<readonly KbRow[]>
}
```

- [ ] **Step 2: 타입 오류 확인**

Run: `cd src && npm run typecheck`
Expected: FAIL — `createKbStore` 반환값에 `listEntries` 없음. (시험 스텁이 `KbStore` 를 통째로 만드는 자리가 있으면 그것도 같이 걸립니다 — 그 스텁에 `listEntries: async () => []` 를 더합니다.)

- [ ] **Step 3: 구현** — `createKbStore` 의 `findReference` 아래:

```ts
    async listEntries(kbVersion: string): Promise<readonly KbRow[]> {
      const rows = await sql<Record<string, unknown>[]>`
        SELECT kb_entry_id, kb_version, step_key, step_seq, channel_id, org_id,
               track, title, body, legal_basis, source_url,
               effective_from, effective_until, verified_at
        FROM kb_entry
        WHERE kb_version = ${kbVersion}
        ORDER BY channel_id NULLS FIRST, org_id NULLS FIRST, step_seq
      `
      return rows.map(toRow)
    },
```

- [ ] **Step 4: 통과 확인**

Run: `cd src && npm run typecheck && npx vitest run modules/kb-finder lib/db`
Expected: PASS. (DB 통합시험이 있으면 `npm run test:db` 로 한 번 — 없으면 Task 13 의 손 확인이 이 쿼리를 봅니다.)

- [ ] **Step 5: 커밋**

```bash
git add src/modules/kb-finder/types.ts src/lib/db.ts
git commit -m "KbStore.listEntries — 한 릴리스의 항목 전부, 검수 화면의 매뉴얼 렌즈용 (API §7.3)"
```

---

### Task 8: 조립과 흐름 — `src/flows/kb-review.ts`

라우트 다섯이 부를 함수 다섯을 흐름 하나에 모읍니다. 라우트는 얇게, 조립은 `container.ts` 가.

**Files:**
- Modify: `src/lib/container.ts` — `Container` 에 `kbChanges` · `kbSnapshots` 둘
- Create: `src/flows/kb-review.ts` · `kb-review.test.ts`

**Interfaces:**
- Consumes: `ChangeStore` · `createSnapshotReader` (`@/lib/db-kb-collect`) · `KbStore.listEntries` (Task 7) · `linkEntries` / `sourceLabelOf` / `parseSourceKey` (Task 6) · `KbChangeNotFoundError` (Task 5).
- Produces (전부 `container: Container` 를 첫 인자로):
  - `readQueue(container, status: 'pending' | 'deferred'): Promise<QueueBody>`
  - `readChange(container, changeId): Promise<ChangeBody>`
  - `decide(container, changeId, input: { status: 'approved' | 'rejected' | 'deferred'; reviewedBy: string; note: string | null }): Promise<DecisionBody>`
  - `readEntries(container): Promise<EntriesBody>`
  - `readHistory(container): Promise<HistoryBody>`
  - 응답 타입은 API §7.3 의 JSON 과 이름이 같습니다(snake_case).

- [ ] **Step 1: 조립** — `Container` 인터페이스에 둘, `createContainer` 반환에 둘:

```ts
  /** 검수 큐 원표 — 검수 화면의 이력·미룸 조회 (API §7). 판단은 kbReviewer 로만 */
  readonly kbChanges: ReturnType<typeof createChangeStore>
  /** 원문 스냅샷 읽기 — 직전/이번 본문 */
  readonly kbSnapshots: ReturnType<typeof createSnapshotReader>
```

```ts
function snapshotReader(env: Env): ReturnType<typeof createSnapshotReader> {
  const sql = createSql(env)
  if (!sql) return unconfigured('SnapshotReader', ['DATABASE_URL'])
  return createSnapshotReader(sql)
}
```

반환 객체에 `kbReviewer` 옆:

```ts
    kbChanges: changeStore(env),
    kbSnapshots: snapshotReader(env),
```

(`createSnapshotReader` import 를 `db-kb-collect` 에서 더합니다.)

- [ ] **Step 2: 실패하는 시험**

```ts
// src/flows/kb-review.test.ts
import { describe, expect, it } from 'vitest'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { KbChangeNotFoundError } from '@/lib/errors'
import type { KbRow } from '@/modules/kb-finder'
import type { SourceChange } from '@/modules/kb-reviewer'
import { decide, readChange, readEntries, readQueue } from './kb-review'

const change = (over: Partial<SourceChange>): SourceChange => ({
  changeId: '01J0000000000000000000000A',
  sourceKey: 'law:011359:제3조',
  snapshotBefore: null,
  snapshotAfter: '01J0000000000000000000000S',
  detectedAt: '2026-09-06T04:00:12+09:00',
  dedupeKey: null,
  impact: null,
  reviewStatus: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  releasedVersion: null,
  ...over,
})

const entry = (id: string, legalBasis: string, over: Partial<KbRow> = {}): KbRow => ({
  kbEntryId: id,
  kbVersion: '2026.09.2',
  stepKey: id,
  stepSeq: 1,
  channelId: null,
  orgId: null,
  track: 'victim',
  title: `제목 ${id}`,
  body: {},
  legalBasis,
  sourceUrl: 'https://example.invalid',
  effectiveFrom: '2024-08-28',
  effectiveUntil: null,
  verifiedAt: '2026-08-25',
  ...over,
})

function wire(changes: SourceChange[], entries: KbRow[]) {
  const store = new Map(changes.map((one) => [one.changeId, one]))
  const base = createContainer(readEnv({ KB_VERSION: '2026.09.2' }))
  return {
    ...base,
    kbChanges: {
      listByStatus: async (status: string) => [...store.values()].filter((one) => one.reviewStatus === status),
      findById: async (id: string) => store.get(id) ?? null,
      applyDecision: async (input: { changeId: string; status: SourceChange['reviewStatus']; reviewedBy: string; reviewedAt: string; note: string | null }) => {
        const found = store.get(input.changeId)!
        store.set(input.changeId, { ...found, reviewStatus: input.status, reviewedBy: input.reviewedBy, reviewedAt: input.reviewedAt, reviewNote: input.note })
      },
      markReleased: async () => undefined,
    },
    kbReviewer: (() => {
      const { createKbReviewer } = require('@/modules/kb-reviewer') as typeof import('@/modules/kb-reviewer')
      return createKbReviewer({
        store: {
          listByStatus: async (status) => [...store.values()].filter((one) => one.reviewStatus === status),
          findById: async (id) => store.get(id) ?? null,
          applyDecision: async (input) => {
            const found = store.get(input.changeId)!
            store.set(input.changeId, { ...found, reviewStatus: input.status, reviewedBy: input.reviewedBy, reviewedAt: input.reviewedAt, reviewNote: input.note })
          },
          markReleased: async () => undefined,
        },
        clock: { now: () => '2026-09-06T17:20:00+09:00' },
      })
    })(),
    kbSnapshots: {
      byIds: async (ids: readonly string[]) =>
        ids.map((id) => ({ snapshotId: id, sourceKey: 'law:011359:제3조', content: '① 피해자는 …', meta: { 시행일자: '20260804', 조문제목: '피해구제의 신청' } })),
    },
    ports: { ...base.ports, kbStore: { ...base.ports.kbStore, listEntries: async () => entries } },
  }
}

const ENTRIES = [
  entry('common-freeze-request', '통신사기피해환급법 제3조제1항 · 제4조제1항제1호'),
  entry('common-relief-documents', '시행령 제3조제1항', { channelId: null }),
  entry('easypay-freeze-request', '통신사기피해환급법 제15조제3항', { channelId: 'CH-easypay' }),
  entry('frozen-objection-file', '통신사기피해환급법 제7조제1항', { track: 'frozen_account' }),
]

describe('큐 — §7.3', () => {
  it('묶음 · 조문 · 최초 수집 · 닿는 매뉴얼을 싣는다', async () => {
    const body = await readQueue(wire([change({})], ENTRIES), 'pending')
    expect(body.kb_version).toBe('2026.09.2')
    expect(body.counts).toEqual({ pending: 1, deferred: 0 })
    const one = body.groups[0]!.changes[0]!
    expect(one.article).toBe('제3조')
    expect(one.title).toBe('피해구제의 신청')
    expect(one.first_seen).toBe(true)
    expect(one.source.label).toBe('법 011359 · 통신사기피해환급법')
    expect(one.affected).toEqual(['common-freeze-request'])
  })
  it('미룬 것은 status=deferred 로 따로 본다', async () => {
    const body = await readQueue(wire([change({ reviewStatus: 'deferred' })], ENTRIES), 'deferred')
    expect(body.groups).toHaveLength(1)
    expect(body.counts).toEqual({ pending: 0, deferred: 1 })
  })
})

describe('변경 하나 — §7.3', () => {
  it('직전은 없고 이번 원문과 닿는 매뉴얼 상세가 온다', async () => {
    const body = await readChange(wire([change({})], ENTRIES), '01J0000000000000000000000A')
    expect(body.before).toBeNull()
    expect(body.after?.content).toBe('① 피해자는 …')
    expect(body.affected[0]).toMatchObject({ kb_entry_id: 'common-freeze-request', file: 'common.json', verified_at: '2026-08-25' })
    expect(body.review.status).toBe('pending')
  })
  it('없으면 404 코드다', async () => {
    await expect(readChange(wire([], ENTRIES), '01J0000000000000000000000Z')).rejects.toBeInstanceOf(KbChangeNotFoundError)
  })
})

describe('판단 — §7.3', () => {
  it('기록하고 시각을 돌려준다', async () => {
    const c = wire([change({})], ENTRIES)
    const body = await decide(c, '01J0000000000000000000000A', { status: 'approved', reviewedBy: '김태현', note: null })
    expect(body).toEqual({ change_id: '01J0000000000000000000000A', review_status: 'approved', reviewed_at: '2026-09-06T17:20:00+09:00' })
  })
})

describe('매뉴얼 렌즈 — §7.3', () => {
  it('파일 이름을 규약에서 계산하고 닿은 미검수 변경을 단다', async () => {
    const body = await readEntries(wire([change({})], ENTRIES))
    const byId = Object.fromEntries(body.entries.map((one) => [one.kb_entry_id, one]))
    expect(byId['common-freeze-request']!.file).toBe('common.json')
    expect(byId['easypay-freeze-request']!.file).toBe('ch-easypay.json')
    expect(byId['frozen-objection-file']!.file).toBe('frozen-account.json')
    expect(byId['common-freeze-request']!.pending_changes).toEqual(['01J0000000000000000000000A'])
    expect(byId['easypay-freeze-request']!.pending_changes).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `cd src && npx vitest run flows/kb-review.test.ts`
Expected: FAIL — `./kb-review` 없음

- [ ] **Step 4: 구현**

```ts
// src/flows/kb-review.ts
/**
 * 검수 큐 흐름 — API §7 · ADR-088. 라우트 다섯이 여기 함수 다섯을 부릅니다.
 *
 * **`kb_entry` 에 쓰는 자리가 없습니다.** 반영은 파일을 고쳐 릴리스하는 것입니다(RFC-002).
 * 닿는 매뉴얼은 읽을 때 규칙으로 계산합니다(§7.4) — `impact` 에 저장하지 않습니다.
 */
import 'server-only'
import type { Container } from '@/lib/container'
import { KbChangeNotFoundError } from '@/lib/errors'
import type { KbRow } from '@/modules/kb-finder'
import { linkEntries, parseSourceKey, sourceLabelOf } from '@/modules/kb-reviewer'
import type { ChangeGroup, ReviewStatus, SourceChange } from '@/modules/kb-reviewer'

export type DecisionStatus = Exclude<ReviewStatus, 'pending'>

export interface ChangeView {
  readonly change_id: string
  readonly source_key: string
  readonly source: { readonly prefix: string; readonly label: string }
  readonly article: string | null
  readonly title: string | null
  readonly first_seen: boolean
  readonly detected_at: string
  readonly meta: Readonly<Record<string, unknown>>
  readonly affected: readonly string[]
  readonly review_status: ReviewStatus
}
export interface ReviewView {
  readonly status: ReviewStatus
  readonly by: string | null
  readonly at: string | null
  readonly note: string | null
  readonly released_version: string | null
}
export interface QueueBody {
  readonly kb_version: string | null
  readonly counts: { readonly pending: number; readonly deferred: number }
  readonly groups: readonly { readonly dedupe_key: string | null; readonly changes: readonly ChangeView[] }[]
}
export interface EntryView {
  readonly kb_entry_id: string
  readonly title: string
  readonly file: string
  readonly track: KbRow['track']
  readonly channel_id: string | null
  readonly org_id: string | null
  readonly legal_basis: string
  readonly effective_from: string
  readonly verified_at: string
  readonly pending_changes: readonly string[]
}
export interface ChangeBody {
  readonly change: ChangeView
  readonly before: { readonly snapshot_id: string; readonly content: string; readonly meta: Readonly<Record<string, unknown>> } | null
  readonly after: { readonly snapshot_id: string; readonly content: string; readonly meta: Readonly<Record<string, unknown>> } | null
  readonly affected: readonly Omit<EntryView, 'pending_changes'>[]
  readonly review: ReviewView
}
export interface DecisionBody {
  readonly change_id: string
  readonly review_status: ReviewStatus
  readonly reviewed_at: string | null
}
export interface EntriesBody {
  readonly kb_version: string | null
  readonly entries: readonly EntryView[]
}
export interface HistoryBody {
  readonly changes: readonly (ChangeView & { readonly review: ReviewView })[]
}

const HISTORY_LIMIT = 200

/** RFC-002 의 파일 규약을 뒤집어 계산합니다 — 저장된 칼럼이 아닙니다 (§7.3) */
export function fileOf(row: Pick<KbRow, 'track' | 'channelId'>): string {
  if (row.track === 'frozen_account') return 'frozen-account.json'
  if (row.channelId) return `${row.channelId.toLowerCase()}.json`
  return 'common.json'
}

async function entriesOf(container: Container): Promise<{ kbVersion: string | null; rows: readonly KbRow[] }> {
  const kbVersion = container.env.values.KB_VERSION ?? null
  if (!kbVersion) return { kbVersion: null, rows: [] }
  return { kbVersion, rows: await container.ports.kbStore.listEntries(kbVersion) }
}

function affectedOf(sourceKey: string, rows: readonly KbRow[]): readonly string[] {
  return linkEntries(sourceKey, rows)
}

function reviewOf(one: SourceChange): ReviewView {
  return { status: one.reviewStatus, by: one.reviewedBy, at: one.reviewedAt, note: one.reviewNote, released_version: one.releasedVersion }
}

async function viewsOf(
  container: Container,
  changes: readonly SourceChange[],
  rows: readonly KbRow[],
): Promise<readonly ChangeView[]> {
  const snaps = await container.kbSnapshots.byIds(changes.map((one) => one.snapshotAfter))
  const metaOf = new Map(snaps.map((one) => [one.snapshotId, one.meta]))
  return changes.map((one) => {
    const parsed = parseSourceKey(one.sourceKey)
    const meta = metaOf.get(one.snapshotAfter) ?? {}
    const title = typeof meta['조문제목'] === 'string' ? (meta['조문제목'] as string) : null
    return {
      change_id: one.changeId,
      source_key: one.sourceKey,
      source: { prefix: parsed ? `law:${parsed.lawId}` : one.sourceKey.split(':').slice(0, 2).join(':'), label: sourceLabelOf(one.sourceKey) },
      article: parsed?.article ?? null,
      title,
      first_seen: one.snapshotBefore === null,
      detected_at: one.detectedAt,
      meta,
      affected: affectedOf(one.sourceKey, rows),
      review_status: one.reviewStatus,
    }
  })
}

export async function readQueue(container: Container, status: 'pending' | 'deferred'): Promise<QueueBody> {
  const { kbVersion, rows } = await entriesOf(container)
  const [pending, deferred] = await Promise.all([
    container.kbChanges.listByStatus('pending'),
    container.kbChanges.listByStatus('deferred'),
  ])
  // pending 은 kbReviewer.queue() 의 묶음을 그대로, deferred 는 낱개로 — 미룬 것은 큐가 아닙니다(ADR-044)
  const groups: ChangeGroup[] =
    status === 'pending'
      ? [...(await container.kbReviewer.queue())]
      : deferred.map((one) => ({ dedupeKey: one.dedupeKey, changes: [one], confidence: null, affectedEntries: [] }))
  const made = await Promise.all(
    groups.map(async (group) => ({ dedupe_key: group.dedupeKey, changes: await viewsOf(container, group.changes, rows) })),
  )
  return { kb_version: kbVersion, counts: { pending: pending.length, deferred: deferred.length }, groups: made }
}

export async function readChange(container: Container, changeId: string): Promise<ChangeBody> {
  const found = await container.kbChanges.findById(changeId)
  if (!found) throw new KbChangeNotFoundError('그 변경을 찾지 못했습니다', { changeId })
  const { rows } = await entriesOf(container)
  const ids = [found.snapshotAfter, ...(found.snapshotBefore ? [found.snapshotBefore] : [])]
  const snaps = await container.kbSnapshots.byIds(ids)
  const snap = (id: string | null) => {
    const hit = id ? snaps.find((one) => one.snapshotId === id) : undefined
    return hit ? { snapshot_id: hit.snapshotId, content: hit.content, meta: hit.meta } : null
  }
  const [view] = await viewsOf(container, [found], rows)
  const affectedIds = new Set(view!.affected)
  return {
    change: view!,
    before: snap(found.snapshotBefore),
    after: snap(found.snapshotAfter),
    affected: rows.filter((row) => affectedIds.has(row.kbEntryId)).map((row) => entryViewOf(row)),
    review: reviewOf(found),
  }
}

export async function decide(
  container: Container,
  changeId: string,
  input: { status: DecisionStatus; reviewedBy: string; note: string | null },
): Promise<DecisionBody> {
  await container.kbReviewer.review({ changeId, status: input.status, reviewedBy: input.reviewedBy, ...(input.note ? { note: input.note } : {}) })
  const after = await container.kbChanges.findById(changeId)
  if (!after) throw new KbChangeNotFoundError('그 변경을 찾지 못했습니다', { changeId })
  return { change_id: changeId, review_status: after.reviewStatus, reviewed_at: after.reviewedAt }
}

function entryViewOf(row: KbRow): Omit<EntryView, 'pending_changes'> {
  return {
    kb_entry_id: row.kbEntryId,
    title: row.title,
    file: fileOf(row),
    track: row.track,
    channel_id: row.channelId,
    org_id: row.orgId,
    legal_basis: row.legalBasis,
    effective_from: row.effectiveFrom,
    verified_at: row.verifiedAt,
  }
}

export async function readEntries(container: Container): Promise<EntriesBody> {
  const { kbVersion, rows } = await entriesOf(container)
  const pending = await container.kbChanges.listByStatus('pending')
  const touching = new Map<string, string[]>()
  for (const one of pending) {
    for (const id of affectedOf(one.sourceKey, rows)) {
      const list = touching.get(id) ?? []
      list.push(one.changeId)
      touching.set(id, list)
    }
  }
  return {
    kb_version: kbVersion,
    entries: rows.map((row) => ({ ...entryViewOf(row), pending_changes: touching.get(row.kbEntryId) ?? [] })),
  }
}

export async function readHistory(container: Container): Promise<HistoryBody> {
  const { rows } = await entriesOf(container)
  const [approved, rejected, deferred] = await Promise.all([
    container.kbChanges.listByStatus('approved'),
    container.kbChanges.listByStatus('rejected'),
    container.kbChanges.listByStatus('deferred'),
  ])
  const all = [...approved, ...rejected, ...deferred]
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
    .slice(0, HISTORY_LIMIT)
  const views = await viewsOf(container, all, rows)
  return { changes: views.map((view, i) => ({ ...view, review: reviewOf(all[i]!) })) }
}
```

> `KbRow` 가 `@/modules/kb-finder` 에서 export 되지 않으면 `index.ts` 에 `export type { KbRow, KbStore } from './types'` 를 더합니다.

- [ ] **Step 5: 통과 확인**

Run: `cd src && npx vitest run flows/kb-review.test.ts && npm run typecheck`
Expected: PASS (7) · 타입 오류 0. `require` 가 ESM 에서 걸리면 시험 머리에 `import { createKbReviewer } from '@/modules/kb-reviewer'` 로 바꿉니다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/container.ts src/flows/kb-review.ts src/flows/kb-review.test.ts
git commit -m "검수 큐 흐름 다섯 — 큐·변경·판단·매뉴얼 렌즈·이력, 닿는 매뉴얼은 읽을 때 규칙으로 (API §7.3)"
```

---

### Task 9: 라우트 다섯 — `/api/admin/kb/*`

**Files:**
- Create: `src/app/api/admin/kb/queue/route.ts` · `route.test.ts`
- Create: `src/app/api/admin/kb/changes/[change_id]/route.ts` · `route.test.ts`
- Create: `src/app/api/admin/kb/changes/[change_id]/decision/route.ts` · `route.test.ts`
- Create: `src/app/api/admin/kb/entries/route.ts` · `src/app/api/admin/kb/history/route.ts` (+ 시험 하나에 같이)
- Modify: `.github/scripts/route-contract.py` — `GUARDED_SEGMENTS` 에 `"change_id": ("ulidParamOf",)`

**Interfaces:**
- Consumes: Task 8 의 다섯 함수 · `ulidParamOf` · `BadRequestError`.
- Produces: §7.2 의 경로 다섯. GET 은 `rate` 생략(기본 `read` — 관리자 경로라 껍데기가 건너뜀), POST 는 `rate: 'none'` 을 밝힘.

- [ ] **Step 1: 실패하는 시험 — 큐** (쿠키가 있어야 200 · 없으면 401)

```ts
// src/app/api/admin/kb/queue/route.test.ts
import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import type { QueueBody } from '@/flows/kb-review'
import { GET } from './route'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))
vi.mock('@/flows/kb-review', () => ({
  readQueue: async (_c: unknown, status: string) => EMPTY(status),
}))

const EMPTY = (status: string): QueueBody => ({ kb_version: '2026.09.2', counts: { pending: 0, deferred: 0 }, groups: [], ...(status === 'deferred' ? {} : {}) })
const env = readEnv({ ADMIN_PASSWORD_HASH: hashPassword('pw-pw-pw-pw-pw') })

function ask(query = '', withCookie = true) {
  const session = issueAdminSession(env, serverClock.nowMs())!
  return new Request(`http://x/api/admin/kb/queue${query}`, {
    headers: withCookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` } : {},
  })
}

describe('큐 — §7.2', () => {
  it('세션이 없으면 401', async () => {
    holder.container = createContainer(env)
    expect((await GET(ask('', false))).status).toBe(401)
  })
  it('기본은 pending', async () => {
    holder.container = createContainer(env)
    const res = await GET(ask())
    expect(res.status).toBe(200)
    expect((await res.json()).kb_version).toBe('2026.09.2')
  })
  it('status 가 셋 밖이면 400', async () => {
    holder.container = createContainer(env)
    expect((await GET(ask('?status=approved'))).status).toBe(400)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run app/api/admin/kb/queue`
Expected: FAIL — 라우트 없음

- [ ] **Step 3: 구현 — 다섯**

```ts
// src/app/api/admin/kb/queue/route.ts
/** 검수 큐 — API §7.2 · §7.3. 문지기 뒤(§5.1) — 인증은 껍데기가 봅니다 */
import { readQueue } from '@/flows/kb-review'
import { BadRequestError } from '@/lib/errors'
import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(request, async (ctx) => {
    const status = new URL(ctx.request.url).searchParams.get('status') ?? 'pending'
    if (status !== 'pending' && status !== 'deferred') {
      throw new BadRequestError('status 는 pending 또는 deferred 입니다', { param: 'status' })
    }
    return { body: await readQueue(ctx.container, status) }
  })
}
```

```ts
// src/app/api/admin/kb/changes/[change_id]/route.ts
/** 변경 하나 — §7.3. `change_id` 는 ULID 라 전용 헬퍼로만 읽습니다 */
import { readChange } from '@/flows/kb-review'
import { handleRoute, ulidParamOf } from '@/lib/request'

export async function GET(request: Request, route: { params: Promise<{ change_id: string }> }) {
  return handleRoute(request, async (ctx) => {
    const changeId = await ulidParamOf(route, 'change_id')
    return { body: await readChange(ctx.container, changeId) }
  })
}
```

```ts
// src/app/api/admin/kb/changes/[change_id]/decision/route.ts
/**
 * 판단 — §7.3. 승인은 「봤고 반영해도 된다」는 표시이고 매뉴얼에 자동 반영되지 않습니다(RFC-002).
 * 이미 승인·거절된 건은 409(`KB_CHANGE_DECIDED`) — 검수 이력을 덮지 않습니다(ADR-044).
 */
import { decide, type DecisionStatus } from '@/flows/kb-review'
import { BadRequestError } from '@/lib/errors'
import { handleRoute, ulidParamOf } from '@/lib/request'

const STATUSES: readonly DecisionStatus[] = ['approved', 'rejected', 'deferred']

export async function POST(request: Request, route: { params: Promise<{ change_id: string }> }) {
  return handleRoute(
    request,
    async (ctx) => {
      const changeId = await ulidParamOf(route, 'change_id')
      const body = (await ctx.request.json().catch(() => null)) as
        | { status?: unknown; reviewed_by?: unknown; note?: unknown }
        | null
      const status = body?.status
      if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
        throw new BadRequestError('status 는 approved · rejected · deferred 중 하나입니다', { param: 'status' })
      }
      const reviewedBy = typeof body?.reviewed_by === 'string' ? body.reviewed_by.trim() : ''
      if (reviewedBy.length === 0) throw new BadRequestError('reviewed_by 가 비었습니다', { param: 'reviewed_by' })
      const note = typeof body?.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null
      return { body: await decide(ctx.container, changeId, { status: status as DecisionStatus, reviewedBy, note }) }
    },
    // 관리자 경로는 제한하지 않습니다(§1.3) — 검사기(R3)에 밝히는 것입니다
    { rate: 'none' },
  )
}
```

```ts
// src/app/api/admin/kb/entries/route.ts
/** 매뉴얼 렌즈 — §7.3. `KB_VERSION` 의 항목 전부와 닿은 미검수 변경 */
import { readEntries } from '@/flows/kb-review'
import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(request, async (ctx) => ({ body: await readEntries(ctx.container) }))
}
```

```ts
// src/app/api/admin/kb/history/route.ts
/** 판단 이력 — §7.3. 최신순 200건 */
import { readHistory } from '@/flows/kb-review'
import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(request, async (ctx) => ({ body: await readHistory(ctx.container) }))
}
```

- [ ] **Step 4: 시험 — 변경·판단**

```ts
// src/app/api/admin/kb/changes/[change_id]/decision/route.test.ts
import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { KbChangeDecidedError } from '@/lib/errors'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import { POST } from './route'

const holder = vi.hoisted(() => ({ container: undefined as unknown, decided: [] as unknown[] }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))
vi.mock('@/flows/kb-review', () => ({
  decide: async (_c: unknown, changeId: string, input: { status: string }) => {
    if (changeId === '01J0000000000000000000000D') throw new KbChangeDecidedError('이미 판단이 끝난 변경입니다', { changeId })
    holder.decided.push(input)
    return { change_id: changeId, review_status: input.status, reviewed_at: '2026-09-06T17:20:00+09:00' }
  },
}))

const env = readEnv({ ADMIN_PASSWORD_HASH: hashPassword('pw-pw-pw-pw-pw') })
const ID = '01J0000000000000000000000A'

function ask(id: string, body: unknown) {
  const session = issueAdminSession(env, serverClock.nowMs())!
  return POST(
    new Request(`http://x/api/admin/kb/changes/${id}/decision`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ change_id: id }) },
  )
}

describe('판단 — §7.3', () => {
  it('기록하고 시각을 돌려준다', async () => {
    holder.container = createContainer(env)
    const res = await ask(ID, { status: 'approved', reviewed_by: '김태현', note: '' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ change_id: ID, review_status: 'approved', reviewed_at: '2026-09-06T17:20:00+09:00' })
  })
  it('이미 판단된 건은 409', async () => {
    holder.container = createContainer(env)
    const res = await ask('01J0000000000000000000000D', { status: 'rejected', reviewed_by: '김태현' })
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('KB_CHANGE_DECIDED')
  })
  it('검수자가 비면 400 · status 가 셋 밖이면 400 · ULID 가 아니면 400', async () => {
    holder.container = createContainer(env)
    expect((await ask(ID, { status: 'approved', reviewed_by: ' ' })).status).toBe(400)
    expect((await ask(ID, { status: 'released', reviewed_by: '김태현' })).status).toBe(400)
    expect((await ask('not-a-ulid', { status: 'approved', reviewed_by: '김태현' })).status).toBe(400)
  })
})
```

`changes/[change_id]/route.test.ts` 는 같은 틀로 둘만: 세션 없으면 401 · `readChange` 스텁이 돌려준 본문이 그대로 200.
`entries` · `history` 는 `queue/route.test.ts` 와 같은 틀로 「세션 없으면 401 · 있으면 200」 하나씩.

- [ ] **Step 5: 검사기에 세그먼트 등록** — `.github/scripts/route-contract.py` 의 `GUARDED_SEGMENTS`:

```python
    "message_id": ("ulidParamOf",),
    # 검수 큐의 변경 — ULID. 관리자 화면(S-12)만 씁니다 → API §7.2 · ADR-088
    "change_id": ("ulidParamOf",),
```

- [ ] **Step 6: 통과 확인 + 검사기 넷**

Run:
```bash
cd src && npx vitest run app/api/admin && npm run typecheck && npm run lint
cd .. && python .github/scripts/route-contract.py && python .github/scripts/schema-names.py && bash .github/scripts/gates.sh
```
Expected: PASS · 위반 0 · gates 통과.

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/admin/kb .github/scripts/route-contract.py
git commit -m "검수 큐 라우트 다섯 — 큐·변경·판단·매뉴얼 렌즈·이력, 전부 문지기 뒤 (API §7.2)"
```

---

### Task 10: 클라이언트 모듈 — `load.ts` · `state.ts`

**Files:**
- Create: `src/app/admin/kb/load.ts`
- Create: `src/app/admin/kb/state.ts` · `state.test.ts`

**Interfaces:**
- Consumes: API §7.3 의 JSON 모양 (Task 8 의 `QueueBody` · `ChangeBody` · `EntriesBody` · `HistoryBody` · `DecisionBody` 를 **타입만** 가져옵니다 — `import type` 이라 서버 코드가 번들에 들어가지 않습니다).
- Produces (`load.ts`): `fetchQueue(status)` · `fetchChange(id)` · `fetchEntries()` · `fetchHistory()` · `postDecision(id, {status, reviewed_by, note})` · `login(password)` · `logout()` — 전부 `Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }>`.
- Produces (`state.ts`): `Lens` · `Selection` · `Filter` · `ReviewState` · `reduce(state, action)` · `initialState` · `nextPendingAfter(groups, changeId)`.

- [ ] **Step 1: 실패하는 시험 — 상태**

```ts
// src/app/admin/kb/state.test.ts
import { describe, expect, it } from 'vitest'
import { initialState, nextPendingAfter, reduce } from './state'
import type { QueueBody } from '@/flows/kb-review'

const view = (id: string, affected: string[] = []) => ({
  change_id: id, source_key: 'law:011359:제3조', source: { prefix: 'law:011359', label: '법' }, article: '제3조',
  title: null, first_seen: true, detected_at: '2026-09-06T04:00:00+09:00', meta: {}, affected, review_status: 'pending' as const,
})
const QUEUE: QueueBody = { kb_version: '2026.09.2', counts: { pending: 2, deferred: 0 }, groups: [{ dedupe_key: null, changes: [view('A', ['e1']), view('B')] }] }

describe('렌즈와 선택 — S-12', () => {
  it('처음은 조문 기준 · 아무것도 안 고름', () => {
    expect(initialState.lens).toBe('article')
    expect(initialState.selected).toBeNull()
  })
  it('조문을 고르면 그 조문이 선택된다', () => {
    const s = reduce(initialState, { type: 'pick-change', changeId: 'A' })
    expect(s.selected).toEqual({ changeId: 'A' })
    expect(s.lens).toBe('article')
  })
  it('닿는 매뉴얼을 누르면 렌즈가 매뉴얼로 바뀌고 그 항목이 선택된다', () => {
    const s = reduce(reduce(initialState, { type: 'pick-change', changeId: 'A' }), { type: 'pick-entry', kbEntryId: 'e1' })
    expect(s.lens).toBe('entry')
    expect(s.selected).toEqual({ kbEntryId: 'e1' })
  })
  it('매뉴얼 상세의 조문을 누르면 조문 기준으로 돌아온다', () => {
    const s = reduce({ ...initialState, lens: 'entry', selected: { kbEntryId: 'e1' } }, { type: 'pick-change', changeId: 'A' })
    expect(s.lens).toBe('article')
    expect(s.selected).toEqual({ changeId: 'A' })
  })
  it('렌즈만 바꾸면 선택은 비운다', () => {
    const s = reduce(reduce(initialState, { type: 'pick-change', changeId: 'A' }), { type: 'set-lens', lens: 'entry' })
    expect(s.selected).toBeNull()
  })
  it('필터를 바꿔도 선택은 남는다', () => {
    const s = reduce(reduce(initialState, { type: 'pick-change', changeId: 'A' }), { type: 'set-filter', filter: 'first' })
    expect(s.filter).toBe('first')
    expect(s.selected).toEqual({ changeId: 'A' })
  })
})

describe('판단 뒤 다음 건', () => {
  it('목록 순서에서 바로 다음 pending', () => {
    expect(nextPendingAfter(QUEUE.groups, 'A')).toBe('B')
  })
  it('마지막이면 null', () => {
    expect(nextPendingAfter(QUEUE.groups, 'B')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run app/admin/kb/state.test.ts`
Expected: FAIL — `./state` 없음

- [ ] **Step 3: 구현 — 상태**

```ts
// src/app/admin/kb/state.ts
/**
 * S-12 의 상태 — 렌즈 · 선택 · 필터. 순수 리듀서 하나입니다 (화면 설계 S-12).
 * 두 렌즈는 같은 두 응답(큐 · 매뉴얼)을 재조합할 뿐이라 여기에 데이터를 두지 않습니다.
 */
import type { QueueBody } from '@/flows/kb-review'

export type Lens = 'article' | 'entry'
export type Filter = 'all' | 'first' | 'changed' | 'deferred' | 'page'
export type Selection = { readonly changeId: string } | { readonly kbEntryId: string } | null

export interface ReviewState {
  readonly lens: Lens
  readonly selected: Selection
  readonly filter: Filter
}

export type Action =
  | { readonly type: 'set-lens'; readonly lens: Lens }
  | { readonly type: 'set-filter'; readonly filter: Filter }
  | { readonly type: 'pick-change'; readonly changeId: string }
  | { readonly type: 'pick-entry'; readonly kbEntryId: string }
  | { readonly type: 'clear' }

export const initialState: ReviewState = { lens: 'article', selected: null, filter: 'all' }

export function reduce(state: ReviewState, action: Action): ReviewState {
  switch (action.type) {
    case 'set-lens':
      return state.lens === action.lens ? state : { ...state, lens: action.lens, selected: null }
    case 'set-filter':
      return { ...state, filter: action.filter }
    case 'pick-change':
      // 조문을 고르면 렌즈도 조문 기준 — 매뉴얼 상세의 조문 행에서 넘어오는 길입니다
      return { ...state, lens: 'article', selected: { changeId: action.changeId } }
    case 'pick-entry':
      return { ...state, lens: 'entry', selected: { kbEntryId: action.kbEntryId } }
    case 'clear':
      return { ...state, selected: null }
  }
}

/** 판단 뒤 초점을 옮길 다음 건 — 목록 순서에서 바로 다음 pending. 없으면 null */
export function nextPendingAfter(groups: QueueBody['groups'], changeId: string): string | null {
  const flat = groups.flatMap((group) => group.changes)
  const at = flat.findIndex((one) => one.change_id === changeId)
  const next = flat.slice(at + 1).find((one) => one.review_status === 'pending')
  return next?.change_id ?? null
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd src && npx vitest run app/admin/kb/state.test.ts`
Expected: PASS (8)

- [ ] **Step 5: `load.ts`** — fetch 하는 유일한 자리. 사건 화면의 `load.ts` 와 같은 자세(스스로 다시 부르지 않음).

```ts
// src/app/admin/kb/load.ts
"use client";
/**
 * S-12 가 서버와 말하는 유일한 자리 — API §7. 401 이면 화면이 로그인 카드로 돌아갑니다.
 * **스스로 다시 부르지 않습니다** — 실패는 메시지로 돌려주고, 누르는 것은 사람입니다(에러 §3.1).
 */
import type { ChangeBody, DecisionBody, DecisionStatus, EntriesBody, HistoryBody, QueueBody } from "@/flows/kb-review";

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string };

const UNREACHABLE = "서버에 닿지 못했습니다. 연결을 확인해 주세요.";

async function call<T>(url: string, init: RequestInit = {}): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } });
  } catch {
    return { ok: false, status: 0, code: null, message: UNREACHABLE };
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* 본문이 JSON 이 아니어도 상태 코드로 판정합니다 */
    }
    return { ok: false, status: res.status, code: body.error?.code ?? null, message: body.error?.message ?? "요청에 실패했습니다." };
  }
  return { ok: true, data: (await res.json()) as T };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchQueue = (status: "pending" | "deferred") => call<QueueBody>(`/api/admin/kb/queue?status=${status}`);
export const fetchChange = (changeId: string) => call<ChangeBody>(`/api/admin/kb/changes/${changeId}`);
export const fetchEntries = () => call<EntriesBody>("/api/admin/kb/entries");
export const fetchHistory = () => call<HistoryBody>("/api/admin/kb/history");
export const postDecision = (changeId: string, input: { status: DecisionStatus; reviewed_by: string; note: string | null }) =>
  call<DecisionBody>(`/api/admin/kb/changes/${changeId}/decision`, json(input));
export const login = (password: string) => call<{ ok: true }>("/api/admin-login", json({ password }));
export const logout = () => call<{ ok: true }>("/api/admin/logout", { method: "POST" });

/** 검수자 이름 — 브라우저에만 둡니다(S-12 「문」). 쿠키엔 넣지 않습니다(§5.1) */
const NAME_KEY = "fin-ally.admin.reviewer";
export function rememberedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 저장 못 해도 이번 세션은 상태에 있습니다 */
  }
}
```

- [ ] **Step 6: 타입 확인**

Run: `cd src && npm run typecheck && npm run lint`
Expected: 오류 0. `import type` 만이라 `server-only` 가 브라우저 번들에 안 들어갑니다 — `next build` 가 Task 11 끝에서 확인합니다.

- [ ] **Step 7: 커밋**

```bash
git add src/app/admin/kb/load.ts src/app/admin/kb/state.ts src/app/admin/kb/state.test.ts
git commit -m "S-12 클라이언트 모듈 — fetch 하는 자리 하나와 렌즈·선택 리듀서 (화면 설계 S-12)"
```

---

### Task 11: 화면 — `/admin/kb`

시안은 `assets/artifacts/handoff/09-06-s12-kb-review/Main.dc.html`. 값은 사건 화면과 같습니다 — 헤더 56px · `bg-stage` · `border-hairline`,
칩 `rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px]`, 알약 내비 `min-h-[var(--size-touch)]`,
행 `rounded-[11px] border border-hairline bg-surface px-[11px] py-[9px] shadow-[0_1px_0_oklch(1_0_0/7%)_inset,0_8px_20px_-10px_oklch(0_0_0/65%)]`,
활성 행 `border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/9%)]`, 패널 `rounded-[18px] bg-stage`,
눈썹 `text-[12.5px] font-[620] tracking-[0.13em] text-ink-4`, 토큰 칩 `rounded-[6px] border-[oklch(0.697_0.16_258.2/36%)] bg-pii-bg text-pii`.

**Files:**
- Create: `src/app/admin/kb/page.tsx` — 셸. 로그인 · 데이터 · 렌즈 상태를 들고 `queue.tsx` · `detail.tsx` 를 그림
- Create: `src/app/admin/kb/login.tsx` — 로그인 카드 (이름 · 비밀번호)
- Create: `src/app/admin/kb/queue.tsx` — 왼쪽 목록 (두 렌즈 · 필터)
- Create: `src/app/admin/kb/detail.tsx` — 오른쪽 상세 (조문 상세 · 매뉴얼 상세 · 판단)
- Create: `src/app/admin/kb/page.test.tsx`

**Interfaces:**
- Consumes: Task 10 전부 · `Icon`(`@/components/ui/Icon` — `check-c` · `x` · `clock` · `chevron` · `external`).
- Produces: `export function LoginCard(props: { name: string; onSubmit(name: string, password: string): void; busy: boolean; message: string | null })`,
  `export function QueueList(props: { state: ReviewState; queue: QueueBody; entries: EntriesBody; dispatch(a: Action): void })`,
  `export function ChangeDetail(props: { change: ChangeBody | null; loading: boolean; onPickEntry(id: string): void; onDecide(status: DecisionStatus, note: string): void; busy: boolean; message: string | null; nextTitle: string | null })`,
  `export function EntryDetail(props: { entry: EntryView; changes: readonly ChangeView[]; onPickChange(id: string): void })`.
  `export default function AdminKbPage()`.

- [ ] **Step 1: 실패하는 시험** — 정적 렌더만 봅니다 (`react-dom/server`).

```tsx
// src/app/admin/kb/page.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChangeBody, QueueBody, EntriesBody } from "@/flows/kb-review";
import { ChangeDetail, LoginCard, QueueList } from "./page";
import { initialState } from "./state";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const view = (id: string, article: string, affected: string[] = []) => ({
  change_id: id, source_key: `law:011359:${article}`, source: { prefix: "law:011359", label: "법 011359 · 통신사기피해환급법" },
  article, title: null, first_seen: true, detected_at: "2026-09-06T04:00:12+09:00", meta: { 시행일자: "20260804" }, affected, review_status: "pending" as const,
});
const QUEUE: QueueBody = { kb_version: "2026.09.2", counts: { pending: 2, deferred: 0 }, groups: [{ dedupe_key: null, changes: [view("A", "제3조", ["common-freeze-request"]), view("B", "제13조의4")] }] };
const ENTRIES: EntriesBody = { kb_version: "2026.09.2", entries: [{ kb_entry_id: "common-freeze-request", title: "돈이 빠져나간 금융회사에 지급정지를 요청합니다", file: "common.json", track: "victim", channel_id: null, org_id: null, legal_basis: "법 제3조", effective_from: "2024-08-28", verified_at: "2026-08-25", pending_changes: ["A"] }] };
const CHANGE: ChangeBody = {
  change: QUEUE.groups[0]!.changes[0]!,
  before: null,
  after: { snapshot_id: "S", content: "① 피해자는 피해금을 …", meta: {} },
  affected: [{ ...ENTRIES.entries[0]! }],
  review: { status: "pending", by: null, at: null, note: null, released_version: null },
};

describe("로그인 카드 — 401 이면 본문 자리에", () => {
  it("이름과 비밀번호 칸이 있고 이유를 말하지 않는다", () => {
    const html = renderToStaticMarkup(<LoginCard name="" onSubmit={() => {}} busy={false} message={null} />);
    expect(html).toContain('type="password"');
    expect(textOf(html)).toContain("검수자 이름");
  });
});

describe("목록 — 두 렌즈", () => {
  it("조문 기준은 조문을, 매뉴얼 기준은 항목을 줄 세운다", () => {
    const article = textOf(renderToStaticMarkup(<QueueList state={initialState} queue={QUEUE} entries={ENTRIES} dispatch={() => {}} />));
    expect(article).toContain("제3조");
    expect(article).toContain("새 조문");
    const entry = textOf(renderToStaticMarkup(<QueueList state={{ ...initialState, lens: "entry" }} queue={QUEUE} entries={ENTRIES} dispatch={() => {}} />));
    expect(entry).toContain("지급정지를 요청합니다");
  });
});

describe("상세 — 판단 단추", () => {
  it("승인 단추는 「승인」이고 어느 단추에도 「반영」이 없다 — RFC-002", () => {
    const html = renderToStaticMarkup(<ChangeDetail change={CHANGE} loading={false} onPickEntry={() => {}} onDecide={() => {}} busy={false} message={null} nextTitle="제4조" />);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]!));
    expect(buttons).toContain("승인");
    expect(buttons.some((label) => label.includes("반영"))).toBe(false);
    expect(textOf(html)).toContain("자동 반영되지 않습니다");
  });
  it("최초 수집은 직전이 없다고 말하고 닿는 매뉴얼에 (추정) 을 붙인다", () => {
    const text = textOf(renderToStaticMarkup(<ChangeDetail change={CHANGE} loading={false} onPickEntry={() => {}} onDecide={() => {}} busy={false} message={null} nextTitle={null} />));
    expect(text).toContain("직전 원문이 없습니다");
    expect(text).toContain("닿는 매뉴얼(추정)");
    expect(text).toContain("common-freeze-request");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd src && npx vitest run app/admin/kb/page.test.tsx`
Expected: FAIL — `./page` 없음

- [ ] **Step 3: 구현 — `login.tsx`**

```tsx
// src/app/admin/kb/login.tsx
"use client";
import { useState } from "react";

/** 로그인 카드 — S-12 「문」. 401 이면 본문 자리에 뜹니다. 이유는 말하지 않습니다(§7.1) */
export function LoginCard({ name, onSubmit, busy, message }: { name: string; onSubmit(name: string, password: string): void; busy: boolean; message: string | null }) {
  const [who, setWho] = useState(name);
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(who.trim(), password);
      }}
      className="mx-auto mt-[10vh] flex w-full max-w-[420px] flex-col gap-3 rounded-[18px] bg-stage p-6 shadow-[0_1px_0_oklch(1_0_0/6%)_inset,0_16px_40px_-18px_oklch(0_0_0/70%)]"
    >
      <span className="text-[12.5px] font-[620] tracking-[0.13em] text-ink-4">KB 검수</span>
      <h1 className="text-[20px] font-[640] leading-[1.6] text-ink-1">팀만 들어오는 문입니다</h1>
      <label className="flex flex-col gap-1 text-[13px] text-ink-3">
        검수자 이름
        <input value={who} onChange={(e) => setWho(e.target.value)} required className="min-h-[var(--size-touch)] rounded-[11px] border border-hairline bg-surface-low px-[14px] text-[14.5px] text-ink-1" />
      </label>
      <label className="flex flex-col gap-1 text-[13px] text-ink-3">
        비밀번호
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" className="min-h-[var(--size-touch)] rounded-[11px] border border-hairline bg-surface-low px-[14px] text-[14.5px] text-ink-1" />
      </label>
      {message && (
        <p role="alert" className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2.5 text-[13px] text-ink-1">{message}</p>
      )}
      <button type="submit" disabled={busy} className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink-1 px-[18px] text-[13.5px] font-[620] text-ground disabled:opacity-40">
        들어가기
      </button>
    </form>
  );
}
```

- [ ] **Step 4: 구현 — `queue.tsx`**

```tsx
// src/app/admin/kb/queue.tsx
"use client";
import type { EntriesBody, QueueBody } from "@/flows/kb-review";
import type { Action, Filter, Lens, ReviewState } from "./state";

const ROW = "flex w-full items-center gap-2.5 rounded-[11px] border px-[11px] py-[9px] text-left transition-colors duration-200 shadow-[0_1px_0_oklch(1_0_0/7%)_inset,0_8px_20px_-10px_oklch(0_0_0/65%)]";
const ON = "border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/9%)]";
const OFF = "border-hairline bg-surface hover:border-[oklch(1_0_0/22%)]";
const BADGE = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-chip px-[9px] py-px text-[12.5px] text-ink-3";

const FILTERS: readonly [Filter, string][] = [["all", "전체"], ["first", "최초 수집"], ["changed", "변경"], ["deferred", "미룸"], ["page", "기관 페이지"]];

function keep(filter: Filter, one: QueueBody["groups"][number]["changes"][number]): boolean {
  if (filter === "all") return true;
  if (filter === "first") return one.first_seen;
  if (filter === "changed") return !one.first_seen;
  if (filter === "deferred") return one.review_status === "deferred";
  return one.source_key.startsWith("page:");
}

export function QueueList({ state, queue, entries, dispatch }: { state: ReviewState; queue: QueueBody; entries: EntriesBody; dispatch(a: Action): void }) {
  const flat = queue.groups.flatMap((g) => g.changes);
  const touched = entries.entries.filter((e) => e.pending_changes.length > 0);
  const quiet = entries.entries.filter((e) => e.pending_changes.length === 0);
  const lens = (id: Lens, label: string, count: number) => (
    <button type="button" onClick={() => dispatch({ type: "set-lens", lens: id })} aria-current={state.lens === id ? "page" : undefined}
      className={`inline-flex min-h-[var(--size-touch)] items-center gap-1.5 rounded-full px-3 text-[13px] ${state.lens === id ? "bg-[oklch(1_0_0/12%)] font-[620] text-ink-1" : "text-ink-3 hover:text-ink-1"}`}>
      {label} <span data-numeric className="text-ink-4">{count}</span>
    </button>
  );
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <nav aria-label="렌즈" className="inline-flex self-start items-center gap-0.5 rounded-full border border-hairline bg-chip p-0.5">
        {lens("article", "조문 기준", flat.length)}
        {lens("entry", "매뉴얼 기준", touched.length)}
      </nav>
      {state.lens === "article" ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([id, label]) => (
              <button key={id} type="button" onClick={() => dispatch({ type: "set-filter", filter: id })}
                className={`inline-flex min-h-[var(--size-touch)] items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] ${state.filter === id ? "border-[oklch(1_0_0/25%)] font-[620] text-ink-1" : "border-hairline text-ink-3"} bg-chip`}>
                {label} <span data-numeric>{flat.filter((one) => keep(id, one)).length}</span>
              </button>
            ))}
          </div>
          {queue.groups.map((group, gi) => (
            <div key={group.dedupe_key ?? `alone-${gi}`} className="flex flex-col gap-2">
              {group.changes.filter((one) => keep(state.filter, one)).map((one) => {
                const on = state.selected !== null && "changeId" in state.selected && state.selected.changeId === one.change_id;
                return (
                  <button key={one.change_id} type="button" onClick={() => dispatch({ type: "pick-change", changeId: one.change_id })} aria-current={on ? "true" : undefined} className={`${ROW} ${on ? ON : OFF}`}>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[13.5px] font-[620] text-ink-1">{one.article ?? one.source_key}{one.title ? ` (${one.title})` : ""}</span>
                      <span data-numeric className="text-[12.5px] text-ink-3">{one.source.label} · 감지 {one.detected_at.slice(5, 16).replace("T", " ")} · 닿는 항목 {one.affected.length === 0 ? "없음" : one.affected.length}</span>
                    </span>
                    {one.affected.length === 0 && one.first_seen ? <span className={`${BADGE} font-[620] text-ink-1`}>새 조문</span> : <span className={BADGE}>{one.first_seen ? "최초 수집" : "변경"}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </>
      ) : (
        <>
          <p className="px-0.5 text-[13.5px] leading-[1.65] text-ink-3">근거 조문에 미검수 변경이 닿은 항목만 위로 올라옵니다.</p>
          {touched.map((entry) => {
            const on = state.selected !== null && "kbEntryId" in state.selected && state.selected.kbEntryId === entry.kb_entry_id;
            return (
              <button key={entry.kb_entry_id} type="button" onClick={() => dispatch({ type: "pick-entry", kbEntryId: entry.kb_entry_id })} aria-current={on ? "true" : undefined} className={`${ROW} ${on ? ON : OFF}`}>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13.5px] font-[620] text-ink-1">{entry.title}</span>
                  <span data-numeric className="text-[12.5px] text-ink-3">{entry.file} · 확인일 {entry.verified_at}</span>
                </span>
                <span data-numeric className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full border border-[oklch(0.697_0.16_258.2/36%)] bg-[oklch(0.697_0.16_258.2/14%)] px-1.5 text-[12.5px] font-[620] text-pii">{entry.pending_changes.length}</span>
              </button>
            );
          })}
          <span className="pt-1 text-[12.5px] font-[620] tracking-[0.13em] text-ink-4">조용한 항목 · {quiet.length}</span>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 5: 구현 — `detail.tsx`**

```tsx
// src/app/admin/kb/detail.tsx
"use client";
import { useState } from "react";
import type { ChangeBody, ChangeView, DecisionStatus, EntryView } from "@/flows/kb-review";

const EYEBROW = "text-[12.5px] font-[620] tracking-[0.13em] text-ink-4";
const TAG = "inline-flex rounded-[6px] border border-[oklch(0.697_0.16_258.2/36%)] bg-pii-bg px-2 py-px font-mono text-[12.5px] text-pii";
const BTN = "inline-flex min-h-[var(--size-touch)] items-center justify-center gap-2 rounded-[11px] border border-hairline bg-chip px-4 text-[13px] font-[560] text-ink-2 disabled:opacity-40";
const ROW = "flex w-full items-center gap-2.5 rounded-[11px] border border-hairline bg-surface px-[11px] py-[9px] text-left hover:border-[oklch(1_0_0/22%)]";

export function ChangeDetail({ change, loading, onPickEntry, onDecide, busy, message, nextTitle }: {
  change: ChangeBody | null; loading: boolean; onPickEntry(id: string): void;
  onDecide(status: DecisionStatus, note: string): void; busy: boolean; message: string | null; nextTitle: string | null;
}) {
  const [note, setNote] = useState("");
  if (loading) return <p className="text-[13px] text-ink-3">원문을 불러오고 있습니다</p>;
  if (!change) return <p className="text-[13.5px] leading-[1.65] text-ink-3">왼쪽에서 조문을 고르세요. 판단은 조문 단위입니다.</p>;
  const c = change.change;
  const decided = change.review.status === "approved" || change.review.status === "rejected";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className={`${EYEBROW} text-pii`}>{c.source.label} · {c.article}</span>
          <span className="inline-flex rounded-full border border-hairline bg-chip px-[9px] py-px text-[12.5px] text-ink-3">{c.first_seen ? "최초 수집 · 기준선" : "변경"}</span>
        </div>
        <h1 className="text-[20px] font-[640] leading-[1.6] text-ink-1">{c.title ?? c.article ?? c.source_key}</h1>
        <p data-numeric className="text-[13.5px] leading-[1.65] text-ink-3">시행 {String(c.meta["시행일자"] ?? "?")} · 감지 {c.detected_at.slice(0, 16).replace("T", " ")} · <span className={TAG}>{c.source_key}</span></p>
      </div>
      <div className="flex flex-col gap-2">
        <span className={EYEBROW}>무엇이 바뀌었나</span>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-[11px] border border-dashed border-hairline px-3 py-2.5 text-[13px] leading-[1.65] text-ink-3">
            <span className="block text-[12.5px] font-[620] text-ink-4">직전</span>
            {change.before ? <pre className="whitespace-pre-wrap font-sans">{change.before.content}</pre> : "직전 원문이 없습니다. 첫 수집이라 이 조문이 기준선이 됩니다."}
          </div>
          <div className="rounded-[13px] border border-hairline bg-surface px-[15px] py-[13px] text-[13.5px] leading-[1.65] text-ink-2">
            <span className="block text-[12.5px] font-[620] text-ink-4">이번</span>
            <pre className="whitespace-pre-wrap font-sans">{change.after?.content ?? "(원문 없음)"}</pre>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className={EYEBROW}>닿는 매뉴얼(추정) · {change.affected.length}</span>
          <span className="text-[12.5px] text-ink-3">행을 누르면 매뉴얼 기준으로 넘어갑니다</span>
        </div>
        {change.affected.length === 0 ? (
          <p className="text-[13.5px] leading-[1.65] text-ink-3">닿는 항목 없음 — 새 조문입니다. 어느 항목에 붙일지는 사람이 정합니다.</p>
        ) : (
          change.affected.map((entry) => (
            <button key={entry.kb_entry_id} type="button" onClick={() => onPickEntry(entry.kb_entry_id)} className={ROW}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-[620] text-ink-1">{entry.title}</span>
                <span className="text-[12.5px] text-ink-3"><span className={TAG}>{entry.kb_entry_id}</span> · {entry.file} · 확인일 {entry.verified_at}</span>
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-chip px-[9px] py-px text-[12.5px] text-ink-3">매뉴얼 기준으로 →</span>
            </button>
          ))
        )}
      </div>
      <div className="flex flex-col gap-2.5 border-t border-hairline pt-4">
        {decided ? (
          <p className="text-[13.5px] leading-[1.65] text-ink-3">이미 판단이 끝난 변경입니다 — {change.review.status === "approved" ? "승인" : "거절"} · {change.review.by} · {change.review.at?.slice(0, 10)}{change.review.note ? ` · 「${change.review.note}」` : ""}</p>
        ) : (
          <>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 예시: 시행일 미정, 10월 재확인" className="min-h-[var(--size-touch)] rounded-[11px] border border-hairline bg-surface-low px-[14px] text-[13.5px] text-ink-1 placeholder:text-ink-4" />
            {message && <p role="alert" className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2.5 text-[13px] text-ink-1">{message}</p>}
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={() => onDecide("approved", note)} className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink-1 px-[18px] text-[13.5px] font-[620] text-ground disabled:opacity-40">승인</button>
              <button type="button" disabled={busy} onClick={() => onDecide("rejected", note)} className={BTN}>거절</button>
              <button type="button" disabled={busy} onClick={() => onDecide("deferred", note)} className={BTN}>미룸</button>
              {nextTitle && <span data-numeric className="ml-auto text-[13.5px] text-ink-3">다음 · {nextTitle} →</span>}
            </div>
            <p className="text-[13.5px] leading-[1.65] text-ink-3">승인해도 매뉴얼에 자동 반영되지 않습니다. 반영은 <span className={TAG}>src/kb/*.json</span> 을 고쳐 릴리스할 때입니다.</p>
          </>
        )}
      </div>
    </div>
  );
}

export function EntryDetail({ entry, changes, onPickChange }: { entry: EntryView; changes: readonly ChangeView[]; onPickChange(id: string): void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className={`${EYEBROW} text-pii`}>{entry.file} · {entry.kb_entry_id}</span>
        <h1 className="text-[20px] font-[640] leading-[1.6] text-ink-1">{entry.title}</h1>
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-ink-4">근거</dt><dd className="text-ink-2">{entry.legal_basis}</dd>
          <dt className="text-ink-4">시행일</dt><dd data-numeric className="text-ink-2">{entry.effective_from} · 확인일 {entry.verified_at}</dd>
        </dl>
      </div>
      <div className="flex flex-col gap-2">
        <span className={EYEBROW}>이 항목에 닿은 변경 · {changes.length}</span>
        {changes.map((one) => (
          <button key={one.change_id} type="button" onClick={() => onPickChange(one.change_id)} className={ROW}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13.5px] font-[620] text-ink-1">{one.source.label} · {one.article}</span>
              <span data-numeric className="text-[12.5px] text-ink-3">{one.first_seen ? "최초 수집 · 기준선" : "변경"} · 감지 {one.detected_at.slice(0, 10)}</span>
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-chip px-[9px] py-px text-[12.5px] text-ink-3">조문 기준으로 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 구현 — `page.tsx`**

```tsx
// src/app/admin/kb/page.tsx
"use client";
/**
 * S-12 · KB 검수 큐 — /admin/kb (ADR-088). **피해자 화면 어디서도 링크하지 않습니다.**
 * 껍데기만 공개이고 데이터는 전부 /api/admin/kb/* — 401 이면 로그인 카드가 본문 자리에 뜹니다.
 */
import Image from "next/image";
import { useCallback, useEffect, useReducer, useState } from "react";
import type { ChangeBody, EntriesBody, QueueBody, DecisionStatus } from "@/flows/kb-review";
import { ChangeDetail, EntryDetail } from "./detail";
import { fetchChange, fetchEntries, fetchQueue, login, logout, postDecision, rememberName, rememberedName } from "./load";
import { LoginCard } from "./login";
import { QueueList } from "./queue";
import { initialState, nextPendingAfter, reduce } from "./state";

export { ChangeDetail, EntryDetail } from "./detail";
export { LoginCard } from "./login";
export { QueueList } from "./queue";

type Phase = { kind: "loading" } | { kind: "login"; message: string | null } | { kind: "ready"; queue: QueueBody; entries: EntriesBody } | { kind: "failed"; message: string };

export default function AdminKbPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [state, dispatch] = useReducer(reduce, initialState);
  const [name, setName] = useState("");
  const [change, setChange] = useState<ChangeBody | null>(null);
  const [changeLoading, setChangeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [q, e] = await Promise.all([fetchQueue("pending"), fetchEntries()]);
    if (!q.ok || !e.ok) {
      const fail = !q.ok ? q : (e as Extract<typeof e, { ok: false }>);
      setPhase(fail.status === 401 ? { kind: "login", message: null } : { kind: "failed", message: fail.message });
      return;
    }
    setPhase({ kind: "ready", queue: q.data, entries: e.data });
  }, []);

  useEffect(() => {
    setName(rememberedName());
    void load();
  }, [load]);

  // 조문을 고르면 원문 한 번 — 메모리에 두고, 같은 건을 다시 부르지 않습니다
  useEffect(() => {
    if (!state.selected || !("changeId" in state.selected)) return;
    const id = state.selected.changeId;
    if (change?.change.change_id === id) return;
    setChangeLoading(true);
    setMessage(null);
    void fetchChange(id).then((r) => {
      setChangeLoading(false);
      if (r.ok) setChange(r.data);
      else if (r.status === 401) setPhase({ kind: "login", message: null });
      else setMessage(r.message);
    });
  }, [state.selected, change]);

  const onLogin = async (who: string, password: string) => {
    setBusy(true);
    const r = await login(password);
    setBusy(false);
    if (!r.ok) {
      setPhase({ kind: "login", message: r.status === 429 ? "너무 여러 번 시도했습니다. 잠시 뒤에 다시." : "들어가지 못했습니다." });
      return;
    }
    rememberName(who);
    setName(who);
    setPhase({ kind: "loading" });
    void load();
  };

  const onDecide = async (status: DecisionStatus, note: string) => {
    if (phase.kind !== "ready" || !state.selected || !("changeId" in state.selected)) return;
    const id = state.selected.changeId;
    setBusy(true);
    setMessage(null);
    const r = await postDecision(id, { status, reviewed_by: name, note: note.trim() || null });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) setPhase({ kind: "login", message: null });
      else setMessage(r.message);
      return;
    }
    const next = nextPendingAfter(phase.queue.groups, id);
    setChange(null);
    await load();
    if (next) dispatch({ type: "pick-change", changeId: next });
    else dispatch({ type: "clear" });
  };

  const nextTitle = (() => {
    if (phase.kind !== "ready" || !state.selected || !("changeId" in state.selected)) return null;
    const id = nextPendingAfter(phase.queue.groups, state.selected.changeId);
    const hit = phase.queue.groups.flatMap((g) => g.changes).find((one) => one.change_id === id);
    return hit ? `${hit.article ?? hit.source_key}` : null;
  })();

  return (
    <main className="flex min-h-svh flex-col">
      <header className="border-b border-hairline bg-stage">
        <div className="mx-auto flex min-h-[56px] w-full max-w-shell flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[clamp(16px,3vw,32px)] py-2">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/symbol-mark.png" alt="" width={169} height={158} className="h-[23px] w-auto invert" />
            <span className="text-[18px] font-[660] tracking-[-0.02em] text-ink-1">Fin<span className="text-pii">Ally</span></span>
            <span className="ml-1 text-[13px] text-ink-3">KB 검수</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {phase.kind === "ready" && (
              <span data-numeric className="inline-flex items-center gap-2 rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3">
                <span aria-hidden className="size-[5px] rounded-full bg-pii" />지금 나가는 KB {phase.queue.kb_version ?? "미설정"}
              </span>
            )}
            <nav aria-label="고객 화면 열기" className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-chip p-0.5">
              <a href="/" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-[13px] text-ink-3 hover:text-ink-1">랜딩</a>
              <a href="/start" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-[13px] text-ink-3 hover:text-ink-1">시작</a>
              <a href="/start?demo" className="inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-[13px] text-ink-3 hover:text-ink-1">시연</a>
            </nav>
            {name && <span className="inline-flex items-center gap-2 rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3">검수자 {name}</span>}
            {phase.kind === "ready" && (
              <button type="button" onClick={() => void logout().then(() => setPhase({ kind: "login", message: null }))} className="inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-[13px] text-ink-3 hover:text-ink-1">나가기</button>
            )}
          </div>
        </div>
      </header>

      {phase.kind === "loading" && <p className="mx-auto mt-10 text-[13px] text-ink-3">검수 큐를 불러오고 있습니다</p>}
      {phase.kind === "login" && <LoginCard name={name} onSubmit={onLogin} busy={busy} message={phase.message} />}
      {phase.kind === "failed" && <p role="alert" className="mx-auto mt-10 text-[13.5px] text-ink-1">{phase.message}</p>}
      {phase.kind === "ready" && (
        <div className="mx-auto grid w-full max-w-shell grid-cols-[400px_minmax(0,1fr)] gap-[18px] px-[clamp(16px,3vw,32px)] pb-8 pt-[22px]">
          <QueueList state={state} queue={phase.queue} entries={phase.entries} dispatch={dispatch} />
          <section className="self-start rounded-[18px] bg-stage p-5 shadow-[0_1px_0_oklch(1_0_0/6%)_inset,0_16px_40px_-18px_oklch(0_0_0/70%)]">
            {state.lens === "entry" && state.selected && "kbEntryId" in state.selected ? (
              (() => {
                const id = state.selected.kbEntryId;
                const entry = phase.entries.entries.find((one) => one.kb_entry_id === id);
                const touching = phase.queue.groups.flatMap((g) => g.changes).filter((one) => one.affected.includes(id));
                return entry ? <EntryDetail entry={entry} changes={touching} onPickChange={(cid) => dispatch({ type: "pick-change", changeId: cid })} /> : null;
              })()
            ) : (
              <ChangeDetail change={state.selected && "changeId" in state.selected ? change : null} loading={changeLoading} onPickEntry={(eid) => dispatch({ type: "pick-entry", kbEntryId: eid })} onDecide={onDecide} busy={busy} message={message} nextTitle={nextTitle} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 7: 통과 확인 + 빌드**

Run: `cd src && npx vitest run app/admin/kb && npm run typecheck && npm run lint && npm run build`
Expected: PASS · 빌드 통과 (`server-only` 가 브라우저 번들에 들어갔으면 여기서 깨집니다 — `import type` 만 썼는지 봅니다).

- [ ] **Step 8: 손으로 한 바퀴** — 로컬 DB(`src/.env.local`)가 있으면:

```bash
cd src && npm run admin:hash -- "local-only-password-1234"   # 출력을 .env.local 의 ADMIN_PASSWORD_HASH= 에
npx next dev -p 3131
```
`http://localhost:3131/admin/kb` → 로그인 카드 → 이름·비밀번호 → 큐 58건 → 제3조 → 닿는 매뉴얼 셋 → 행 클릭 → 매뉴얼 기준 → 조문 행 클릭 → 조문 기준.
승인 하나 → 목록에서 빠지고 다음 건. **끝나면 서버를 내립니다** (`Stop-Process` — 포트 3131).

- [ ] **Step 9: 커밋**

```bash
git add src/app/admin/kb
git commit -m "S-12 KB 검수 큐 화면 — 받은편지함 + 조문·매뉴얼 렌즈, 승인은 「승인」 (ADR-088 · 핸드오프 09-06-s12)"
```

---

### Task 12: 문서 동기화

**Files:**
- Modify: `ARCHITECTURE.md` — §1 「요청이 지나는 길」 그림에 팀 화면 한 줄 · §4 층 4 표의 「사람 검수」 행과 mermaid `REV` 노드 · 「물리 배치」 표 넷(화면 · API 진입점 · 명령줄 · 문지기) · §7 환경변수 문장
- Modify: `CLAUDE.md` 51행 — 라우트 수
- Modify: `spec/frontend/08-14-screens.md` S-12 절 — 「아직 구현되지 않았습니다」 배너 제거
- Modify: `assets/artifacts/handoff/09-06-s12-kb-review/README.md` — 상태 「적용됨」 + 적용 커밋
- Modify: `src/lib/config-report.ts` — 「관리자 비밀번호」 줄 복구
- Modify: `docs/plans/README.md` — 이 계획을 표에 (이미 등록돼 있으면 상태만)

- [ ] **Step 1: ARCHITECTURE.md**

「물리 배치」 표:

```markdown
| 화면 | `src/app/page.tsx`(랜딩) · `src/app/start/`(진입 · 동의 · 첫 문항) · `src/app/c/[token]/`(사건 화면 셸) · **`src/app/admin/kb/`(KB 검수 큐 — 팀용 · 피해자 화면에서 링크하지 않음)** | 브라우저 |
| 문지기 | `src/proxy.ts` — `/api/admin/*` 401 · `/api/cron/*` Bearer 확인. **`/api/admin-login` 만 밖** — 비밀번호를 대조해 세션 쿠키를 굽는다 | 서버 · 라우트 앞 |
| API 진입점 | `src/app/api/**/route.ts` — 사건 13 + 크론 3 + **관리자 7**(로그인 · 로그아웃 · 검수 큐 5) · 전부 `handleRoute` 경유 | 서버 |
| 명령줄 | `src/scripts/` — `npm run migrate` · `kb:load` · `kb:collect` · `kb:review` · **`admin:hash`** · `config:report` · `probe:llm` (`server-only` 때문에 `npm run`으로만) | 소유자 기기 |
```

층 4 표의 「사람 검수」 행:

```markdown
| 사람 검수 | `kb-reviewer` | `npm run kb:review` **또는 화면 `/admin/kb`(S-12)** 로 `source_change`의 변경분을 승인 · 반려 · 보류. 조문과 매뉴얼은 `link.ts` 가 `legal_basis` 글에서 규칙으로 잇는다(추정). 승인이 매뉴얼 반영은 아니다 |
```

mermaid: `REV["사람 검수<br/>명령줄"]` → `REV["사람 검수<br/>명령줄 · 화면"]`.

§1 그림의 브라우저 subgraph 아래 한 줄을 더합니다 — `TEAM["팀 화면<br/>KB 검수"] -- "세션 쿠키" --> API`. 그리고 §7 의 환경변수 문장 뒤에 한 문장: *관리자 비밀번호는 `ADMIN_PASSWORD_HASH`(scrypt) 하나이고 `npm run admin:hash`로 만든다 (ADR-088 — 링크는 ARCHITECTURE 의 이웃 줄과 같은 상대경로로).*

「근거」 줄에 ADR-088 링크를 이웃 줄과 같은 꼴로 추가.

- [ ] **Step 2: CLAUDE.md** 51행: `API 라우트 16(사건 13 + 크론 3)` → `API 라우트 23(사건 13 + 크론 3 + 관리자 7)`.

- [ ] **Step 3: S-12 절** — 머리 인용문의 `**아직 구현되지 않았습니다.**` 를 `**2026-09-xx 구현** (커밋 해시)` 로.

- [ ] **Step 4: 핸드오프 README** — 표의 「상태」를 `**적용됨** — <커밋 해시>` 로.

- [ ] **Step 5: config-report.ts** — 53행 근처 주석을 고치고 줄 하나 복구. 형태는 그 파일의 다른 줄과 같게 (예: `row('관리자 비밀번호', has(env, 'ADMIN_PASSWORD_HASH') ? '설정됨' : '없음 — /admin/kb 가 닫혀 있습니다 (ADR-088)')`). 정확한 헬퍼 이름은 그 파일의 이웃 줄을 그대로 따릅니다.

- [ ] **Step 6: 검사기 셋**

```bash
python .github/scripts/doc-integrity.py --base origin/main --head HEAD
bash .github/scripts/gates.sh
cd src && npm run typecheck && npx vitest run
```
Expected: 전부 통과.

- [ ] **Step 7: 커밋**

```bash
git add ARCHITECTURE.md CLAUDE.md spec/frontend/08-14-screens.md assets/artifacts/handoff/09-06-s12-kb-review/README.md src/lib/config-report.ts docs/plans/README.md
git commit -m "KB 검수 큐가 섰다 — ARCHITECTURE 물리 배치·층 4·라우트 수, S-12 구현 표시, 설정 현황에 관리자 비밀번호 (ADR-088)"
```

---

### Task 13: 배포

**Files:**
- Modify (필요하면): `.github/workflows/vercel-env.yml` — 입력에 `admin_password_hash` 가 없으면 추가 (`law_api_oc` 줄과 같은 꼴)
- Vercel 환경변수 `ADMIN_PASSWORD_HASH` (값은 저장소에 두지 않는다 — ADR-059)

- [ ] **Step 1: 값 만들기** — 소유자 기기에서. 비밀번호는 무작위 12자 이상, 팀 채널로만 공유.

```bash
cd src && npm run admin:hash -- "<무작위 비밀번호>"
```

- [ ] **Step 2: 워크플로 확인** — `.github/workflows/vercel-env.yml` 이 키를 열거하면 `admin_password_hash` 입력과 `ADMIN_PASSWORD_HASH` 매핑을 `law_api_oc` 와 같은 자리에 더합니다. 열거하지 않으면 건너뜁니다.

- [ ] **Step 3: 넣기** — `vercel-env` 워크플로(Actions 탭 · 수동)에 값을 넣고 재배포. 또는 소유자의 `vercel env add ADMIN_PASSWORD_HASH production`.

- [ ] **Step 4: 배포본에서 한 바퀴** — PR 머지 → `deploy` → `smoke` 통과 뒤:
  `https://fin-ally-khaki.vercel.app/admin/kb` → 로그인 → 큐 → 승인 하나 (실제 기준선 조문이라 「봤다」가 맞습니다) → `npm run kb:review` 로 같은 건이 `approved` 로 보이는지 대조.

- [ ] **Step 5: deploy/README 「지금 올라가 있는 것」** 에 한 줄 — 검수 화면이 섰고 비밀번호는 환경변수라는 것. 커밋.

```bash
git add deploy/README.md .github/workflows/vercel-env.yml
git commit -m "배포본에 KB 검수 큐 — ADMIN_PASSWORD_HASH 를 vercel-env 로 넣는다 (ADR-088)"
```

---

## 자기 점검 (계획을 쓰며 확인한 것)

| 정본의 요구 | 태스크 |
| --- | --- |
| §7.1 로그인 경로 · scrypt · 상한 · `ADMIN_USERNAME` 안 씀 | 1 · 3 · 4 |
| §7.2 다섯 경로 · `ulidParamOf` · 검사기 등록 · 관리자 경로 무제한 | 9 |
| §7.3 응답 모양 · `file` 계산 · 이력 200건 | 8 |
| §7.4 규칙 · 「추정」 · `impact` 에 안 씀 · `page:` 는 밖 | 6 · 8 · 11 |
| 에러 코드 둘 | 5 |
| S-12 두 렌즈 · 전환 · 판단 조문 단위 · 어휘 · 금지(반영 문구 · 링크 없음 · 피해자 데이터 없음) | 10 · 11 |
| ADR-088 「어떻게 지키나」 넷 | 4 · 9 · 6 · 11 |
| ADR-068 부분 대체의 결과(설정 현황 복구 · 환경변수) | 12 · 13 |
| 껍데기에 헤더 자리 (계획에서 발견 — 정본엔 없던 것) | 2 |

- 자리표시 없음 — 코드 블록마다 실제 내용.
- **실행 중 발견(2026-09-06) — 이 계획의 코드와 다르게 구현된 자리:** ① `source_key` 는 `law:011359:제3조` 가 아니라
  **`law:011359:3`(가지번호는 `:2:2`)** 입니다 — 데이터 모델 §12.1 · `law-fetcher.ts`. `parseSourceKey` 가 그 꼴을 읽어
  「제N조」를 만듭니다. 계획대로 만들었더니 실제 큐 58건이 전부 「새 조문」으로 떴습니다. ② `BadRequestError`·`UnauthorizedError`
  는 `@/lib/errors` 가 아니라 `@/lib/http` 에 있습니다. ③ `link.ts` 는 다른 법(「전기통신사업법 제32조의6」)의 조를 세지 않습니다.
  ④ 실제 KB 로 세운 기대: 법 제3조 → 둘(서류 제출은 시행령만 인용), 법 제7조 → 셋(`common-procedure-stopped` 가 제7조제2항 인용).
  ⑤ 화면의 초기 로드는 효과 안 동기 setState 를 금하는 lint 때문에 `.then` 안에서만 상태를 바꿉니다. ⑥ `ADMIN_PASSWORD_HASH` 를
  로컬 `.env.local` 에 넣을 땐 `\$` 로 이스케이프해야 합니다(dotenv 확장). ⑦ 배포는 입력 칸이 아니라 저장소 시크릿 + `set_admin_password_hash`.
- 이름 대조: `readQueue/readChange/decide/readEntries/readHistory`(8 ↔ 9 ↔ 10) · `linkEntries/parseSourceKey/sourceLabelOf`(6 ↔ 8) · `KbChangeNotFoundError/KbChangeDecidedError`(5 ↔ 8 ↔ 9) · `RouteResult.headers`(2 ↔ 4) · `'adminLogin'`(3 ↔ 4) · `fileOf`(8) · `reduce/initialState/nextPendingAfter`(10 ↔ 11).
