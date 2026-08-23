import type { PollInput, PollVerdict } from "./types";

/**
 * 다음에 다시 물을지, 언제 물을지 판단합니다. **기다리거나 다시 부르지 않습니다** —
 * 판단만 돌려주고 실제 대기와 재호출은 부른 쪽이 합니다 (`retry-checker` 와 같은 모양).
 *
 * **정상 진행(200)과 에러를 다르게 다룹니다.**
 *
 *  · 정상 진행 — 서버의 `poll_after_ms` 를 그대로 씁니다. **예산을 걸지 않습니다.**
 *    전사는 몇 분이 걸릴 수 있고, 부하 조절은 서버가 그 값으로 합니다 (§3.3).
 *
 *  · 에러 — **자동으로 다시 부르지 않습니다.** 에러 §3.1 이 「클라이언트는 자동으로
 *    다시 부르지 않습니다 … 누르는 것은 사용자가 합니다」라고 정했습니다.
 *    이 응답은 **서버가 이미 §2.1 의 예산 안에서 재시도한 뒤**에 나온 것이라,
 *    여기서 또 때리면 아픈 서버에 요청이 배로 늡니다.
 *
 * **§2.1 의 예산(20초·120초)을 여기 가져오지 않습니다** — 그건 서버리스 함수 **안**의
 * 재시도에 건 것입니다.
 *
 * **에러일 때 넘기는 둘은 화면이 버튼을 그리는 재료입니다** (에러 §3.1.1):
 * `retryable` 이 「띄울지」, `retryAfterSec` 이 「몇 초 뒤라고 적을지」입니다.
 * **둘 다 재호출을 뜻하지 않습니다.**
 */
export function decidePoll(input: PollInput): PollVerdict {
  if (input.done) return { poll: false, reason: "done" };

  // ── 정상 진행 ────────────────────────────────────────────
  if (input.status >= 200 && input.status < 300) {
    if (typeof input.pollAfterMs !== "number") {
      // 간격을 지어내지 않습니다 — 서버의 부하 조절이 무의미해집니다
      return { poll: false, reason: "no_interval" };
    }
    return { poll: true, delayMs: input.pollAfterMs };
  }

  // ── 에러 ────────────────────────────────────────────────
  // 예외 종류를 분기하지 않고, 자동으로 다시 부르지도 않습니다 → 에러 §2 · §3.1
  return {
    poll: false,
    reason: "error",
    ...(typeof input.retryable === "boolean" ? { retryable: input.retryable } : {}),
    ...(typeof input.retryAfterSec === "number"
      ? { retryAfterSec: input.retryAfterSec }
      : {}),
  };
}
