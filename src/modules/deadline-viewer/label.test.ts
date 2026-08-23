import { describe, expect, it } from "vitest";
import { badgeOf, dueLabel } from "./label";
import type { Deadline } from "./types";

const mk = (over: Partial<Deadline> = {}): Deadline => ({
  deadline_id: "01J",
  title: "피해구제 신청서 제출",
  kind: "primary",
  due_at: "2026-08-20T23:59:59+09:00",
  status: "open",
  ...over,
});

describe("날짜는 서버 값을 표기만 바꾼다", () => {
  it("한국 시각으로 읽는다 — 기기 시간대를 따르지 않는다", () => {
    expect(dueLabel(mk())).toBe("8월 20일");
  });

  it("자정 직후의 UTC 표기도 한국 날짜로 읽는다", () => {
    // 2026-08-20T15:00:00Z = 2026-08-21 00:00 KST
    expect(dueLabel(mk({ due_at: "2026-08-20T15:00:00Z" }))).toBe("8월 21일");
  });

  it("날짜가 아닌 값에 던지지 않는다", () => {
    expect(dueLabel(mk({ due_at: "언젠가" }))).toBeNull();
  });
});

describe("배지는 세 변형뿐이다", () => {
  it("사용자 기한은 앰버이고, D-day 는 여기에만 붙는다", () => {
    expect(badgeOf(mk({ days_left: 2 }))).toEqual({
      variant: "user",
      text: "8월 20일까지 · D-2",
    });
  });

  it("잔여일이 없으면 D-day 없이 날짜만 — 화면이 세지 않는다", () => {
    expect(badgeOf(mk())).toEqual({ variant: "user", text: "8월 20일까지" });
  });

  it("지난 본 기한은 중립이고 지우지 않는다", () => {
    expect(badgeOf(mk({ status: "missed" }))).toEqual({
      variant: "passed",
      text: "본 기한 8월 20일 · 지남",
    });
  });

  it("유예는 앰버이되 유예라고 밝힌다 — 본 기한과 합치지 않는다", () => {
    const grace = mk({ kind: "grace", due_at: "2026-09-03T23:59:59+09:00", days_left: 11 });
    expect(badgeOf(grace)).toEqual({ variant: "user", text: "유예 9월 3일까지 · D-11" });
  });

  it("제도 시간은 중립이고 D-day 가 없다 — 두 달을 카운트다운으로 만들지 않는다", () => {
    const info = mk({
      kind: "info",
      title: "채권소멸공고",
      due_at: "2026-10-30T23:59:59+09:00",
      days_left: 60,
    });
    expect(badgeOf(info)).toEqual({ variant: "system", text: "채권소멸공고 10월 30일" });
  });

  it("날짜를 못 읽으면 배지를 그리지 않는다", () => {
    expect(badgeOf(mk({ due_at: "" }))).toBeNull();
  });
});
