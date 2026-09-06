/**
 * 업로드 완료 통지 시험 — §3.2 3단계.
 *
 * **여기서 못 박는 것:**
 * 1. 없는 증거 번호는 **404** 다 — `GET …/evidence/{id}` 와 같은 자리여야 한다.
 *    (전에는 완료 처리가 없는 행에 부딪혀 일반 500 으로 샜다 — 2026-09-06 배포본 점검)
 * 2. 있는 증거는 202 로 접수하고 판독을 맡긴다.
 * 3. 모양이 틀린 주소·번호는 400 이다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CaseStore } from '@/modules/case-intake'

// 판독 맡기기는 전사기를 건드리므로 라우트 제어 흐름만 보도록 대역으로 둡니다
const startReading = vi.hoisted(() => vi.fn())
vi.mock('@/flows/read-evidence', () => ({ startReading, collectReading: vi.fn() }))

import { POST } from './route'

const TOKEN = 'TKN00000000000000000000ABC'.slice(0, 26)
const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const EVIDENCE_ID = '01J8XKR60000000000000000AA'

const caseStore: CaseStore = {
  async createCase() {},
  async evidenceTotals() {
    return { count: 0, bytes: 0 }
  },
  async addEvidence() {},
  async markUploaded() {
    return 'processing'
  },
  async touchPurgeAfter() {},
}

const holder = vi.hoisted(() => ({ container: undefined as unknown }))
vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

/** `read` 가 `null` 이면 「그 번호의 증거가 없다」입니다 */
function build(caseId: string | null, evidenceFound: boolean) {
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
        return evidenceFound
          ? {
              kind: 'image' as const,
              objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
              mimeType: 'image/png',
              ingestStatus: 'pending' as const,
              transcriptMasked: null,
              createdAt: '2026-09-06T14:00:00+09:00',
            }
          : null
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

const ask = (evidence_id = EVIDENCE_ID) =>
  new Request(`http://x/api/cases/${TOKEN}/evidence/${evidence_id}/complete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })

beforeEach(() => {
  startReading.mockReset()
})

describe('업로드 완료 통지 — §3.2 3단계', () => {
  it('있는 증거는 202 로 접수하고 판독을 맡긴다', async () => {
    build(CASE_ID, true)
    const res = await POST(ask(), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(202)
    expect(body.evidence_id).toBe(EVIDENCE_ID)
    expect(body.ingest_status).toBe('processing')
    expect(startReading).toHaveBeenCalledTimes(1)
  })

  /**
   * **없는 번호는 404 다.** 조회 경로(`GET …/evidence/{id}`)가 이미 그렇습니다 —
   * 두 자리가 달라선 안 됩니다. 전에는 완료 처리가 없는 행에 부딪혀 일반 500 을
   * 냈고, 그 500 은 감사 로그도 안 남겼습니다(2026-09-06 배포본 점검).
   */
  it('없는 증거 번호는 404 다 — 500 이 아니다', async () => {
    build(CASE_ID, false)
    const res = await POST(ask(), route())

    expect(res.status).toBe(404)
    expect(startReading).not.toHaveBeenCalled()
  })

  it('그 주소로 열리는 사건이 없으면 404 다', async () => {
    build(null, true)
    const res = await POST(ask(), route())

    expect(res.status).toBe(404)
  })

  it('증거 번호 모양이 틀리면 400 이다', async () => {
    build(CASE_ID, true)
    const res = await POST(ask('not-a-ulid'), route(TOKEN, 'not-a-ulid'))

    expect(res.status).toBe(400)
  })
})
