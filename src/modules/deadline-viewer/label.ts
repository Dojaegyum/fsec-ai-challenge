import { ddayLabel } from "./group";
import type { Deadline } from "./types";

/**
 * `due_at` 을 「8월 20일」로 **표기만 바꿉니다.**
 *
 * **날짜를 세는 것이 아닙니다** — 시계를 읽지 않습니다(`Date.now()` 없음).
 * 서버가 준 시점 하나를 한국 시각으로 **표기**할 뿐이라
 * [기한 규칙](../../../spec/common/08-16-deadline-rules.md) 「화면은 날짜를 세지 않습니다」에
 * 걸리지 않습니다. 기기의 **시간대 설정**도 따르지 않습니다 — `Asia/Seoul` 로 못 박습니다.
 *
 * 읽을 수 없는 값이면 `null` 입니다. 「Invalid Date」를 화면에 내보내지 않습니다.
 */
export function dueLabel(d: Deadline): string | null {
  const at = new Date(d.due_at);
  if (Number.isNaN(at.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "long",
    day: "numeric",
  }).format(at);
}

/** 배지는 셋뿐입니다 → 시안 「deadline-badges」(2b) */
export type BadgeVariant =
  /** 사용자가 지켜야 할 기한. **D-day 는 여기에만 붙습니다** */
  | "user"
  /** 지난 본 기한. **지우지 않고** 중립으로 남깁니다 */
  | "passed"
  /** 제도가 흐르는 시간. 날짜만, D-day 없음 */
  | "system";

export interface DeadlineBadgeText {
  variant: BadgeVariant;
  text: string;
  /**
   * 기산점이 확인 안 된 기한 — **「미확인」을 함께 그립니다** (기한 규칙).
   *
   * **변형을 넷으로 늘리지 않았습니다.** 시안이 셋으로 못 박았고(2b), 추정
   * 여부는 「어떤 종류의 기한인가」와 **다른 축**입니다 — 본 기한도 유예도
   * 추정일 수 있습니다. 색은 종류가 정하고, 확실성은 이 표시가 말합니다.
   */
  estimated: boolean;
}

/**
 * 기한 하나를 배지 한 줄로.
 *
 * **목록 화면을 만들지 않습니다** → 시안 2b 「별도 DeadlineList 화면은 만들지 않습니다」.
 * 목록을 두면 히어로·단계 행과 어긋날 수 있는 **두 번째 정본**이 생깁니다.
 *
 * **본 기한과 유예를 한 배지로 합치지 않습니다** — 부르는 쪽이 둘을 나란히 놓습니다.
 */
export function badgeOf(d: Deadline): DeadlineBadgeText | null {
  const date = dueLabel(d);
  if (date === null) return null;

  const estimated = d.estimated === true;

  // 제도 시간 — 사용자가 지킬 기한이 아닙니다. `days_left` 가 있어도 안 씁니다
  if (d.kind === "info") {
    return { variant: "system", text: `${d.title} ${date}`, estimated };
  }

  if (d.status === "missed") {
    return { variant: "passed", text: `본 기한 ${date} · 지남`, estimated };
  }

  const prefix = d.kind === "grace" ? "유예 " : "";
  const dday = ddayLabel(d);
  return {
    variant: "user",
    text: dday === null ? `${prefix}${date}까지` : `${prefix}${date}까지 · ${dday}`,
    estimated,
  };
}
