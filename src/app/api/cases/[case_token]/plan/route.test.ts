/**
 * `GET /api/cases/{case_token}/plan` 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §3.6 · spec/backend/08-16-data-model.md §6 §6.1
 *
 * **여기서 못 박는 것 셋:**
 * 1. `generated_at` 이 **응답에 실린다** — 계약이 정한 칸인데 늘 `null` 이었습니다
 * 2. 보존된 옛 단계가 섞여도 **가장 최근** 것이 나온다 → §6.1
 * 3. 값이 없으면 `null` 이다 — **지금 시각으로 메우지 않습니다.** 조회는
 *    아무것도 안 바꾸는데 폴링마다 「방금 갱신됨」이 되면 안 됩니다
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

/** 이 시험이 보는 것은 플랜의 시각 하나입니다 — 나머지는 비워 둡니다 */
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
    slots: { read: async () => [] },
    channelWrite: { write: async () => {}, candidates: async () => [] },
    orgs: { read: async () => null, list: async () => [] },
  }
}

/** 응답 본문의 플랜 부분 */
async function planOf(steps: readonly StoredStep[]) {
  holder.container = wiredContainer(steps)

  const res = await GET(new Request(`http://x/api/cases/${TOKEN}/plan`), {
    params: Promise.resolve({ case_token: TOKEN }),
  })

  expect(res.status).toBe(200)
  return (await res.json()) as { generated_at: string | null; kb_version: string | null }
}

beforeEach(() => {
  holder.container = undefined
})

describe('플랜 생성 시각을 응답에 싣는다 — §3.6 `generated_at`', () => {
  it('저장된 시각이 그대로 나간다', async () => {
    const body = await planOf([stepAt('report-112', 1, '2026-08-27T15:30:00.000+09:00')])

    // 계약이 정한 칸인데 라우트가 `null` 로 못 박아 두고 있었습니다 —
    // 값은 `plan_step.generated_at` 에 이미 있고 되읽는 자리만 없었습니다
    expect(body.generated_at).toBe('2026-08-27T15:30:00.000+09:00')
  })

  it('**보존된 옛 단계가 섞여도 가장 최근 것이 나간다** — §6.1', async () => {
    // 재생성은 지우고 다시 넣지 않아 완료된 단계가 옛 시각을 그대로 들고
    // 있습니다. 옛것을 `seq` 앞에 둡니다 — 첫째를 고르면 여기서 걸립니다
    const body = await planOf([
      stepAt('report-112', 1, '2026-08-20T09:00:00.000+09:00'),
      stepAt('bank-freeze', 2, '2026-08-27T15:30:00.000+09:00'),
    ])

    expect(body.generated_at).toBe('2026-08-27T15:30:00.000+09:00')
  })

  it('없으면 `null` 이다 — **지금 시각으로 메우지 않는다**', async () => {
    // 화면이 이 경로를 폴링합니다(§1.3). 여기서 지금 시각을 만들면 아무 일도
    // 없었는데 매번 「방금 갱신됨」이 됩니다
    const body = await planOf([])

    expect(body.generated_at).toBeNull()
  })
})
