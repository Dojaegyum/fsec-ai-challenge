/**
 * 사건 파일 카드 렌더 시험 — **아무 말도 안 한 사람에게 「피해 금액 300만원」이
 * 자기 사건 사실로 뜨던 것**을 막습니다.
 *
 * 계약: spec/frontend/08-14-screens.md §S-06 「사건 파일 — 채워지는 것이 보입니다」
 * 근거: CLAUDE.md 불변 규칙 5(「모름」은 실패가 아니다) · ADR-041(확인 전에는 없는 값)
 *
 * ⚠️ **2026-08-27 까지 이 카드가 값까지 박힌 상수였습니다.** 카드 제목이 「진술에서
 * 파악한 것」이고 옆에 진행 중 점까지 맥동해서, 사용자는 그것을 **자기 진술에서 뽑아낸
 * 값**으로 읽었습니다. 서버는 §3.4 `slots[]` 로 실제 값을 보내고 있었고 화면이 버렸습니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaseFileCard } from "./page";
import type { CaseSlot } from "./load";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const slot = (key: string, state: string, value: string | null): CaseSlot => ({
  slot_key: key,
  tier: "T2",
  state,
  value,
});

const draw = (slots: readonly CaseSlot[], asking: string | null = null) =>
  renderToStaticMarkup(<CaseFileCard slots={slots} asking={asking} />);

describe("서버가 준 슬롯만 그린다", () => {
  it("아무것도 안 채워졌으면 값이 하나도 안 뜬다", () => {
    const text = textOf(draw([]));
    // 목업 시절의 값들 — 하나라도 남아 있으면 그 사람 사건의 사실로 읽힙니다
    expect(text).not.toContain("300만원");
    expect(text).not.toContain("기관 사칭");
    expect(text).not.toContain("검찰");
  });

  it("금액은 기재 안내와 같은 얼굴로 다듬는다 — 값은 서버 것 그대로", () => {
    // 2026-09-03 까지 이 시험이 「3000000 생숫자」를 계약으로 박고 있었습니다 (감사 D1)
    expect(textOf(draw([slot("amount", "confirmed", "3000000")]))).toContain("3,000,000원");
  });

  it("문장으로 말한 금액은 해석하지 않고 그대로 그린다", () => {
    expect(textOf(draw([slot("amount", "confirmed", "300만원쯤")]))).toContain("300만원쯤");
  });

  it("빈 칸은 「모름이어도 진행」이라고 말한다 — 실패로 보이면 안 됩니다", () => {
    expect(textOf(draw([]))).toContain("모름이어도 진행");
  });

  it("카드 안에 「모름도 답입니다」가 있다 — §S-06 이 요구합니다", () => {
    expect(textOf(draw([]))).toContain("모름도 답입니다");
  });
});

describe("네 상태를 가른다", () => {
  it("지금 묻는 중인 칸은 그렇게 말한다", () => {
    expect(textOf(draw([], "channel"))).toContain("지금 여쭤보는 중");
  });

  it("「모름」으로 답한 것과 아직 안 물은 것을 가른다", () => {
    // 둘 다 값이 없지만 뜻이 다릅니다 — 뒤엣것은 **답을 받은 것**입니다
    expect(textOf(draw([slot("amount", "unknown", null)]))).toContain("모름으로 넘어감");
  });

  it("확인 전(`pii_pending`)은 채워진 것으로 세지 않는다 — ADR-041", () => {
    const text = textOf(draw([slot("org_name", "pii_pending", "[이름-1]")]));
    expect(text).not.toContain("[이름-1]");
  });

  it("자동 추출된 값도 보여준다", () => {
    expect(textOf(draw([slot("org_name", "extracted", "국민은행")]))).toContain("국민은행");
  });
});

describe("가려진 값은 파랗게 — §S-06 「PII」", () => {
  it("토큰이 붙은 값에는 pii 색이 간다", () => {
    // **서버로 안 갔다는 뜻**입니다. 흐리지 않습니다
    const html = draw([slot("org_name", "confirmed", "[계좌-1]")]);
    expect(html).toContain("text-pii");
  });

  it("보통 값에는 안 간다", () => {
    const html = draw([slot("amount", "confirmed", "3000000")]);
    // 카드 머리의 맥동 점(bg-pii)은 있으므로 글자색만 봅니다
    expect(html).not.toContain("text-pii");
  });
});
