/**
 * 요청 껍데기 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §1 §1.1 §1.3 · spec/backend/08-16-errors.md §3
 *
 * **여기서 못 박는 것 넷:**
 * 1. 성공이든 실패든 계측 헤더 넷이 붙는다 (§1.1)
 * 2. 조회 경로는 적지 않아도 제한이 걸린다 (§1.3 「그 외 조회」)
 * 3. 관리자 경로에는 제한이 안 걸린다 (§1.3)
 * 4. 예외가 밖으로 새지 않는다 (§3)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, type Container } from './container'
import { readEnv } from './env'
import { KbUnavailableError } from './errors'
import { BadRequestError, CaseNotFoundError } from './http'
import { RATE_RULES } from './rate-limit'
import {
  caseIdOf,
  caseTokenOf,
  clientIpOf,
  handleRoute,
  sessionIdOf,
  ulidParamOf,
} from './request'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from './session-cookie'
import { TELEMETRY_HEADER_NAMES } from './telemetry'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** 관리자 계정이 설정된 서버 */
const ADMIN_ENV = readEnv({
  ADMIN_USERNAME: 'operator',
  ADMIN_PASSWORD_HASH: 'hash-of-a-password',
})

let container: Container

beforeEach(() => {
  // 시험마다 새로 조립합니다 — 카운터가 앞 시험의 횟수를 물려받으면
  // 뒤 시험이 조용히 깨집니다
  container = createContainer(readEnv({}))
})

/** 지금 유효한 관리자 세션 쿠키 한 줄 */
function adminCookie(): Record<string, string> {
  const made = issueAdminSession(ADMIN_ENV, Date.now())
  return { cookie: `${ADMIN_SESSION_COOKIE}=${made!.value}` }
}

function get(path = 'http://x/api/cases/x/plan', headers: Record<string, string> = {}) {
  return new Request(path, { headers })
}

describe('계측 헤더는 모든 응답에 붙는다 — §1.1', () => {
  it('성공 응답에 넷 다 있다', async () => {
    const res = await handleRoute(get(), async () => ({ body: { ok: true } }), {
      container,
    })

    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(res.headers.has(name), name).toBe(true)
    }
  })

  it('에러 응답에도 넷 다 있다', async () => {
    const res = await handleRoute(
      get(),
      async () => {
        throw new KbUnavailableError('조회 실패')
      },
      { container },
    )

    expect(res.status).toBe(503)
    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(res.headers.has(name), name).toBe(true)
    }
  })

  it('핸들러가 모은 값이 헤더로 나간다', async () => {
    const res = await handleRoute(
      get(),
      async (ctx) => {
        ctx.telemetry.addTokenCounts({ account: 1 })
        ctx.telemetry.useKbVersion('2026.08.1')
        ctx.telemetry.useAuditId('01J8XKR2')
        return { body: {} }
      },
      { container },
    )

    expect(res.headers.get('X-Pii-Token-Count')).toBe('account=1')
    expect(res.headers.get('X-Kb-Version')).toBe('2026.08.1')
    expect(res.headers.get('X-Audit-Id')).toBe('01J8XKR2')
  })

  it('던지기 전에 모은 값도 에러 응답에 실린다', async () => {
    // 어디까지 갔다가 실패했는지가 응답으로 보여야 합니다
    const res = await handleRoute(
      get(),
      async (ctx) => {
        ctx.telemetry.useAuditId('01J8AUDIT')
        throw new KbUnavailableError('조회 실패')
      },
      { container },
    )
    const body = (await res.json()) as { error: { audit_id?: string } }

    expect(res.headers.get('X-Audit-Id')).toBe('01J8AUDIT')
    // 08-16-errors.md §5 — 모든 에러 응답에 audit_id 가 붙습니다
    expect(body.error.audit_id).toBe('01J8AUDIT')
  })
})

describe('상태 코드', () => {
  it('기본은 200 이다', async () => {
    const res = await handleRoute(get(), async () => ({ body: {} }), { container })

    expect(res.status).toBe(200)
  })

  it('핸들러가 정하면 그대로 나간다 — 생성은 201', async () => {
    const res = await handleRoute(
      new Request('http://x/api/cases', { method: 'POST' }),
      async () => ({ body: {}, status: 201 }),
      { container, rate: 'none' },
    )

    expect(res.status).toBe(201)
  })
})

