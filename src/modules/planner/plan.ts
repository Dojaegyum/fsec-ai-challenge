/**
 * 플랜 생성 — 활성 조건 판정 · 슈퍼셋 · 상태 병합.
 *
 * 정본: spec/backend/08-16-data-model.md §6 §6.1 §11.4 ·
 *       spec/backend/08-14-slot-tiering.md
 *
 * **절차 문장을 만들지 않습니다.** KB 항목의 본문을 그대로 옮기고, 이 모듈이
 * 정하는 것은 **어느 단계가 지금 활성인가**와 **기존 상태를 어떻게 잇는가**입니다.
 */

import { KbError } from '@/lib/errors'

import type {
  Actor,
  Clock,
  KbStep,
  PlanInput,
  Planner,
  PlanResult,
  PlannedStep,
  PreservedStep,
  SlotState,
  StepState,
} from './types'

const ACTORS: readonly Actor[] = [
  'victim',
  'police',
  'bank',
  'prosecutor',
  'carrier',
  'issuer',
  // 감독기관. 채권소멸공고를 내는 것이 금융감독원입니다 → 마이그레이션 0006
  'agency',
]

/**
 * 재생성해도 내용을 손대지 않는 상태 → 09-data-model.md §6.1.
 *
 * `done_verified` 를 덮으면 부산물이 끊기고, `unconfirmed` 를 덮으면
 * 리마인더 추적이 끊깁니다.
 */
const PRESERVED: readonly StepState[] = ['done_verified', 'unconfirmed']

export function createPlanner(deps: { clock: Clock }): Planner {
  const { clock } = deps

  return {
    build(input: PlanInput): PlanResult {
      const slots = new Map<string, SlotState>(
        input.slots.map((one) => [one.slotKey, one.state]),
      )
      const existing = new Map<string, StepState>(
        (input.existing ?? []).map((one) => [one.stepKey, one.state]),
      )

      // 이미 끝난 단계는 활성 조건 판정에 쓰입니다 — `after` 가 이것을 봅니다
      const done = new Set(
        [...existing.entries()]
          .filter(([, state]) => state === 'done_verified')
          .map(([stepKey]) => stepKey),
      )

      const chosen = [
        ...input.applied.filter((step) => isActive(step, slots, done)),
        ...supersetSteps(input, slots, done),
      ]

      const generatedAt = clock.now()
      const upsert: PlannedStep[] = []
      const preserved: PreservedStep[] = []

      chosen.forEach((step, index) => {
        assertGrounded(step)

        // 표시 순서는 보존 여부와 무관하게 플랜 순서를 따릅니다.
        // 건너뛰고 매기면 완료할 때마다 화면 순서가 어긋납니다
        const seq = index + 1
        const state = existing.get(step.stepKey)

        if (state !== undefined && PRESERVED.includes(state)) {
          preserved.push({ stepKey: step.stepKey, seq })
          return
        }

        upsert.push({
          caseId: input.caseId,
          seq,
          stepKey: step.stepKey,
          title: step.title,
          actor: step.body.actor as Actor,
          body: step.body,
          conditional: step.body.conditional ?? null,
          // 진행 중이던 것은 상태를 유지하고 내용만 교체합니다
          state: state === 'in_progress' ? 'in_progress' : 'not_started',
          kbEntryId: step.kbEntryId,
          kbVersion: step.kbVersion,
          sourceUrl: step.sourceUrl,
          effectiveFrom: step.effectiveFrom,
          generatedAt,
        })
      })

      const kept = new Set([
        ...upsert.map((one) => one.stepKey),
        ...preserved.map((one) => one.stepKey),
      ])

      return {
        upsert,
        preserved,
        // 새 플랜에 없는 단계는 지우지 않고 표시만 바꿉니다
        skipped: [...existing.keys()].filter(
          (stepKey) => !kept.has(stepKey) && existing.get(stepKey) !== 'skipped',
        ),
      }
    },
  }
}

/**
 * 지금 활성인가 → 09-data-model.md §11.4.
 *
 * **`confirmed` 슬롯만 셉니다.** `extracted` 는 모델이 뽑았을 뿐 확인 전이라,
 * 그걸로 단계를 켜면 잘못 읽은 값 때문에 엉뚱한 절차가 뜹니다 → §5.2.
 */
function isActive(
  step: KbStep,
  slots: Map<string, SlotState>,
  done: Set<string>,
): boolean {
  const needs = step.body.requiresSlots ?? []
  if (needs.some((slotKey) => slots.get(slotKey) !== 'confirmed')) return false

  const after = step.body.after ?? []
  return after.every((stepKey) => done.has(stepKey))
}

/**
 * 슈퍼셋 플랜에 넣을 다른 유형의 단계 → 02-slot-tiering.md.
 *
 * **조건 라벨이 있는 것만 넣습니다.** 라벨 없이 넣으면 은행 이체 사건에
 * 간편송금 절차가 조건 없이 뜹니다 — 그건 슈퍼셋이 아니라 틀린 안내입니다.
 *
 * ⬜ 라벨은 KB 가 씁니다(`body.conditional`). 안 쓰여 있으면 이 모듈이 지어낼 수
 * 없어 빠집니다. 유형 이름에서 문구를 만들면 절차 지식을 코드에 굽는 셈입니다.
 */
function supersetSteps(
  input: PlanInput,
  slots: Map<string, SlotState>,
  done: Set<string>,
): readonly KbStep[] {
  if (!input.superset) return []

  return (input.reference ?? [])
    .filter((step) => step.body.conditional)
    .filter((step) => isActive(step, slots, done))
}

/**
 * 근거가 붙어 있는지 본다.
 *
 * **버리고 넘어가지 않고 던집니다.** 09-data-model.md §6 이 네 칸이 비면 적재를
 * 거부한다고 정했고, *"근거 없는 단계가 저장될 수 있으면 불변 규칙 1이 강제되지
 * 않는다"* 고 이유를 적어 두었습니다. 조용히 빼면 사용자는 절차 하나가
 * 없어진 것을 모릅니다.
 */
function assertGrounded(step: KbStep): void {
  const missing = (
    [
      ['kbEntryId', step.kbEntryId],
      ['kbVersion', step.kbVersion],
      ['sourceUrl', step.sourceUrl],
      ['effectiveFrom', step.effectiveFrom],
    ] as const
  )
    .filter(([, value]) => !value || !String(value).trim())
    .map(([name]) => name)

  if (missing.length > 0) {
    throw new KbError(`근거 없는 KB 항목입니다: ${step.stepKey}`, {
      stepKey: step.stepKey,
      missing,
    })
  }

  // actor 는 「누가 하나」입니다. 기본값을 두면 기관이 할 일이 사용자 할 일로 뜹니다
  if (!step.body.actor || !ACTORS.includes(step.body.actor)) {
    throw new KbError(`actor 가 없거나 목록 밖입니다: ${step.stepKey}`, {
      stepKey: step.stepKey,
      actor: step.body.actor ?? null,
    })
  }
}
