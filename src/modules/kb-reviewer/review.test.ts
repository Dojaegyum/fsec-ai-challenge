/**
 * 검수기 시험.
 *
 * 검증 대상: spec/backend/08-16-data-model.md §12.2 ·
 *            spec/backend/08-14-kb-operations.md 원칙 4 · rfc/002-kb-authoring.md
 *
 * **여기서 못 박는 것 넷:**
 * 1. 확신도가 낮다고 버리지 않는다
 * 2. 같은 발표는 한 묶음, 다른 것은 억지로 합치지 않는다
 * 3. 검수 이력을 덮어쓰지 않는다
 * 4. 승인 없이 반영된 것으로 표시할 수 없다
 */

import { describe, expect, it } from 'vitest'

import { KbError } from '@/lib/errors'

import { createKbReviewer } from './review'
import type { ChangeStore, Clock, ReviewStatus, SourceChange } from './types'

const NOW = '2026-08-21T14:00:00.000+09:00'
const clock: Clock = { now: () => NOW }

function change(over: Partial<SourceChange> = {}): SourceChange {
  return {
    changeId: 'c1',
    sourceKey: 'fsc:press:2026-08-20:1',
    snapshotBefore: null,
    snapshotAfter: 'snap-1',
    detectedAt: '2026-08-20T09:00:00.000+09:00',
    dedupeKey: null,
    impact: null,
    reviewStatus: 'pending',
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    releasedVersion: null,
    ...over,
  }
}

/**
 * 검수 큐 흉내.
 *
 * **`applyDecision` 이 실제로 행을 바꿉니다.** 담기만 하면 검수 → 릴리스로
 * 이어지는 경로를 시험할 수 없고, 「이미 판단이 끝난 것을 다시 판단하지
 * 않는다」도 확인할 수 없습니다.
 */
function storeOf(seed: readonly SourceChange[]) {
  const rows: SourceChange[] = [...seed]
  const decisions: Record<string, unknown>[] = []
  const released: { changeId: string; kbVersion: string }[] = []

  const put = (changeId: string, patch: Partial<SourceChange>) => {
    const at = rows.findIndex((row) => row.changeId === changeId)
    if (at >= 0) rows[at] = { ...rows[at], ...patch }
  }

  const store: ChangeStore = {
    async listByStatus(status: ReviewStatus) {
      return rows.filter((row) => row.reviewStatus === status)
    },
    async findById(changeId) {
      return rows.find((row) => row.changeId === changeId) ?? null
    },
    async applyDecision(input) {
      decisions.push(input)
      put(input.changeId, {
        reviewStatus: input.status,
        reviewedBy: input.reviewedBy,
        reviewedAt: input.reviewedAt,
        reviewNote: input.note,
      })
    },
    async markReleased(changeId, kbVersion) {
      released.push({ changeId, kbVersion })
      put(changeId, { releasedVersion: kbVersion })
    },
  }
  return { store, rows, decisions, released, reviewer: createKbReviewer({ store, clock }) }
}

