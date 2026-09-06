import { describe, expect, it, vi } from 'vitest'
import { hashPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { KbChangeNotFoundError } from '@/lib/errors'
import { ADMIN_SESSION_COOKIE, issueAdminSession } from '@/lib/session-cookie'
import { GET } from './route'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))
vi.mock('@/flows/kb-review', () => ({
  readChange: async (_c: unknown, changeId: string) => {
    if (changeId === '01J0000000000000000000000Z') {
      throw new KbChangeNotFoundError('그 변경을 찾지 못했습니다', { changeId })
    }
    return { change: { change_id: changeId }, before: null, after: null, affected: [], review: { status: 'pending' } }
  },
}))

const env = readEnv({ ADMIN_PASSWORD_HASH: hashPassword('pw-pw-pw-pw-pw') })
const ID = '01J0000000000000000000000A'

function ask(id: string, withCookie = true) {
  const session = issueAdminSession(env, serverClock.nowMs())!
  return GET(
    new Request(`http://x/api/admin/kb/changes/${id}`, {
      headers: withCookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` } : {},
    }),
    { params: Promise.resolve({ change_id: id }) },
  )
}

describe('변경 하나 — §7.2', () => {
  it('세션이 없으면 401', async () => {
    holder.container = createContainer(env)
    expect((await ask(ID, false)).status).toBe(401)
  })
  it('흐름이 돌려준 본문 그대로 200', async () => {
    holder.container = createContainer(env)
    const res = await ask(ID)
    expect(res.status).toBe(200)
    expect((await res.json()).change.change_id).toBe(ID)
  })
  it('없으면 404 KB_CHANGE_NOT_FOUND', async () => {
    holder.container = createContainer(env)
    const res = await ask('01J0000000000000000000000Z')
    expect(res.status).toBe(404)
    expect((await res.json()).error.code).toBe('KB_CHANGE_NOT_FOUND')
  })
  it('ULID 가 아니면 400', async () => {
    holder.container = createContainer(env)
    expect((await ask('nope')).status).toBe(400)
  })
})
