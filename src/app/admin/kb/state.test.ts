import { describe, expect, it } from "vitest";
import type { QueueBody } from "@/flows/kb-review";
import { initialState, nextPendingAfter, reduce } from "./state";

const view = (id: string, affected: string[] = []) => ({
  change_id: id,
  source_key: "law:011359:제3조",
  source: { prefix: "law:011359", label: "법" },
  article: "제3조",
  title: null,
  first_seen: true,
  detected_at: "2026-09-06T04:00:00+09:00",
  meta: {},
  affected,
  review_status: "pending" as const,
});
const QUEUE: QueueBody = {
  kb_version: "2026.09.2",
  counts: { pending: 2, deferred: 0 },
  groups: [{ dedupe_key: null, changes: [view("A", ["e1"]), view("B")] }],
};

describe("렌즈와 선택 — S-12", () => {
  it("처음은 조문 기준 · 아무것도 안 고름", () => {
    expect(initialState.lens).toBe("article");
    expect(initialState.selected).toBeNull();
  });
  it("조문을 고르면 그 조문이 선택된다", () => {
    const s = reduce(initialState, { type: "pick-change", changeId: "A" });
    expect(s.selected).toEqual({ changeId: "A" });
    expect(s.lens).toBe("article");
  });
  it("닿는 매뉴얼을 누르면 렌즈가 매뉴얼로 바뀌고 그 항목이 선택된다", () => {
    const s = reduce(reduce(initialState, { type: "pick-change", changeId: "A" }), {
      type: "pick-entry",
      kbEntryId: "e1",
    });
    expect(s.lens).toBe("entry");
    expect(s.selected).toEqual({ kbEntryId: "e1" });
  });
  it("매뉴얼 상세의 조문을 누르면 조문 기준으로 돌아온다", () => {
    const s = reduce(
      { ...initialState, lens: "entry", selected: { kbEntryId: "e1" } },
      { type: "pick-change", changeId: "A" },
    );
    expect(s.lens).toBe("article");
    expect(s.selected).toEqual({ changeId: "A" });
  });
  it("렌즈만 바꾸면 선택은 비운다", () => {
    const s = reduce(reduce(initialState, { type: "pick-change", changeId: "A" }), {
      type: "set-lens",
      lens: "entry",
    });
    expect(s.selected).toBeNull();
  });
  it("필터를 바꿔도 선택은 남는다", () => {
    const s = reduce(reduce(initialState, { type: "pick-change", changeId: "A" }), {
      type: "set-filter",
      filter: "first",
    });
    expect(s.filter).toBe("first");
    expect(s.selected).toEqual({ changeId: "A" });
  });
});

describe("판단 뒤 다음 건", () => {
  it("목록 순서에서 바로 다음 pending", () => {
    expect(nextPendingAfter(QUEUE.groups, "A")).toBe("B");
  });
  it("마지막이면 null", () => {
    expect(nextPendingAfter(QUEUE.groups, "B")).toBeNull();
  });
});
