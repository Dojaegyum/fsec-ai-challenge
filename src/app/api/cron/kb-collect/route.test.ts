/**
 * `GET /api/cron/kb-collect` 시험 — §6.1 관문과 §6.5 응답 모양.
 */

import { describe, expect, it, vi } from 'vitest'

import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CollectResult } from '@/modules/kb-collector'

import { GET } from './route'

const SECRET = 'a-long-random-cron-secret'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

function ask(headers: Record<string, string> = {}) {
  return new Request('http://x/api/cron/kb-collect', { headers })
}

function wire(run: CollectResult, env: Record<string, string> = { CRON_SECRET: SECRET }) {
  holder.container = {
    ...createContainer(readEnv(env)),
    kbCollector: { collect: async () => run },
  }
}

const EMPTY: CollectResult = { results: [], stale: [] }

describe('두 번째 관문 — §6.1', () => {
  it('헤더가 없으면 401 이다', async () => {
    wire(EMPTY)
    expect((await GET(ask())).status).toBe(401)
  })

  it('비밀값이 설정 안 된 서버는 닫혀 있다', async () => {
    wire(EMPTY, {})
    expect((await GET(ask({ authorization: 'Bearer anything' }))).status).toBe(401)
  })
})

describe('응답은 소스별 건수다 — §6.5', () => {
  it('더한 것·같은 것·오류를 소스마다 센다', async () => {
    wire({
      results: [
        { sourceKeyPrefix: 'law:011359', added: 2, unchanged: 29, pages: 1, hitPageLimit: false },
        {
          sourceKeyPrefix: 'law:011448',
          added: 0,
          unchanged: 0,
          pages: 1,
          hitPageLimit: false,
          error: 'TypeError',
        },
      ],
      stale: ['law:011448'],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sources: [
        { source: 'law:011359', added: 2, unchanged: 29, pages: 1, hit_page_limit: false },
        { source: 'law:011448', added: 0, unchanged: 0, pages: 1, hit_page_limit: false, error: 'TypeError' },
      ],
      stale: ['law:011448'],
    })
  })
})
