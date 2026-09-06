import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import { GET } from './route'

const holder = vi.hoisted(() => ({ container: undefined as unknown, asked: [] as string[] }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))
vi.mock('@/flows/kb-review', () => ({
  readQueue: async (_c: unknown, status: string) => {
    holder.asked.push(status)
    return { kb_version: '2026.09.2', counts: { pending: 0, deferred: 0 }, groups: [] }
  },
}))

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
    expect(holder.asked.at(-1)).toBe('pending')
  })
  it('deferred 도 받는다', async () => {
    holder.container = createContainer(env)
    expect((await GET(ask('?status=deferred'))).status).toBe(200)
    expect(holder.asked.at(-1)).toBe('deferred')
  })
  it('status 가 둘 밖이면 400', async () => {
    holder.container = createContainer(env)
    expect((await GET(ask('?status=approved'))).status).toBe(400)
  })
})
