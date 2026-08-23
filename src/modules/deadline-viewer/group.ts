import type { Deadline, DeadlineGroups } from "./types";

/** 본 기한·추가 기간·안내를 가릅니다. **합치지 않습니다** → 데이터 모델 §8.1 */
export function groupDeadlines(list: readonly Deadline[]): DeadlineGroups {
  const primary: Deadline[] = [];
  const grace: Deadline[] = [];
  const info: Deadline[] = [];

  for (const d of list) {
    if (d.kind === "grace") grace.push(d);
    else if (d.kind === "info") info.push(d);
    // 모르는 값을 버리지 않습니다 — 기한 목록이 조용히 비면 사용자가 권리를 잃습니다
    else primary.push(d);
  }

  return { primary, grace, info };
}

/**
 * D-day 문자열. **서버가 센 값이 없으면 `null` 입니다.**
 *
 * `due_at` 에서 직접 세지 마세요 — 기준 시계는 서버이고, 사용자 기기의 날짜가
 * 틀리면 기한을 놓칩니다 → spec/common/08-16-deadline-rules.md 「계산의 전제」.
 *
 * **음수는 오지 않습니다** (2026-08-23 확정 · §3.7). 서버는 **아직 안 지난 기한에만**
 * `days_left` 를 싣고, 지난 것은 `status: "missed"` 하나로 말합니다 —
 * 지난 기한의 표시는 「본 기한 8월 20일 · 지남」 배지가 맡습니다 (시안 2b).
 * 그래도 음수가 오면 **그리지 않습니다** — 시안에 「D+3」 이라는 표시가 없어서,
 * 지어내느니 날짜만 보이는 쪽이 낫습니다.
 */
export function ddayLabel(d: Deadline): string | null {
  if (typeof d.days_left !== "number") return null;
  if (d.days_left > 0) return `D-${d.days_left}`;
  if (d.days_left === 0) return "오늘";
  return null;
}

/**
 * 카운트다운으로 그려도 되는가.
 *
 * **`info` 는 안 됩니다.** 환급 타임라인은 통상 3~6개월이라
 * 카운트다운으로 만들면 매일 실망을 줍니다 — 진행 단계 설명으로 보여줍니다.
 */
export function isCountdown(d: Deadline): boolean {
  return d.kind !== "info" && typeof d.days_left === "number";
}
