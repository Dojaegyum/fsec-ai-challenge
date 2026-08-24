/**
 * 나가는 발화 시험 — **여기가 PII 경계입니다.**
 *
 * 겨누는 것은 셋입니다.
 *  · 원문이 네트워크에 안 나간다 (불변 규칙 2)
 *  · 볼트가 발화보다 **먼저** 간다 (§3.11)
 *  · 볼트가 실패하면 **발화를 안 보낸다** — 아무도 못 푸는 토큰을 남기지 않습니다
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryKeyStore } from "@/modules/key-handler";

import { sendUtterance } from "./send";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
/** 시안·목업에서 쓰는 예시 값입니다 — 실제 계좌가 아닙니다 */
const ACCOUNT = "110-2345-678901";

/**
 * 무엇으로 분류됐는지는 **여기서 묻지 않습니다.**
 *
 * 이 값은 13자리이고 Luhn 을 통과해서 `pii-masker` 가 「카드」로 집습니다
 * (`CARD` 가 13~19자리이고 계좌보다 먼저 옵니다). 목업이 계좌로 쓰는 값이라
 * 어긋나지만, **그 판단은 `pii-masker` 의 것**이고 어느 쪽이든 **가려져 나가는
 * 것은 같습니다.** 이 파일이 지키는 것은 경계이지 분류가 아닙니다
 * → QA 계획 Task 9 에 올려 뒀습니다.
 */
const ANY_TOKEN = /\[(계좌|카드)-1\]/;

const answer = {
  message_id: "01J8XKRE000000000000000000",
  reply: "지급정지를 거셨으면 다음은 피해구제 신청서 제출입니다.",
  citations: [{ ref: "kb-2", label: "피해구제 신청서 제출" }],
};

/** 부른 순서와 본문을 그대로 들고 있는 가짜 `fetch` */
function spyFetch(reply: (url: string) => Response) {
  const calls: { url: string; body: string }[] = [];
  const spy = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? "") });
    return reply(url);
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const send = (text: string) =>
  sendUtterance({ caseToken: TOKEN, text, mappings: [], store: memoryKeyStore() });

afterEach(() => vi.unstubAllGlobals());

describe("원문은 네트워크에 나가지 않는다", () => {
  it("계좌번호가 토큰으로 바뀌어 나간다 → 불변 규칙 2", async () => {
    const calls = spyFetch(() => json(answer));
    const result = await send(`${ACCOUNT} 로 300만원을 보냈어요`);

    expect(result.ok).toBe(true);
    const said = calls.find((c) => c.url.includes("/messages"));
    expect(said).toBeDefined();
    // **이 한 줄이 이 파일의 존재 이유입니다**
    expect(said?.body).not.toContain(ACCOUNT);
    expect(said?.body).toMatch(ANY_TOKEN);
  });

  it("볼트에도 원문이 안 들어간다 — 봉한 것만 갑니다", async () => {
    const calls = spyFetch(() => json(answer));
    await send(`${ACCOUNT} 로 보냈어요`);

    const kept = calls.find((c) => c.url.includes("/vault"));
    expect(kept?.body).not.toContain(ACCOUNT);
    // 토큰은 평문입니다 — 조회 키로 써야 하고 그 자체는 개인정보가 아닙니다
    expect(kept?.body).toMatch(ANY_TOKEN);
    expect(kept?.body).toContain("ciphertext");
  });
});

describe("순서가 계약이다", () => {
  it("볼트가 발화보다 먼저 간다 → §3.11", async () => {
    const calls = spyFetch(() => json(answer));
    await send(`${ACCOUNT} 로 보냈어요`);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/vault");
    expect(calls[1]?.url).toContain("/messages");
  });

  it("볼트가 실패하면 발화를 아예 안 보낸다", async () => {
    const calls = spyFetch((url) =>
      url.includes("/vault")
        ? json({ error: { code: "STORAGE_UNAVAILABLE", message: "맡기지 못했습니다" } }, 503)
        : json(answer),
    );
    const result = await send(`${ACCOUNT} 로 보냈어요`);

    // 거꾸로 가면 **아무도 못 푸는 토큰**이 사건에 남습니다
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/vault");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("vault");
  });

  it("가릴 것이 없으면 볼트를 부르지 않는다", async () => {
    const calls = spyFetch(() => json(answer));
    await send("이제 뭘 해야 하나요");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/messages");
  });
});

describe("자동으로 다시 보내지 않는다", () => {
  it("발화가 실패해도 한 번만 부른다 → 에러 §3.1", async () => {
    const calls = spyFetch(() => json({ error: { message: "잠시 뒤에", retryable: true } }, 503));
    const result = await send("이제 뭘 해야 하나요");

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("message");
    expect(!result.ok && result.fail.retryable).toBe(true);
  });
});

describe("답변은 화면 쪽 모양으로 옮겨진다", () => {
  it("근거 한 줄이 붙고 인용 번호는 안 나온다 → §3.9", async () => {
    spyFetch(() => json(answer));
    const result = await send("이제 뭘 해야 하나요");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.turn.sourceNote).toBe("피해구제 신청서 제출");
    // `ref` 는 서버가 이번 턴에 발급한 내부 번호입니다 — 화면에 쓰지 않습니다
    expect(result.turn.sourceNote).not.toContain("kb-2");
  });

  it("사건 정보·전사는 법령 근거로 세지 않는다", async () => {
    spyFetch(() =>
      json({
        ...answer,
        citations: [
          { ref: "case-3", label: "피해구제 신청 기한" },
          { ref: "t-1", label: "사건 대화 t-1" },
        ],
      }),
    );
    const result = await send("이제 뭘 해야 하나요");
    expect(result.ok && result.turn.sourceNote).toBeNull();
  });
});
