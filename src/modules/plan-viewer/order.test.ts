import { describe, expect, it } from "vitest";
import { numberSteps } from "./order";
import type { PlanStep } from "./types";

const mk = (id: string, seq: number, key?: string, after?: string[]): PlanStep => ({
  step_id: id,
  seq,
  title: id,
  state: "not_started",
  conditional: null,
  body: { step_key: key, after },
});

describe("번호는 사슬에 있는 것에만 붙는다", () => {
  it("사슬이 하나도 없으면 전부 점이다 — 없는 순서를 지어내지 않는다", () => {
    const got = numberSteps([mk("a", 10, "report-112"), mk("b", 20, "bank-freeze")]);
    expect(got.get("a")).toBeNull();
    expect(got.get("b")).toBeNull();
  });

  it("사슬 밖 단계는 번호를 받지 않는다", () => {
    const got = numberSteps([
      mk("a", 10, "report-112"),
      mk("b", 20, "relief-application", ["report-112"]),
    ]);
    // report-112 는 남의 after 에 등장하므로 사슬 안이다
    expect(got.get("a")).toBe(1);
    expect(got.get("b")).toBe(2);
  });

  it("사슬 안 위치로 다시 센다 — step_seq 가 그대로 나오지 않는다", () => {
    const got = numberSteps([
      mk("a", 10, "relief-application", ["bank-freeze"]),
      mk("b", 25, "receipt-upload", ["relief-application"]),
      mk("c", 20, "bank-freeze"),
    ]);
    expect(got.get("c")).toBe(1);
    expect(got.get("a")).toBe(2);
    expect(got.get("b")).toBe(3);
  });

  it("사슬 안과 밖이 섞이면 밖은 null 이다", () => {
    const got = numberSteps([
      mk("chain1", 10, "bank-freeze"),
      mk("chain2", 20, "relief-application", ["bank-freeze"]),
      mk("free", 30, "identity-check"),
    ]);
    expect(got.get("chain1")).toBe(1);
    expect(got.get("chain2")).toBe(2);
    expect(got.get("free")).toBeNull();
  });

  it("step_key 가 없어도 던지지 않는다", () => {
    const got = numberSteps([mk("a", 10), mk("b", 20)]);
    expect(got.get("a")).toBeNull();
  });
});
