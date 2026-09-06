/**
 * 서버 혼자 하는 다시 맡기기 시험 — ADR-091 §5.
 *
 * **여기서 못 박는 것 셋:**
 * 1. 팟이 모르는 것(404 · 닿지 못함)만 다시 맡긴다 — 돌고 있거나 끝난 것은 브라우저 몫
 * 2. 토큰화하지 않는다 — collect 가 done 을 줘도 저장하지 않는다
 * 3. 미설정(AppError)은 그대로 올린다
 *
 * ## 검토 1회차 — 60초 안에 20건을 다 못 본다
 *
 * **더 못 박는 것 둘** (검토에서 지적 · 컨트롤러 ruling):
 * 4. 45초 예산을 넘기면 남은 건은 손대지 않고 `skipped` 로 센다 — 함수 상한(60초)에 걸려
 *    응답 자체를 잃는 것보다, 건수라도 답하는 편이 낫습니다
 * 5. 묻기의 최종적 거절(4xx)은 그 건만 `failed` 로 세고 다음 건을 봅니다 — 한 건이 통째로
 *    막으면 `ORDER BY created_at ASC` 라 매번 같은 자리에서 멈춥니다. 연속으로 닿지 못하는
 *    것이 두 번이면 그 뒤도 마찬가지일 것이므로 나머지는 다음 호출로 미룹니다
 */
import { describe, expect, it } from 'vitest'

import type { Container } from '@/lib/container'
import { AppError, IngestError } from '@/lib/errors'

import {
  RESUBMIT_BUDGET_MS,
  RESUBMIT_LIMIT,
  RESUBMIT_UNREACHABLE_STOP,
  RESUBMIT_WITHIN_MS,
  resubmitEvidence,
} from './resubmit-evidence'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const row = (evidenceId: string, kind: 'audio' | 'image' = 'audio') => ({
  caseId: CASE_ID,
  evidenceId,
  kind,
  objectKey: `${CASE_ID}/${evidenceId}`,
  mimeType: kind === 'audio' ? 'audio/m4a' : 'image/png',
})

function harness(input: {
  rows: ReturnType<typeof row>[]
  collect: (jobId: string) => Promise<unknown>
  start?: () => Promise<unknown>
}) {
  const asked: { withinMs: number; limit: number }[] = []
  const started: string[] = []
  const finished: unknown[] = []
  const container = {
    evidence: {
      listRetryCandidates: async (q: { withinMs: number; limit: number }) => {
        asked.push(q)
        return input.rows
      },
    },
    transcriber: {
      collect: async (job: { jobId: string }) => input.collect(job.jobId),
      start: async (i: { jobId: string }) => {
        started.push(i.jobId)
        if (input.start) return input.start()
        return { started: true, job: { jobId: i.jobId, phase: 'stt', kind: 'audio' } }
      },
    },
    evidenceWrite: {
      finish: async (one: unknown) => {
        finished.push(one)
      },
      fail: async () => {},
    },
  } as unknown as Container
  return { container, asked, started, finished }
}

