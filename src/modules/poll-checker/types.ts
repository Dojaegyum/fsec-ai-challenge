/**
 * poll-checker — `poll_after_ms` 를 보고 다시 묻는다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.3 · spec/backend/08-16-errors.md §2 §3 §3.1.1
 * 이름: spec/common/08-16-module-names.md 층 C 「서버와 이야기하는 자리」
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **스트리밍·웹소켓 쓰기** (ADR-022)
 *  · **예외 종류로 분기하기** — 재시도 여부 하나만 봅니다
 *  · **에러를 자동으로 다시 부르기** — 에러 §3.1 「누르는 것은 사용자가 합니다」
 *  · 스스로 기다리거나 다시 부르기 — 판단만 돌려줍니다
 *  · 간격을 여기서 지어내기 — 서버가 지시한 값만 씁니다
 */

export interface PollInput {
  /** HTTP 상태. `200` 이면 정상 진행입니다 */
  status: number;

  /** 처리가 끝났나 — §3.3 `ingest_status === "done"` */
  done: boolean;

  /**
   * 서버가 지시한 다음 호출 간격 — §3.3 `poll_after_ms`.
   *
   * **없으면 다시 묻지 않습니다.** 화면이 간격을 지어내면 서버의 부하 조절이 무의미해집니다.
   */
  pollAfterMs?: number;

  /**
   * 에러 본문의 `retryable` — 에러 §3.1.1 (2026-08-23 확정).
   *
   * **§2 재시도 표의 값이 아닙니다.** 그쪽은 「서버가 자기 안에서 다시 시도할까」이고
   * 이 칸은 「사용자가 같은 요청을 다시 보내면 달라질까」입니다 — 응답이 여기 닿았을 때
   * 서버의 재시도는 이미 끝났습니다.
   *
   * **`true` 여도 자동으로 다시 부르지 않습니다** — 「다시 시도」 버튼을
   * 보여줄지에만 씁니다 (에러 §3.1).
   */
  retryable?: boolean;

  /**
   * `Retry-After` 헤더(초).
   *
   * 화면이 「N초 뒤 다시 시도할 수 있습니다」를 띄우는 데 씁니다 → 에러 §3.1.
   */
  retryAfterSec?: number;
}

/** 왜 멈추는가 */
export type StopReason =
  /** 처리가 끝났습니다 — 정상 종료 */
  | "done"
  /** 서버가 다음 간격을 지시하지 않았습니다 */
  | "no_interval"
  /** 에러 응답입니다. **자동으로 다시 부르지 않습니다** → 에러 §3.1 */
  | "error";

export type PollVerdict =
  | { readonly poll: true; readonly delayMs: number }
  | {
      readonly poll: false;
      readonly reason: StopReason;
      /**
       * 「다시 시도」 버튼을 띄울지. **`true` 일 때만 띄웁니다** → 에러 §3.1.1.
       * **누르는 것은 사용자입니다** — 이 값이 재호출을 뜻하지 않습니다.
       */
      readonly retryable?: boolean;
      /** 화면이 「N초 뒤 다시 시도할 수 있습니다」를 그릴 때 씁니다 */
      readonly retryAfterSec?: number;
    };
