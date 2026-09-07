"use client";
import type { EntriesBody, QueueBody } from "@/flows/kb-review";
import type { Action, Filter, Lens, ReviewState } from "./state";

const ROW =
  "flex w-full items-center gap-2.5 rounded-[11px] border px-[11px] py-[9px] text-left transition-colors duration-200 shadow-[0_1px_0_oklch(1_0_0/7%)_inset,0_8px_20px_-10px_oklch(0_0_0/65%)]";
const ON = "border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/9%)]";
const OFF = "border-hairline bg-surface hover:border-[oklch(1_0_0/22%)]";
const BADGE =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-chip px-[9px] py-px text-[12.5px] text-ink-3";

const FILTERS: readonly [Filter, string][] = [
  ["all", "전체"],
  ["first", "최초 수집"],
  ["changed", "변경"],
  ["deferred", "미룸"],
  ["page", "기관 페이지"],
];

type Change = QueueBody["groups"][number]["changes"][number];

/**
 * 「전체」는 큐(pending)입니다 — 미룬 것은 큐가 아니라서(ADR-044) 「미룸」 칩에서만 보입니다.
 * 기관 페이지는 상태와 무관하게 수집원으로 가릅니다.
 */
function keep(filter: Filter, one: Change): boolean {
  if (filter === "deferred") return one.review_status === "deferred";
  if (filter === "page") return one.source_key.startsWith("page:");
  if (one.review_status !== "pending") return false;
  if (filter === "first") return one.first_seen;
  if (filter === "changed") return !one.first_seen;
  return true;
}

function badgeOf(one: Change): { label: string; strong: boolean } {
  if (one.review_status === "deferred") return { label: "미룸", strong: false };
  if (one.affected.length === 0 && one.first_seen) return { label: "새 조문", strong: true };
  return { label: one.first_seen ? "최초 수집" : "변경", strong: false };
}

/** `2026-09-06T04:00:12+09:00` → `09-06 04:00` — 목록 한 줄에 맞는 만큼만 */
const shortTime = (iso: string) => iso.slice(5, 16).replace("T", " ");

export function QueueList({
  state,
  queue,
  deferred,
  entries,
  dispatch,
}: {
  state: ReviewState;
  /** 큐 — pending 만 (kb-reviewer.queue()) */
  queue: QueueBody;
  /** 미룬 것 — 큐 밖이라 따로 받습니다 (`?status=deferred`) */
  deferred: QueueBody;
  entries: EntriesBody;
  dispatch(a: Action): void;
}) {
  const pending = queue.groups.flatMap((g) => g.changes);
  const everything = [...pending, ...deferred.groups.flatMap((g) => g.changes)];
  const groups = [...queue.groups, ...deferred.groups];
  const touched = entries.entries.filter((e) => e.pending_changes.length > 0);
  const quiet = entries.entries.filter((e) => e.pending_changes.length === 0);
  const shown = everything.filter((one) => keep(state.filter, one)).length;
  const lens = (id: Lens, label: string, count: number) => (
    <button
      type="button"
      onClick={() => dispatch({ type: "set-lens", lens: id })}
      aria-current={state.lens === id ? "page" : undefined}
      className={`inline-flex min-h-[var(--size-touch)] items-center gap-1.5 rounded-full px-3 text-[13px] ${
        state.lens === id ? "bg-[oklch(1_0_0/12%)] font-[620] text-ink-1" : "text-ink-3 hover:text-ink-1"
      }`}
    >
      {label}{" "}
      <span data-numeric className="text-ink-4">
        {count}
      </span>
    </button>
  );
  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <nav
        aria-label="렌즈"
        className="inline-flex items-center gap-0.5 self-start rounded-full border border-hairline bg-chip p-0.5"
      >
        {lens("article", "조문 기준", pending.length)}
        {lens("entry", "매뉴얼 기준", touched.length)}
      </nav>
      {state.lens === "article" ? (
        <>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => dispatch({ type: "set-filter", filter: id })}
                className={`inline-flex min-h-[var(--size-touch)] items-center gap-1.5 rounded-full border px-[11px] text-[12.5px] ${
                  state.filter === id ? "border-[oklch(1_0_0/25%)] font-[620] text-ink-1" : "border-hairline text-ink-3"
                } bg-chip`}
              >
                {label} <span data-numeric>{everything.filter((one) => keep(id, one)).length}</span>
              </button>
            ))}
          </div>
          {groups.map((group, gi) => (
            <div key={group.dedupe_key ?? `alone-${gi}`} className="flex flex-col gap-2">
              {group.changes
                .filter((one) => keep(state.filter, one))
                .map((one) => {
                  const on =
                    state.selected !== null && "changeId" in state.selected && state.selected.changeId === one.change_id;
                  const badge = badgeOf(one);
                  return (
                    <button
                      key={one.change_id}
                      type="button"
                      onClick={() => dispatch({ type: "pick-change", changeId: one.change_id })}
                      aria-current={on ? "true" : undefined}
                      className={`${ROW} ${on ? ON : OFF}`}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-[13.5px] font-[620] text-ink-1">
                          {one.article ?? one.source_key}
                          {one.title ? ` (${one.title})` : ""}
                        </span>
                        <span data-numeric className="text-[12.5px] text-ink-3">
                          {one.source.label} · 감지 {shortTime(one.detected_at)} · 닿는 항목{" "}
                          {one.affected.length === 0 ? "없음" : one.affected.length}
                        </span>
                      </span>
                      <span className={badge.strong ? `${BADGE} font-[620] text-ink-1` : BADGE}>{badge.label}</span>
                    </button>
                  );
                })}
            </div>
          ))}
          {shown === 0 && (
            <p className="px-0.5 text-[13.5px] leading-[1.65] text-ink-3">이 조건에 해당하는 변경이 없습니다.</p>
          )}
        </>
      ) : (
        <>
          <p className="px-0.5 text-[13.5px] leading-[1.65] text-ink-3">
            근거 조문에 미검수 변경이 닿은 항목만 위로 올라옵니다.
          </p>
          {touched.map((entry) => {
            const on =
              state.selected !== null && "kbEntryId" in state.selected && state.selected.kbEntryId === entry.kb_entry_id;
            return (
              <button
                key={entry.kb_entry_id}
                type="button"
                onClick={() => dispatch({ type: "pick-entry", kbEntryId: entry.kb_entry_id })}
                aria-current={on ? "true" : undefined}
                className={`${ROW} ${on ? ON : OFF}`}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-[13.5px] font-[620] text-ink-1">{entry.title}</span>
                  <span data-numeric className="text-[12.5px] text-ink-3">
                    {entry.file} · 확인일 {entry.verified_at}
                  </span>
                </span>
                <span
                  data-numeric
                  className="inline-flex h-[26px] min-w-[26px] items-center justify-center rounded-full border border-[oklch(0.697_0.16_258.2/36%)] bg-[oklch(0.697_0.16_258.2/14%)] px-1.5 text-[12.5px] font-[620] text-pii"
                >
                  {entry.pending_changes.length}
                </span>
              </button>
            );
          })}
          <span className="pt-1 text-[12.5px] font-[620] tracking-[0.13em] text-ink-4">조용한 항목 · {quiet.length}</span>
        </>
      )}
    </section>
  );
}
