"use client";

import { useEffect, useState } from "react";

/**
 * 발급 직후 링크를 넘기는 자리 — 화면 설계 §S-05 「발급」.
 *
 * **재발급 경로가 없습니다** (ADR-039 ⑥). 그래서 이 순간에 확실히 넘겨야 하고,
 * **잃었을 때 복구해 주는 척하면 안 됩니다** — 그건 토큰이 곧 인증이라는 전제를 깹니다.
 *
 * 마크업은 `src/app/start/page.tsx` 의 **시안 1a 확정본을 옮긴 것**입니다.
 * 고치려면 캔버스에서 고쳐 새 핸드오프를 받으세요 (RFC-003 · ADR-030).
 *
 * **「나에게 문자로」(`sms:`) 는 넣지 않았습니다** — 시안에 없습니다.
 * 더할지는 사람이 정합니다 (구현 계획 Task 5).
 */
export function LinkHandoff({
  url,
  onCopied,
}: {
  /** 복사되는 주소 전체. 화면에는 `https://` 를 뗀 모양으로 보입니다 */
  url: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
    } catch {
      // 클립보드가 막혀 있어도 실패가 아닙니다 — 아래 주소가 그대로 보입니다
      setCopied(false);
    }
  };

  return (
    <div
      className="rounded-[14px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg p-[16px_18px]
                 shadow-[0_0_50px_-14px_oklch(0.811_0.14_66.9/40%)]"
    >
      <div className="text-[13px] text-pii">내 사건 주소</div>
      <div className="mt-2 flex items-center gap-3">
        {/* 줄바꿈해서라도 **전부 보입니다** — 복사가 막혀도 손으로 옮길 수 있게 (§S-05).
            가로 스크롤로 두면 숨은 부분을 옮겨 적다 잃습니다 */}
        <span data-numeric className="flex-1 break-all font-mono text-[19px] text-ink-1">
          {url.replace(/^https?:\/\//, "")}
        </span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-[var(--size-touch)] shrink-0 items-center rounded-[10px] bg-ink-1 px-[18px] text-[14px] font-[660] text-ground transition-transform duration-200 hover:-translate-y-px"
        >
          {copied ? "복사됨 ✓" : "주소 복사"}
        </button>
      </div>
    </div>
  );
}
