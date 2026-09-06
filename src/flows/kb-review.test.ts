import { describe, expect, it } from 'vitest'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { KbChangeNotFoundError } from '@/lib/errors'
import type { KbRow } from '@/modules/kb-finder'
import { createKbReviewer } from '@/modules/kb-reviewer'
import type { ChangeStore, SourceChange } from '@/modules/kb-reviewer'
import { decide, readChange, readEntries, readHistory, readQueue } from './kb-review'

const change = (over: Partial<SourceChange>): SourceChange => ({
  changeId: '01J0000000000000000000000A',
  sourceKey: 'law:011359:3',
  snapshotBefore: null,
  snapshotAfter: '01J0000000000000000000000S',
  detectedAt: '2026-09-06T04:00:12+09:00',
  dedupeKey: null,
  impact: null,
  reviewStatus: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  releasedVersion: null,
  ...over,
})

const entry = (id: string, legalBasis: string, over: Partial<KbRow> = {}): KbRow => ({
  kbEntryId: id,
  kbVersion: '2026.09.2',
  stepKey: id,
  stepSeq: 1,
  channelId: null,
  orgId: null,
  track: 'victim',
  title: `제목 ${id}`,
  body: {},
  legalBasis,
  sourceUrl: 'https://example.invalid',
  effectiveFrom: '2024-08-28',
  effectiveUntil: null,
  verifiedAt: '2026-08-25',
  ...over,
})

function wire(changes: SourceChange[], entries: KbRow[]) {
  const store = new Map(changes.map((one) => [one.changeId, one]))
  const changeStore: ChangeStore = {
    listByStatus: async (status) => [...store.values()].filter((one) => one.reviewStatus === status),
    findById: async (id) => store.get(id) ?? null,
    applyDecision: async (input) => {
      const found = store.get(input.changeId)!
      store.set(input.changeId, {
        ...found,
        reviewStatus: input.status,
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt,
        reviewNote: input.note,
      })
    },
    markReleased: async () => undefined,
  }
  const base = createContainer(readEnv({ KB_VERSION: '2026.09.2' }))
  return {
    ...base,
    kbChanges: changeStore,
    kbReviewer: createKbReviewer({ store: changeStore, clock: { now: () => '2026-09-06T17:20:00+09:00' } }),
    kbSnapshots: {
      byIds: async (ids: readonly string[]) =>
        ids.map((id) => ({
          snapshotId: id,
          sourceKey: 'law:011359:3',
          content: '① 피해자는 …',
          meta: { 시행일자: '20260804', 조문제목: '피해구제의 신청' },
        })),
    },
    ports: { ...base.ports, kbStore: { ...base.ports.kbStore, listEntries: async () => entries } },
  }
}

const ENTRIES = [
  entry('common-freeze-request', '통신사기피해환급법 제3조제1항 · 제4조제1항제1호'),
  entry('common-relief-documents', '시행령 제3조제1항'),
  entry('easypay-freeze-request', '통신사기피해환급법 제15조제3항', { channelId: 'CH-easypay' }),
  entry('frozen-objection-file', '통신사기피해환급법 제7조제1항', { track: 'frozen_account' }),
]

describe('큐 — §7.3', () => {
  it('묶음 · 조문 · 최초 수집 · 닿는 매뉴얼을 싣는다', async () => {
    const body = await readQueue(wire([change({})], ENTRIES), 'pending')
    expect(body.kb_version).toBe('2026.09.2')
    expect(body.counts).toEqual({ pending: 1, deferred: 0 })
    const one = body.groups[0]!.changes[0]!
    expect(one.article).toBe('제3조')
    expect(one.title).toBe('피해구제의 신청')
    expect(one.first_seen).toBe(true)
    expect(one.source.label).toBe('법 011359 · 통신사기피해환급법')
    expect(one.affected).toEqual(['common-freeze-request'])
  })
  it('미룬 것은 status=deferred 로 따로 본다', async () => {
    const body = await readQueue(wire([change({ reviewStatus: 'deferred' })], ENTRIES), 'deferred')
    expect(body.groups).toHaveLength(1)
    expect(body.counts).toEqual({ pending: 0, deferred: 1 })
  })
})

describe('변경 하나 — §7.3', () => {
  it('직전은 없고 이번 원문과 닿는 매뉴얼 상세가 온다', async () => {
    const body = await readChange(wire([change({})], ENTRIES), '01J0000000000000000000000A')
    expect(body.before).toBeNull()
    expect(body.after?.content).toBe('① 피해자는 …')
    expect(body.affected[0]).toMatchObject({
      kb_entry_id: 'common-freeze-request',
      file: 'common.json',
      verified_at: '2026-08-25',
    })
    expect(body.review.status).toBe('pending')
  })
  it('없으면 404 코드다', async () => {
    await expect(readChange(wire([], ENTRIES), '01J0000000000000000000000Z')).rejects.toBeInstanceOf(
      KbChangeNotFoundError,
    )
  })
})

describe('판단 — §7.3', () => {
  it('기록하고 시각을 돌려준다', async () => {
    const c = wire([change({})], ENTRIES)
    const body = await decide(c, '01J0000000000000000000000A', {
      status: 'approved',
      reviewedBy: '김태현',
      note: null,
    })
    expect(body).toEqual({
      change_id: '01J0000000000000000000000A',
      review_status: 'approved',
      reviewed_at: '2026-09-06T17:20:00+09:00',
    })
  })
})

describe('매뉴얼 렌즈 — §7.3', () => {
  it('파일 이름을 규약에서 계산하고 닿은 미검수 변경을 단다', async () => {
    const body = await readEntries(wire([change({})], ENTRIES))
    const byId = Object.fromEntries(body.entries.map((one) => [one.kb_entry_id, one]))
    expect(byId['common-freeze-request']!.file).toBe('common.json')
    expect(byId['easypay-freeze-request']!.file).toBe('ch-easypay.json')
    expect(byId['frozen-objection-file']!.file).toBe('frozen-account.json')
    expect(byId['common-freeze-request']!.pending_changes).toEqual(['01J0000000000000000000000A'])
    expect(byId['easypay-freeze-request']!.pending_changes).toEqual([])
  })
})

describe('이력 — §7.3', () => {
  it('판단 끝난 것을 최신순으로', async () => {
    const c = wire(
      [
        change({ changeId: '01J0000000000000000000000B', reviewStatus: 'approved', reviewedAt: '2026-09-06T10:00:00+09:00', reviewedBy: '김태현' }),
        change({ changeId: '01J0000000000000000000000C', reviewStatus: 'rejected', reviewedAt: '2026-09-06T11:00:00+09:00', reviewedBy: '김태현' }),
        change({}),
      ],
      ENTRIES,
    )
    const body = await readHistory(c)
    expect(body.changes.map((one) => one.change_id)).toEqual([
      '01J0000000000000000000000C',
      '01J0000000000000000000000B',
    ])
    expect(body.changes[0]!.review.status).toBe('rejected')
  })
})
