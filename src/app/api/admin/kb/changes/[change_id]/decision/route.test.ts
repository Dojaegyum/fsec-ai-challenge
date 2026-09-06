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
  decide: async (_c: unknown, changeId: string, input: { status: string; reviewedBy: string; note: string | null }) => {
    if (changeId === '01J0000000000000000000000D') {
      throw new KbChangeDecidedError('이미 판단이 끝난 변경입니다', { changeId })
    }
    holder.decided.push(input)
    return { change_id: changeId, review_status: input.status, reviewed_at: '2026-09-06T17:20:00+09:00' }
  },
}))

const env = readEnv({ ADMIN_PASSWORD_HASH: hashPassword('pw-pw-pw-pw-pw') })
const ID = '01J0000000000000000000000A'

function ask(id: string, body: unknown, withCookie = true) {
  const session = issueAdminSession(env, serverClock.nowMs())!
  return POST(
    new Request(`http://x/api/admin/kb/changes/${id}/decision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(withCookie ? { cookie: `${ADMIN_SESSION_COOKIE}=${session.value}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ change_id: id }) },
  )
}

describe('판단 — §7.3', () => {
  it('세션이 없으면 401', async () => {
    holder.container = createContainer(env)
    expect((await ask(ID, { status: 'approved', reviewed_by: '김태현' }, false)).status).toBe(401)
  })
  it('기록하고 시각을 돌려준다 — 빈 메모는 null 로', async () => {
    holder.container = createContainer(env)
    const res = await ask(ID, { status: 'approved', reviewed_by: '김태현', note: '  ' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      change_id: ID,
      review_status: 'approved',
      reviewed_at: '2026-09-06T17:20:00+09:00',
    })
    expect(holder.decided.at(-1)).toEqual({ status: 'approved', reviewedBy: '김태현', note: null })
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
