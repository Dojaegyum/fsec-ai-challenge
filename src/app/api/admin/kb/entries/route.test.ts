import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import { GET as ENTRIES } from './route'
import { GET as HISTORY } from '../history/route'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))
vi.mock('@/flows/kb-review', () => ({
  readEntries: async () => ({ kb_version: '2026.09.2', entries: [] }),
  readHistory: async () => ({ changes: [] }),
}))

const env = readEnv({ ADMIN_PASSWORD_HASH: hashPassword('pw-pw-pw-pw-pw') })

function ask(path: string, withCookie = true) {
  const session = issueAdminSession(env, serverClock.nowMs())!
  return new Request(`http://x${path}`, {
    headers: withCookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` } : {},
  })
}

describe('매뉴얼 렌즈 · 이력 — §7.2', () => {
  it('세션이 없으면 둘 다 401', async () => {
    holder.container = createContainer(env)
    expect((await ENTRIES(ask('/api/admin/kb/entries', false))).status).toBe(401)
    expect((await HISTORY(ask('/api/admin/kb/history', false))).status).toBe(401)
  })
  it('세션이 있으면 둘 다 200', async () => {
    holder.container = createContainer(env)
    const entries = await ENTRIES(ask('/api/admin/kb/entries'))
    expect(entries.status).toBe(200)
    expect((await entries.json()).kb_version).toBe('2026.09.2')
    const history = await HISTORY(ask('/api/admin/kb/history'))
    expect(history.status).toBe(200)
    expect(await history.json()).toEqual({ changes: [] })
  })
})
