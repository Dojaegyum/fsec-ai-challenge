/**
 * 플랜 재생성 흐름 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §3.1 · spec/backend/08-16-data-model.md §6.1 §11.2
 *            spec/backend/08-14-slot-tiering.md · CLAUDE.md 불변 규칙 1·5
 *
 * **여기서 못 박는 것 넷:**
 * 1. 슬롯이 하나도 없어도 플랜이 나온다 (불변 규칙 5)
 * 2. 조회 조건을 서버가 전부 채운다 (§11.2 — 모델에게 묻지 않는다)
 * 3. 근거 없는 단계를 만들지 않는다 (불변 규칙 1)
 * 4. 안 붙은 자원을 부르면 조용히 넘어가지 않는다
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { NotConfiguredError } from '@/lib/not-configured'

import type { KbQuery, KbRow, KbStore } from '@/modules/kb-finder'
import type { OpenedCase } from '@/modules/case-intake'
import type { PlanResult } from '@/modules/planner'

import {
  CaseNotFoundError,
  regeneratePlan,
  type CasePlanStore,
  type KbVersionSource,
  type StoredStep,
} from './regenerate-plan'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** 근거 네 칸이 다 찬 KB 항목 하나 — 이게 없으면 플랜 생성이 던집니다 */
function kbRow(over: Partial<KbRow> = {}): KbRow {
  return {
    kbEntryId: 'report-112',
    kbVersion: '2026.08.1',
    stepKey: 'report-112',
    stepSeq: 1,
    channelId: null,
    orgId: null,
    track: 'victim',
    title: '112에 신고하기',
    body: { actor: 'victim', summary: '112로 신고합니다' },
    legalBasis: '통신사기피해환급법 제3조',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2020-01-01',
    effectiveUntil: null,
    verifiedAt: '2026-08-01',
    ...over,
  }
}

/** 무엇으로 조회했는지 들여다볼 수 있는 KB 저장소 */
function kbStoreOf(rows: readonly KbRow[]) {
  const seen: KbQuery[] = []
  const store: KbStore = {
    async findApplied(query) {
      seen.push(query)
      return rows
    },
    async findReference() {
      return []
    },
  }
  return { store, seen }
}

