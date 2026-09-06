/**
 * 판독을 기다리던 부산물을 다시 판정하는가 → ADR-077.
 *
 * 계약: spec/backend/08-14-completion-hook.md ② · spec/common/08-14-api.md §3.8
 *
 * 파일로 낸 부산물은 올린 순간 판독이 안 끝나 있습니다(전사·OCR 은 몇 초~몇 분).
 * 그때 `reading_pending` 으로 두고, **읽기가 끝나면 여기서** 통과·확인 못 함을
 * 가립니다. 통과면 라우트가 했을 일(단계 완료 · 기산점 · 기한 닫기 · 플랜 재생성)을
 * 그대로 합니다 — 두 자리가 다르게 굴면 「올린 직후」와 「나중에」의 결과가 갈립니다.
 */

import { describe, expect, it, vi } from 'vitest'

import type { Container } from '@/lib/container'

import { createCompletionChecker } from '@/modules/completion-checker'

import { settleArtifacts } from './settle-artifacts'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const EVIDENCE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4B'
const STEP_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4C'
const ARTIFACT_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4D'

const regenerated = vi.hoisted(() => ({ calls: 0 }))
vi.mock('./regenerate-plan', () => ({
  regeneratePlan: async () => {
    regenerated.calls += 1
    return { steps: [], auditId: '01J8AUDIT0000000000000000A', changedDeadlines: [] }
  },
}))

function harness(base: {
  readonly pending?: readonly { artifactId: string; planStepId: string; kind: string }[]
  readonly evidence?: {
    kind: 'audio' | 'image' | 'text'
    ingestStatus: 'pending' | 'processing' | 'done' | 'failed'
    transcriptMasked: string | null
  } | null
  readonly stepKey?: string
}) {
  const settled: Record<string, unknown>[] = []
  const marked: unknown[] = []
  const met: unknown[] = []
  const slotsWritten: Record<string, unknown>[] = []

  const container = {
    completionChecker: createCompletionChecker({ receiptFormat: { matches: () => undefined } }),
    artifacts: {
      pendingFor: async () => base.pending ?? [],
      settle: async (one: Record<string, unknown>) => {
        settled.push(one)
      },
      markStep: async (...args: unknown[]) => {
        marked.push(args)
        return true
      },
    },
    evidence: {
      read: async () =>
        base.evidence === undefined
          ? { kind: 'image', ingestStatus: 'done', transcriptMasked: null }
          : base.evidence,
    },
    channelWrite: { allPublicNames: async () => ['경찰청', '경찰', '금융감독원', '금감원'] },
    deadlineWrite: {
      markMet: async (...args: unknown[]) => {
        met.push(args)
        return 1
      },
    },
    slots: { read: async () => [] },
    slotWrite: {
      write: async (row: Record<string, unknown>) => {
        slotsWritten.push(row)
      },
    },
    ports: {
      kbVersion: { current: async () => '2026.09.3' },
      casePlan: {
        readSteps: async () => [
          { planStepId: STEP_ID, stepKey: base.stepKey ?? 'relief-documents', state: 'unconfirmed', body: {} },
        ],
      },
    },
  } as unknown as Container

  return { container, settled, marked, met, slotsWritten }
}

const stored = (lines: readonly string[]) =>
  JSON.stringify({ lines: lines.map((text) => ({ speaker: null, text, startMs: null })), tokens: [], shortfalls: [] })

const pendingOne = [{ artifactId: ARTIFACT_ID, planStepId: STEP_ID, kind: 'receipt_doc' }]

