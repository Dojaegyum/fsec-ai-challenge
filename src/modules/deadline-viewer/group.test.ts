import { describe, expect, it } from "vitest";
import { ddayLabel, groupDeadlines, isCountdown } from "./group";
import type { Deadline } from "./types";

const mk = (over: Partial<Deadline> = {}): Deadline => ({
  deadline_id: "01J",
  title: "피해구제 신청서 제출",
  kind: "primary",
  due_at: "2026-08-20T23:59:59+09:00",
  status: "open",
  ...over,
});

describe("갈래를 나눈다", () => {
  it("본 기한과 추가 기간을 합치지 않는다", () => {
    const got = groupDeadlines([mk(), mk({ deadline_id: "02J", kind: "grace" })]);
    expect(got.primary).toHaveLength(1);
    expect(got.grace).toHaveLength(1);
  });

  it("모르는 kind 를 버리지 않는다 — 본 기한으로 둔다", () => {
    const got = groupDeadlines([mk({ kind: "무언가_새로_생긴_값" })]);
    expect(got.primary).toHaveLength(1);
  });

  it("지난 기한도 목록에서 지우지 않는다 — 유예가 남아 있을 수 있다", () => {
    const got = groupDeadlines([mk({ status: "missed" })]);
    expect(got.primary).toHaveLength(1);
  });
});

describe("화면이 날짜를 세지 않는다", () => {
  it("서버가 센 값이 없으면 D-day 를 그리지 않는다", () => {
    expect(ddayLabel(mk())).toBeNull();
  });

  it("서버가 센 값이 있으면 그대로 옮긴다", () => {
    expect(ddayLabel(mk({ days_left: 2 }))).toBe("D-2");
  });

  it("오늘은 D-0 이 아니라 오늘이다", () => {
    expect(ddayLabel(mk({ days_left: 0 }))).toBe("오늘");
  });

  it("음수는 그리지 않는다 — 서버가 지난 기한에는 잔여일을 싣지 않는다", () => {
    // 지난 기한의 표시는 status: "missed" 배지가 맡습니다 → §3.7 · 시안 2b
    expect(ddayLabel(mk({ days_left: -3 }))).toBeNull();
  });
});

describe("환급을 카운트다운으로 만들지 않는다", () => {
  it("info 는 카운트다운이 아니다", () => {
    expect(isCountdown(mk({ kind: "info", days_left: 60 }))).toBe(false);
  });

  it("본 기한은 카운트다운이다", () => {
    expect(isCountdown(mk({ days_left: 2 }))).toBe(true);
  });

  it("센 값이 없으면 카운트다운을 만들지 않는다", () => {
    expect(isCountdown(mk())).toBe(false);
  });
});
