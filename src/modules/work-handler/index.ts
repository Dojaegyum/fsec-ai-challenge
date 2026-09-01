/**
 * work-handler — 어느 작업 패널을 열지 정하고 그 패널을 맡는다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md · spec/frontend/08-17-workspace-panels.md
 * 근거: ADR-023(층 C) · ADR-024(`body.action` 신설)
 *
 * 판정은 `panel.ts`·`signal.ts`, 렌더는 `panels.tsx` 입니다.
 * **둘을 섞지 마세요** — 한 모듈로 합친 대가라 경계가 모듈 안의 규칙으로만 남습니다.
 */

export { panelFor, panelForStep, panelRule, exitFor } from "./panel";
export {
  pickStep,
  applySignal,
  openStep,
  closePanel,
  emptyPanelState,
  currentStep,
  isOpen,
} from "./signal";
export {
  CallPanel,
  VisitPanel,
  WritePanel,
  UploadPanel,
  DownloadPanel,
  WaitPanel,
  ReadPanel,
  Token,
  PANEL_EYEBROW,
} from "./panels";
export type { PanelProps } from "./panels";
export { Workspace } from "./workspace";
export type { FullStep, Submission, WorkspaceProps } from "./workspace";
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
