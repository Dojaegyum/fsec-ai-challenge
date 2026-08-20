/**
 * `/c/{token}` 화면 상태 — **독립된 두 축**입니다 (ADR-035).
 *
 * 계약: spec/frontend/08-14-screens.md 「화면 상태는 두 축입니다」
 *
 * ⚠️ **한 줄로 늘어놓는 단계가 아닙니다.** 「다음」이 없습니다 —
 * 며칠 뒤 링크를 열면 챗을 거치지 않고 곧장 `focus: "plan"` 으로 시작합니다.
 * 두 축을 하나로 합치는 순간(`"chat_panel"` 같은 값) 순차처럼 읽히고,
 * 그러면 「다음 단계로 넘긴다」는 코드가 따라 붙습니다.
 *
 * 「국면」이라는 말은 여기 쓰지 마세요. 그건 사건의 일생(0~5)이고
 * 정의는 spec/common/08-17-service-concept.md 「여정 — 여섯 국면」에 있습니다.
 */

/** 본문이 무엇을 보여주나 — 화면 ID 로는 S-06 · S-07 · S-08 · S-10 */
export type Focus = "chat" | "plan" | "evidence" | "doc";

/** 오른쪽 350px 열이 무엇을 보여주나 */
export type Side = "casefile" | "work";

export type ScreenState = { focus: Focus; side: Side };

/**
 * 핸드오프 번들의 옛 `phase` 값 ↔ 두 축.
 *
 * 번들은 받은 그대로 두는 스냅샷이라 고치지 않았습니다 (RFC-003).
 * 시안·모션 문서를 읽을 때 이 표로 옮겨 읽으세요.
 *
 * 모션은 **바뀐 축**을 따릅니다 — 전환 ①은 `side` 만, ②·④는 `focus` 만 바뀝니다.
 */
export const FROM_HANDOFF_PHASE = {
  chat: { focus: "chat", side: "casefile" },
  chat_panel: { focus: "chat", side: "work" },
  board: { focus: "plan", side: "work" },
  evidence: { focus: "evidence", side: "work" },
} as const satisfies Record<string, ScreenState>;
