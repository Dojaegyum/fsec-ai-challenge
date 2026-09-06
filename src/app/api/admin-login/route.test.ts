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