describe('확신도가 낮다고 버리지 않는다 — §12.2', () => {
  it('확신도 0 도 큐에 남는다', async () => {
    // 정본: "확신도가 낮은 판정을 자동으로 버리지 않습니다"
    // 낮은 확신도는 덜 중요하다는 뜻이 아니라 기계가 판단을 못 했다는 뜻입니다
    const { reviewer } = storeOf([
      change({ changeId: 'c1', impact: { confidence: 0 } }),
      change({ changeId: 'c2', impact: { confidence: 0.95 } }),
    ])

    const queue = await reviewer.queue()

    expect(queue).toHaveLength(2)
    expect(queue.map((g) => g.changes[0].changeId).sort()).toEqual(['c1', 'c2'])
  })

  it('영향 분석이 아예 없어도 큐에 남는다', async () => {
    const { reviewer } = storeOf([change({ impact: null })])

    const queue = await reviewer.queue()

    expect(queue).toHaveLength(1)
    expect(queue[0].confidence).toBeNull()
  })

  it('확신도로 줄 세우지 않는다 — 먼저 감지된 것이 앞이다', async () => {
    // 확신도순으로 정렬하면 낮은 것이 아래로 밀려 안 보게 됩니다.
    //
    // **먼저 감지된 쪽에 높은 확신도를 줍니다.** 반대로 두면 오름차순 정렬과
    // 감지 순 정렬이 같은 답을 내 둘을 구분하지 못합니다
    const { reviewer } = storeOf([
      change({
        changeId: 'late-low',
        detectedAt: '2026-08-20T12:00:00.000+09:00',
        impact: { confidence: 0.01 },
      }),
      change({
        changeId: 'early-high',
        detectedAt: '2026-08-19T12:00:00.000+09:00',
        impact: { confidence: 0.99 },
      }),
    ])

    const queue = await reviewer.queue()

    expect(queue.map((g) => g.changes[0].changeId)).toEqual(['early-high', 'late-low'])
  })

  it('밀리초 표기가 섞여도 감지 순서를 지킨다', async () => {
    // detected_at 은 TIMESTAMPTZ(3) 이고 Postgres 는 밀리초가 0이면 소수부를
    // 생략합니다. 문자열 대조로 정렬하면 이때 더 이른 것이 뒤로 갑니다
    const { reviewer } = storeOf([
      change({ changeId: 'later', detectedAt: '2026-08-20T09:00:00.001+09:00' }),
      change({ changeId: 'earlier', detectedAt: '2026-08-20T09:00:00+09:00' }),
    ])

    const queue = await reviewer.queue()

    expect(queue.map((g) => g.changes[0].changeId)).toEqual(['earlier', 'later'])
  })

  it('판단이 끝난 것은 큐에 안 나온다', async () => {
    const { reviewer } = storeOf([
      change({ changeId: 'done', reviewStatus: 'approved' }),
      change({ changeId: 'todo' }),
    ])

    const queue = await reviewer.queue()

    expect(queue.map((g) => g.changes[0].changeId)).toEqual(['todo'])
  })
})

describe('같은 발표는 한 묶음 — §12.2', () => {
  it('같은 키는 하나로 묶는다', async () => {
    // 금융위는 게시판을 넷 운영해 같은 발표가 여러 곳에 올라옵니다.
    // 본문이 달라 해시로는 안 걸려 사람이 같은 것을 네 번 보게 됩니다
    const { reviewer } = storeOf([
      change({ changeId: 'press', dedupeKey: '2026-08-20/통신사기법-시행령' }),
      change({ changeId: 'notice', dedupeKey: '2026-08-20/통신사기법-시행령' }),
    ])

    const queue = await reviewer.queue()

    expect(queue).toHaveLength(1)
    expect(queue[0].changes).toHaveLength(2)
  })

  it('묶는 키가 없는 것은 각자 한 묶음이다', async () => {
    // 억지로 합치면 서로 다른 제도 변경이 한 줄로 보여
    // 하나를 승인하면서 다른 하나까지 승인하게 됩니다
    const { reviewer } = storeOf([
      change({ changeId: 'a', dedupeKey: null }),
      change({ changeId: 'b', dedupeKey: null }),
    ])

    const queue = await reviewer.queue()

    expect(queue).toHaveLength(2)
  })

  it('빈 문자열 키도 합치지 않는다', async () => {
    // 키가 빈 값이면 "묶을 근거가 없다"는 뜻입니다
    const { reviewer } = storeOf([
      change({ changeId: 'a', dedupeKey: '' }),
      change({ changeId: 'b', dedupeKey: '' }),
    ])

    expect(await reviewer.queue()).toHaveLength(2)
  })

  it('원문 스냅샷을 전부 남긴다', async () => {
    // 근거가 여럿인 편이 낫습니다 — 묶었다고 버리지 않습니다
    const { reviewer } = storeOf([
      change({ changeId: 'a', dedupeKey: 'k', snapshotAfter: 'snap-a' }),
      change({ changeId: 'b', dedupeKey: 'k', snapshotAfter: 'snap-b' }),
    ])

    const queue = await reviewer.queue()

    expect(queue[0].changes.map((c) => c.snapshotAfter)).toEqual(['snap-a', 'snap-b'])
  })

  it('묶음의 확신도는 가장 높은 것이다', async () => {
    // 낮은 쪽으로 잡으면 근거가 여럿인 묶음이 오히려 덜 확실해 보입니다
    const { reviewer } = storeOf([
      change({ changeId: 'a', dedupeKey: 'k', impact: { confidence: 0.3 } }),
      change({ changeId: 'b', dedupeKey: 'k', impact: { confidence: 0.8 } }),
    ])

    expect((await reviewer.queue())[0].confidence).toBe(0.8)
  })

  it('영향받는 항목을 합쳐서 겹치지 않게 낸다', async () => {
    const { reviewer } = storeOf([
      change({
        changeId: 'a',
        dedupeKey: 'k',
        impact: { affectedEntries: ['kb:지급정지', 'kb:피해구제신청'] },
      }),
      change({
        changeId: 'b',
        dedupeKey: 'k',
        impact: { affectedEntries: ['kb:지급정지'] },
      }),
    ])

    expect((await reviewer.queue())[0].affectedEntries).toEqual([
      'kb:지급정지',
      'kb:피해구제신청',
    ])
  })

  it('묶음은 그 안에서 가장 먼저 감지된 때로 줄 세운다', async () => {
    const { reviewer } = storeOf([
      change({ changeId: 'solo', detectedAt: '2026-08-20T10:00:00.000+09:00' }),
      change({
        changeId: 'pair-late',
        dedupeKey: 'k',
        detectedAt: '2026-08-20T18:00:00.000+09:00',
      }),
      change({
        changeId: 'pair-early',
        dedupeKey: 'k',
        detectedAt: '2026-08-19T08:00:00.000+09:00',
      }),
    ])

    const queue = await reviewer.queue()

    expect(queue[0].dedupeKey).toBe('k')
    expect(queue[1].changes[0].changeId).toBe('solo')
  })
})

