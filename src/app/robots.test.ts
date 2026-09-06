import { describe, expect, it } from "vitest";

import robots from "./robots";

describe("robots.txt — 사건 링크는 색인하지 않는다 (ADR-021 · ADR-039)", () => {
  const rules = [robots().rules].flat();

  it("랜딩과 /start 는 열고, 사건·API·관리자 화면은 막는다", () => {
    expect(rules).toHaveLength(1);
    const [rule] = rules;
    expect(rule.userAgent).toBe("*");
    expect(rule.allow).toEqual(["/", "/start"]);
    expect(rule.disallow).toEqual(expect.arrayContaining(["/c/", "/api/", "/admin"]));
  });
});
