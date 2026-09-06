/**
 * 부산물 접수 시험 — **완료가 기산점을 남기는가.**
 *
 * 검증 대상: spec/common/08-14-api.md §3.8 · spec/backend/08-14-completion-hook.md ① ·
 *            decisions/057-receipt-number-l1.md
 *
 * ## 왜 이 파일이 생겼나
 *
 * 2026-08-27 에 사슬을 끝까지 걸어 보니 단계는 순서대로 열리는데
 * **`GET …/deadlines` 가 모든 경로에서 빈 배열**이었습니다. 원인은
 * `relief-apply` 가 끝나도 `relief_applied_at` 을 아무도 안 채운 것이었고,
 * **기산점이 없으면 기한도 없다**는 올바른 규칙 때문에 조용히 0개였습니다.
 *
 * `anchor-from-artifact.test.ts` 가 **표**를 지키고, 이 파일이 **라우트가
 * 그것을 부르는지**를 지킵니다. 둘 중 하나만 있으면 다시 조용히 끊깁니다 —
 * 실제로 끊겨 있던 것이 「부르는 쪽」이었습니다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import { POST } from './route'

const TOKEN = 'TKN00000000000000000000ABC'.slice(0, 26)
const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const STEP_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4B'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

/** 플랜 재생성은 이 파일이 보는 대상이 아닙니다 — 부르는지만 봅니다 */
const regenerated = vi.hoisted(() => ({ calls: 0 }))
vi.mock('@/flows/regenerate-plan', () => ({
  regeneratePlan: async () => {
    regenerated.calls += 1
    return { steps: [] }
  },
}))

/** 올린 자료 한 줄 — `EvidenceReader.read` 가 돌려주는 모양 */
interface StoredEvidence {
  readonly kind: 'audio' | 'image' | 'text'
  readonly objectKey: string
  readonly mimeType: string
  readonly ingestStatus: 'pending' | 'processing' | 'done' | 'failed'
  readonly transcriptMasked: string | null
}

const EVIDENCE_ID = '01J8EVID000000000000000000'

/** 판독 결과를 저장된 모양(JSON) 그대로 — `read-evidence.ts` 의 `finish` */
const stored = (lines: readonly string[]) =>
  JSON.stringify({ lines: lines.map((text) => ({ speaker: null, text, startMs: null })), tokens: [], shortfalls: [] })

function build(
  stepKey: string,
  existingSlots: unknown[] = [],
  evidence: StoredEvidence | null = {
    kind: 'image',
    objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
    mimeType: 'image/png',
    ingestStatus: 'done',
    transcriptMasked: stored(['피해구제 신청 접수증', '접수번호 2026-004821']),
  },
) {
  const env = readEnv({})
  const written: Record<string, unknown>[] = []
  const marked: unknown[] = []
  const artifacts: Record<string, unknown>[] = []
  const met: unknown[] = []

  const made = createContainer(env, {
    ...unconfiguredPorts(env),
    // 기산점을 안 만들어도 되는 자리라 진짜 형식 대조기는 안 씁니다
    receiptFormat: { matches: () => undefined },
    casePlan: {
      async readSteps() {
        return [{ planStepId: STEP_ID, stepKey, state: 'not_started', body: {} }]
      },
      async writeSteps() {},
    },
  } as unknown as Ports)

  holder.container = {
    ...made,
    caseTokens: { async toCaseId() { return CASE_ID } },
    artifacts: {
      async write(row: Record<string, unknown>) {
        artifacts.push(row)
      },
      async markStep(...args: unknown[]) {
        marked.push(args)
        return true
      },
    },
    // 파일로 낸 부산물은 그 자료를 읽은 결과를 봅니다 → ADR-077
    evidence: { async read() { return evidence } },
    channelWrite: { allCandidates: async () => [], allPublicNames: async () => ['경찰청', '경찰', '금융감독원'] },
    deadlineWrite: {
      apply: async () => [],
      sweepOverdue: async () => 0,
      async markMet(...args: unknown[]) {
        met.push(args)
        return 1
      },
    },
    slots: { async read() { return existingSlots } },
    // 이름표 장부 → 04-pii-boundary.md 「번호의 단위」. 서버 토큰화가 이미 쓰인
    // 번호를 이어받는 자리라, 대역이 없으면 미설정 포트에서 터집니다
    vaultWrite: { put: async () => 0, list: async () => [], tokens: async () => [] },
    messages: {
      write: async () => {},
      history: async () => [],
      transcript: async () => [],
      turns: async () => ({ turns: [], truncated: false }),
    },
    // 장부가 읽는 자리 → `pii-tokenizer/ledger.ts`. 이 시험은 빈 사건입니다
    maskedTexts: { all: async () => [] },
    slotWrite: {
      async write(row: Record<string, unknown>) {
        written.push(row)
      },
    },
  }
  return { written, marked, artifacts, met }
}