describe('판독이 끝나면 미뤄 둔 부산물을 다시 판정한다', () => {
  it('기다리는 것이 없으면 아무것도 안 한다 — 자료를 읽지도 않는다', async () => {
    regenerated.calls = 0
    const one = harness({ pending: [] })
    const got = await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })
    expect(got).toEqual([])
    expect(one.settled).toHaveLength(0)
    expect(regenerated.calls).toBe(0)
  })

  it('접수번호 자리가 보이면 통과 — 단계 완료 · 기한 닫기 · 플랜 재생성까지', async () => {
    regenerated.calls = 0
    const one = harness({
      pending: pendingOne,
      evidence: { kind: 'image', ingestStatus: 'done', transcriptMasked: stored(['접수증', '접수번호 2026-004821']) },
    })

    const got = await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })

    expect(got).toEqual([{ artifactId: ARTIFACT_ID, planStepId: STEP_ID, stepState: 'done_verified' }])
    expect(one.settled).toEqual([
      {
        artifactId: ARTIFACT_ID,
        verifyResult: 'passed',
        // 어느 자료였는지는 그대로 남깁니다 — 나중에 「무엇으로 통과했나」를 셀 때 씁니다
        verifyDetail: { reason: 'receipt_number_found', evidence_id: EVIDENCE_ID },
      },
    ])
    expect(one.marked).toEqual([[CASE_ID, STEP_ID, 'done_verified']])
    // **끝난 단계의 기한은 닫힙니다** — 안 닫으면 끝난 단계 옆에 D-3 이 계속 뜹니다
    expect(one.met).toEqual([[CASE_ID, STEP_ID]])
    expect(regenerated.calls).toBe(1)
  })

  it('기산점을 남기는 단계면 슬롯도 채운다 — 라우트와 같은 표를 쓴다', async () => {
    const one = harness({
      pending: pendingOne,
      stepKey: 'relief-apply',
      evidence: { kind: 'image', ingestStatus: 'done', transcriptMasked: stored(['접수번호: KB-20260906-0001']) },
    })
    await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })
    expect(one.slotsWritten.map((row) => row.slotKey)).toEqual(['relief_applied_at'])
  })

  it('접수번호도 기관명도 없으면 확인 못 함 — 단계는 미확인 그대로, 플랜은 안 만든다', async () => {
    regenerated.calls = 0
    const one = harness({
      pending: pendingOne,
      evidence: {
        kind: 'image',
        ingestStatus: 'done',
        transcriptMasked: stored(['KB국민은행 이체 완료', '[계좌-1]', '1,000,000원']),
      },
    })

    const got = await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })

    expect(got[0]?.stepState).toBe('unconfirmed')
    expect(one.settled[0]).toMatchObject({
      verifyResult: 'failed',
      verifyDetail: { reason: 'no_receipt_marks', evidence_id: EVIDENCE_ID },
    })
    expect(one.marked).toEqual([[CASE_ID, STEP_ID, 'unconfirmed']])
    expect(one.met).toHaveLength(0)
    expect(regenerated.calls).toBe(0)
  })

  it('읽기가 실패했으면 확인 못 함으로 적는다 — 영영 기다리지 않는다', async () => {
    const one = harness({
      pending: pendingOne,
      evidence: { kind: 'image', ingestStatus: 'failed', transcriptMasked: null },
    })
    await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })
    expect(one.settled[0]).toMatchObject({ verifyResult: 'failed', verifyDetail: { reason: 'unreadable', evidence_id: EVIDENCE_ID } })
  })

  it('아직 읽는 중이면 그대로 둔다 — 다음 폴링에서 다시 본다', async () => {
    const one = harness({
      pending: pendingOne,
      evidence: { kind: 'image', ingestStatus: 'processing', transcriptMasked: null },
    })
    const got = await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })
    expect(got).toEqual([])
    expect(one.settled).toHaveLength(0)
    expect(one.marked).toHaveLength(0)
  })

  it('통과한 것이 여럿이어도 플랜은 한 번만 다시 만든다', async () => {
    regenerated.calls = 0
    const one = harness({
      pending: [
        { artifactId: ARTIFACT_ID, planStepId: STEP_ID, kind: 'receipt_doc' },
        { artifactId: '01J8XKQZ3M7N2P4R6T8V0W2Y4E', planStepId: STEP_ID, kind: 'sms_capture' },
      ],
      evidence: { kind: 'image', ingestStatus: 'done', transcriptMasked: stored(['금융감독원 통지']) },
    })
    await settleArtifacts({ caseId: CASE_ID, evidenceId: EVIDENCE_ID, container: one.container })
    expect(one.settled).toHaveLength(2)
    expect(regenerated.calls).toBe(1)
  })
})
