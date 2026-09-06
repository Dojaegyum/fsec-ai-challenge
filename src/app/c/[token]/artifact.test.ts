/**
 * 판정 이유 → 안내 한 줄. **새로고침한 뒤에도 같은 말을 하는가.**
 *
 * 계약: spec/common/08-14-api.md §3.6 `artifacts[].verify_reason` · §3.8
 * 근거: ADR-077(L2 는 판독 결과로 판정한다)
 *
 * ⚠️ 판정은 브라우저 메모리에만 있습니다 — 창을 다시 열면 사라집니다. 부산물은
 * 서버에 남으므로, 그 마지막 줄의 이유로 **같은 표에서 같은 글자**를 고릅니다.
 * 이 자리가 없으면 새로고침한 사람에게는 무엇을 더 해야 완료가 되는지가
 * 통째로 사라집니다.
 */

import { describe, expect, it } from "vitest";

import { L2_NOTES } from "@/modules/completion-checker/notes";

import { noteFor, noteOfStep } from "./artifact";

const step = (over: Partial<Parameters<typeof noteOfStep>[0]> = {}) => ({
  step_id: "01STEP-A",
  state: "unconfirmed",
  artifacts: [
    { verify_reason: "reading_pending" },
    { verify_reason: "no_receipt_marks" },
  ],
  ...over,
});

describe("이유를 사람 말로 — 표는 서버와 나눠 씁니다", () => {
  it("표에 있는 이유는 그 글자를 낸다", () => {
    expect(noteFor("no_receipt_marks")).toBe(L2_NOTES.no_receipt_marks);
  });

  it("**표에 없는 이유는 `null`** — 화면이 지어내지 않습니다", () => {
    // L1 의 이유들(`format_unchecked` 등)은 이 표의 것이 아닙니다
    expect(noteFor("format_unchecked")).toBeNull();
    expect(noteFor(null)).toBeNull();
    expect(noteFor(undefined)).toBeNull();
  });
});

describe("단계의 마지막 부산물이 안내를 정한다", () => {
  it("여러 번 냈으면 **마지막 것**을 본다 — 처음 낸 「읽는 중」이 남지 않게", () => {
    expect(noteOfStep(step())).toBe(L2_NOTES.no_receipt_marks);
  });

  it("완료된 단계에는 할 말이 없다", () => {
    expect(noteOfStep(step({ state: "done_verified" }))).toBeNull();
  });

  it("낸 것이 없으면 `null`", () => {
    expect(noteOfStep(step({ artifacts: [] }))).toBeNull();
    expect(noteOfStep(step({ artifacts: undefined }))).toBeNull();
  });

  it("단계가 없으면 `null` — 워크스페이스가 비어 있을 때", () => {
    expect(noteOfStep(null)).toBeNull();
  });
});
