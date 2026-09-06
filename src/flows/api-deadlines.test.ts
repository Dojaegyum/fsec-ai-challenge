/**
 * 기한을 계약의 모양으로 옮길 때 — **지킨 기한에 D-day 를 싣지 않는가** → ADR-077.
 *
 * 계약: spec/common/08-14-api.md §3.7
 *
 * 화면은 `days_left` 가 있으면 카운트다운을 그립니다(`deadline-viewer` 의 `ddayLabel`).
 * 단계가 끝나 `met` 이 된 기한에 그 칸이 남아 있으면 **끝난 단계 옆에 D-3 이 계속 뜹니다** —
 * 2026-09-06 점검에서 실제로 그랬습니다.
 */

import { describe, expect, it } from 'vitest'

import type { DeadlineView } from '@/lib/db'

import { toApiDeadline } from './api-deadlines'

const AT = { today: '2026-09-06', nowMs: Date.parse('2026-09-06T10:00:00+09:00') }

const view = (over: Partial<DeadlineView> = {}): DeadlineView => ({
  deadlineId: '01J8DL000000000000000000A',
  stepId: '01J8ST000000000000000000A',
  title: '신청서류를 금융회사에 제출합니다',
  kind: 'primary',
  dueAt: '2026-09-09T23:59:59+09:00',
  status: 'open',
  computedFrom: 'relief_applied_at',
  onMiss: null,
  startsAt: null,
  condition: null,
  note: null,
  estimated: false,
  ...over,
})

describe('days_left 는 아직 열린 사용자 기한에만 붙는다', () => {
  it('열린 본 기한에는 붙는다', () => {
    expect(toApiDeadline(view(), AT).days_left).toBe(3)
  })

  it('지킨 기한(met)에는 안 붙는다 — 끝난 단계 옆에 D-3 이 남지 않는다', () => {
    const got = toApiDeadline(view({ status: 'met' }), AT)
    expect(got.status).toBe('met')
    expect(got).not.toHaveProperty('days_left')
  })

  it('유예도 같다', () => {
    expect(toApiDeadline(view({ kind: 'grace', status: 'met' }), AT)).not.toHaveProperty('days_left')
  })

  it('지난 기한(missed)에도 없다 — §3.7 그대로', () => {
    expect(
      toApiDeadline(view({ status: 'missed', dueAt: '2026-09-01T23:59:59+09:00' }), AT),
    ).not.toHaveProperty('days_left')
  })

  it('info 는 상태와 무관하게 없다 — 사용자 기한이 아니다', () => {
    expect(toApiDeadline(view({ kind: 'info' }), AT)).not.toHaveProperty('days_left')
  })
})
