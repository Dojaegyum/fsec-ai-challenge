import { describe, expect, it } from "vitest";
import { countTokens, readTranscript } from "./read";
import type { RawLine } from "./types";

const lines: RawLine[] = [
  { speaker: "A", text: "[이름-1] 고객님 되시죠", start_ms: 0 },
  { speaker: "B", text: "네 맞는데요", start_ms: 2100 },
];

const mapping = [{ token: "[이름-1]", original: "이영희" }];

describe("전사를 원문으로 펼친다", () => {
  it("여기서는 전체 복원이 허용된다 — 사용자가 자기 통화를 대조하는 자리다", () => {
    const got = readTranscript(lines, mapping);
    expect(got[0].text).toBe("이영희 고객님 되시죠");
  });

  it("매핑에 없는 토큰은 토큰 그대로 남기고 던지지 않는다", () => {
    const got = readTranscript(lines, []);
    expect(got[0].text).toBe("[이름-1] 고객님 되시죠");
    expect(got[0].unresolved).toEqual(["[이름-1]"]);
  });

  it("다른 기기에서 열어도 화면이 비지 않는다 — 고장이 아니다", () => {
    const got = readTranscript(lines, []);
    expect(got).toHaveLength(2);
    expect(got[1].text).toBe("네 맞는데요");
  });

  it("토큰이 없는 줄은 그대로다", () => {
    const got = readTranscript(lines, mapping);
    expect(got[1].unresolved).toEqual([]);
  });
});

describe("무엇이 가려져 나갔는지 개수로 밝힌다", () => {
  it("종류별로 센다", () => {
    const got = countTokens([
      { token: "[이름-1]", kind: "name" },
      { token: "[계좌-1]", kind: "account" },
      { token: "[계좌-2]", kind: "account" },
    ]);
    expect(got).toEqual([
      { kind: "이름", count: 1 },
      { kind: "계좌", count: 2 },
    ]);
  });

  it("없으면 빈 목록이다", () => {
    expect(countTokens([])).toEqual([]);
  });
});
