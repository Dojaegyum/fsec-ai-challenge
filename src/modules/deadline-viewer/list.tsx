"use client";

import { ddayLabel, groupDeadlines, isCountdown } from "./group";
import type { Deadline } from "./types";

/** 놓치면 되돌릴 수 없는 것만 앰버입니다. **빨강을 쓰지 않습니다** */
export function DeadlineBadge({ deadline }: { deadline: Deadline }) {
  const label = ddayLabel(deadline);
  // 서버가 세 주지 않았으면 아무것도 그리지 않습니다 — 화면이 대신 세지 않습니다
  if (label === null) return null;

  const urgent = isCountdown(deadline) && deadline.kind === "primary";
  return (
    <span
      data-numeric
      className={`inline-flex min-h-[26px] items-center rounded-[9px] border px-2.5 text-[13px] font-[660] ${
        urgent
          ? "border-[oklch(0.77_0.117_70.9/45%)] text-deadline-urgent"
          : "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3"
      }`}
    >
      {label}
    </span>
  );
}

export function DeadlineList({ deadlines }: { deadlines: readonly Deadline[] }) {
  const { primary, grace, info } = groupDeadlines(deadlines);

  const row = (d: Deadline, extra?: string) => (
    <li key={d.deadline_id} className="flex items-start gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-[1.5] text-ink-1">{d.title}</span>
        {extra && <span className="mt-0.5 block text-[13px] text-ink-3">{extra}</span>}
      </span>
      <DeadlineBadge deadline={d} />
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 지난 기한도 지우지 않습니다 — 유예가 남아 있을 수 있습니다 */}
      {primary.length > 0 && <ul>{primary.map((d) => row(d, d.on_miss))}</ul>}
      {grace.length > 0 && (
        <ul className="border-t border-hairline pt-2">
          {grace.map((d) => row(d, d.condition))}
        </ul>
      )}
      {info.length > 0 && (
        <ul className="border-t border-hairline pt-2 opacity-80">
          {/* `info` 는 사용자가 지킬 기한이 아닙니다 — `note` 가 그렇게 밝힙니다 */}
          {info.map((d) => row(d, d.note))}
        </ul>
      )}
    </div>
  );
}
