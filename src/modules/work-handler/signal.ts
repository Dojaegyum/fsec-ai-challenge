/**
 * 시그널 — 어느 패널을 여는가.
 *
 * ```
 * 챗 응답의 referenced_steps
 *    ↓  아직 안 끝난 것만 남긴다 (done_verified · skipped 제외)
 *    ↓  그중 seq 가 가장 작은 것 하나
 *    ↓
 * 그 step 의 유형으로 워크스페이스를 연다
 * ```
 *
 * **모델이 패널을 고르지 않습니다.** 모델은 이미 내고 있는 `referenced_steps`만 내고,
 * 패널은 여기서 규칙으로 정합니다 → ADR-013 · ADR-022의 "모델은 도구를 부르지 않는다".
 *
 * 이 파일에 네트워크 호출도 렌더도 없어야 합니다.
 */

import { panelForStep } from "./panel";
import type {
  PanelState,
  PlanStep,
  SignalOptions,
  SkipReason,
} from "./types";

/** 끝난 것으로 보는 상태. 여기 있으면 후보에서 빠집니다 */
const CLOSED: ReadonlySet<string> = new Set(["done_verified", "skipped"]);

export function isOpen(step: PlanStep): boolean {
  return !CLOSED.has(step.state);
}

/**
 * 언급된 단계들 중 **지금 할 것 하나**를 고릅니다.
 *
 * **여러 단계를 언급해도 패널은 하나입니다.** "지급정지를 걸고 3영업일 안에 신청하세요"는
 * 두 단계를 가리키지만, 지금 할 것은 앞의 하나입니다.
 *
 * 고를 것이 없으면 `null`입니다 — 그때 **패널을 닫지 않는 것**은 부르는 쪽의 몫입니다
 * (`applySignal`이 그렇게 합니다).
 */
export function pickStep(
  referencedStepIds: readonly string[],
  steps: readonly PlanStep[],
  options: SignalOptions = {},
): PlanStep | null {
  const byId = new Map(steps.map((s) => [s.step_id, s]));
  const skip = (stepId: string, reason: SkipReason) =>
    options.onSkipped?.({ stepId, reason });

  const candidates: PlanStep[] = [];

  for (const id of referencedStepIds) {
    const step = byId.get(id);
    if (!step) {
      // 모델이 지어낸 step_id 이거나 다른 사건의 것
      skip(id, "not_in_plan");
      continue;
    }
    if (!isOpen(step)) {
      skip(id, "already_done");
      continue;
    }
    if (panelForStep(step) === null) {
      // 서버가 새 action 을 추가했는데 프론트가 모르는 경우
      skip(id, "unknown_action");
      continue;
    }
    candidates.push(step);
  }

  if (candidates.length === 0) return null;

  return candidates.reduce((best, s) => (s.seq < best.seq ? s : best));
}

/**
 * 챗 한 턴의 결과를 패널 상태에 반영합니다.
 *
 * | 조건 | 동작 |
 * | --- | --- |
 * | 남은 것이 있음 | 그 단계로 **패널을 바꾼다** |
 * | **남은 것이 없음** | **패널을 그대로 둔다. 닫지 않습니다** |
 *
 * **왜 안 닫는가** — `referenced_steps`는 "감사합니다" 같은 발화에서 비어 있습니다.
 * 그때 작업 패널이 사라지면 **사용자가 적고 있던 접수번호를 잃습니다.**
 */
export function applySignal(
  current: PanelState,
  referencedStepIds: readonly string[],
  steps: readonly PlanStep[],
  options: SignalOptions = {},
): PanelState {
  const step = pickStep(referencedStepIds, steps, options);
  if (!step) return current;

  const panel = panelForStep(step);
  if (!panel) return current;

  return { stepId: step.step_id, panel };
}

/**
 * 사용자가 보드에서 단계를 직접 누른 경우.
 *
 * **두 경로가 한 곳으로 들어옵니다** — 챗 시그널과 같은 결과를 냅니다.
 * 여기서만 다른 규칙을 쓰면 "같은 단계인데 다르게 열린다"가 생깁니다.
 */
export function openStep(
  current: PanelState,
  stepId: string,
  steps: readonly PlanStep[],
  options: SignalOptions = {},
): PanelState {
  return applySignal(current, [stepId], steps, options);
}

/** 아무것도 안 열린 상태 */
export function emptyPanelState(): PanelState {
  return { stepId: null, panel: null };
}

/**
 * 사용자가 패널을 닫습니다.
 *
 * **패널은 사용자가 닫거나 다른 단계로 바뀔 때만 바뀝니다** — 시그널은 닫지 않습니다.
 */
export function closePanel(): PanelState {
  return emptyPanelState();
}