describe('속도 제한 — §1.3', () => {
  it('조회는 적지 않아도 걸린다', async () => {
    const headers = { 'X-Session-Id': 'sess-1' }
    for (let i = 0; i < RATE_RULES.read.limit; i += 1) {
      const res = await handleRoute(get('http://x/api/cases/x/plan', headers), async () => ({ body: {} }), { container })
      expect(res.status).toBe(200)
    }

    const over = await handleRoute(
      get('http://x/api/cases/x/plan', headers),
      async () => ({ body: {} }),
      { container },
    )
    const body = (await over.json()) as { error: { code: string } }

    expect(over.status).toBe(429)
    expect(body.error.code).toBe('RATE_LIMITED')
  })

  it('429 에 남은 창 시간이 붙는다 — §3.1', async () => {
    const headers = { 'X-Session-Id': 'sess-2' }
    let last: Response | undefined
    for (let i = 0; i <= RATE_RULES.read.limit; i += 1) {
      last = await handleRoute(
        get('http://x/api/cases/x/plan', headers),
        async () => ({ body: {} }),
        { container },
      )
    }

    // 창이 60초이고 시험은 같은 순간에 다 도므로 남은 시간이 그대로 60초입니다
    expect(last?.status).toBe(429)
    expect(last?.headers.get('Retry-After')).toBe('60')
  })

  it('세션이 다르면 서로 안 센다', async () => {
    for (let i = 0; i < RATE_RULES.read.limit; i += 1) {
      await handleRoute(get('http://x/api/cases/x/plan', { 'X-Session-Id': 'sess-a' }), async () => ({ body: {} }), { container })
    }

    const other = await handleRoute(
      get('http://x/api/cases/x/plan', { 'X-Session-Id': 'sess-b' }),
      async () => ({ body: {} }),
      { container },
    )

    expect(other.status).toBe(200)
  })

  it('세션 헤더가 없으면 IP 로 떨어진다 — 막지 않는다', async () => {
    // ⬜ 정본이 「헤더가 없을 때」를 안 정했습니다. 400 으로 막으면
    // §1.3 의 「제한이 정상 사용을 막으면 안 됩니다」를 정면으로 어깁니다
    const res = await handleRoute(
      get('http://x/api/cases/x/plan', { 'X-Forwarded-For': '203.0.113.9' }),
      async () => ({ body: {} }),
      { container },
    )

    expect(res.status).toBe(200)
  })

  it('사건 단위 제한은 라우트가 건다', async () => {
    const run = () =>
      handleRoute(
        new Request('http://x/api/cases/x/messages', { method: 'POST' }),
        async (ctx) => {
          await ctx.limit('chat', CASE_ID)
          return { body: {} }
        },
        { container },
      )

    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      expect((await run()).status).toBe(200)
    }
    expect((await run()).status).toBe(429)
  })

  it('관리자 경로는 제한하지 않는다', async () => {
    // 계정이 하나뿐이고 조사 중에 걸리면 곤란합니다 → §1.3
    const admin = createContainer(ADMIN_ENV)
    const path = 'http://x/api/admin/cases/x/trace'

    for (let i = 0; i < RATE_RULES.read.limit + 5; i += 1) {
      const res = await handleRoute(get(path, adminCookie()), async () => ({ body: {} }), {
        container: admin,
      })
      expect(res.status).toBe(200)
    }
  })

  it('일부러 안 걸 수도 있다', async () => {
    for (let i = 0; i < RATE_RULES.read.limit + 2; i += 1) {
      const res = await handleRoute(get(), async () => ({ body: {} }), {
        container,
        rate: 'none',
      })
      expect(res.status).toBe(200)
    }
  })
})

