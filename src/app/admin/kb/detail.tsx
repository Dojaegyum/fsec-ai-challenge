"use client";
import { useState } from "react";
import type { ChangeBody, ChangeView, DecisionStatus, EntryView } from "@/flows/kb-review";

const EYEBROW = "text-[12.5px] font-[620] tracking-[0.13em] text-ink-4";
const TAG =
  "inline-flex rounded-[6px] border border-[oklch(0.697_0.16_258.2/36%)] bg-pii-bg px-2 py-px font-mono text-[12.5px] text-pii";
const BTN =
  "inline-flex min-h-[var(--size-touch)] items-center justify-center gap-2 rounded-[11px] border border-hairline bg-chip px-4 text-[13px] font-[560] text-ink-2 disabled:opacity-40";
const ROW =
  "flex w-full items-center gap-2.5 rounded-[11px] border border-hairline bg-surface px-[11px] py-[9px] text-left hover:border-[oklch(1_0_0/22%)]";
const PILL =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-hairline bg-chip px-[9px] py-px text-[12.5px] text-ink-3";
const ALERT =
  "rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2.5 text-[13px] text-ink-1";

/** `2026-09-06T04:00:12+09:00` → `2026-09-06 04:00` */
const dayTime = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function ChangeDetail({
  change,
  loading,
  onPickEntry,
  onDecide,
  busy,
  message,
  nextTitle,
}: {
  change: ChangeBody | null;
  loading: boolean;
  onPickEntry(id: string): void;
  onDecide(status: DecisionStatus, note: string): void;
  busy: boolean;
  message: string | null;
  nextTitle: string | null;
}) {
  const [note, setNote] = useState("");
  if (loading) return <p className="text-[13px] text-ink-3">원문을 불러오고 있습니다</p>;
  if (!change) {
    return (
      <p className="text-[13.5px] leading-[1.65] text-ink-3">왼쪽에서 조문을 고르세요. 판단은 조문 단위입니다.</p>
    );
  }
  const c = change.change;
  const decided = change.review.status === "approved" || change.review.status === "rejected";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3">
          <span className={`${EYEBROW} text-pii`}>
            {c.source.label} · {c.article ?? c.source_key}
          </span>
          <span className={PILL}>{c.first_seen ? "최초 수집 · 기준선" : "변경"}</span>
        </div>
        <h1 className="text-[20px] font-[640] leading-[1.6] text-ink-1">{c.title ?? c.article ?? c.source_key}</h1>
        <p data-numeric className="text-[13.5px] leading-[1.65] text-ink-3">
          시행 {String(c.meta["시행일자"] ?? "?")} · 감지 {dayTime(c.detected_at)} ·{" "}
          <span className={TAG}>{c.source_key}</span>
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <span className={EYEBROW}>무엇이 바뀌었나</span>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-[11px] border border-dashed border-hairline px-3 py-2.5 text-[13px] leading-[1.65] text-ink-3">
            <span className="block text-[12.5px] font-[620] text-ink-4">직전</span>
            {change.before ? (
              <pre className="whitespace-pre-wrap font-sans">{change.before.content}</pre>
            ) : (
              "직전 원문이 없습니다. 첫 수집이라 이 조문이 기준선이 됩니다."
            )}
          </div>
          <div className="rounded-[13px] border border-hairline bg-surface px-[15px] py-[13px] text-[13.5px] leading-[1.65] text-ink-2">
            <span className="block text-[12.5px] font-[620] text-ink-4">이번</span>
            <pre className="whitespace-pre-wrap font-sans">{change.after?.content ?? "(원문 없음)"}</pre>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className={EYEBROW}>닿는 매뉴얼(추정) · {change.affected.length}</span>
          <span className="text-[12.5px] text-ink-3">행을 누르면 매뉴얼 기준으로 넘어갑니다</span>
        </div>
        {change.affected.length === 0 ? (
          <p className="text-[13.5px] leading-[1.65] text-ink-3">
            닿는 항목 없음 — 새 조문입니다. 어느 항목에 붙일지는 사람이 정합니다.
          </p>
        ) : (
          change.affected.map((entry) => (
            <button key={entry.kb_entry_id} type="button" onClick={() => onPickEntry(entry.kb_entry_id)} className={ROW}>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[13.5px] font-[620] text-ink-1">{entry.title}</span>
                <span className="text-[12.5px] text-ink-3">
                  <span className={TAG}>{entry.kb_entry_id}</span> · {entry.file} · 확인일 {entry.verified_at}
                </span>
              </span>
              <span className={PILL}>매뉴얼 기준으로 →</span>
            </button>
          ))
        )}
      </div>

      <div className="flex flex-col gap-2.5 border-t border-hairline pt-4">
        {decided ? (
          <p className="text-[13.5px] leading-[1.65] text-ink-3">
            이미 판단이 끝난 변경입니다 — {change.review.status === "approved" ? "승인" : "거절"} · {change.review.by} ·{" "}
            {change.review.at?.slice(0, 10)}
            {change.review.note ? ` · 「${change.review.note}」` : ""}
          </p>
        ) : (
          <>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="메모 예시: 시행일 미정, 10월 재확인"
              aria-label="검수 메모"
              className="min-h-[var(--size-touch)] rounded-[11px] border border-hairline bg-surface-low px-[14px] text-[13.5px] text-ink-1 placeholder:text-ink-4"
            />
            {message && (
              <p role="alert" className={ALERT}>
                {message}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onDecide("approved", note)}
                className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-full bg-ink-1 px-[18px] text-[13.5px] font-[620] text-ground disabled:opacity-40"
              >
                승인
              </button>
              <button type="button" disabled={busy} onClick={() => onDecide("rejected", note)} className={BTN}>
                거절
              </button>
              <button type="button" disabled={busy} onClick={() => onDecide("deferred", note)} className={BTN}>
                미룸
              </button>
              {nextTitle && (
                <span data-numeric className="ml-auto text-[13.5px] text-ink-3">
                  다음 · {nextTitle} →
                </span>
              )}
            </div>
            <p className="text-[13.5px] leading-[1.65] text-ink-3">
              승인해도 매뉴얼에 자동 반영되지 않습니다. 반영은 <span className={TAG}>src/kb/*.json</span> 을 고쳐
              릴리스할 때입니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function EntryDetail({
  entry,
  changes,
  onPickChange,
}: {
  entry: EntryView;
  changes: readonly ChangeView[];
  onPickChange(id: string): void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className={`${EYEBROW} text-pii`}>
          {entry.file} · {entry.kb_entry_id}
        </span>
        <h1 className="text-[20px] font-[640] leading-[1.6] text-ink-1">{entry.title}</h1>
        <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-ink-4">근거</dt>
          <dd className="text-ink-2">{entry.legal_basis}</dd>
          <dt className="text-ink-4">시행일</dt>
          <dd data-numeric className="text-ink-2">
            {entry.effective_from} · 확인일 {entry.verified_at}
          </dd>
        </dl>
      </div>
      <div className="flex flex-col gap-2">
        <span className={EYEBROW}>이 항목에 닿은 변경 · {changes.length}</span>
        {changes.length === 0 && (
          <p className="text-[13.5px] leading-[1.65] text-ink-3">닿은 미검수 변경이 없습니다.</p>
        )}
        {changes.map((one) => (
          <button key={one.change_id} type="button" onClick={() => onPickChange(one.change_id)} className={ROW}>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-[13.5px] font-[620] text-ink-1">
                {one.source.label} · {one.article ?? one.source_key}
              </span>
              <span data-numeric className="text-[12.5px] text-ink-3">
                {one.first_seen ? "최초 수집 · 기준선" : "변경"} · 감지 {one.detected_at.slice(0, 10)}
              </span>
            </span>
            <span className={PILL}>조문 기준으로 →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