const route = () => ({
  params: Promise.resolve({ case_token: TOKEN, step_id: STEP_ID }),
})

function ask(body: unknown) {
  return new Request(`http://x/api/cases/${TOKEN}/steps/${STEP_ID}/artifacts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  regenerated.calls = 0
})

describe('완료가 기산점을 남긴다 — 05-completion-hook.md ①', () => {
  it('relief-apply 를 접수번호로 끝내면 relief_applied_at 이 채워진다', async () => {
    const { written } = build('relief-apply')

    const res = await POST(ask({ kind: 'receipt_no', value: '2026-004821' }), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.step_state).toBe('done_verified')
    expect(written).toHaveLength(1)
    expect(written[0].slotKey).toBe('relief_applied_at')
    // **`system` 이어야 확정 기한이 됩니다** → compute-deadlines.ts 의 anchorOf
    expect(written[0].source).toBe('system')
  })

  it('기산점을 안 남기는 단계에서는 아무것도 안 쓴다', async () => {
    const { written } = build('freeze-request')

    await POST(ask({ kind: 'receipt_no', value: '2026-004821' }), route())
    expect(written).toHaveLength(0)
  })

  // L3 자기신고는 「했다」의 근거가 아닙니다. 그것으로 기산점을 만들면
  // **법정 기한이 자기 신고 하나로** 서게 됩니다
  it('L3 자기신고로는 기산점을 만들지 않는다', async () => {
    const { written } = build('relief-apply')

    const res = await POST(ask({ kind: 'other', self_reported: true }), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(body.step_state).toBe('unconfirmed')
    expect(written).toHaveLength(0)
    // 다음 단계도 안 열립니다 — 증거 연쇄가 무너지지 않아야 합니다
    expect(regenerated.calls).toBe(0)
  })

  // → ADR-057. 모양이 아닌 값은 완료가 아니고, 완료가 아니면 기산점도 없습니다
  it('접수번호 모양이 아니면 기산점도 없다', async () => {
    const { written } = build('relief-apply')

    const res = await POST(ask({ kind: 'receipt_no', value: 'ㅇㅇ' }), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(body.verify_result).toBe('failed')
    expect(body.verify_detail).toEqual({ reason: 'not_identifier' })
    expect(written).toHaveLength(0)
  })

  it('이미 채워져 있으면 덮지 않는다', async () => {
    // 다시 누르면 기산점이 뒤로 밀려 **놓친 기한이 안 놓친 것처럼** 보입니다
    const { written } = build('relief-apply', [
      {
        slotKey: 'relief_applied_at',
        tier: 'T2',
        state: 'confirmed',
        valueMasked: '2026-08-20',
        valueType: 'date',
        source: 'system',
      },
    ])

    await POST(ask({ kind: 'receipt_no', value: '2026-004821' }), route())
    expect(written).toHaveLength(0)
  })

  it('**끝난 단계의 기한을 닫는다** — 안 닫으면 끝난 단계 옆에 D-3 이 계속 뜬다', async () => {
    const { met } = build('relief-documents')

    await POST(ask({ kind: 'receipt_no', value: '2026-004821' }), route())
    expect(met).toEqual([[CASE_ID, STEP_ID]])
  })
})

/**
 * ⚠️ **2026-09-06 까지 파일은 올리기만 하면 통과였습니다** → ADR-077.
 *
 * 사기범과의 통화 녹음을 올려도 「신청서류 제출」이 끝났고, 이체 캡처가 112 접수증으로
 * 인정됐습니다. 이제 라우트는 그 자료를 읽은 결과를 `completion-checker` 에 넘깁니다.
 */
describe('파일로 낸 부산물은 판독 결과를 본다 — ADR-077', () => {
  const upload = () => ask({ kind: 'receipt_doc', evidence_id: EVIDENCE_ID })

  it('접수번호 자리가 있는 접수증은 완료 — 기산점·기한 닫기·재생성까지', async () => {
    const { written, marked, met, artifacts } = build('relief-apply')

    const res = await POST(upload(), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.verify_level).toBe('L2')
    expect(body.step_state).toBe('done_verified')
    expect(body.verify_detail).toEqual({ reason: 'receipt_number_found' })
    expect(marked).toEqual([[CASE_ID, STEP_ID, 'done_verified']])
    expect(written[0]?.slotKey).toBe('relief_applied_at')
    expect(met).toEqual([[CASE_ID, STEP_ID]])
    expect(regenerated.calls).toBe(1)
    // 표에는 어느 자료였는지가 남습니다 — 판독을 기다리는 것을 나중에 찾는 열쇠입니다
    expect(artifacts[0]?.verifyDetail).toEqual({ reason: 'receipt_number_found', evidence_id: EVIDENCE_ID })
    expect(artifacts[0]?.objectKey).toBe(`${CASE_ID}/${EVIDENCE_ID}`)
  })

  it('통화 녹음은 접수증이 아니다 — 미확인이고, 기산점도 기한 닫기도 재생성도 없다', async () => {
    const { written, marked, met, artifacts } = build('relief-apply', [], {
      kind: 'audio',
      objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
      mimeType: 'audio/wav',
      ingestStatus: 'done',
      transcriptMasked: stored(['접수번호 2026-004821 이라고 하셨죠']),
    })

    const res = await POST(upload(), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(200)
    expect(body.step_state).toBe('unconfirmed')
    expect(body.verify_result).toBe('failed')
    expect(body.verify_detail).toEqual({ reason: 'not_a_document' })
    expect(typeof body.note).toBe('string')
    expect(body.next_options).toEqual([
      { level: 'L1', label: '접수번호를 적어 주세요' },
      { level: 'L3', label: '번호 없이 접수했다고 표시' },
    ])
    expect(marked).toEqual([[CASE_ID, STEP_ID, 'unconfirmed']])
    expect(written).toHaveLength(0)
    expect(met).toHaveLength(0)
    expect(regenerated.calls).toBe(0)
    // 응답에는 증거 번호를 안 싣지만 표에는 남깁니다
    expect(JSON.stringify(body)).not.toContain(EVIDENCE_ID)
    expect(artifacts[0]?.verifyDetail).toEqual({ reason: 'not_a_document', evidence_id: EVIDENCE_ID })
  })

  it('이체 캡처는 은행 이름이 있어도 접수증이 아니다', async () => {
    build('report-112', [], {
      kind: 'image',
      objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
      mimeType: 'image/png',
      ingestStatus: 'done',
      transcriptMasked: stored(['KB국민은행 이체 완료', '[계좌-1]', '1,000,000원', '2026-09-05 14:22']),
    })

    const body = (await (await POST(upload(), route())).json()) as Record<string, unknown>
    expect(body.step_state).toBe('unconfirmed')
    expect(body.verify_detail).toEqual({ reason: 'no_receipt_marks' })
  })

  it('아직 읽는 중이면 미뤄 둔다 — 표에 reading_pending 과 자료 번호가 남는다', async () => {
    const { marked, artifacts, met } = build('relief-apply', [], {
      kind: 'image',
      objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
      mimeType: 'image/png',
      ingestStatus: 'processing',
      transcriptMasked: null,
    })

    const body = (await (await POST(upload(), route())).json()) as Record<string, unknown>

    expect(body.step_state).toBe('unconfirmed')
    expect(body.verify_result).toBe('not_applicable')
    expect(body.verify_detail).toEqual({ reason: 'reading_pending' })
    expect(body.next_options).toBeUndefined()
    expect(marked).toEqual([[CASE_ID, STEP_ID, 'unconfirmed']])
    expect(met).toHaveLength(0)
    expect(regenerated.calls).toBe(0)
    // `settle-artifacts` 가 이 둘로 찾습니다
    expect(artifacts[0]?.verifyDetail).toEqual({ reason: 'reading_pending', evidence_id: EVIDENCE_ID })
  })

  it('이 사건의 자료가 아니면 400 이다 — 남의 자료를 내 단계의 증빙으로 못 붙인다', async () => {
    const { artifacts } = build('relief-apply', [], null)

    const res = await POST(upload(), route())
    expect(res.status).toBe(400)
    expect(artifacts).toHaveLength(0)
  })
})
