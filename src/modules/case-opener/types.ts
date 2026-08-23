/**
 * case-opener — URL 토큰으로 사건을 연다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.10 · spec/frontend/08-14-screens.md §S-05
 * 근거: ADR-021(재진입) · ADR-035(화면 상태 두 축) · ADR-039(링크 토큰)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · 토큰을 외부로 흘리기
 *  · **잃은 링크를 복구해 주는 척하기** (재발급 경로는 없습니다 — ADR-039 ⑥)
 */

/** 본문이 무엇을 보여주나 → ADR-035. `src/app/c/[token]/state.ts` 와 같은 값입니다 */
export type Focus = "chat" | "plan" | "evidence" | "doc";

/** 오른쪽 350px 열 */
export type Side = "casefile" | "work";

export interface ScreenState {
  focus: Focus;
  side: Side;
}

/** §3.10 응답 중 첫 화면을 고르는 데 쓰는 부분만 */
export interface CaseResponse {
  case_id: string;
  track: string;
  plan?: {
    steps?: readonly {
      step_id: string;
      state: string;
    }[];
  };
}
