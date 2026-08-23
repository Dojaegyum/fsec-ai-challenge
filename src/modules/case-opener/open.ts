import type { CaseResponse, ScreenState } from "./types";

/**
 * Crockford Base32 — `0-9A-Z` 에서 **`I`·`L`·`O`·`U` 를 뺀** 32글자 → ADR-039 ②.
 *
 * ⚠️ **ULID 와 길이가 같습니다(26자).** 겉으로 구분이 안 되니 코드에서 섞지 마세요 —
 * 다른 점은 길이가 아니라 **시간 정보가 없다**는 것입니다.
 */
const TOKEN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i;

/** 이 값이 링크 토큰처럼 생겼나. **있는 토큰인지는 서버만 압니다** */
export function isCaseToken(value: string): boolean {
  return TOKEN.test(value);
}

/** 아직 남은 일이 있는 상태 → 데이터 모델 §6 */
const OPEN_STATES = new Set(["not_started", "in_progress", "unconfirmed"]);

/**
 * 첫 화면을 고릅니다.
 *
 * **서버가 지목하지 않습니다** — §3.10 이 `focus`·`side` 를 응답에 넣지 않기로 했고,
 * 화면 구조가 바뀔 때마다 서버를 고치게 두지 않으려는 것입니다.
 *
 * ```
 * focus   plan.steps 가 비어 있지 않으면       → 'plan',  그 밖 → 'chat'
 * side    plan.steps 에 지금 할 단계가 있으면  → 'work',  그 밖 → 'casefile'
 * ```
 *
 * **`focus: "evidence"` 로는 열지 않습니다** — 증거함은 눌러서 가는 곳이지
 * 재진입의 도착지가 아닙니다.
 *
 * **두 축은 독립입니다** (ADR-035) — 한 값으로 합치면 순차처럼 읽히고,
 * 「다음 단계로 넘긴다」는 코드가 따라 붙습니다.
 */
export function openCase(response: CaseResponse): ScreenState {
  const steps = response.plan?.steps ?? [];

  return {
    focus: steps.length > 0 ? "plan" : "chat",
    side: steps.some((s) => OPEN_STATES.has(s.state)) ? "work" : "casefile",
  };
}
