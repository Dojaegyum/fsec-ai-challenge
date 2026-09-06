/**
 * `POST /api/cron/evidence-resubmit` 시험 — 비밀값이 관문이고, 응답은 건수뿐인가 (ADR-091 §5).
 */
import { describe, expect, it, vi } from 'vitest'

import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'

import { POST } from './route'

const SECRET = 'a-long-random-cron-secret'
const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

const report = { scanned: 2, resubmitted: 1, running: 1, unreachable: 0, failed: 0, skipped: 0 }
const resubmitEvidence = vi.hoisted(() => vi.fn(async () => report))
vi.mock('@/flows/resubmit-evidence', () => ({ resubmitEvidence }))

function ask(headers: Record<string, string> = {}) {
  return new Request('http://x/api/cron/evidence-resubmit', { method: 'POST', headers })
}

function wire(env: Record<string, string> = { CRON_SECRET: SECRET }) {
  holder.container = createContainer(readEnv(env))
}

describe('두 번째 관문 — §6.1', () => {
  it('헤더가 없으면 401 이다', async () => {
    wire()
    expect((await POST(ask())).status).toBe(401)
  })

  it('비밀값이 비어 있는 서버는 맞는 헤더로도 401 이다', async () => {
    wire({})
    expect((await POST(ask({ authorization: `Bearer ${SECRET}` }))).status).toBe(401)
  })
})

describe('건수만 답한다', () => {
  it('흐름을 한 번 부르고 그 보고를 그대로 낸다', async () => {
    wire()
    const res = await POST(ask({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(report)
    expect(resubmitEvidence).toHaveBeenCalledTimes(1)
  })
})
