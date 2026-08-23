/**
 * plan-viewer — 타임라인·단계·상태 배지를 그린다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-035(화면 상태 두 축) · ADR-028(층 C 는 client-only)
 *
 * 판정은 `tone.ts`·`order.ts`, 렌더는 `board.tsx` 입니다. **둘을 섞지 마세요.**
 */

import "client-only";

export { toneOf, tagOf } from "./tone";
export { numberSteps } from "./order";
export { PlanBoard, StepRow } from "./board";
export type { PlanBoardProps, StepRowProps } from "./board";
export type { PlanStep, StepState, StepTone } from "./types";
