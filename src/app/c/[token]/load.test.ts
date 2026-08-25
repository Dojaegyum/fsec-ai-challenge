/**
 * 첫 로드 시험 — **금지 규칙**을 겨눕니다.
 *
 * 이 자리의 핵심은 「하지 않는 것」입니다:
 * 모양이 아닌 토큰으로 서버를 부르지 않기 · 자동으로 다시 부르지 않기 ·
 * 서버가 말하지 않은 `retryable` 을 화면이 지어내지 않기 (에러 §3.1 §3.1.1).
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchCaseBundle, fetchEvidence } from "./load";

/** 26자 Crockford Base32 — ADR-039 */
const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const OK_BODY = {
  case_id: "01J8XKR5000000000000000000",
  track: "victim",
  slots: {
    slots: [],
    tier_status: { T1: "met", T2: "partial" },
    next_question: { slot_key: "channel", text: "돈이 어떻게 나갔나요?", input: "buttons", options: ["기억이 안 나요"] },
  },
  plan: { is_superset: false, steps: [{ step_id: "m1", seq: 10, title: "지급정지", state: "in_progress", conditional: null, body: {} }] },
  deadlines: { deadlines: [{ deadline_id: "d1", title: "제출", kind: "primary", due_at: "2026-08-20T23:59:59+09:00", status: "open" }] },
};

