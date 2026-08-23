/**
 * deadline-viewer — 기한을 표시한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 시안: assets/artifacts/handoff/08-23-s07-wait-and-badges/ 「deadline-badges」·「wait-card」
 * 근거: ADR-023(층 C) · ADR-028(층 C 는 client-only) · 불변 규칙 7(날짜는 규칙이 센다)
 *
 * 판정은 `group.ts`·`badge.ts`, 렌더는 `badge.tsx`·`wait.tsx` 입니다.
 * **둘을 섞지 마세요.**
 *
 * **기한 목록 화면은 만들지 않습니다** → 시안 2b. 목록을 두면 히어로·단계 행과
 * 어긋날 수 있는 두 번째 정본이 생깁니다.
 */

import "client-only";

export { groupDeadlines, ddayLabel, isCountdown } from "./group";
export { badgeOf, dueLabel } from "./label";
export type { BadgeVariant, DeadlineBadgeText } from "./label";
export { DeadlineBadge, DeadlinePair } from "./badges";
export { WaitCard } from "./wait";
export type { WaitCardProps } from "./wait";
export type { Deadline, DeadlineGroups, DeadlineKind } from "./types";
