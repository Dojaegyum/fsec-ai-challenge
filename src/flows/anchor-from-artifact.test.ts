/**
 * 부산물이 기산점을 남기는가 — **이 줄이 없어서 기한이 하나도 안 섰습니다.**
 *
 * 계약: spec/backend/08-14-completion-hook.md ① · spec/common/08-16-deadline-rules.md
 *
 * 2026-08-27 에 사슬을 끝까지 걸어 보고 드러난 자리입니다. 단계는 순서대로
 * 열리는데 `GET …/deadlines` 가 **모든 경로에서 빈 배열**이었습니다 —
 * KB 가 기산점으로 쓰는 슬롯을 아무도 안 채우고 있었습니다.
 *
 * **통과하는 시험은 증거가 아닙니다.** 이 파일이 지키는 것은 「불렀다」가 아니라
 * 「무엇을 · 어떤 표시로 · 몇 번 쓰는가」입니다 — 셋 다 틀리면 기한이 조용히
 * 어긋납니다.
 */

import { describe, expect, it, vi } from 'vitest'

import { anchorFromArtifact } from './anchor-from-artifact'

import type { Container } from '@/lib/container'
import type { SlotView } from '@/lib/db'

function containerWith(slots: readonly Partial<SlotView>[] = []) {
  const write = vi.fn(async () => undefined)
  const container = {
    slots: {
      read: async () =>
        slots.map((one) => ({
          slotKey: 'relief_applied_at',
          tier: 'T2',
          state: 'confirmed',
          valueMasked: '2026-08-20',
          valueType: 'date',
          source: 'system',
          ...one,
        })) as readonly SlotView[],
    },
    slotWrite: { write },
  } as unknown as Container
  return { container, write }
}

describe('부산물이 기산점을 남긴다', () => {
  it('relief-apply 가 끝나면 relief_applied_at 을 채운다', async () => {
    const { container, write } = containerWith([])

    const filled = await anchorFromArtifact({
      caseId: '01J8XKRB',
      stepKey: 'relief-apply',
      container,
    })

    expect(filled).toBe('relief_applied_at')
    expect(write).toHaveBeenCalledTimes(1)
    const [arg] = write.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(arg.slotKey).toBe('relief_applied_at')
    expect(arg.state).toBe('confirmed')
    // **`system` 이어야 확정 기한이 됩니다** — `user` 면 추정으로 나갑니다
    // → compute-deadlines.ts 의 anchorOf
    expect(arg.source).toBe('system')
    // 날짜만. 시각을 넣으면 시간대 변환이 끼어들어 하루가 어긋날 여지가 생깁니다
    expect(arg.valueMasked).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('기산점을 안 남기는 단계는 아무것도 안 쓴다', async () => {
    for (const stepKey of ['report-112', 'freeze-request', 'relief-documents', 'crypto-status']) {
      const { container, write } = containerWith([])
      expect(await anchorFromArtifact({ caseId: '01J8XKRB', stepKey, container })).toBeNull()
      expect(write, stepKey).not.toHaveBeenCalled()
    }
  })

  // **채권소멸공고의 기산일은 통지문에 적힌 날**입니다 → ADR-054.
  // 여기서 「오늘」로 채우면 2개월 공고가 통째로 틀립니다
  it('debt-extinction-notice 는 여기서 안 채운다', async () => {
    const { container, write } = containerWith([])
    expect(
      await anchorFromArtifact({
        caseId: '01J8XKRB',
        stepKey: 'debt-extinction-notice',
        container,
      }),
    ).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('이미 채워져 있으면 덮지 않는다', async () => {
    // 같은 단계에 부산물을 두 번 내면(재시도·다시 누르기) 기산점이 뒤로 밀립니다 —
    // 그러면 기한이 저절로 늘어나서 **놓친 기한이 안 놓친 것처럼** 보입니다
    const { container, write } = containerWith([
      { slotKey: 'relief_applied_at', state: 'confirmed', valueMasked: '2026-08-20' },
    ])

    expect(
      await anchorFromArtifact({ caseId: '01J8XKRB', stepKey: 'relief-apply', container }),
    ).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('「모른다」로 표시돼 있으면 채운다', async () => {
    // `unknown` 은 「모른다」이지 날짜가 아닙니다 — 비어 있는 것과 같습니다
    const { container, write } = containerWith([
      { slotKey: 'relief_applied_at', state: 'unknown', valueMasked: null },
    ])

    expect(
      await anchorFromArtifact({ caseId: '01J8XKRB', stepKey: 'relief-apply', container }),
    ).toBe('relief_applied_at')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('확인 전 상태도 비어 있는 것으로 본다', async () => {
    // `pii_pending`·`extracted` 는 확인 전이라 기산점이 못 됩니다 → 0003 마이그레이션
    for (const state of ['pii_pending', 'extracted']) {
      const { container, write } = containerWith([
        { slotKey: 'relief_applied_at', state, valueMasked: '2026-08-20' },
      ])
      expect(
        await anchorFromArtifact({ caseId: '01J8XKRB', stepKey: 'relief-apply', container }),
        state,
      ).toBe('relief_applied_at')
      expect(write, state).toHaveBeenCalledTimes(1)
    }
  })
})
