/**
 * `LinkHandoff` 렌더 시험 — **금지 규칙만** 봅니다.
 *
 * 재발급 경로가 없어서(ADR-039 ⑥) 이 카드가 마지막 기회입니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LinkHandoff } from "./index";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const URL = "https://finally.kr/c/0123456789ABCDEFGHJKMNPQRS";

describe("주소가 전부 보인다", () => {
  const html = renderToStaticMarkup(<LinkHandoff url={URL} />);

  it("긴 주소도 줄바꿈해서 다 보인다 — 손으로 옮겨 적을 수 있게", () => {
    // 가로 스크롤로 두면 숨은 부분을 옮겨 적다 잃습니다 (§S-05)
    expect(html).toContain("break-all");
    expect(textOf(html)).toContain("finally.kr/c/0123456789ABCDEFGHJKMNPQRS");
  });

  it("화면에서는 스킴만 뗀다 — 옮겨 적을 때 헷갈리지 않게", () => {
    expect(textOf(html)).not.toContain("https://");
  });
});

describe("복사가 막혀도 실패가 아니다", () => {
  it("주소가 화면에 남아 있다 — 버튼이 유일한 길이 아니다", () => {
    const text = textOf(renderToStaticMarkup(<LinkHandoff url={URL} />));
    expect(text).toContain("주소 복사");
    expect(text).toContain("finally.kr");
  });
});
