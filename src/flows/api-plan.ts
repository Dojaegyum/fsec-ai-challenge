/**
 * 플랜을 계약의 표기로 옮기는 자리 — **옮기는 곳을 하나로 둡니다.**
 *
 * 정본: spec/common/08-14-api.md §3.1 §3.6
 *
 * 코드는 낙타 표기(`planStepId`)를 쓰고 계약은 밑줄 표기(`step_id`)를 씁니다.
 * 라우트마다 옮기면 한 곳에서 이름을 잘못 적어도 **컴파일이 안 막습니다** —
 * JSON 이라 그냥 다른 이름으로 나갑니다.
 *
 * **손으로 적습니다.** 자동 변환을 쓰면 저장소 내부 값이 같이 실려 나갑니다 —
 * [lib/adapters.ts](../lib/adapters.ts) 와 같은 이유입니다.
 *
 * ## 단계 모양은 한 벌뿐입니다
 *
 * §3.1(사건 생성)과 §3.6(플랜 조회)이 같은 모양을 씁니다 → ADR-047.
 *
 * 전에는 §3.1 이 `body`·`artifacts`·`required_artifact` 없이 얇았습니다. 그러면
 * **화면이 사건을 만든 직후에 작업 패널을 못 그립니다** — ADR-024 가
 * *"클라이언트가 `actor`·`channel`·`required_artifact` 로 유형을 추론하지 않습니다 —
 * 서버가 준 `action` 을 그대로 씁니다"* 라고 정했는데 그 `action` 이 `body` 안에
 * 있기 때문입니다. 화면이 곧바로 플랜 조회를 한 번 더 불러야 했습니다.
 *
 * **모양이 둘이면 옮기는 코드도 둘입니다.** 한쪽만 고치면 조용히 갈라집니다.
 */

import 'server-only'

import type { PlanSnapshot, StoredStep } from './regenerate-plan'

/** 계약의 `steps[]` 한 칸 → §3.1 · §3.6 (같은 모양입니다) */
export interface ApiPlanStep {
  readonly step_id: string
  readonly seq: number
  readonly title: string
  readonly state: string
  readonly actor: string
  /** 슈퍼셋 플랜의 조건 라벨. 없으면 `null` */
  readonly conditional: string | null
  /** `action` 이 화면의 작업 패널을 정합니다 → ADR-024 */
  readonly body: Readonly<Record<string, unknown>>
  readonly citation: {
    readonly kb_entry_id: string
    readonly kb_version: string
    readonly legal_basis: string
    readonly source_url: string
    readonly effective_from: string
  }
  readonly artifacts: readonly {
    readonly artifact_id: string
    readonly kind: string
    readonly verify_level: string
    readonly verify_result: string
  }[]
  readonly required_artifact: {
    readonly kind: string
    readonly label: string
  } | null
}

/** 계약의 `plan` */
export interface ApiPlan {
  readonly is_superset: boolean
  readonly steps: readonly ApiPlanStep[]
}

/**
 * 단계 하나를 계약의 모양으로.
 *
 * **`citation` 이 없는 단계를 만들지 않습니다** → CLAUDE.md 불변 규칙 1.
 * 네 칸은 `plan_step` 이 `NOT NULL` 로 잡고 있고(§6), 빈 값이면 애초에
 * 저장이 거부됩니다. `legal_basis` 는 `kb_entry` 쪽 `NOT NULL` 입니다(§11.3).
 */
export function toApiStep(step: StoredStep): ApiPlanStep {
  return {
    // 칼럼 이름은 plan_step_id 인데 계약의 이름은 step_id 입니다
    step_id: step.planStepId,
    seq: step.seq,
    title: step.title,
    state: step.state,
    actor: step.actor,
    conditional: step.conditional,
    /**
     * KB 가 담은 것을 그대로 옮기되 **`step_key` 하나만 더합니다.**
     *
     * 계약이 `body.step_key` 로 정했는데(§3.6 「사슬을 잇는 열쇠」) 그 값은
     * `body` 가 아니라 **`plan_step.step_key` 칼럼**에 있습니다. KB 파일에
     * 같이 적어 두면 칼럼과 둘이 되어 어긋납니다.
     *
     * **없으면 화면이 번호를 하나도 못 붙입니다** — `plan-viewer` 의
     * `numberSteps` 가 이 열쇠로 `after` 사슬을 잇습니다. 안 오면 전부 점으로
     * 그리고 「번호가 붙은 것만 순서대로」 안내 줄도 안 뜹니다.
     */
    body: { ...step.body, step_key: step.stepKey },
    citation: {
      kb_entry_id: step.kbEntryId,
      kb_version: step.kbVersion,
      legal_basis: step.legalBasis,
      source_url: step.sourceUrl,
      effective_from: step.effectiveFrom,
    },
    artifacts: step.artifacts.map((one) => ({
      artifact_id: one.artifactId,
      kind: one.kind,
      verify_level: one.verifyLevel,
      verify_result: one.verifyResult,
    })),
    required_artifact: step.requiredArtifact
      ? { kind: step.requiredArtifact.kind, label: step.requiredArtifact.label }
      : null,
  }
}

/**
 * **쓰는 두 칸만 받습니다.** 스냅샷 전체를 요구하면 `changedDeadlines` 처럼
 * 이 응답과 무관한 칸이 늘 때마다 부르는 자리와 시험이 함께 늘어납니다.
 */
export function toApiPlan(
  snapshot: Pick<PlanSnapshot, 'isSuperset' | 'steps'>,
): ApiPlan {
  return {
    is_superset: snapshot.isSuperset,
    steps: snapshot.steps.map(toApiStep),
  }
}
