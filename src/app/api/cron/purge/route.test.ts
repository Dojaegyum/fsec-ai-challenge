/**
 * `GET /api/cron/purge` 시험 — **비밀값이 관문이고, 응답은 건수뿐인가.**
 *
 * 검증 대상: spec/backend/08-16-data-model.md §14 · spec/common/08-14-api.md §6
 * 근거: ADR-016(세 층 같은 수명) · ADR-025(Vercel Cron 이 앱의 라우트를 깨운다)
 *
 * ## 왜 관문 시험이 여기서 특히 무거운가
 *
 * 이 경로는 **되돌릴 수 없는 삭제**를 합니다. 비밀값이 비어 있는 서버가 열려
 * 있으면 남의 사건을 밖에서 지울 수 있습니다 — 그래서 「설정 안 된 서버는
 * 닫혀 있다」를 알림 크론과 **같은 강도로** 못 박습니다.
 *
 * **여기서 못 박는 것 넷:**
 * 1. 두 번째 관문 — 문지기를 지나쳤어도 비밀값 없이는 401 이다 (§6.1)
 * 2. 응답에 사건 식별자가 안 실린다 — 크론 응답은 실행 기록에 남는다
 * 3. 일부가 실패해도 200 이고, 남은 층이 종류별로 세어진다
 * 4. 실패한 사건은 서버 로그에 남는다 — 파기가 밀린 것을 관측할 유일한 자리
 */

import { describe, expect, it, vi } from 'vitest'

import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { PurgeRun } from '@/modules/case-purger'

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
  return new Request('http://x/api/cron/purge', { headers })
}

/** 조립본의 크론 비밀값과 파기 결과를 갈아 끼웁니다 */
function wire(run: PurgeRun, env: Record<string, string> = { CRON_SECRET: SECRET }) {
  holder.container = {
    ...createContainer(readEnv(env)),
    casePurger: { run: async () => run },
  }
}

const EMPTY: PurgeRun = { scanned: 0, purged: [], failed: [] }

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

  /**
   * **되돌릴 수 없는 삭제를 하는 경로입니다.** 비교할 것이 없을 때 통과시키면
   * 설정을 빠뜨린 서버의 파기를 밖에서 부를 수 있습니다.
   */
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
      scanned: 0,
      purged: 0,
      failed: 0,
      remaining: {},
    })
  })
})

describe('응답은 건수뿐이다', () => {
  it('집은 수·지운 수·실패한 수를 센다', async () => {
    wire({
      scanned: 3,
      purged: [CASE_ID, '01J8CASE000000000000000001'],
      failed: [
        {
          caseId: '01J8CASE000000000000000002',
          purged: false,
          remaining: ['objects', 'database'],
          error: '객체 저장소가 지워지지 않았습니다',
        },
      ],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      scanned: 3,
      purged: 2,
      failed: 1,
      // 어느 층이 몇 건 남았나 — 볼트만 계속 남으면 볼트 설정이,
      // 객체 저장소만 남으면 삭제 권한이 문제입니다
      remaining: { objects: 1, database: 1 },
    })
  })

  it('사건 식별자가 응답에 없다 — 크론 응답은 실행 기록에 남습니다', async () => {
    wire({
      scanned: 1,
      purged: [CASE_ID],
      failed: [],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))
    const text = JSON.stringify(await res.json())

    expect(text).not.toContain(CASE_ID)
  })
})

/**
 * **파기가 밀렸을 때 관측할 방법이 필요합니다** → ADR-025 「남은 것」.
 * 어느 층이 안 지워졌는지 모르면 고칠 수가 없습니다.
 */
describe('일부가 실패해도 멈추지 않는다', () => {
  it('실패가 있어도 200 이고, 남은 것은 서버 로그에 적힌다', async () => {
    const logged: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      logged.push(args.map(String).join(' '))
    })

    wire({
      scanned: 2,
      purged: [CASE_ID],
      failed: [
        {
          caseId: '01J8CASE000000000000000009',
          purged: false,
          remaining: ['vault', 'objects', 'database'],
          error: '볼트가 지워지지 않았습니다',
        },
      ],
    })

    const res = await GET(ask({ authorization: `Bearer ${SECRET}` }))

    expect(res.status).toBe(200)
    expect(logged.join('\n')).toContain('01J8CASE000000000000000009')
    expect(logged.join('\n')).toContain('vault')

    spy.mockRestore()
  })
})
