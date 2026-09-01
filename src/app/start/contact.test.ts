/**
 * 이메일 보내기 시험 — **실패해도 사용자를 막지 않는 모양인가.**
 *
 * 검증 대상: spec/common/08-14-api.md §3.13
 * 근거: ADR-021(이메일은 선택·미검증) · 불변 규칙 5(「모름」은 실패가 아니다)
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { saveEmail } from "./contact";

const TOKEN = "01J8TKN0000000000000000000";

function spyFetch(res: Response) {
  const calls: { url: string; method: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: String(init?.method ?? "GET"),
        body: String(init?.body ?? ""),
      });
      return res;
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("보낸다 — §3.13", () => {
  it("PUT /api/cases/{token}/contact 로 간다", async () => {
    const calls = spyFetch(json({ saved: true }));

    const made = await saveEmail(TOKEN, "name@example.com");

    expect(made).toEqual({ ok: true, sent: true });
    expect(calls[0]?.method).toBe("PUT");
    expect(calls[0]?.url).toBe(`/api/cases/${TOKEN}/contact`);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({ email: "name@example.com" });
  });

  it("빈 칸이면 아예 안 보낸다 — 안 준 것도 정상 사건입니다 (ADR-021)", async () => {
    const calls = spyFetch(json({ saved: true }));

    const made = await saveEmail(TOKEN, "   ");

    expect(made).toEqual({ ok: true, sent: false });
    expect(calls).toHaveLength(0);
  });
});

describe("실패해도 던지지 않는다 — 불변 규칙 5", () => {
  it("서버가 거절해도 조용히 실패를 돌려준다", async () => {
    spyFetch(json({ error: { code: "BAD_REQUEST", message: "…" } }, 400));

    const made = await saveEmail(TOKEN, "name@example.com");

    // 부르는 쪽은 이 값과 무관하게 사건 화면으로 넘어갑니다 — 알림이 안 갈 뿐
    expect(made).toEqual({ ok: false });
  });

  it("아예 못 갔어도 던지지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    expect(await saveEmail(TOKEN, "name@example.com")).toEqual({ ok: false });
  });
});
