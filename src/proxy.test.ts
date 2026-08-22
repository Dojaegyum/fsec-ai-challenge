/**
 * 문지기 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §5.1 · decisions/025-scheduled-jobs.md 「남은 것」
 *
 * **여기서 못 박는 것 넷:**
 * 1. 관리자 경로는 인증 없이 못 들어온다 (§5.1 — 401)
 * 2. 크론 경로는 비밀값 없이 못 들어온다 (ADR-025)
 * 3. 설정이 없는 서버는 **닫혀 있다** — 열린 쪽으로 실패하지 않는다
 * 4. 문지기가 낸 응답에도 계측 헤더 넷이 붙는다 (§1.1)
 */

import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readEnv } from '@/lib/env'
import { GATED_MATCHERS } from '@/lib/gated-paths'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import { TELEMETRY_HEADER_NAMES } from '@/lib/telemetry'

import { config, proxy } from './proxy'

const ADMIN_HASH = 'hash-of-a-password'
const CRON_SECRET = 'a-long-random-cron-secret'

afterEach(() => {
  vi.unstubAllEnvs()
})

/** 문지기는 `process.env` 를 직접 읽습니다 — 조립본을 안 씁니다 */
function configureAdmin() {
  vi.stubEnv('ADMIN_USERNAME', 'operator')
  vi.stubEnv('ADMIN_PASSWORD_HASH', ADMIN_HASH)
}

function validCookie(): string {
  const made = issueAdminSession(
    readEnv({ ADMIN_USERNAME: 'operator', ADMIN_PASSWORD_HASH: ADMIN_HASH }),
    Date.now(),
  )
  return `${ADMIN_SESSION_COOKIE}=${made!.value}`
}

function ask(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, 'http://x'), { headers })
}

describe('어디에 거는가', () => {
  it('관리자와 크론 두 갈래에만 건다', () => {
    // matcher 는 빌드할 때 그대로 읽히는 값이어야 합니다 — 변수를 넣으면
    // 조용히 무시되고 문지기가 아무 데도 안 걸립니다
    expect(config.matcher).toEqual(['/api/admin/:path*', '/api/cron/:path*'])
  })

  it('matcher 와 문지기가 같은 집합을 가리킨다', () => {
    // 둘이 어긋나면 그 틈으로 인증 없이 들어옵니다.
    // 실제로 뒤 슬래시 한 칸 때문에 `/api/admin` 이 새어 나갔습니다
    expect(config.matcher).toEqual([...GATED_MATCHERS])
  })

  it('그 밖의 경로는 그냥 지나간다', () => {
    const res = proxy(ask('/api/cases'))

    expect(res.status).not.toBe(401)
  })
})

describe('관리자 경로 — §5.1', () => {
  it('쿠키가 없으면 401 이다', () => {
    configureAdmin()

    expect(proxy(ask('/api/admin/cases/x/trace')).status).toBe(401)
  })

  it('맞는 쿠키면 지나간다', () => {
    configureAdmin()

    const res = proxy(ask('/api/admin/cases/x/trace', { cookie: validCookie() }))

    expect(res.status).not.toBe(401)
  })

  it('서명이 다른 쿠키는 막힌다', () => {
    configureAdmin()

    const res = proxy(
      ask('/api/admin/cases/x/trace', {
        cookie: `${ADMIN_SESSION_COOKIE}=v1.99999999999999.deadbeef`,
      }),
    )

    expect(res.status).toBe(401)
  })

  it('관리자 계정이 설정 안 된 서버는 닫혀 있다', () => {
    vi.stubEnv('ADMIN_USERNAME', '')
    vi.stubEnv('ADMIN_PASSWORD_HASH', '')

    const res = proxy(ask('/api/admin/cases/x/trace', { cookie: validCookie() }))

    expect(res.status).toBe(401)
  })

  it('새 관리자 경로를 만들어도 자동으로 걸린다', () => {
    // §5.1 이 「엔드포인트마다 개별로 확인하지 않습니다」로 정한 이유입니다
    configureAdmin()

    for (const path of [
      // 뒤 슬래시가 없는 이 경로가 문지기를 그냥 지나갔습니다.
      // Next 의 경로 패턴은 이것도 덮는데 startsWith('/api/admin/') 는 놓칩니다
      '/api/admin',
      '/api/admin/',
      '/api/admin/cases/x/messages/y',
      '/api/admin/anything/new/we/add/later',
    ]) {
      expect(proxy(ask(path)).status, path).toBe(401)
    }
  })

  it('이름이 비슷한 남의 경로까지 막지는 않는다', () => {
    configureAdmin()

    // 접두사만 보면 상관없는 경로까지 막습니다
    expect(proxy(ask('/api/adminx')).status).not.toBe(401)
    expect(proxy(ask('/api/administrator')).status).not.toBe(401)
  })

  it('깨진 쿠키에도 던지지 않고 401 로 떨어진다', () => {
    // decodeURIComponent('%') 는 예외를 던집니다. 문지기가 그걸 맞으면
    // 인증 없는 요청 한 줄이 401 대신 500 이 되고, 그 응답에는 계측 헤더도
    // 에러 봉투도 없습니다
    configureAdmin()

    for (const bad of [
      '%',
      '%E0%A4%A',
      'v1.99999999999999.%C3',
      `${'a'.repeat(63)}\u00e9`,
    ]) {
      const res = proxy(ask('/api/admin/x', { cookie: `${ADMIN_SESSION_COOKIE}=${bad}` }))
      expect(res.status, bad).toBe(401)
    }
  })

  it('글자 수는 같고 바이트 수는 다른 서명에도 던지지 않는다', () => {
    // timingSafeEqual 은 바이트 길이가 다르면 예외를 던집니다.
    // 글자 수로 재는 것으로는 못 막습니다 — `é` 한 글자가 2바이트입니다
    configureAdmin()

    const future = Date.now() + 3_600_000
    const signature = `${'a'.repeat(63)}\u00e9`

    const res = proxy(
      ask('/api/admin/x', {
        cookie: `${ADMIN_SESSION_COOKIE}=v1.${future}.${signature}`,
      }),
    )

    expect(res.status).toBe(401)
  })
})

