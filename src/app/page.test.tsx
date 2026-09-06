/**
 * 랜딩 렌더 시험 — **행동은 [지금 시작하기] 하나**라는 계약을 지키는지 봅니다.
 *
 * 계약: spec/frontend/08-14-screens.md §S-04
 * 근거: ADR-029 「바뀌지 않는 것 셋」 · CLAUDE.md 불변 규칙 8(기대치 관리는 랜딩에서)
 *
 * ③ 화면 소개가 와이어프레임에서 **실제 화면 컴포넌트**로 바뀌면서(2026-09-06) 링크·버튼이
 * 딸려 들어올 수 있게 됐습니다. 이 시험은 그것들이 랜딩의 행동으로 새지 않는지 봅니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Landing from "./page";

const html = renderToStaticMarkup(<Landing />);
const textOf = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const text = textOf(html);

describe("행동은 하나 — ADR-029 ①", () => {
  it("링크는 [지금 시작하기] 하나뿐이다", () => {
    const anchors = html.match(/<a\s[^>]*>/g) ?? [];
    expect(anchors.length).toBe(1);
    expect(anchors[0]).toContain('href="/start"');
    expect(text).toContain("지금 시작하기");
  });
});

describe("③ 화면 소개 — 실제 화면이 그림 자리에 선다", () => {
  it("장면 넷이 들어 있다", () => {
    expect(html.match(/data-scene="/g)?.length).toBe(4);
  });

  it("옛 와이어프레임 카드(/start)는 없다", () => {
    expect(text).not.toContain("동의, 그리고 링크 발급");
  });
});

describe("④ 고지는 끝에 그대로 — 문구를 줄이지 않습니다", () => {
  it("112 우선과 환급 비보장이 남아 있다", () => {
    expect(text).toContain("신고 전이라면 112가 먼저");
    expect(text).toContain("환급을 보장하지 않습니다");
  });
});
