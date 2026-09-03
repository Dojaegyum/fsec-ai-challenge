/**
 * `GET /api/cases/{case_token}` 시험 — 재방문 진입.
 *
 * 검증 대상: spec/common/08-14-api.md §3.10 · §3.6 ·
 *            spec/backend/08-16-data-model.md §6 §6.1
 *
 * **여기서 못 박는 것 둘:**
 * 1. `plan.generated_at` 이 **§3.6 과 같은 값을 낸다** — 이 경로는 §3.6 의
 *    응답을 그대로 품습니다(§3.10 「구조를 다시 정의하지 않습니다」). 한쪽만
 *    고치면 같은 플랜이 두 화면에서 다르게 보입니다
 * 2. 없으면 `null` 이다 — **며칠 만에 링크를 연 사람에게 「방금 갱신됨」을
 *    띄우지 않습니다**
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CasePlanStore, StoredStep } from '@/flows/regenerate-plan'

import { GET } from './route'

const CASE_ID = '01J8CASE000000000000000000'
const TOKEN = '01J8TKN0000000000000000000'

/** 저장된 단계 하나. `generatedAt` 만 갈아끼웁니다 */
function stepAt(stepKey: string, seq: number, generatedAt?: string): StoredStep {
  return {
    planStepId: `01J8STEP${String(seq).padStart(17, '0')}`,
    stepKey,
    seq,
    title: `${stepKey} 단계`,
    actor: 'victim',
    conditional: null,
    state: 'not_started',
    body: { text: '본문', action: 'call' },
    kbEntryId: stepKey,
    kbVersion: '2026.08.1',
    legalBasis: '통신사기피해환급법 제3조',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2020-01-01',
    ...(generatedAt === undefined ? {} : { generatedAt }),
    artifacts: [],
    requiredArtifact: null,
  }
}

function planStoreOf(steps: readonly StoredStep[]): CasePlanStore {
  return {
    async openCase() {
      return []
    },
    async readCase() {
      return { track: 'victim' as const }
    },
    async readSlots() {
      return []
    },
    async readChannel() {
      return null
    },
    async readChannels() {
      return []
    },
    async readSteps() {
      return steps
    },
    async applyPlan() {
      return steps
    },
  }
}

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

function wiredContainer(steps: readonly StoredStep[]) {
  const ports = {
    ...unconfiguredPorts(readEnv({})),
    casePlan: planStoreOf(steps),
    kbStore: { async findApplied() { return [] }, async findReference() { return [] } },
    auditStore: { appendChained: async (build) => build(null) },
    kbVersion: { current: async () => '2026.08.1' },
  } as Ports

  return {
    ...createContainer(readEnv({}), ports),
    caseTokens: { toCaseId: async () => CASE_ID },
    caseRead: {
      read: async () => ({
        track: 'victim',
        status: 'intake',
        createdAt: '2026-08-20T09:00:00.000+09:00',
        lastActivityAt: '2026-08-27T15:30:00.000+09:00',
        purgeAfter: '2027-02-23',
      }),
    },
    slots: { read: async () => [] },
    channelWrite: { write: async () => {}, candidates: async () => [] },
    orgs: { read: async () => null, list: async () => [] },
    // §3.7 도 같은 응답에 실립니다 — 이 시험이 보는 것은 플랜 쪽입니다
    deadlines: { read: async () => [] },
    deadlineWrite: { apply: async () => [], sweepOverdue: async () => 0 },
  }
}

async function planOf(steps: readonly StoredStep[]) {
  holder.container = wiredContainer(steps)

  const res = await GET(new Request(`http://x/api/cases/${TOKEN}`), {
    params: Promise.resolve({ case_token: TOKEN }),
  })

  expect(res.status).toBe(200)
  const body = (await res.json()) as { plan: { generated_at: string | null } }
  return body.plan
}

beforeEach(() => {
  holder.container = undefined
})

describe('첫 로드에도 플랜 생성 시각이 실린다 — §3.10 이 품은 §3.6', () => {
  it('저장된 시각이 그대로 나간다', async () => {
    const plan = await planOf([stepAt('report-112', 1, '2026-08-27T15:30:00.000+09:00')])

    expect(plan.generated_at).toBe('2026-08-27T15:30:00.000+09:00')
  })

  it('**보존된 옛 단계가 섞여도 가장 최근 것이 나간다** — §6.1', async () => {
    const plan = await planOf([
      stepAt('report-112', 1, '2026-08-20T09:00:00.000+09:00'),
      stepAt('bank-freeze', 2, '2026-08-27T15:30:00.000+09:00'),
    ])

    expect(plan.generated_at).toBe('2026-08-27T15:30:00.000+09:00')
  })

  it('없으면 `null` 이다 — 지금 시각으로 메우지 않는다', async () => {
    const plan = await planOf([])

    expect(plan.generated_at).toBeNull()
  })
})
