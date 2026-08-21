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
 * ## §3.1 과 §3.6 의 단계 모양이 다릅니다
 *
 * ⬜ **어느 쪽이 맞는지 사람이 정해야 합니다.**
 *
 * | | §3.1 (사건 생성) | §3.6 (플랜 조회) |
 * | --- | --- | --- |
 * | `step_id`·`seq`·`title`·`state`·`actor` | 있음 | 있음 |
 * | `citation` | `kb_entry_id`·`kb_version`·`source_url`·`effective_from` | **`legal_basis` 도** |
 * | `body`·`artifacts`·`required_artifact` | **없음** | 있음 |
 *
 * **§3.1 을 글자 그대로 따랐습니다.** 두 가지 이유입니다.
 *
 * 하나, `body.contact` 는 *"`contact_ref` 를 서버가 푼 값"* 이라(§3.6) 기관 표를
 * 한 번 더 읽어야 나옵니다. 그 푸는 규칙을 여기서 지어내면 플랜 조회를 만들 때
 * 두 곳이 서로 다르게 풀 수 있습니다.
 *
 * 둘, `plan_step` 표에 `legal_basis` 칼럼이 **없습니다**(§6). §3.6 이 그것을
 * 요구하므로 플랜 조회는 `kb_entry` 를 함께 읽어야 하는데, §3.1 은 그 값을
 * 요구하지 않아 읽을 이유가 없습니다.
 *
 * **다만 이대로면 화면이 사건을 만든 직후에 작업 패널을 못 그립니다** —
 * ADR-024 가 *"클라이언트가 `actor`·`channel`·`required_artifact` 로 유형을
 * 추론하지 않습니다 — 서버가 준 `action` 을 그대로 씁니다"* 라고 정했는데,
 * 그 `action` 이 `body` 안에 있기 때문입니다. 화면은 곧바로 플랜 조회를 한 번
 * 더 불러야 합니다.
 */

import 'server-only'

import type { PlanSnapshot, StoredStep } from './regenerate-plan'

/** §3.1 의 `plan.steps[]` 한 칸 */
export interface ApiPlanStep {
  readonly step_id: string
  readonly seq: number
  readonly title: string
  readonly state: string
  readonly actor: string
  /** 슈퍼셋 플랜의 조건 라벨. 없으면 `null` → §3.6 */
  readonly conditional: string | null
  readonly citation: {
    readonly kb_entry_id: string
    readonly kb_version: string
    readonly source_url: string
    readonly effective_from: string
  }
}

/** §3.1 의 `plan` */
export interface ApiPlan {
  readonly is_superset: boolean
  readonly steps: readonly ApiPlanStep[]
}

/**
 * 단계 하나를 계약의 모양으로.
 *
 * **`citation` 이 없는 단계를 만들지 않습니다** → CLAUDE.md 불변 규칙 1.
 * 네 칸은 `plan_step` 이 `NOT NULL` 로 잡고 있고(§6), 빈 값이면 애초에
 * 저장이 거부됩니다.
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
    citation: {
      kb_entry_id: step.kbEntryId,
      kb_version: step.kbVersion,
      source_url: step.sourceUrl,
      effective_from: step.effectiveFrom,
    },
  }
}

export function toApiPlan(snapshot: PlanSnapshot): ApiPlan {
  return {
    is_superset: snapshot.isSuperset,
    steps: snapshot.steps.map(toApiStep),
  }
}
