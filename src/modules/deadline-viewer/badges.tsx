"use client";

import { badgeOf } from "./label";
import type { BadgeVariant } from "./label";
import type { Deadline } from "./types";

/** 시안 「deadline-badges」(2b) — 세 변형뿐입니다. **빨강을 쓰지 않습니다** */
const PILL: Record<BadgeVariant, string> = {
  // 사용자 기한 — 놓치면 되돌릴 수 없는 것만 앰버입니다
  user: "border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/10%)] font-[620] text-deadline-urgent",
  // 지난 본 기한 — 지우지 않고 중립으로 남깁니다
  passed: "border-hairline bg-chip text-ink-3",
  // 제도가 흐르는 시간 — 두 달을 급한 일로 보이게 하지 않습니다
  system: "border-hairline bg-chip text-ink-3",
};

/**
 * 기한 배지 하나.
 *
 * **날짜를 못 읽으면 아무것도 그리지 않습니다** — 「Invalid Date」를 내보내지 않습니다.
 * `days_left` 가 없으면 D-day 없이 날짜만 나갑니다 (화면이 세지 않습니다).
 */
export function DeadlineBadge({ deadline }: { deadline: Deadline }) {
  const badge = badgeOf(deadline);
  if (badge === null) return null;

  return (
    <span
      data-numeric
      className={`inline-flex items-center gap-[7px] rounded-full border px-[11px] py-1 text-[13px] ${PILL[badge.variant]}`}
    >
      {badge.text}
    </span>
  );
}

/**
 * 본 기한과 유예를 **나란히** 놓습니다.
 *
 * **합치지 않습니다** — 「8월 20일(9월 3일까지 유예)」처럼 한 줄로 만들면
 * 사용자가 유예를 본 기한으로 읽습니다 → 데이터 모델 §8.1 · 시안 2b.
 */
export function DeadlinePair({
  primary,
  grace,
}: {
  primary: Deadline;
  grace?: Deadline | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <DeadlineBadge deadline={primary} />
      {grace && <DeadlineBadge deadline={grace} />}
    </span>
  );
}
