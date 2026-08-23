import type { PlanStep } from "./types";

/**
 * 사슬(`body.after`)에 있는 단계에만 번호를 붙인다 → 화면 설계 §S-07.
 *
 * **`step_seq` 를 그대로 보이지 않습니다.** 10·20·25 처럼 띄엄띄엄한 내부 정렬값이라
 * 「25번 다음이 30번」이 됩니다. 사슬 안에서 몇 번째인가로 **다시 셉니다.**
 *
 * **seq 로만 세지도 않습니다** — 「선행인데 seq 가 큰」 데이터에서 번호가 역전됩니다.
 * 선행이 모두 번호를 받은 것 중 seq 가 가장 작은 것부터 셉니다(위상 순서 + seq 동률).
 *
 * **사슬이 하나도 없으면 전부 `null` 입니다** — `after` 가 응답에 실려 오는지가
 * 아직 미결이라(→ 계획 Task 1), 없을 때 **번호를 지어내지 않는 쪽**을 기본으로 둡니다.
 */
export function numberSteps(
  steps: readonly PlanStep[],
): ReadonlyMap<string, number | null> {
  const out = new Map<string, number | null>();

  const referenced = new Set<string>();
  for (const s of steps) for (const key of s.body.after ?? []) referenced.add(key);

  const inChain = steps.filter((s) => {
    const hasAfter = (s.body.after?.length ?? 0) > 0;
    const isReferenced = s.body.step_key != null && referenced.has(s.body.step_key);
    return hasAfter || isReferenced;
  });

  const chainKeys = new Set(
    inChain.flatMap((s) => (s.body.step_key != null ? [s.body.step_key] : [])),
  );
  const numberedKeys = new Set<string>();
  const remaining = [...inChain].sort((a, b) => a.seq - b.seq);
  let n = 0;

  while (remaining.length > 0) {
    const i = remaining.findIndex((s) =>
      // 사슬 밖(플랜에 없는) 선행은 이미 충족된 것으로 봅니다 — 막지 않습니다
      (s.body.after ?? []).every((k) => !chainKeys.has(k) || numberedKeys.has(k)),
    );
    // 순환이면 남은 것 중 seq 가 가장 작은 것부터 — 던지지 않습니다
    const next = remaining.splice(i === -1 ? 0 : i, 1)[0];
    out.set(next.step_id, ++n);
    if (next.body.step_key != null) numberedKeys.add(next.body.step_key);
  }

  for (const s of steps) if (!out.has(s.step_id)) out.set(s.step_id, null);
  return out;
}
