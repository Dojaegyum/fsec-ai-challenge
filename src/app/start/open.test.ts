/**
 * 사건 만들기 시험 — **주소를 틀리지 않는 것**이 핵심입니다.
 *
 * `case_id` 와 `link_token` 은 둘 다 26자 Crockford Base32 라 **형식으로는
 * 못 가립니다**(ADR-039). 잘못 쓰면 화면은 조용히 404 를 보여주고 원인이
 * 안 드러납니다 — 그래서 시험이 대신 봅니다.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { openCase, trackOf } from "./open";

const RESPONSE = {
  case_id: "01J8XKQZ3M7N2P4R6T8V0W2Y4A",
  link_token: "7FK2PB9XQW3M5N8R2T4V6Y0Z1A",
  track: "victim",
  status: "intake",
  opened_at: "2026-08-24T14:30:00+09:00",
};

function spyFetch(res: Response) {
  const calls: { url: string; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? "") });
      return res;
    }),
  );
  return calls;
}

const json = (body: unknown, status = 201) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("주소에 실리는 것은 link_token 이다", () => {
  it("case_id 를 집지 않는다 → ADR-039", async () => {
    spyFetch(json(RESPONSE));
    const made = await openCase("victim");

    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.linkToken).toBe(RESPONSE.link_token);
    // **이 한 줄이 이 파일의 존재 이유입니다** — 둘 다 26자라 형식으로는 못 가립니다
    expect(made.linkToken).not.toBe(RESPONSE.case_id);
  });

  it("주소를 못 받으면 그대로 넘어가지 않는다", async () => {
    spyFetch(json({ ...RESPONSE, link_token: undefined }));
    const made = await openCase("victim");

    // 이걸 흘려보내면 다음 요청을 아예 못 보냅니다 — §3.2 부터 경로가 `{case_token}` 입니다
    expect(made.ok).toBe(false);
    expect(!made.ok && made.fail.retryable).toBe(true);
  });
});

describe("track 은 계약의 둘만 나간다", () => {
  it("고른 대로 실려 나간다", async () => {
    const calls = spyFetch(json(RESPONSE));
    await openCase("frozen_account");
    expect(calls[0]?.url).toBe("/api/cases");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ track: "frozen_account" });
  });

  it("「내 계좌가 묶였어요」만 frozen_account 다", () => {
    expect(trackOf(0)).toBe("victim");
    expect(trackOf(1)).toBe("frozen_account");
  });

  it("「잘 모르겠어요」와 안 고른 것은 스키마 기본값으로 간다", () => {
    // ⬜ 계약에 「모름」 자리가 없습니다 → QA 계획 Task 9 ④.
    // `case.track` 의 `NOT NULL DEFAULT 'victim'` 과 같은 값입니다 — 지어낸 것이 아닙니다
    expect(trackOf(2)).toBe("victim");
    expect(trackOf(-1)).toBe("victim");
  });
});

describe("못 만들었을 때", () => {
  it("서버 문구를 그대로 쓰고 자동으로 다시 부르지 않는다", async () => {
    const calls = spyFetch(
      json({ error: { code: "RATE_LIMITED", message: "잠시 뒤 다시 시도해 주세요.", retryable: true } }, 429),
    );
    const made = await openCase("victim");

    expect(calls).toHaveLength(1);
    expect(made.ok).toBe(false);
    if (made.ok) return;
    expect(made.fail.message).toBe("잠시 뒤 다시 시도해 주세요.");
    expect(made.fail.retryable).toBe(true);
  });

  it("서버가 retryable 을 안 말하면 화면도 모르는 채로 둔다", async () => {
    spyFetch(json({ error: { code: "BAD_REQUEST", message: "track 값이 목록 밖입니다" } }, 400));
    const made = await openCase("victim");

    expect(made.ok).toBe(false);
    expect(!made.ok && "retryable" in made.fail).toBe(false);
  });
});
