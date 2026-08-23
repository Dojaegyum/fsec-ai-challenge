"use client";

import type { CSSProperties } from "react";

import type { RestorableMapping } from "@/modules/pii-restorer";
import { countTokens, readTranscript } from "./read";
import type { PiiToken, RawLine } from "./types";

/**
 * `start_ms` → 「00:12」.
 *
 * **기한 계산이 아닙니다** — 녹음 안의 경과 밀리초를 표기만 바꾸는 것이라
 * 「화면이 날짜를 세지 않는다」(불변 규칙 7)에 걸리지 않습니다. 시계를 안 봅니다.
 */
function atLabel(startMs: number): string {
  const total = Math.max(0, Math.floor(startMs / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export interface TranscriptViewProps {
  lines: readonly RawLine[];
  mappings: readonly RestorableMapping[];
  /**
   * §3.3 `pii_tokens[]` — 개수 한 줄을 **본문 위에** 그립니다.
   *
   * 시안은 이 줄을 헤더 막대에 두므로, 그 자리를 쓰는 화면은 넘기지 말고
   * `countTokens` 를 직접 불러 헤더에 적으세요. 두 곳에 나오면 중복입니다.
   */
  tokens?: readonly PiiToken[];
  /** 줄마다 다른 인라인 스타일 — 시안의 계단 등장에 씁니다 */
  lineStyle?: (index: number) => CSSProperties | undefined;
}

export function TranscriptView({
  lines,
  mappings,
  tokens = [],
  lineStyle,
}: TranscriptViewProps) {
  const read = readTranscript(lines, mappings);
  const counts = countTokens(tokens);
  const stuck = read.some((l) => l.unresolved.length > 0);

  return (
    <div className="flex flex-col gap-4">
      {counts.length > 0 && (
        <p className="text-[12.5px] leading-[1.6] text-ink-3">
          서버로는 {counts.map((c) => `${c.kind} ${c.count}`).join(" · ")}을 가려서
          보냈습니다.
        </p>
      )}

      {stuck && (
        // **고장이 아닙니다** — 다른 기기라 매핑이 없는 것입니다 (S-11 과 같은 어휘).
        // 앰버입니다. 빨강을 쓰지 않습니다
        <p className="rounded-[10px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2 text-[12.5px] leading-[1.6] text-deadline-urgent">
          이 기기에는 열쇠가 없어 일부를 원래대로 보여드리지 못했습니다. 처음 시작하신
          기기에서 열면 그대로 보입니다.
        </p>
      )}

      <ol className="flex flex-col gap-4">
        {read.map((line, i) => (
          <li
            key={`${line.speaker}-${line.start_ms}`}
            style={lineStyle?.(i)}
            className="rise grid grid-cols-[42px_1fr] gap-3"
          >
            <span data-numeric className="mt-0.5 font-mono text-[12.5px] text-ink-3">
              {atLabel(line.start_ms)}
            </span>
            <div className="min-w-0">
              {/* ⬜ 화자는 §3.3 의 `speaker`(「A」·「B」) 그대로입니다 —
                  누가 「나」인지 밝히는 칸이 계약에 없습니다 → 계획 「덮지 않는 것」 */}
              <p className="mb-1 text-[12.5px] text-ink-3">{line.speaker}</p>
              <p className="text-[14px] leading-[1.7] text-ink-2">{line.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
