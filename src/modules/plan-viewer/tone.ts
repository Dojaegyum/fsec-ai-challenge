import type { PlanStep, StepTone } from "./types";

/**
 * 상태를 화면 어휘로 옮긴다.
 *
 * **`hasOwnDeadline` 을 받는 이유** — 「언제든(◇)」은 상태가 아니라
 * **기한이 없다는 사실**입니다. 기한 목록을 아는 쪽이 넣어 줍니다.
 * 이 모듈이 기한을 직접 조회하면 `deadline-viewer` 와 주인이 겹칩니다.
 */
export function toneOf(step: PlanStep, hasOwnDeadline: boolean): StepTone {
  switch (step.state) {
    case "done_verified":
      return "done";
    case "in_progress":
      return "now";
    case "skipped":
      return "na";
    // ⬜ `unconfirmed` 의 어휘는 미결입니다 → 계획 Task 1 · 화면 설계 §S-07
    case "unconfirmed":
      return "todo";
    case "not_started":
      return hasOwnDeadline ? "todo" : "anytime";
    default:
      // 모르는 값에 던지지 않습니다 — 새 상태가 생겨도 보드가 비지 않아야 합니다
      return "todo";
  }
}

/**
 * 색 하나로 가르지 않습니다 — 기호·태그·색 셋이 함께 갑니다 (§S-07).
 *
 * **태그는 화면 어휘(tone) 기준입니다** — 「언제든」은 상태가 아니라 어휘의 태그입니다.
 * `unconfirmed` 만 상태로 가립니다 → 계획 Task 1 미결.
 * `now` 의 태그는 어휘 표에서 D-day 입니다 — 서버가 준 기한 문자열(`deadlineLabel`)이
 * 그 자리를 대신하고, 없으면 비웁니다. **화면이 날짜를 만들지 않습니다.**
 */
export function tagOf(step: PlanStep, tone: StepTone): string {
  if (step.state === "unconfirmed") return "미확인";
  switch (tone) {
    case "done":
      return "증빙됨";
    case "now":
      return "";
    case "anytime":
      return "언제든";
    case "na":
      return "해당 없음";
    default:
      return "미시작";
  }
}