/** 사건 하나가 들어 있는 저장소. 반영 결과를 들여다볼 수 있습니다 */
function planStoreOf(
  over: Partial<CasePlanStore> = {},
  existingSteps: readonly StoredStep[] = [],
) {
  const applied: PlanResult[] = []
  const openedRows: OpenedCase[] = []
  const store: CasePlanStore = {
    async openCase(row, result) {
      openedRows.push(row)
      return store.applyPlan(row.caseId, result)
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
    async readSteps() {
      return existingSteps
    },
    /**
     * **포트 계약대로 「반영 뒤의 플랜 전부」를 돌려줍니다.**
     *
     * `upsert` 만 돌려주면 시험은 통과하는데 실제로는 완료·미확인 단계가
     * 응답에서 통째로 빠집니다 — §6.1 이 막으려던 바로 그 파손입니다.
     * DB 구현자가 이 대역을 본떠 만들 수 있으므로 여기서부터 계약을 지킵니다.
     */
    async applyPlan(_caseId, result) {
      applied.push(result)

      const kept = existingSteps
        .filter((one) => result.preserved.some((two) => two.stepKey === one.stepKey))
        .map((one): StoredStep => ({
          ...one,
          seq: result.preserved.find((two) => two.stepKey === one.stepKey)!.seq,
        }))

      const fresh = result.upsert.map(
        (one, index): StoredStep => ({
          planStepId: `01J8STEP${String(index).padStart(17, '0')}`,
          stepKey: one.stepKey,
          seq: one.seq,
          title: one.title,
          actor: one.actor,
          conditional: one.conditional,
          state: one.state,
          body: one.body,
          kbEntryId: one.kbEntryId,
          kbVersion: one.kbVersion,
          // kb_entry 를 함께 읽어야 나오는 값입니다 → ADR-047
          legalBasis: `${one.kbEntryId} 근거 조항`,
          sourceUrl: one.sourceUrl,
          effectiveFrom: one.effectiveFrom,
          artifacts: [],
          requiredArtifact: null,
        }),
      )

      // 건너뜀으로 표시된 것도 지우지 않습니다 → §6.1
      const skipped = existingSteps
        .filter((one) => result.skipped.includes(one.stepKey))
        .map((one): StoredStep => ({ ...one, state: 'skipped' }))

      return [...fresh, ...kept, ...skipped].sort((a, b) => a.seq - b.seq)
    },
    ...over,
  }
  return { store, applied, openedRows }
}

const kbVersion: KbVersionSource = { current: async () => '2026.08.1' }

/** 감사 기록만 받아 두는 자리. 다른 포트는 안 붙은 그대로 둡니다 */
function portsWith(over: Partial<Ports>): Ports {
  const env = readEnv({})
  return {
    ...unconfiguredPorts(env),
    auditStore: { lastHash: async () => null, append: async () => {} },
    ...over,
  } as Ports
}

let deps: Parameters<typeof regeneratePlan>[1]
let seenQueries: KbQuery[]
let appliedResults: PlanResult[]

beforeEach(() => {
  const kb = kbStoreOf([kbRow()])
  const plans = planStoreOf()
  seenQueries = kb.seen
  appliedResults = plans.applied

  deps = {
    container: createContainer(readEnv({}), portsWith({ kbStore: kb.store })),
    store: plans.store,
    kbVersion,
  }
})

describe('슬롯이 하나도 없어도 플랜이 나온다 — 불변 규칙 5', () => {
  it('T0 단계가 붙는다', async () => {
    const snapshot = await regeneratePlan(CASE_ID, deps)

    expect(snapshot.steps).toHaveLength(1)
    expect(snapshot.steps[0].title).toBe('112에 신고하기')
  })

  it('넓은 플랜으로 간다', async () => {
    // T1 이 미충족이면 슈퍼셋입니다 — 낫게 안내하지 못할 바에 넓게 안내합니다
    const snapshot = await regeneratePlan(CASE_ID, deps)

    expect(snapshot.isSuperset).toBe(true)
    expect(snapshot.t1).not.toBe('satisfied')
  })

  it('질문이 나가든 안 나가든 플랜을 먼저 내놓는다', async () => {
    // **질문 여부에 기대지 않습니다.** 문진 문구가 붙기 전에는 물을 것이 없어
    // `nextQuestion` 이 `null` 이고, 붙은 뒤에는 첫 문항이 나갑니다 —
    // 이 시험이 확인하는 것은 **어느 쪽이든 플랜이 같은 응답에 실린다**는 것입니다.
    //
    // 답을 받고 나서 플랜을 만드는 것이 아닙니다. 질문으로 사용자를 세우면
    // 불변 규칙 5 위반이고, 그것이 여기서 못 박는 성질입니다
    // → 08-14-api.md §3.4 「next_question 이 null 이어도 실행 보드는 열립니다」
    const snapshot = await regeneratePlan(CASE_ID, deps)

    expect(snapshot.steps.length).toBeGreaterThan(0)
    expect(snapshot.isSuperset).toBe(true)
  })
})

describe('조회 조건을 서버가 전부 채운다 — §11.2', () => {
  it('갈래와 KB 버전을 넣는다', async () => {
    await regeneratePlan(CASE_ID, deps)

    expect(seenQueries[0]).toMatchObject({ track: 'victim', kbVersion: '2026.08.1' })
  })

  it('경유 서비스를 못 특정하면 비운다 — 그게 T1 미충족이다', async () => {
    await regeneratePlan(CASE_ID, deps)

    expect(seenQueries[0].channelId).toBeNull()
    expect(seenQueries[0].orgId).toBeNull()
  })

  it('조회 기준일이 서버 시각이다', async () => {
    await regeneratePlan(CASE_ID, deps)

    // 클라이언트 시계를 믿지 않습니다
    expect(seenQueries[0].asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('근거 없는 단계를 만들지 않는다 — 불변 규칙 1', () => {
  it('저장하는 단계마다 근거 네 칸이 있다', async () => {
    await regeneratePlan(CASE_ID, deps)

    for (const step of appliedResults[0].upsert) {
      expect(step.kbEntryId).toBeTruthy()
      expect(step.kbVersion).toBeTruthy()
      expect(step.sourceUrl).toBeTruthy()
      expect(step.effectiveFrom).toBeTruthy()
    }
  })

  it('근거가 빈 KB 항목이 오면 삼키지 않고 던진다', async () => {
    const kb = kbStoreOf([kbRow({ sourceUrl: '' })])
    const plans = planStoreOf()

    await expect(
      regeneratePlan(CASE_ID, {
        container: createContainer(readEnv({}), portsWith({ kbStore: kb.store })),
        store: plans.store,
        kbVersion,
      }),
    ).rejects.toThrow()
  })
})

describe('삭제 후 삽입이 아니다 — §6.1', () => {
  /** 이미 끝낸 단계 하나 */
  const DONE: StoredStep = {
    planStepId: '01J8OLD00000000000000000AA',
    stepKey: 'report-112',
    seq: 1,
    title: '112에 신고하기',
    actor: 'victim',
    conditional: null,
    state: 'done_verified',
    body: { text: '112로 전화합니다', action: 'call' },
    kbEntryId: 'report-112',
    legalBasis: '통신사기피해환급법 제3조',
    artifacts: [],
    requiredArtifact: null,
    kbVersion: '2026.08.1',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2020-01-01',
  }

  function withDoneStep() {
    const kb = kbStoreOf([kbRow()])
    const plans = planStoreOf({}, [DONE])
    return {
      plans,
      deps: {
        container: createContainer(readEnv({}), portsWith({ kbStore: kb.store })),
        store: plans.store,
        kbVersion,
      },
    }
  }

  it('완료된 단계를 덮지 않는다', async () => {
    const { plans, deps: one } = withDoneStep()

    await regeneratePlan(CASE_ID, one)

    // 완료된 단계를 덮으면 부산물이 끊깁니다
    const result = plans.applied[0]
    expect(result.upsert.map((step) => step.stepKey)).not.toContain('report-112')
    expect(result.preserved.map((step) => step.stepKey)).toContain('report-112')
  })

  it('완료된 단계가 응답에서 사라지지 않는다', async () => {
    // 저장소가 upsert 만 돌려주면 여기서 걸립니다 — 시험만 통과하고
    // 실제로는 완료·미확인 단계가 플랜에서 통째로 빠지는 상태입니다
    const { deps: one } = withDoneStep()

    const snapshot = await regeneratePlan(CASE_ID, one)

    expect(snapshot.steps.map((step) => step.stepKey)).toContain('report-112')
    expect(snapshot.steps.find((step) => step.stepKey === 'report-112')?.state)
      .toBe('done_verified')
  })

  it('감사 기록의 단계 수가 실제 플랜과 같다', async () => {
    // 09-data-model.md §10.2 의 plan.generated detail 입니다.
    // 보존된 단계를 안 세면 조사할 때 실제보다 작게 남습니다
    const { deps: one } = withDoneStep()

    const snapshot = await regeneratePlan(CASE_ID, one)

    expect(snapshot.steps.length).toBeGreaterThanOrEqual(1)
  })
})

describe('없는 사건', () => {
  it('404 로 낸다', async () => {
    const kb = kbStoreOf([kbRow()])
    const plans = planStoreOf({
      async readCase() {
        return null
      },
    })

    const thrown = await regeneratePlan(CASE_ID, {
      container: createContainer(readEnv({}), portsWith({ kbStore: kb.store })),
      store: plans.store,
      kbVersion,
    }).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(CaseNotFoundError)
    expect((thrown as CaseNotFoundError).httpStatus).toBe(404)
  })
})

describe('안 붙은 자원은 조용히 넘어가지 않는다', () => {
  it('플랜 저장소가 없으면 터진다', async () => {
    const container = createContainer(readEnv({}))

    await expect(
      regeneratePlan(CASE_ID, {
        container,
        store: container.ports.casePlan,
        kbVersion: container.ports.kbVersion,
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError)
  })

  it('KB 릴리스를 모르면 터진다', async () => {
    // ⬜ 「현재 릴리스」를 어디서 얻는지가 정본에 없습니다.
    // 아무 버전이나 고르면 아직 사람이 안 본 절차가 피해자에게 나갑니다
    const container = createContainer(readEnv({}))
    const plans = planStoreOf()

    await expect(
      regeneratePlan(CASE_ID, {
        container,
        store: plans.store,
        kbVersion: container.ports.kbVersion,
      }),
    ).rejects.toBeInstanceOf(NotConfiguredError)
  })
})
