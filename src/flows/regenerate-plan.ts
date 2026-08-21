/**
 * 플랜을 만들고 다시 만드는 자리 — **호출자가 둘입니다.**
 *
 * 정본: spec/common/08-14-api.md §3.1 §3.5 · spec/backend/08-16-data-model.md §6 §6.1 §11.2
 *       spec/backend/08-14-slot-tiering.md
 * 근거: ADR-028 「라우트는 얇게, 모듈이 두껍게」 · CLAUDE.md 불변 규칙 1·5
 *
 * | 부르는 곳 | 언제 |
 * | --- | --- |
 * | `POST /api/cases` | 사건을 연 직후. 슬롯이 하나도 없어도 T0 가 붙습니다 |
 * | `PATCH …/slots/{slot_key}` | 슬롯이 채워질 때마다 |
 *
 * **둘이 같은 코드를 지나야 합니다.** 갈라 두면 「생성」과 「재생성」의 결과가
 * 조금씩 달라지고, 어느 쪽이 맞는지 알 수 없게 됩니다.
 *
 * ## 이 자리가 하는 일
 *
 * ```
 * 사건 읽기 → 슬롯 읽기 → 경유 서비스 읽기
 *   → 슬롯 체커: T1 충족? 슈퍼셋으로 갈까?
 *   → KB 조회 (적용·참고 두 묶음)
 *   → 플랜 생성기: step_key 로 병합
 *   → 저장 (삭제 후 삽입이 아니라 병합)
 *   → 감사 기록
 * ```
 *
 * **정보가 없다고 멈추지 않습니다** → 불변 규칙 5. 슬롯이 하나도 없으면
 * 슈퍼셋 플랜이 되고, 그것이 정상입니다.
 *
 * **근거 없는 단계는 만들지 않습니다** → 불변 규칙 1. 플랜 생성기가 근거 네 칸이
 * 빈 KB 항목을 받으면 던집니다 — 여기서 삼키지 않습니다.
 *
 * ## 기한은 여기서 안 셉니다
 *
 * §3.5 가 슬롯 응답에 `changed_deadlines` 를 요구하는데, 그 계산은 확정된 슬롯을
 * 기산점으로 삼습니다 → 08-16-deadline-rules.md. **플랜 단계가 정해진 뒤에 도는
 * 별개의 일**이라, 슬롯 라우트를 만들 때 이 자리 뒤에 붙입니다.
 */

import 'server-only'

import { kbRowToPlanStep } from '@/lib/adapters'
import { serverClock } from '@/lib/clock'
import type { Container } from '@/lib/container'
import { AppError } from '@/lib/errors'

import type { Track } from '@/modules/case-intake'
import type { Actor, PlanResult, StepState } from '@/modules/planner'
import type { NextQuestion, SlotKey, SlotState, SlotTier, TierStatus } from '@/modules/slot-checker'

/** `case_slot` 한 행 중 이 흐름이 보는 것 → 09-data-model.md §5 */
export interface StoredSlot {
  readonly slotKey: SlotKey
  readonly tier: SlotTier
  readonly state: SlotState
}

/**
 * `plan_step` 한 행 → 09-data-model.md §6.
 *
 * **칼럼 이름은 `plan_step_id` 인데 계약의 이름은 `step_id` 입니다** → §3.6.
 * 옮기는 자리를 아래 `toApiStep` 하나로 모읍니다.
 */
export interface StoredStep {
  readonly planStepId: string
  readonly stepKey: string
  readonly seq: number
  readonly title: string
  readonly actor: Actor
  readonly conditional: string | null
  readonly state: StepState
  readonly kbEntryId: string
  readonly kbVersion: string
  readonly sourceUrl: string
  /** `YYYY-MM-DD` */
  readonly effectiveFrom: string
}

/**
 * 이 흐름이 밖에 요구하는 것 — 사건의 상태를 읽고 플랜을 반영하는 자리.
 *
 * **SQL 은 여기 없습니다.** ⬜ DB 드라이버가 아직 안 정해져(`package.json` 에 하나도
 * 없습니다) 구현이 없고, 부르면 무엇이 왜 없는지 말하며 멈춥니다
 * → [not-configured.ts](../lib/not-configured.ts).
 */
export interface CasePlanStore {
  /** 사건의 갈래. 없는 사건이면 `null` */
  readCase(caseId: string): Promise<{ readonly track: Track } | null>
  /** 슬롯. 하나도 없으면 빈 배열 — **없는 것이 정상입니다** */
  readSlots(caseId: string): Promise<readonly StoredSlot[]>
  /** 특정된 경유 서비스. 못 특정했으면 `null` → 09-data-model.md §4 */
  readChannel(
    caseId: string,
  ): Promise<{ readonly channelId: string; readonly orgId: string | null } | null>
  /** 이미 저장된 단계. 처음이면 빈 배열 */
  readSteps(caseId: string): Promise<readonly StoredStep[]>
  /**
   * 병합 결과를 반영하고 **반영 뒤의 플랜 전부**를 `seq` 순으로 돌려준다.
   *
   * **삭제 후 삽입이 아닙니다** → §6.1. `upsert` 는 교체하고, `preserved` 는
   * 내용을 두고 `seq` 만 갱신하며, `skipped` 는 상태만 바꿉니다. 지우지 않습니다.
   *
   * 새 단계의 `plan_step_id` 는 이 구현이 발급합니다 — 발급기를 이 흐름이
   * 고를 이유가 없습니다.
   */
  applyPlan(caseId: string, result: PlanResult): Promise<readonly StoredStep[]>
}