describe('팟이 모르는 것만 다시 맡긴다', () => {
  it('48시간 · 20건으로 묻는다', async () => {
    const h = harness({ rows: [], collect: async () => ({ status: 'missing' }) })

    await resubmitEvidence(h.container)

    expect(h.asked).toEqual([{ withinMs: RESUBMIT_WITHIN_MS, limit: RESUBMIT_LIMIT }])
    expect(RESUBMIT_WITHIN_MS).toBe(48 * 60 * 60 * 1000)
    expect(RESUBMIT_LIMIT).toBe(20)
  })

  it('404 면 다시 맡기고, 도는 중이면 두고, 끝났으면 저장하지 않고 둔다', async () => {
    const h = harness({
      rows: [row('E1'), row('E2'), row('E3', 'image')],
      collect: async (id) =>
        id === 'E1'
          ? { status: 'missing' }
          : id === 'E2'
            ? { status: 'running', phase: 'stt', percent: 30 }
            : { status: 'done', result: { lines: [], shortfalls: [] } },
    })

    const report = await resubmitEvidence(h.container)

    expect(h.started).toEqual(['E1'])
    expect(h.finished).toEqual([])
    expect(report).toEqual({
      scanned: 3,
      resubmitted: 1,
      running: 2,
      unreachable: 0,
      failed: 0,
      skipped: 0,
    })
  })

  it('묻기가 닿지 못하면 다시 맡겨 보고, 그것도 닿지 못하면 unreachable 로 센다', async () => {
    const h = harness({
      rows: [row('E1')],
      collect: async () => {
        throw new IngestError('물어보지 못했습니다', { reason: 'poll_failed', transient: true })
      },
      start: async () => {
        throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
      },
    })

    const report = await resubmitEvidence(h.container)

    expect(h.started).toEqual(['E1'])
    expect(report).toEqual({
      scanned: 1,
      resubmitted: 0,
      running: 0,
      unreachable: 1,
      failed: 0,
      skipped: 0,
    })
  })

  it('다시 맡기기가 최종적으로 안 되면 failed 로 센다(startReading 이 이미 적음)', async () => {
    const h = harness({
      rows: [row('E1')],
      collect: async () => ({ status: 'missing' }),
      start: async () => {
        throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: false })
      },
    })

    const report = await resubmitEvidence(h.container)

    expect(report.failed).toBe(1)
  })

  it('미설정은 그대로 올린다', async () => {
    const h = harness({
      rows: [row('E1')],
      collect: async () => {
        throw new AppError('전사 서비스가 아직 설정되지 않았습니다')
      },
    })

    await expect(resubmitEvidence(h.container)).rejects.toBeInstanceOf(AppError)
  })
})

describe('한 건의 거절·연속 실패·예산이 나머지를 막지 않는다 — 검토 1회차', () => {
  it('묻기가 최종적으로 거절돼도(4xx) 그 건만 failed 로 세고 다음 건을 계속 본다', async () => {
    const h = harness({
      rows: [row('E1'), row('E2')],
      collect: async (id) => {
        if (id === 'E1') {
          throw new IngestError('거절', { reason: 'poll_failed', transient: false })
        }
        return { status: 'missing' }
      },
    })

    const report = await resubmitEvidence(h.container)

    expect(h.started).toEqual(['E2'])
    expect(report).toEqual({
      scanned: 2,
      resubmitted: 1,
      running: 0,
      unreachable: 0,
      failed: 1,
      skipped: 0,
    })
  })

  it('연속 두 건이 닿지 못하면 나머지는 다음 호출로 미룬다 — skipped', async () => {
    expect(RESUBMIT_UNREACHABLE_STOP).toBe(2)

    const h = harness({
      rows: [row('E1'), row('E2'), row('E3'), row('E4')],
      collect: async () => {
        throw new IngestError('물어보지 못했습니다', { reason: 'poll_failed', transient: true })
      },
      start: async () => {
        throw new IngestError('맡기지 못했습니다', { reason: 'submit_failed', transient: true })
      },
    })

    const report = await resubmitEvidence(h.container)

    expect(h.started).toHaveLength(2)
    expect(report).toEqual({
      scanned: 4,
      resubmitted: 0,
      running: 0,
      unreachable: 2,
      failed: 0,
      skipped: 2,
    })
  })

  it('45초 예산을 넘기면 남은 건을 skipped 로 세고 멈춘다', async () => {
    expect(RESUBMIT_BUDGET_MS).toBe(45_000)

    const h = harness({
      rows: [row('E1'), row('E2'), row('E3')],
      collect: async () => ({ status: 'missing' }),
    })

    let calls = 0
    const now = () => {
      calls += 1
      return calls === 1 ? 0 : 46_000
    }

    const report = await resubmitEvidence(h.container, { now })

    expect(h.started).toHaveLength(1)
    expect(report).toEqual({
      scanned: 3,
      resubmitted: 1,
      running: 0,
      unreachable: 0,
      failed: 0,
      skipped: 2,
    })
  })
})
