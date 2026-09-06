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
