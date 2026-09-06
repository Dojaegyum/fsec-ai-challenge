/**
 * 자료 하나 조회 시험 — §3.3.
 *
 * **여기서 못 박는 것:**
 * 1. 없는 증거 번호는 404 다 (ADR-039 — 조회가 신분 확인).
 * 2. 막 올린 `pending` 은 그대로 `pending` 이다 — 성급히 건드리지 않는다.
 * 3. **오래 멈춘 `pending` 은 판독을 다시 깨운다** — 완료 통지가 누락돼 시작조차
 *    못 한 자료가 「대기 중」에 영영 남던 결함(2026-09-06 배포본 점검).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CaseStore } from '@/modules/case-intake'

// 응답 뒤 작업(`after`)과 판독 맡기기는 라우트 제어 흐름 밖이라 대역으로 둡니다
vi.mock('next/server', () => ({ after: (fn: () => unknown) => void fn() }))
const startReading = vi.hoisted(() => vi.fn())
const collectReading = vi.hoisted(() => vi.fn())
vi.mock('@/flows/read-evidence', () => ({ startReading, collectReading }))

import { GET } from './route'

const TOKEN = 'TKN00000000000000000000ABC'.slice(0, 26)
const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const EVIDENCE_ID = '01J8XKR60000000000000000AA'

const markUploaded = vi.hoisted(() => vi.fn(async () => 'processing' as const))
const caseStore: CaseStore = {
  async createCase() {},
  async evidenceTotals() {
    return { count: 0, bytes: 0 }
  },
  async addEvidence() {},
  markUploaded,
  async touchPurgeAfter() {},
}

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

/**
 * `createdAt` 이 없으면 「그 번호의 증거가 없다」입니다.
 *
 * 세 번째 인자(`processingKind`)를 주면 **이미 올라와 판독 중인 자료**를 냅니다 —
 * `pendingCreatedAt` 은 이때 무시되고, `ingestStatus: 'processing'` 인 행이라
 * 라우트가 `collectReading` 갈래(§3.3 `running`)를 탑니다.
 */
function build(caseId: string | null, pendingCreatedAt: string | null, processingKind?: 'audio' | 'image') {
  const env = readEnv({})
  const made = createContainer(env, {
    ...unconfiguredPorts(env),
    caseStore,
  } satisfies Ports)

  holder.container = {
    ...made,
    caseTokens: { async toCaseId() { return caseId } },
    evidence: {
      async read() {
        if (processingKind) {
          return {
            kind: processingKind,
            objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
            mimeType: processingKind === 'audio' ? 'audio/mpeg' : 'image/png',
            ingestStatus: 'processing' as const,
            transcriptMasked: null,
            createdAt: new Date().toISOString(),
          }
        }
        return pendingCreatedAt === null
          ? null
          : {
              kind: 'image' as const,
              objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
              mimeType: 'image/png',
              ingestStatus: 'pending' as const,
              transcriptMasked: null,
              createdAt: pendingCreatedAt,
            }
      },
      async list() {
        return []
      },
    },
  }
}

const route = (case_token = TOKEN, evidence_id = EVIDENCE_ID) => ({
  params: Promise.resolve({ case_token, evidence_id }),
})
const ask = () => new Request(`http://x/api/cases/${TOKEN}/evidence/${EVIDENCE_ID}`)

beforeEach(() => {
  startReading.mockReset()
  markUploaded.mockClear()
})

describe('자료 하나 조회 — §3.3', () => {
  it('없는 증거 번호는 404 다', async () => {
    build(CASE_ID, null)
    const res = await GET(ask(), route())

    expect(res.status).toBe(404)
  })

  it('막 올린 `pending` 은 그대로 pending 이다 — 건드리지 않는다', async () => {
    build(CASE_ID, new Date().toISOString())
    const res = await GET(ask(), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.ingest_status).toBe('pending')
    expect(startReading).not.toHaveBeenCalled()
    expect(markUploaded).not.toHaveBeenCalled()
  })

  /**
   * **오래 멈춘 `pending` 은 다시 깨운다.** 완료 통지가 누락돼 판독이 시작조차
   * 못 한 자료입니다. `completeUpload`(→ `markUploaded`)로 옮기고 판독을 맡깁니다 —
   * 둘 다 멱등이라 다시 불러도 안전합니다.
   */
  it('오래된 `pending` 은 판독을 다시 맡기고 processing 을 낸다', async () => {
    build(CASE_ID, new Date(Date.now() - 120_000).toISOString())
    const res = await GET(ask(), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.ingest_status).toBe('processing')
    expect(markUploaded).toHaveBeenCalledTimes(1)
    expect(startReading).toHaveBeenCalledTimes(1)
  })
})

describe('재시도중은 processing 인 채 progress.retrying 으로 — ADR-091 §2', () => {
  it('retrying 이 붙은 running 은 poll_after_ms 5000 과 progress.retrying: true 로 나간다', async () => {
    build(CASE_ID, null, 'audio')
    collectReading.mockResolvedValueOnce({
      status: 'running',
      phase: 'stt',
      percent: 0,
      pollAfterMs: 5000,
      retrying: true,
    })

    const res = await GET(ask(), route())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      evidence_id: EVIDENCE_ID,
      ingest_status: 'processing',
      progress: { phase: 'stt', percent: 0, retrying: true },
      poll_after_ms: 5000,
    })
  })

  it('평소 running 에는 retrying 칸이 없다 — 회귀', async () => {
    build(CASE_ID, null, 'audio')
    collectReading.mockResolvedValueOnce({ status: 'running', phase: 'stt', percent: 40, pollAfterMs: 1500 })

    const body = await (await GET(ask(), route())).json()

    expect(body.progress).toEqual({ phase: 'stt', percent: 40 })
  })
})