describe('검수 이력을 덮어쓰지 않는다', () => {
  it('판단을 누가 언제 했는지 함께 남긴다', async () => {
    const { reviewer, decisions } = storeOf([change()])

    await reviewer.review({ changeId: 'c1', status: 'approved', reviewedBy: '김태현' })

    expect(decisions[0]).toEqual({
      changeId: 'c1',
      status: 'approved',
      reviewedBy: '김태현',
      reviewedAt: NOW,
      note: null,
    })
  })

  it('이미 판단이 끝난 것을 다시 판단하면 거절한다', async () => {
    // 덮어쓰면 「사람 검수 생략 불가」를 지켰는지 확인할 방법이 없어집니다
    const { reviewer, decisions } = storeOf([
      change({ reviewStatus: 'rejected', reviewedBy: '김태현' }),
    ])

    await expect(
      reviewer.review({ changeId: 'c1', status: 'approved', reviewedBy: '다른사람' }),
    ).rejects.toBeInstanceOf(KbError)
    expect(decisions).toHaveLength(0)
  })

  it('미룬 것도 다시 판단하지 않는다', async () => {
    const { reviewer } = storeOf([change({ reviewStatus: 'deferred' })])

    await expect(
      reviewer.review({ changeId: 'c1', status: 'approved', reviewedBy: '김태현' }),
    ).rejects.toThrow(KbError)
  })

  it('없는 변경은 거절한다', async () => {
    const { reviewer, decisions } = storeOf([])

    await expect(
      reviewer.review({ changeId: 'nope', status: 'approved', reviewedBy: '김태현' }),
    ).rejects.toBeInstanceOf(KbError)
    expect(decisions).toHaveLength(0)
  })

  it('검수자가 비면 거절한다', async () => {
    // 누가 봤는지가 안 남으면 「사람이 봤다」를 증명할 수 없습니다
    const { reviewer, decisions } = storeOf([change()])

    await expect(
      reviewer.review({ changeId: 'c1', status: 'approved', reviewedBy: '   ' }),
    ).rejects.toBeInstanceOf(KbError)
    expect(decisions).toHaveLength(0)
  })

  it('미룬 판단을 값 그대로 남긴다', async () => {
    const { reviewer, decisions } = storeOf([change()])

    await reviewer.review({
      changeId: 'c1',
      status: 'deferred',
      reviewedBy: '김태현',
      note: '시행일 확인 후 다시',
    })

    expect(decisions[0]).toEqual({
      changeId: 'c1',
      status: 'deferred',
      reviewedBy: '김태현',
      reviewedAt: NOW,
      note: '시행일 확인 후 다시',
    })
  })

  it('거절을 승인으로 바꿔 적지 않는다', async () => {
    // **사람이 누른 값이 그대로 남아야 합니다.** 여기가 「사람 검수는 생략
    // 불가」와 「승인 없이 반영하지 않는다」가 함께 걸려 있는 한 줄입니다
    const { reviewer, decisions, rows } = storeOf([change()])

    await reviewer.review({
      changeId: 'c1',
      status: 'rejected',
      reviewedBy: '김태현',
      note: '우리 절차와 무관',
    })

    expect(decisions[0]).toMatchObject({ status: 'rejected' })
    expect(rows[0].reviewStatus).toBe('rejected')
  })

  it('거절한 것은 반영 기록도 못 받는다', async () => {
    // 판단을 잘못 적으면 이 문이 열립니다 — 실제로 이어서 확인합니다
    const { reviewer, released } = storeOf([change()])

    await reviewer.review({ changeId: 'c1', status: 'rejected', reviewedBy: '김태현' })

    await expect(reviewer.markReleased('c1', 'kb-2026-08-21')).rejects.toBeInstanceOf(
      KbError,
    )
    expect(released).toHaveLength(0)
  })

  it('승인한 것은 이어서 반영 기록을 받는다', async () => {
    const { reviewer, released } = storeOf([change()])

    await reviewer.review({ changeId: 'c1', status: 'approved', reviewedBy: '김태현' })
    await reviewer.markReleased('c1', 'kb-2026-08-21')

    expect(released).toEqual([{ changeId: 'c1', kbVersion: 'kb-2026-08-21' }])
  })

  it('판단한 것은 큐에서 빠진다', async () => {
    const { reviewer } = storeOf([change()])

    await reviewer.review({ changeId: 'c1', status: 'approved', reviewedBy: '김태현' })

    expect(await reviewer.queue()).toHaveLength(0)
  })
})