/**
 * 이 흐름이 밖에 요구하는 것 — **지금 어느 KB 릴리스인가.**
 *
 * ⬜ **정본에 방법이 없습니다.** 09-data-model.md §11.2 가 조회 조건으로
 * *"`kb_version` — 현재 릴리스"* 라고만 적었고, **어디서 그 값을 얻는지는
 * 어디에도 없습니다.** 스키마에 `kb_release` 같은 표도 없고 `kb_entry` 에는
 * 행마다 `released_at` 만 있습니다.
 *
 * **여기서 정하지 않았습니다.** 최신 버전을 고르는 것과 「현재 릴리스」는 다를 수
 * 있습니다 — 검수 중인 다음 버전이 먼저 적재될 수 있기 때문입니다. 잘못 고르면
 * **아직 사람이 안 본 절차가 피해자에게 나갑니다.**
 */
export interface KbVersionSource {
  /**
   * @throws KbUnavailableError 알 수 없을 때. **근거 없는 안내보다 멈추는 편이
   *         낫습니다** → 10-errors.md §4.1
   */
  current(): Promise<string>
}

/** 이 흐름이 내놓는 것 */
export interface PlanSnapshot {
  readonly caseId: string
  /** 조건부 단계가 섞인 넓은 플랜인가 → 08-14-slot-tiering.md */
  readonly isSuperset: boolean
  readonly kbVersion: string
  readonly steps: readonly StoredStep[]
  /** 다음에 물을 한 문항. 없으면 `null` — **그래도 실행 보드는 열립니다** */
  readonly nextQuestion: NextQuestion | null
  readonly t1: TierStatus
  readonly t2: TierStatus
  /**
   * **플랜 생성** 기록의 식별자 — `plan.generated` 한 줄.
   *
   * 사건 생성 경로에서는 이 값이 계측 헤더에 안 실립니다. 그 응답의
   * `X-Audit-Id` 는 먼저 남은 `case.opened` 것이고, 헤더가 하나라 뒤엣것으로
   * 덮지 않기 때문입니다 → [telemetry.ts](../lib/telemetry.ts).
   * **두 기록 다 같은 `case_id` 로 묶여 있어** 사건 식별자로 함께 찾습니다.
   */
  readonly auditId: string
}

export interface RegeneratePlanDeps {
  readonly container: Container
  readonly store: CasePlanStore
  readonly kbVersion: KbVersionSource
}

/**
 * 사건 하나의 플랜을 지금 아는 것에 맞춰 다시 만든다.
 *
 * @throws KbUnavailableError KB 조회가 실패했을 때 — 멈춥니다
 * @throws KbError 근거 네 칸이 빈 KB 항목이 왔을 때 — 버리지 않고 멈춥니다
 */
export async function regeneratePlan(
  caseId: string,
  deps: RegeneratePlanDeps,
): Promise<PlanSnapshot> {
  const { container, store, kbVersion } = deps
  const { kbFinder, planner, slotChecker, auditLogger } = container

  const found = await store.readCase(caseId)
  if (!found) {
    throw new CaseNotFoundError('그 사건을 찾지 못했습니다', { caseId })
  }

  const [slots, channel, existing, version] = await Promise.all([
    store.readSlots(caseId),
    store.readChannel(caseId),
    store.readSteps(caseId),
    kbVersion.current(),
  ])

  // 슬롯이 하나도 없어도 판정합니다 — T1 미충족이고, 그것이 정상입니다
  const check = slotChecker.check({ slots })

  const groups = await kbFinder.find({
    kbVersion: version,
    track: found.track,
    // **비면 T1 미충족입니다** — 조회가 전 유형 공통(T0)만 집어 옵니다
    channelId: channel?.channelId ?? null,
    orgId: channel?.orgId ?? null,
    // **서버 시각입니다** → 09-data-model.md §11.2. 클라이언트 시계를 믿지 않습니다.
    // 서버 시계는 `lib/clock.ts` 하나뿐입니다 — `date-checker` 에는 오늘을
    // 내주는 메서드가 없고(그 모듈은 오늘을 밖에서 받아 씁니다), 시계가 여럿이면
    // 크론이 UTC 자정 근처에서 하루 어긋납니다
    asOf: serverClock.today(),
  })

  const result = planner.build({
    caseId,
    applied: groups.applied.map(kbRowToPlanStep),
    // 참고 묶음은 슈퍼셋일 때만 씁니다 — 섞으면 은행 사건에 거래소 절차가 붙습니다
    reference: groups.reference.map(kbRowToPlanStep),
    slots: slots.map((one) => ({ slotKey: one.slotKey, state: one.state })),
    existing: existing.map((one) => ({ stepKey: one.stepKey, state: one.state })),
    superset: check.needsSupersetPlan,
  })

  const steps = await store.applyPlan(caseId, result)

  // 09-data-model.md §10.2 — detail 에 건수와 버전만 담습니다. 원문도 토큰도 안 넣습니다
  const record = await auditLogger.record({
    eventType: 'plan.generated',
    actorType: 'system',
    caseId,
    detail: { kb_version: version, steps: steps.length },
  })

  return {
    caseId,
    isSuperset: check.needsSupersetPlan,
    kbVersion: version,
    steps,
    nextQuestion: check.nextQuestion,
    t1: check.t1,
    t2: check.t2,
    auditId: record.auditId,
  }
}

/**
 * 그 사건이 없다.
 *
 * ⬜ **정본의 코드 표에 없습니다** → 08-16-errors.md §3. 표는 도메인 실패만
 * 담고 있어 「그런 사건이 없다」를 넣을 칸이 없습니다. `KB_ENTRY_NOT_FOUND` 는
 * KB 항목 전용이라 쓸 수 없습니다.
 */
export class CaseNotFoundError extends AppError {
  readonly code: string = 'CASE_NOT_FOUND'
  readonly httpStatus: number = 404
  readonly retryable: boolean = false
}
