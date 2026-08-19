/**
 * work-handler — 어느 작업 패널을 열지 정하고 그 패널을 맡는다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md · spec/frontend/08-17-workspace-panels.md
 * 근거: ADR-023(층 C) · ADR-024(`body.action` 신설)
 *
 * ⬜ **렌더는 아직입니다.** 지금은 판정(`panel.ts`·`signal.ts`)만 서 있고,
 *    화면이 설 때 같은 폴더에 붙습니다 — 판정과 렌더를 섞지 않는 것이 이 모듈의 규칙입니다.
 */

export { panelFor, panelForStep, panelRule, exitFor } from "./panel";
export {
  pickStep,
  applySignal,
  openStep,
  closePanel,
  emptyPanelState,
  isOpen,
} from "./signal";
export type {
  Exit,
  PanelId,
  PanelRule,
  PanelState,
  PlanStep,
  SignalOptions,
  SkipReason,
  StepAction,
  StepState,
} from "./types";
