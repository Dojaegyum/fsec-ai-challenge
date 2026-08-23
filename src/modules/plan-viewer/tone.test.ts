import { describe, expect, it } from "vitest";
import { tagOf, toneOf } from "./tone";
import type { PlanStep, StepState } from "./types";

const step = (state: StepState | string): PlanStep => ({
  step_id: "01J",
  seq: 10,
  title: "피해구제 신청서 제출",
  state,
  conditional: null,
  body: {},
});

describe("상태를 화면 어휘로 옮긴다", () => {
  it("부산물이 판정한 것만 증빙됨이다", () => {
    expect(toneOf(step("done_verified"), true)).toBe("done");
    expect(tagOf(step("done_verified"), "done")).toBe("증빙됨");
  });

  it("자기 신고는 증빙됨이 아니다 — 증빙 대기로 남는다", () => {
    expect(toneOf(step("unconfirmed"), true)).toBe("todo");
    // 「미확인」은 슬롯 배지·전사 스팬이 쓰는 말이라 단계 상태와 섞이면 안 됩니다
    expect(tagOf(step("unconfirmed"), "todo")).toBe("증빙 대기");
  });

  it("건너뛴 단계는 지우지 않고 해당 없음으로 흐리게 둔다", () => {
    expect(toneOf(step("skipped"), false)).toBe("na");
    expect(tagOf(step("skipped"), "na")).toBe("해당 없음");
  });

  it("기한이 없는 단계는 언제든이다 — 태그도 언제든이다", () => {
    expect(toneOf(step("not_started"), false)).toBe("anytime");
    expect(tagOf(step("not_started"), "anytime")).toBe("언제든");
  });

  it("기한이 있는 미시작은 언제든이 아니다", () => {
    expect(toneOf(step("not_started"), true)).toBe("todo");
  });

  it("진행 중은 미시작으로 보이면 안 된다 — 그 자리는 기한 문자열이 대신한다", () => {
    expect(toneOf(step("in_progress"), true)).toBe("now");
    expect(tagOf(step("in_progress"), "now")).toBe("");
  });

  it("모르는 상태를 만나도 던지지 않는다 — 미시작으로 둔다", () => {
    expect(toneOf(step("무언가_새로_생긴_값"), true)).toBe("todo");
  });
});