describe('관리자 경로의 두 번째 관문 — §5.1', () => {
  it('인증 없이 오면 401 이다', async () => {
    // 문지기(proxy.ts)가 이미 막았어야 하는 자리입니다. 그래도 한 번 더 봅니다 —
    // matcher 를 고치거나 경로를 옮기면 문지기가 조용히 안 걸립니다
    const admin = createContainer(ADMIN_ENV)

    const res = await handleRoute(
      get('http://x/api/admin/cases/x/trace'),
      async () => ({ body: { secret: '보이면 안 됩니다' } }),
      { container: admin },
    )

    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain('보이면 안 됩니다')
  })

  it('관리자 계정이 설정 안 된 서버는 닫혀 있다', async () => {
    // 열린 쪽으로 실패하지 않습니다
    const res = await handleRoute(
      get('http://x/api/admin/cases/x/trace', adminCookie()),
      async () => ({ body: {} }),
      { container },
    )

    expect(res.status).toBe(401)
  })

  it('일반 경로는 쿠키가 없어도 그대로 돈다', async () => {
    const res = await handleRoute(get(), async () => ({ body: {} }), { container })

    expect(res.status).toBe(200)
  })

  it('401 에도 계측 헤더 넷이 붙는다', async () => {
    const admin = createContainer(ADMIN_ENV)

    const res = await handleRoute(
      get('http://x/api/admin/cases/x/trace'),
      async () => ({ body: {} }),
      { container: admin },
    )

    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(res.headers.has(name), name).toBe(true)
    }
  })

  it('401 에는 Retry-After 가 안 붙는다', async () => {
    // 기다린다고 인증이 생기지 않습니다 → 08-16-errors.md §3.1 「4xx 전부」
    const admin = createContainer(ADMIN_ENV)

    const res = await handleRoute(
      get('http://x/api/admin/cases/x/trace'),
      async () => ({ body: {} }),
      { container: admin },
    )

    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('예외를 밖으로 내보내지 않는다 — §3', () => {
  it('우리 예외가 아니면 INTERNAL 로 덮는다', async () => {
    const res = await handleRoute(
      get(),
      async () => {
        throw new Error('connect ECONNREFUSED postgres://user:pw@host')
      },
      { container },
    )
    const body = (await res.json()) as { error: { code: string } }

    expect(res.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL')
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })

  it('안 붙은 자원을 부르면 조용히 넘어가지 않는다', async () => {
    // 미설정은 「있는데 지금 안 된다」가 아니라 「아직 없다」입니다 →
    // 503 이 아니라 500 이고 Retry-After 가 안 붙습니다
    const res = await handleRoute(
      get(),
      async (ctx) => ({
        body: await ctx.container.ports.caseStore.evidenceTotals(CASE_ID),
      }),
      { container },
    )

    expect(res.status).toBe(500)
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('서버 쪽 실패는 운영자가 볼 수 있게 남는다', () => {
  it('5xx 는 남긴다 — 안 남기면 왜 터졌는지 알 방법이 없다', async () => {
    const seen: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      seen.push(args)
    })

    await handleRoute(
      get(),
      async (ctx) => ({
        body: await ctx.container.ports.caseStore.evidenceTotals(CASE_ID),
      }),
      { container },
    )
    spy.mockRestore()

    // not-configured 가 담아 던진 「무엇이·왜」가 그대로 보여야 합니다
    expect(JSON.stringify(seen)).toContain('CaseStore')
  })

  it('4xx 는 안 남긴다 — 정상적으로 오가는 요청이다', async () => {
    const seen: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      seen.push(args)
    })

    await handleRoute(
      get(),
      async () => {
        throw new BadRequestError('요청이 잘못됐습니다')
      },
      { container },
    )
    spy.mockRestore()

    // 밖에서 일부러 틀린 요청을 반복해 로그를 채울 수 있습니다
    expect(seen).toHaveLength(0)
  })
})

describe('요청에서 읽는 것들 — §1', () => {
  it('세션 식별자를 읽는다', () => {
    expect(sessionIdOf(get('http://x/', { 'X-Session-Id': 'sess-1' }))).toBe('sess-1')
    expect(sessionIdOf(get())).toBeNull()
  })

  it('X-Forwarded-For 의 첫 칸이 발신자다', () => {
    const req = get('http://x/', { 'X-Forwarded-For': '203.0.113.9, 10.0.0.1' })

    expect(clientIpOf(req)).toBe('203.0.113.9')
  })

  it('프록시 헤더가 없으면 null 이다', () => {
    expect(clientIpOf(get())).toBeNull()
  })
})

describe('경로 파라미터 — Next 16 은 Promise 다', () => {
  /** 주소에 오는 것은 링크 토큰뿐입니다 → ADR-039 */
  const route = (case_token: string) => ({ params: Promise.resolve({ case_token }) })
  /** 조회가 신분 확인입니다 — 형식으로는 못 가릅니다 */
  const resolves = (caseId: string | null) => ({ toCaseId: async () => caseId })

  it('모양이 맞으면 토큰을 꺼낸다', async () => {
    await expect(caseTokenOf(route(CASE_ID))).resolves.toBe(CASE_ID)
  })

  it('모양이 아니면 400 이다', async () => {
    const res = await handleRoute(
      get(),
      async () => ({ body: await caseTokenOf(route('../etc')) }),
      { container },
    )

    expect(res.status).toBe(400)
  })

  it('값을 detail 에 담지 않는다', async () => {
    // 링크 토큰은 사실상 비밀번호이고, 이 detail 은 감사 기록으로 갑니다
    // → ADR-039 · 09-data-model.md §10.1
    let detail: Record<string, unknown> = {}
    try {
      await caseTokenOf(route('110-234-567890'))
    } catch (error) {
      detail = (error as { detail: Record<string, unknown> }).detail
    }

    expect(JSON.stringify(detail)).not.toContain('110-234')
  })

  it('**토큰을 그대로 내부 식별자로 흘리지 않는다** — ADR-039', async () => {
    // 그대로 흘리면 속도 제한이 사건 단위가 아니라 토큰 단위가 되고,
    // 기본키 조회는 언제나 빕니다. ADR-039 가 명시적으로 기각한 모양입니다
    // `O` 는 Crockford Base32 에 없습니다 — 0 과 헷갈려서 뺀 넷(I·L·O·U) 중 하나
    const token = 'TKN00000000000000000000ABC'.slice(0, 26)
    const caseId = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
    await expect(caseIdOf(route(token), resolves(caseId))).resolves.toBe(caseId)
  })

  it('그 주소로 열리는 사건이 없으면 404 다', async () => {
    const res = await handleRoute(
      get(),
      async () => ({ body: await caseIdOf(route(CASE_ID), resolves(null)) }),
      { container },
    )

    // 400 이 아닙니다 — 모양은 맞고 사건이 없는 것입니다
    expect(res.status).toBe(404)
  })

  it('없는 사건과 남의 사건을 구분해 답하지 않는다', async () => {
    // 구분하면 「이 주소는 실재한다」가 새어 나갑니다 — 찍어 보는 쪽에 힌트입니다
    const failed = await caseIdOf(route(CASE_ID), resolves(null)).catch(
      (error: Error) => error,
    )
    expect(String(failed)).not.toContain(CASE_ID)
  })

  it('다른 식별자도 같은 검사를 받는다', async () => {
    await expect(
      ulidParamOf({ params: Promise.resolve({ step_id: CASE_ID }) }, 'step_id'),
    ).resolves.toBe(CASE_ID)
    await expect(
      ulidParamOf({ params: Promise.resolve({ step_id: 'nope' }) }, 'step_id'),
    ).rejects.toThrow()
  })
})

describe('열거 방어 — 404 를 IP 로 센다 — ADR-039 ④', () => {
  /** 링크 토큰이 사실상 비밀번호라, 없는 사건을 계속 찔러 보는 것이 유일한 공격 경로다 */
  const notFound = async (ip: string) =>
    handleRoute(
      get('http://x/api/cases/x', { 'x-forwarded-for': ip }),
      async () => {
        throw new CaseNotFoundError('그 주소로 열리는 사건이 없습니다')
      },
      { container },
    )

  it('한도 안에서는 404 가 그대로 나간다', async () => {
    // **막는 것이 아니라 세는 것입니다.** 링크를 한 번 잘못 눌렀다고
    // 곧바로 막히면 안 됩니다
    for (let i = 0; i < 10; i += 1) {
      expect((await notFound('203.0.113.1')).status).toBe(404)
    }
  })

  it('한도를 넘으면 429 로 바뀐다', async () => {
    for (let i = 0; i < 10; i += 1) await notFound('203.0.113.2')

    const res = await notFound('203.0.113.2')
    // 이 지점부터는 **사건이 있는지 없는지도 알려주지 않습니다**
    expect(res.status).toBe(429)
  })

  it('IP 가 다르면 따로 센다', async () => {
    for (let i = 0; i < 11; i += 1) await notFound('203.0.113.3')
    expect((await notFound('203.0.113.3')).status).toBe(429)

    // 다른 사용자가 같이 막히면 안 됩니다
    expect((await notFound('203.0.113.4')).status).toBe(404)
  })

  it('**사건당이 아니라 IP 당이다** — 매번 다른 사건을 부르는 공격 때문', async () => {
    // 나머지 카운터는 전부 사건당인데, 없는 사건을 찌르는 공격에는 무의미합니다.
    // 경로가 매번 달라도 같은 통에 들어가야 합니다
    for (let i = 0; i < 11; i += 1) {
      await handleRoute(
        get(`http://x/api/cases/DIFFERENT${i}`, { 'x-forwarded-for': '203.0.113.5' }),
        async () => {
          throw new CaseNotFoundError('그 주소로 열리는 사건이 없습니다')
        },
        { container },
      )
    }
    expect((await notFound('203.0.113.5')).status).toBe(429)
  })

  it('다른 오류는 세지 않는다', async () => {
    // 400 은 정상적으로 오가는 요청입니다. 이걸 세면 오타 몇 번에 막힙니다
    for (let i = 0; i < 20; i += 1) {
      await handleRoute(
        get('http://x/api/cases/x', { 'x-forwarded-for': '203.0.113.6' }),
        async () => ({
          body: await caseTokenOf({ params: Promise.resolve({ case_token: '../etc' }) }),
        }),
        { container },
      )
    }
    expect((await notFound('203.0.113.6')).status).toBe(404)
  })
})
