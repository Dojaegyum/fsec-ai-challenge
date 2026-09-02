"use client";

import { forkFor } from "./send";
import type { EvidenceStatus } from "./types";

/**
 * 상태 점 — **색만으로 가르지 않습니다.** 곁의 글자가 항상 같은 것을 말로 말합니다
 * (§S-08 · [접근성](../../../spec/frontend/design-system/08-16-accessibility.md)).
 *
 * `pulse-dot` 은 `globals.css` 에 등록된 키프레임입니다 — 새로 만들지 마세요.
 * 감속 모드에서 전역 규칙이 멈춰 줍니다.
 */
const DOT: Record<EvidenceStatus, { cls: string; label: string }> = {
  pending: { cls: "border border-icon", label: "대기 중" },
  processing: {
    cls: "bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]",
    label: "개인정보 보호 처리중",
  },
  done: { cls: "bg-pii", label: "전사 완료" },
  // **낱말만 같은 두 실패가 있습니다** — 기본 문구는 실제로 일어나는 쪽입니다.
  // 「제외 — 주민번호를 못 가렸습니다」는 `cause: "masking"` 일 때만 참인데
  // 그 판정은 아직 아무도 안 합니다 (`send.ts` 의 `FailCause`)
  failed: { cls: "bg-deadline-urgent", label: "올리지 못했습니다" },
};

export function StatusDot({ status }: { status: EvidenceStatus }) {
  const dot = DOT[status] ?? DOT.pending;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`size-[7px] shrink-0 rounded-full ${dot.cls}`} />
      <span
        className={`truncate text-[12.5px] ${
          status === "failed" ? "text-deadline-urgent" : "text-ink-3"
        }`}
      >
        {dot.label}
      </span>
    </span>
  );
}

export interface RailFile {
  /** 목록 키. **업로드 전(차단 포함)에도 필요하므로 로컬 id 입니다** */
  id: string;
  /** §3.2 로 자리를 받은 뒤에만 있습니다 — 못 가려서 안 올린 파일에는 없습니다 */
  evidence_id?: string;
  /** `screenName` 을 지난 이름 */
  name: string;
  status: EvidenceStatus;
  /** §3.3 `progress.percent` */
  percent?: number;
}

/**
 * 자료 레일 — **선택 UI 를 겸합니다.** 파일을 누르면 오른쪽 전사 본문이 그 파일로
 * 바뀝니다 (시안 1d 의 두 칸 구조).
 */
export function FileRail({
  files,
  selectedId,
  onSelect,
  onRetry,
  onSkip,
}: {
  files: readonly RailFile[];
  /** 전사 본문이 보여주는 파일 */
  selectedId?: string;
  onSelect?: (id: string) => void;
  onRetry?: (id: string) => void;
  onSkip?: (id: string) => void;
}) {
  return (
    <ul className="mt-1.5 grid gap-1">
      {files.map((f) => {
        const fork = forkFor(f.status);
        const on = f.id === selectedId;
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onSelect?.(f.id)}
              aria-current={on ? "true" : undefined}
              className={`flex w-full items-start gap-2.5 rounded-[10px] border px-2.5 py-2.5 text-left transition-colors duration-200 ${
                on
                  ? "border-[oklch(0.697_0.16_258.2/34%)] bg-[oklch(0.697_0.16_258.2/10%)]"
                  : "border-transparent hover:border-hairline"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span
                  title={f.name}
                  className={`block truncate text-[12.5px] ${
                    on ? "font-[600] text-ink-1" : "text-ink-2"
                  }`}
                >
                  {f.name}
                </span>
                <span className="mt-0.5 block">
                  <StatusDot status={f.status} />
                </span>

                {f.status === "processing" && (
                  <span className="mt-1 block text-[12.5px] leading-[1.6] text-ink-3">
                    {typeof f.percent === "number" && (
                      <span data-numeric>{f.percent}% · </span>
                    )}
                    원본은 아직 이 브라우저 안에 있습니다
                  </span>
                )}
              </span>
            </button>

            {fork && (
              // **막는 것이 아니라 갈림길입니다** — 앰버이고 빨강이 아닙니다
              <div className="mt-1.5 px-2.5">
                <p className="text-[12.5px] leading-[1.6] text-deadline-urgent">
                  {fork.message}
                </p>
                {/* ⚠️ **넘겨받지 않은 갈림길은 그리지 않습니다.** 2026-08-27 까지
                    부르는 쪽이 `onRetry`·`onSkip` 을 안 넘겨서 **눌러도 아무 일이
                    없는 버튼 둘**이 켜져 있었습니다 — 「막지 않고 갈림길을 준다」가
                    갈림길 없이 문구만 남은 상태였습니다 */}
                {(onRetry || onSkip) && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {onRetry && (
                      <button
                        type="button"
                        onClick={() => onRetry(f.id)}
                        className="inline-flex min-h-[var(--size-touch)] items-center rounded-[9px] border border-hairline px-3 text-[12.5px] text-ink-2"
                      >
                        {fork.choices[0]}
                      </button>
                    )}
                    {onSkip && (
                      <button
                        type="button"
                        onClick={() => onSkip(f.id)}
                        className="inline-flex min-h-[var(--size-touch)] items-center rounded-[9px] border border-hairline px-3 text-[12.5px] text-ink-2"
                      >
                        {fork.choices[1]}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
