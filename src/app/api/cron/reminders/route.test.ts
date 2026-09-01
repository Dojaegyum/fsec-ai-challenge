/**
 * `GET /api/cron/reminders` 시험 — **비밀값이 관문이고, 응답은 건수뿐인가.**
 *
 * 검증 대상: spec/common/08-14-api.md §6 · §6.2
 * 근거: ADR-025(Vercel Cron 이 앱의 라우트를 깨운다) · ADR-021(이메일은 선택)
 *
 * **여기서 못 박는 것 셋:**
 * 1. 두 번째 관문 — 문지기를 지나쳤어도 비밀값 없이는 401 이다 (§6.1)
 * 2. 응답에 이메일 주소·사건 식별자가 안 실린다 (§6.2)
 * 3. 발송 수단이 없어도 크론은 돈다 — failed 로 정직하게 남는다
 */

import { describe, expect, it, vi } from 'vitest'

import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { ReminderRun } from '@/modules/reminder-sender'

import { GET } from './route'

const SECRET = 'a-long-random-cron-secret'
const CASE_ID = '01J8CASE000000000000000000'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

function ask(headers: Record<string, string> = {}) {
  return new Request('http://x/api/cron/reminders', { headers })
}

/** 조립본의 크론 비밀값과 리마인더 결과를 갈아 끼웁니다 */
function wire(run: ReminderRun, env: Record<string, string> = { CRON_SECRET: SECRET }) {
  holder.container = {
    ...createContainer(readEnv(env)),
    reminderSender: { run: async () => run },
  }
}

const EMPTY: ReminderRun = { sent: [], skipped: [], failed: [] }

describe('두 번째 관문 — §6.1', () => {
  it('헤더가 없으면 401 이다', async () => {
    wire(EMPTY)

    expect((await GET(ask())).status).toBe(401)
  })

  it('비밀값이 틀리면 401 이다', async () => {
    wire(EMPTY)

    const res = await GET(ask({ authorization: 'Bearer wrong-secret-value-x' }))

    expect(res.status).toBe(401)
  })

  it('비밀값이 설정 안 된 서버는 닫혀 있다 — 열린 쪽으로 실패하지 않는다', async () => {
    wire(EMPTY, {})

    const res = await GET(ask({ authorization: 'Bearer anything' }))

    expect(res.status).toBe(401)
  })

  it('맞는 비밀값이면 돈다', async () => {
    wire(EMPTY)

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sent: 0,
      skipped: { no_email: 0, not_confirmed: 0, already_sent: 0, nothing_due: 0 },
      failed: 0,
    })
  })
})

describe('응답은 건수뿐이다 — §6.2', () => {
  it('보낸 것·건너뛴 것·실패한 것을 이유별로 센다', async () => {
    wire({
      sent: [
        {
          caseId: CASE_ID,
          email: 'name@example.com',
          reason: 'deadline_near',
          dedupeKey: `${CASE_ID}|d:D1:2026-08-21`,
          deadlines: [],
          steps: [],
        },
      ],
      skipped: [
        { caseId: 'C2', reason: 'no_email' },
        { caseId: 'C3', reason: 'no_email' },
        { caseId: 'C4', reason: 'not_confirmed' },
      ],
      failed: [{ caseId: 'C5', error: 'Mailer 이(가) 아직 설정되지 않았습니다: send' }],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))
    const body = await res.json()

    expect(body).toEqual({
      sent: 1,
      skipped: { no_email: 2, not_confirmed: 1, already_sent: 0, nothing_due: 0 },
      failed: 1,
    })
  })

  it('이메일 주소도 사건 식별자도 응답에 없다 — 크론 응답은 실행 기록에 남습니다', async () => {
    wire({
      sent: [
        {
          caseId: CASE_ID,
          email: 'name@example.com',
          reason: 'deadline_near',
          dedupeKey: `${CASE_ID}|d:D1:2026-08-21`,
          deadlines: [],
          steps: [],
        },
      ],
      skipped: [],
      failed: [],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))
    const text = JSON.stringify(await res.json())

    expect(text).not.toContain('name@example.com')
    expect(text).not.toContain(CASE_ID)
  })

  it('발송 수단이 없어도 크론은 돈다 — failed 가 그 사실을 말한다', async () => {
    // send.ts 가 사건 단위 try/catch 라, Mailer 미설정이면 보낼 사건만
    // NotConfiguredError 문자열로 failed 에 남습니다 — 200 이 맞습니다
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    wire({
      sent: [],
      skipped: [{ caseId: 'C2', reason: 'nothing_due' }],
      failed: [{ caseId: 'C5', error: 'Mailer 이(가) 아직 설정되지 않았습니다: send' }],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
    expect(((await res.json()) as { failed: number }).failed).toBe(1)
    // 원인은 서버 로그로 갑니다 — 응답이 아니라
    expect(quiet).toHaveBeenCalled()
    quiet.mockRestore()
  })
})