describe('크론 경로 — ADR-025', () => {
  it('뒤 슬래시가 없어도 걸린다', () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET)

    expect(proxy(ask('/api/cron')).status).toBe(401)
  })

  it('비밀값이 없는 서버는 아무도 못 부른다', () => {
    // 비교할 것이 없을 때 통과시키면 설정을 빠뜨린 서버의 파기·발송 경로를
    // 밖에서 부를 수 있습니다
    vi.stubEnv('CRON_SECRET', '')

    const res = proxy(
      ask('/api/cron/purge', { authorization: `Bearer ${CRON_SECRET}` }),
    )

    expect(res.status).toBe(401)
  })

  it('헤더가 없으면 401 이다', () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET)

    expect(proxy(ask('/api/cron/purge')).status).toBe(401)
  })

  it('맞는 비밀값이면 지나간다', () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET)

    const res = proxy(
      ask('/api/cron/purge', { authorization: `Bearer ${CRON_SECRET}` }),
    )

    expect(res.status).not.toBe(401)
  })

  it('값이 틀리면 막힌다', () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET)

    for (const bad of [
      'Bearer wrong',
      `Bearer ${CRON_SECRET}x`,
      `Basic ${CRON_SECRET}`,
      CRON_SECRET,
    ]) {
      expect(proxy(ask('/api/cron/purge', { authorization: bad })).status, bad)
        .toBe(401)
    }
  })

  it('관리자 쿠키로는 크론을 못 부른다', () => {
    // 문이 여럿이면 그중 하나만 약해도 전체가 약해집니다
    configureAdmin()
    vi.stubEnv('CRON_SECRET', CRON_SECRET)

    expect(proxy(ask('/api/cron/purge', { cookie: validCookie() })).status).toBe(401)
  })
})

describe('막은 응답도 규약을 지킨다', () => {
  it('계측 헤더 넷이 붙는다 — §1.1', () => {
    configureAdmin()

    const res = proxy(ask('/api/admin/cases/x/trace'))

    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(res.headers.has(name), name).toBe(true)
    }
  })

  it('그 값이 전송 중에 버려지지 않는다', () => {
    // Next 가 문지기 응답의 헤더를 옮길 때 `if (value)` 로 거릅니다
    // (node_modules/next/dist/server/lib/router-utils/resolve-routes.js).
    // 빈 문자열은 falsy 라 버려져, 붙였는데도 도착하지 않았습니다
    configureAdmin()

    const res = proxy(ask('/api/admin/cases/x/trace'))

    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(Boolean(res.headers.get(name)), `${name} 이 falsy 면 Next 가 버립니다`)
        .toBe(true)
    }
  })

  it('왜 막혔는지 자세히 말하지 않는다', async () => {
    configureAdmin()

    const res = proxy(ask('/api/admin/cases/x/trace'))
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(body.error.code).toBe('UNAUTHORIZED')
    // 아이디가 틀렸는지 쿠키가 지났는지를 구분해 주면 그게 곧 힌트입니다
    expect(body.error.message).not.toMatch(/쿠키|만료|아이디|비밀번호/)
  })
})
