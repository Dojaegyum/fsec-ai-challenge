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

import type { OpenedCase, Track } from '@/modules/case-intake'
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
/** 단계에 딸린 부산물 하나 → 09-data-model.md §7 */
export interface StoredArtifact {
  readonly artifactId: string
  readonly kind: string
  readonly verifyLevel: string
  readonly verifyResult: string
}

/** 이 단계를 끝내려면 무엇이 필요한가 → §11.4 */
export interface RequiredArtifact {
  readonly kind: string
  readonly label: string
}

/**
 * 저장된 단계 하나.
 *
 * **모양이 §3.1 과 §3.6 에서 같습니다** → ADR-047. 얇은 쪽이면 화면이 사건을 만든
 * 직후에 작업 패널을 못 그립니다 — 그 패널을 정하는 `action` 이 `body` 안에 있습니다.
 */
export interface StoredStep {
  readonly planStepId: string
  readonly stepKey: string
  readonly seq: number
  readonly title: string
  readonly actor: Actor
  readonly conditional: string | null
  readonly state: StepState
  /** `plan_step.body` 그대로. `action`·`contact` 가 여기 있습니다 → §11.4 */
  readonly body: Readonly<Record<string, unknown>>
  readonly kbEntryId: string
  readonly kbVersion: string
  /**
   * 법령 근거.
   *
   * **`plan_step` 에 없는 칼럼입니다**(§6). `kb_entry` 를
   * `(kb_entry_id, kb_version)` 으로 함께 읽어야 나옵니다 → §11.3.
   */
  readonly legalBasis: string
  readonly sourceUrl: string
  /** `YYYY-MM-DD` */
  readonly effectiveFrom: string
  /** 이 단계에 붙은 부산물. 없으면 빈 배열 */
  readonly artifacts: readonly StoredArtifact[]
  /** 없으면 `null` */
  readonly requiredArtifact: RequiredArtifact | null
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
  /**
   * 이미 저장된 단계. 처음이면 빈 배열.
   *
   * **`kb_entry` 와 `artifact` 를 함께 읽어야 합니다** → ADR-047.
   * `legalBasis` 는 `plan_step` 에 없는 칼럼이고, 부산물은 `idx_artifact_step` 으로 옵니다.
   */
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
  /**
   * **사건과 플랜을 한 번에 만든다** → ADR-046.
   *
   * 사건을 먼저 저장하면 플랜이 실패했을 때 **되돌아갈 수 없는 빈 사건**이
   * 남습니다 — 에러 봉투에 `case_id` 를 담을 칸이 없기 때문입니다(10-errors.md §3).
   * 사용자는 진입할 때마다 빈 사건을 하나씩 쌓고, 사건 생성 상한까지 소진합니다.
   *
   * **한 트랜잭션이어야 합니다.** 둘로 갈라 부르는 자리를 만들지 마세요 —
   * 포트를 나눈 순간 어떤 구현도 이것을 보장할 수 없습니다.
   */
  openCase(row: OpenedCase, result: PlanResult): Promise<readonly StoredStep[]>
}

/**
 * 이 흐름이 밖에 요구하는 것 — **지금 어느 KB 릴리스인가.**
 *
 * **`KB_VERSION` 환경변수가 현재 릴리스입니다** → ADR-045 · §11.2.
 *
 * 「가장 최근 적재분」을 쓰지 않습니다. 적재기는 검수 중인 다음 버전을 미리 올릴 수
 * 있고, 최신 것을 무조건 고르면 **아직 사람이 안 본 절차가 피해자에게 나갑니다.**
 *
 * 값이 비어 있으면 던집니다 — 근거 없는 안내보다 멈추는 편이 낫습니다.
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
 * 08-16-errors.md §3 — 404. *"해당 사건을 찾지 못했습니다."*
 *
 * **`KB_ENTRY_NOT_FOUND` 와 다릅니다** — 저쪽은 절차 항목이 없는 것이고
 * 이쪽은 사건이 없는 것이라, 사용자에게 보일 말이 완전히 다릅니다.
 */
export class CaseNotFoundError extends AppError {
  readonly code: string = 'CASE_NOT_FOUND'
  readonly httpStatus: number = 404
  readonly retryable: boolean = false
}

/**
 * 사건을 열고 **T0 공통 안전 절차를 함께 저장한다** → §3.1 · ADR-046.
 *
 * 슬롯이 하나도 없어도 절차가 붙습니다 → 08-14-slot-tiering.md *"진입 자체로 충분"*.
 *
 * ## 왜 사건을 먼저 저장하지 않나
 *
 * 사건 행이 커밋된 뒤 플랜이 실패하면 에러 응답이 나가는데, **에러 봉투에는
 * `case_id` 를 담을 칸이 없습니다**(10-errors.md §3). 사용자는 방금 만들어진
 * 자기 사건으로 돌아갈 수 없고, 다시 시도할 때마다 빈 사건이 하나씩 쌓입니다.
 *
 * 그래서 **둘 다 만들어진 뒤에 한 번에 저장합니다.** 중간에 실패하면 아무것도
 * 안 남고, 사용자는 같은 자리에서 다시 시도하면 됩니다.
 *
 * @throws IngestError 갈래가 목록 밖일 때
 * @throws KbUnavailableError KB 조회가 실패했을 때 — 멈춥니다
 * @throws KbError 근거 네 칸이 빈 KB 항목이 왔을 때 — 버리지 않고 멈춥니다
 */
export async function openCaseWithPlan(
  input: { track: Track },
  deps: RegeneratePlanDeps,
): Promise<{ readonly opened: OpenedCase; readonly plan: PlanSnapshot }> {
  const { container, store, kbVersion } = deps
  const { caseIntake, kbFinder, planner, slotChecker, auditLogger } = container

  // 값만 만듭니다. 아직 저장하지 않습니다
  const opened = caseIntake.draft(input)
  const version = await kbVersion.current()

  // 새 사건이라 슬롯도 경유 서비스도 기존 단계도 없습니다.
  // **읽으러 가지 않습니다** — 아직 저장된 것이 없으므로 물어볼 곳이 없습니다
  const check = slotChecker.check({ slots: [] })

  const groups = await kbFinder.find({
    kbVersion: version,
    track: opened.track,
    // 비어 있어 조회가 전 유형 공통(T0)만 집어 옵니다
    channelId: null,
    orgId: null,
    asOf: serverClock.today(),
  })

  const result = planner.build({
    caseId: opened.caseId,
    applied: groups.applied.map(kbRowToPlanStep),
    reference: groups.reference.map(kbRowToPlanStep),
    slots: [],
    existing: [],
    superset: check.needsSupersetPlan,
  })

  // **여기서 처음 저장합니다.** 사건과 플랜이 한 트랜잭션으로 들어갑니다
  const steps = await store.openCase(opened, result)

  const record = await auditLogger.record({
    eventType: 'case.opened',
    actorType: 'user',
    caseId: opened.caseId,
    // 09-data-model.md §10.2 — 건수와 버전만. 원문도 토큰도 안 넣습니다
    detail: { track: opened.track, kb_version: version, steps: steps.length },
  })

  return {
    opened,
    plan: {
      caseId: opened.caseId,
      isSuperset: check.needsSupersetPlan,
      kbVersion: version,
      steps,
      nextQuestion: check.nextQuestion,
      t1: check.t1,
      t2: check.t2,
      auditId: record.auditId,
    },
  }
}