function stubFetch(res: Response | Error) {
  const spy = vi.fn(async () => {
    if (res instanceof Error) throw res;
    return res;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });

afterEach(() => vi.unstubAllGlobals());

describe("모양이 아니면 서버를 부르지 않는다", () => {
  it("짧은 토큰은 왕복을 태우지 않는다", async () => {
    const spy = stubFetch(json(OK_BODY));
    const state = await fetchCaseBundle("짧음");

    expect(spy).not.toHaveBeenCalled();
    expect(state?.phase).toBe("failed");
    // 링크가 틀린 것은 다시 눌러도 달라지지 않습니다 — 버튼을 띄우지 않습니다
    expect(state?.phase === "failed" && state.fail.retryable).toBe(false);
  });
});

describe("한 응답을 셋으로 나눠 준다", () => {
  it("§3.10 한 번으로 플랜·기한·질문이 다 온다", async () => {
    const spy = stubFetch(json(OK_BODY));
    const state = await fetchCaseBundle(TOKEN);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(state?.phase).toBe("ready");
    if (state?.phase !== "ready") return;
    expect(state.bundle.steps).toHaveLength(1);
    expect(state.bundle.deadlines).toHaveLength(1);
    expect(state.bundle.question?.slot_key).toBe("channel");
    // `case-opener` 가 첫 화면을 고르는 데 쓰는 부분도 함께 만들어집니다
    expect(state.bundle.case.plan?.steps?.[0]?.state).toBe("in_progress");
  });

  it("더 물을 것이 없으면 질문이 null 이다", async () => {
    stubFetch(json({ ...OK_BODY, slots: { ...OK_BODY.slots, next_question: null } }));
    const state = await fetchCaseBundle(TOKEN);
    expect(state?.phase === "ready" && state.bundle.question).toBeNull();
  });

  it("읽었는데 사건이 아니면 그대로 넘어가지 않는다", async () => {
    stubFetch(json({ hello: "world" }));
    const state = await fetchCaseBundle(TOKEN);
    expect(state?.phase).toBe("failed");
  });
});

describe("서버가 말한 것만 쓴다", () => {
  it("retryable 과 Retry-After 를 그대로 옮긴다", async () => {
    stubFetch(
      json(
        { error: { code: "UPSTREAM_TIMEOUT", message: "잠시 뒤 다시 시도해 주세요.", retryable: true } },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    );
    const state = await fetchCaseBundle(TOKEN);

    expect(state?.phase).toBe("failed");
    if (state?.phase !== "failed") return;
    expect(state.fail.reason).toBe("error");
    expect(state.fail.retryable).toBe(true);
    expect(state.fail.retryAfterSec).toBe(5);
    expect(state.fail.message).toBe("잠시 뒤 다시 시도해 주세요.");
  });

  it("서버가 retryable 을 안 말하면 화면도 모르는 채로 둔다", async () => {
    stubFetch(json({ error: { code: "CASE_NOT_FOUND", message: "그 사건을 찾지 못했습니다" } }, { status: 404 }));
    const state = await fetchCaseBundle(TOKEN);

    expect(state?.phase).toBe("failed");
    // **`false` 로 채우지 않습니다.** 없는 것과 「다시 시도해도 소용없다」는 다릅니다
    expect(state?.phase === "failed" && "retryable" in state.fail).toBe(false);
  });

  it("본문이 JSON 이 아니어도 상태 코드로 판정한다", async () => {
    stubFetch(new Response("<html>502</html>", { status: 502 }));
    const state = await fetchCaseBundle(TOKEN);
    expect(state?.phase).toBe("failed");
    expect(state?.phase === "failed" && state.fail.reason).toBe("error");
  });
});

describe("서버까지 못 갔을 때", () => {
  it("이때만 화면이 retryable 을 만든다", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const state = await fetchCaseBundle(TOKEN);

    expect(state?.phase).toBe("failed");
    expect(state?.phase === "failed" && state.fail.retryable).toBe(true);
  });

  it("화면이 떠난 것은 실패가 아니다", async () => {
    const ac = new AbortController();
    ac.abort();
    stubFetch(new DOMException("aborted", "AbortError"));

    // 아무 상태도 남기지 않습니다 — 실패 화면이 깜빡이면 안 됩니다
    expect(await fetchCaseBundle(TOKEN, ac.signal)).toBeNull();
  });
});

/* ── 증거 하나 — 다시 묻기 ─────────────────────────────────── */

describe("간격은 서버가 정한다", () => {
  it("처리 중이면 서버가 준 간격으로 다시 묻는다", async () => {
    stubFetch(json({ evidence_id: "e1", ingest_status: "processing", progress: { phase: "stt", percent: 40 }, poll_after_ms: 1500 }));
    const state = await fetchEvidence(TOKEN, "e1");

    expect(state?.phase).toBe("ready");
    if (state?.phase !== "ready") return;
    expect(state.verdict).toEqual({ poll: true, delayMs: 1500 });
  });

  it("간격을 안 주면 다시 묻지 않는다 — 화면이 지어내지 않는다", async () => {
    stubFetch(json({ evidence_id: "e1", ingest_status: "processing" }));
    const state = await fetchEvidence(TOKEN, "e1");
    expect(state?.phase === "ready" && state.verdict).toEqual({ poll: false, reason: "no_interval" });
  });

  it("끝나면 멈추고 전사가 실려 온다", async () => {
    stubFetch(
      json({
        evidence_id: "e1",
        ingest_status: "done",
        transcript: [{ speaker: "A", text: "[계좌-1] 로 보내세요", start_ms: 12000 }],
        pii_tokens: [{ token: "[계좌-1]", kind: "account" }],
      }),
    );
    const state = await fetchEvidence(TOKEN, "e1");

    expect(state?.phase).toBe("ready");
    if (state?.phase !== "ready") return;
    expect(state.verdict).toEqual({ poll: false, reason: "done" });
    expect(state.read.transcript).toHaveLength(1);
    // 내려온 전사는 **토큰화된 상태**입니다 — 원문 복원은 브라우저에서만
    expect(state.read.transcript?.[0]?.text).toContain("[계좌-1]");
  });
});

describe("못 읽은 것은 에러가 아니다", () => {
  it("failed 는 200 이라 실패 화면으로 보내지 않는다 → 불변 규칙 5", async () => {
    stubFetch(json({ evidence_id: "e1", ingest_status: "failed", reason: "resident_id_left" }));
    const state = await fetchEvidence(TOKEN, "e1");

    // 갈림길이지 막는 자리가 아닙니다 — 화면은 「이 파일 하나만 빠집니다」를 그립니다
    expect(state?.phase).toBe("ready");
    expect(state?.phase === "ready" && state.read.ingest_status).toBe("failed");
    expect(state?.phase === "ready" && state.verdict.poll).toBe(false);
  });

  it("진짜 5xx 는 실패로 다룬다", async () => {
    stubFetch(json({ error: { code: "STORAGE_UNAVAILABLE", message: "잠시 뒤에", retryable: true } }, { status: 503 }));
    const state = await fetchEvidence(TOKEN, "e1");

    expect(state?.phase).toBe("failed");
    expect(state?.phase === "failed" && state.fail.retryable).toBe(true);
  });
});
