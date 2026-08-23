/**
 * deadline-viewer — 기한을 표시한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-028(층 C 는 client-only) · 불변 규칙 7(날짜는 규칙이 센다)
 *
 * 판정은 `group.ts`, 렌더는 `list.tsx` 입니다. **둘을 섞지 마세요.**
 */

import "client-only";

export { groupDeadlines, ddayLabel, isCountdown } from "./group";
export { DeadlineList, DeadlineBadge } from "./list";
export type { Deadline, DeadlineGroups, DeadlineKind } from "./types";
