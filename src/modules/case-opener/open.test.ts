import { describe, expect, it } from "vitest";
import { isCaseToken, openCase } from "./open";
import type { CaseResponse } from "./types";

const withSteps = (...states: string[]): CaseResponse => ({
  case_id: "01J8XKR5000000000000000000",
  track: "victim",
  plan: { steps: states.map((state, i) => ({ step_id: `s${i}`, state })) },
});

describe("링크 토큰을 알아본다", () => {
  it("26자 Crockford Base32 를 받는다", () => {
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQRS")).toBe(true);
  });

  it("헷갈리는 네 글자는 토큰에 없다 — I·L·O·U", () => {
    expect(isCaseToken("0123456789ABCDEFGHIKMNPQRS")).toBe(false);
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQRU")).toBe(false);
  });

  it("길이가 다르면 아니다", () => {
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQR")).toBe(false);
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQRST")).toBe(false);
  });

  it("소문자도 받는다 — 사용자가 손으로 옮겨 적을 수 있다", () => {
    expect(isCaseToken("0123456789abcdefghjkmnpqrs")).toBe(true);
  });

  it("빈 값에 던지지 않는다", () => {
    expect(isCaseToken("")).toBe(false);
  });
});

describe("첫 화면은 서버가 지목하지 않는다 — 사실로 고른다", () => {
  it("플랜이 있으면 곧장 플랜으로 연다", () => {
    expect(openCase(withSteps("not_started")).focus).toBe("plan");
  });

  it("플랜이 비어 있으면 챗으로 연다", () => {
    expect(openCase(withSteps()).focus).toBe("chat");
  });

  it("플랜 자체가 없어도 던지지 않는다", () => {
    const got = openCase({ case_id: "01J", track: "victim" });
    expect(got).toEqual({ focus: "chat", side: "casefile" });
  });

  it("지금 할 단계가 있으면 오른쪽을 작업으로 연다", () => {
    expect(openCase(withSteps("done_verified", "in_progress")).side).toBe("work");
  });

  it("할 것이 남았으면 작업으로 연다", () => {
    expect(openCase(withSteps("done_verified", "not_started")).side).toBe("work");
  });

  it("전부 끝났으면 사건 파일로 연다", () => {
    expect(openCase(withSteps("done_verified", "skipped")).side).toBe("casefile");
  });

  it("증거함으로는 열지 않는다 — 눌러서 가는 곳이지 도착지가 아니다", () => {
    for (const states of [[], ["not_started"], ["done_verified"]]) {
      expect(openCase(withSteps(...states)).focus).not.toBe("evidence");
    }
  });
});
