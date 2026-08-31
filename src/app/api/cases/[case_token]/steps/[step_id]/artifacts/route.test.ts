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

function build(stepKey: string, existingSlots: unknown[] = []) {
  const env = readEnv({})
  const written: Record<string, unknown>[] = []
  const marked: unknown[] = []

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
      async write() {},
      async markStep(...args: unknown[]) {
        marked.push(args)
        return true
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
    slotWrite: {
      async write(row: Record<string, unknown>) {
        written.push(row)
      },
    },
  }
  return { written, marked }
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
})
