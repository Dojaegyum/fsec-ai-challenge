/**
 * case-purger 시험.
 *
 * 검증 대상은 spec/backend/08-16-data-model.md §14 와 ADR-016 의
 * 「세 층이 같은 날 함께 사라진다」입니다.
 */

import { describe, expect, it, vi } from 'vitest'

import { createCasePurger } from './purge'
import type { PurgeTarget } from './types'

const TODAY = '2026-08-20'
const DUE: PurgeTarget[] = [{ caseId: 'CASE01', purgeAfter: '2026-08-19' }]

/**
 * 세 층을 흉내 낸다. `left` 에 넣은 층은 지워도 남아 있고,
 * `throws` 에 넣은 층은 지우다 던진다.
 */
function purger(
  over: {
    due?: PurgeTarget[]
    left?: string[]
    throws?: string
    remainsThrows?: string
  } = {},
) {
  const left = new Set(over.left ?? [])
  const calls: string[] = []

  const layer = (name: string) => ({
    del: vi.fn(async () => {
      calls.push(name)
      if (over.throws === name) throw new Error('접속 실패')
    }),
    remains: vi.fn(async () => {
      if (over.remainsThrows === name) throw new Error('조회 실패')
      return left.has(name)
    }),
  })

  const vault = layer('vault')
  const objects = layer('objects')
  const database = layer('database')
  const audit = { record: vi.fn(async () => {}) }

  const purge = createCasePurger({
    cases: {
      findDue: vi.fn(async () => over.due ?? DUE),
      delete: database.del,
      remains: database.remains,
    },
    objects: { deleteAll: objects.del, remains: objects.remains },
    vault: { delete: vault.del, remains: vault.remains },
    audit,
    clock: { today: () => TODAY },
  })

  return { purge, vault, objects, database, audit, calls }
}

describe('세 층을 순서대로 지운다', () => {
  it('볼트 → 객체 저장소 → 관계형 DB 순이다', async () => {
    // DB 가 마지막인 것은 그 행이 「무엇을 지워야 하는가」의 유일한 단서라서입니다
    const { purge, calls } = purger()

    await purge.run()

    expect(calls).toEqual(['vault', 'objects', 'database'])
  })

  it('전부 지워지면 감사 로그를 남긴다', async () => {
    const { purge, audit } = purger()

    const run = await purge.run()

    expect(run.purged).toEqual(['CASE01'])
    expect(run.failed).toEqual([])
    expect(audit.record).toHaveBeenCalledWith({
      eventType: 'case.purged',
      actorType: 'system',
      caseId: 'CASE01',
      detail: { purge_after: '2026-08-19' },
    })
  })

  it('볼트가 이미 비어 있어도 실패가 아니다', async () => {
    // 만료로 먼저 사라질 수 있습니다 → §14
    const { purge } = purger()

    const run = await purge.run()

    expect(run.purged).toEqual(['CASE01'])
  })
})

describe('한 층만 지우고 성공으로 처리하지 않는다', () => {
  it('객체 저장소가 남으면 DB 를 지우지 않는다', async () => {
    // 여기서 DB 를 지우면 남은 파일을 가리킬 단서가 사라집니다
    const { purge, database } = purger({ left: ['objects'] })

    const run = await purge.run()

    expect(run.purged).toEqual([])
    expect(database.del).not.toHaveBeenCalled()
  })

  it('멈춘 지점부터 뒤를 전부 남은 것으로 본다', async () => {
    const { purge } = purger({ left: ['objects'] })

    const run = await purge.run()

    expect(run.failed[0].remaining).toEqual(['objects', 'database'])
    expect(run.failed[0].purged).toBe(false)
  })

  it('볼트가 남으면 아무것도 더 지우지 않는다', async () => {
    const { purge, objects, database } = purger({ left: ['vault'] })

    const run = await purge.run()

    expect(run.failed[0].remaining).toEqual(['vault', 'objects', 'database'])
    expect(objects.del).not.toHaveBeenCalled()
    expect(database.del).not.toHaveBeenCalled()
  })

  it('실패하면 감사 로그를 남기지 않는다', async () => {
    // 지우지 않은 것을 지웠다고 기록하면 안 됩니다
    const { purge, audit } = purger({ left: ['objects'] })

    await purge.run()

    expect(audit.record).not.toHaveBeenCalled()
  })

  it('지우다 던지면 그 층부터 남은 것으로 본다', async () => {
    const { purge } = purger({ throws: 'objects' })

    const run = await purge.run()

    expect(run.failed[0].remaining).toEqual(['objects', 'database'])
    expect(run.failed[0].error).toContain('접속 실패')
  })

  it('확인 자체가 안 되면 지워졌다고 보지 않는다', async () => {
    const { purge, database } = purger({ remainsThrows: 'objects' })

    const run = await purge.run()

    expect(run.failed[0].remaining).toEqual(['objects', 'database'])
    expect(run.failed[0].error).toContain('확인 실패')
    expect(database.del).not.toHaveBeenCalled()
  })
})

describe('한 사건이 실패해도 나머지를 계속한다', () => {
  it('실패한 것과 지운 것을 갈라서 돌려준다', async () => {
    // 하나 때문에 전부 밀리면 파기가 무한정 늦어집니다
    const failing = new Set(['BAD'])
    const audit = { record: vi.fn(async () => {}) }
    const purge = createCasePurger({
      cases: {
        findDue: async () => [
          { caseId: 'GOOD1', purgeAfter: '2026-08-19' },
          { caseId: 'BAD', purgeAfter: '2026-08-19' },
          { caseId: 'GOOD2', purgeAfter: '2026-08-19' },
        ],
        delete: async () => {},
        remains: async () => false,
      },
      objects: {
        deleteAll: async () => {},
        remains: async (caseId) => failing.has(caseId),
      },
      vault: { delete: async () => {}, remains: async () => false },
      audit,
      clock: { today: () => TODAY },
    })

    const run = await purge.run()

    expect(run.scanned).toBe(3)
    expect(run.purged).toEqual(['GOOD1', 'GOOD2'])
    expect(run.failed.map((one) => one.caseId)).toEqual(['BAD'])
  })

  it('예외를 던지지 않는다', async () => {
    // 던지면 어느 사건에서 멈췄는지, 그 앞의 것들은 지워졌는지 알 수 없습니다
    const { purge } = purger({ throws: 'vault' })

    await expect(purge.run()).resolves.toMatchObject({ scanned: 1 })
  })
})

describe('대상 집기', () => {
  it('오늘을 기준으로 지난 사건만 집는다', async () => {
    const findDue = vi.fn(async () => [] as PurgeTarget[])
    const purge = createCasePurger({
      cases: { findDue, delete: async () => {}, remains: async () => false },
      objects: { deleteAll: async () => {}, remains: async () => false },
      vault: { delete: async () => {}, remains: async () => false },
      audit: { record: async () => {} },
      clock: { today: () => TODAY },
    })

    await purge.run({ limit: 10 })

    expect(findDue).toHaveBeenCalledWith(TODAY, 10)
  })

  it('대상이 없으면 조용히 끝난다', async () => {
    const { purge, audit } = purger({ due: [] })

    const run = await purge.run()

    expect(run).toEqual({ scanned: 0, purged: [], failed: [] })
    expect(audit.record).not.toHaveBeenCalled()
  })
})