describe('승인 없이 반영된 것으로 표시할 수 없다 — 원칙 4', () => {
  it('승인된 것만 반영 기록을 받는다', async () => {
    const { reviewer, released } = storeOf([change({ reviewStatus: 'approved' })])

    await reviewer.markReleased('c1', 'kb-2026-08-21')

    expect(released).toEqual([{ changeId: 'c1', kbVersion: 'kb-2026-08-21' }])
  })

  it('아직 안 본 것은 거절한다', async () => {
    const { reviewer, released } = storeOf([change({ reviewStatus: 'pending' })])

    await expect(reviewer.markReleased('c1', 'kb-2026-08-21')).rejects.toBeInstanceOf(
      KbError,
    )
    expect(released).toHaveLength(0)
  })

  it('거절된 것은 거절한다', async () => {
    // 이 검사가 없으면 거절된 변경도 반영된 것으로 표시할 수 있습니다
    const { reviewer, released } = storeOf([change({ reviewStatus: 'rejected' })])

    await expect(reviewer.markReleased('c1', 'kb-2026-08-21')).rejects.toThrow(KbError)
    expect(released).toHaveLength(0)
  })

  it('버전이 비면 거절한다', async () => {
    // 어느 버전에 들어갔는지가 안 남으면 나중에 되짚을 수 없습니다
    const { reviewer, released } = storeOf([change({ reviewStatus: 'approved' })])

    await expect(reviewer.markReleased('c1', '  ')).rejects.toBeInstanceOf(KbError)
    expect(released).toHaveLength(0)
  })

  it('매뉴얼에 쓸 수단을 아예 갖지 않는다', () => {
    // 이 모듈은 검수까지입니다 — 반영은 사람이 파일을 고치는 것,
    // 릴리스는 적재기가 하는 것입니다 → RFC-002
    const surface = Object.keys(
      createKbReviewer({ store: storeOf([]).store, clock }),
    )

    expect(surface.sort()).toEqual(['markReleased', 'queue', 'review'])
  })
})
