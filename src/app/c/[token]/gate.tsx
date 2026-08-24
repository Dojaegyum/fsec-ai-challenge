"use client";

/**
 * 첫 로드의 두 얼굴 — 기다리는 중과 못 읽었을 때.
 *
 * 계약: spec/backend/08-16-errors.md §3.1 §3.1.1 · spec/frontend/08-14-screens.md
 * 근거: ADR-022(스트리밍을 쓰지 않는 대신 **무엇을 하는지 문장으로**)
 *
 * 지켜야 할 것
 *  · **빨강을 쓰지 않습니다.** 실패도 앰버까지입니다 — 패닉을 더 밀지 않습니다
 *  · **스켈레톤·점 3개를 쓰지 않습니다.** 챗의 대기 표시와 같은 규칙으로,
 *    무엇을 기다리는지 문장으로 말합니다
 *  · **자동으로 다시 부르지 않습니다.** 버튼은 서버가 `retryable: true` 라고
 *    말했을 때만 뜨고, **누르는 것은 사용자입니다** (에러 §3.1)
 */

import type { LoadFail } from "./load";

export function CaseLoading() {
  return (
    <main className="grid min-h-svh place-items-center px-[clamp(16px,3vw,32px)]">
      <div className="w-full max-w-[420px] rounded-[15px] border border-hairline bg-surface p-[18px_20px]">
        <div className="flex items-center gap-2 text-[14.5px] text-ink-2">
          사건을 불러오고 있습니다
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
          />
        </div>
        <p className="mt-2 text-[13px] leading-[1.6] text-ink-3">
          지난번까지의 진행과 남은 기한을 함께 가져옵니다. 한 번에 읽어서 화면이 반쯤
          그려지지 않게 합니다.
        </p>
      </div>
    </main>
  );
}

export function CaseFailed({ fail, onRetry }: { fail: LoadFail; onRetry: () => void }) {
  return (
    <main className="grid min-h-svh place-items-center px-[clamp(16px,3vw,32px)]">
      <div
        role="alert"
        className="w-full max-w-[420px] rounded-[15px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[18px_20px]"
      >
        <p className="text-[14.5px] leading-[1.6] text-ink-1">{fail.message}</p>

        {/* 「몇 초 뒤」는 서버가 `Retry-After` 로 말한 값입니다 — 화면이 세지 않습니다 */}
        {fail.retryAfterSec !== undefined && (
          <p data-numeric className="mt-2 text-[13px] text-deadline-urgent">
            {fail.retryAfterSec}초 뒤 다시 시도할 수 있습니다
          </p>
        )}

        {/* **`retryable: true` 일 때만** 띄웁니다 → 에러 §3.1.1 */}
        {fail.retryable === true && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-3.5 inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-5 text-[14px] font-[660] text-ground"
          >
            다시 시도
          </button>
        )}

        {/* 링크를 잃은 사람에게 **복구해 주는 척하지 않습니다** → ADR-039 ⑥ */}
        <p className="mt-3 border-t border-[oklch(0.77_0.117_70.9/25%)] pt-2.5 text-[12.5px] leading-[1.6] text-ink-3">
          받으신 링크 주소가 맞는지 확인해 주세요. 링크가 사건의 유일한 열쇠라
          <b className="font-[620] text-ink-2"> 다시 발급해 드릴 수 없습니다.</b>
        </p>
      </div>
    </main>
  );
}
