/**
 * 나가는 발화 시험 — **여기가 PII 경계입니다.**
 *
 * 겨누는 것은 셋입니다.
 *  · 원문이 네트워크에 안 나간다 (불변 규칙 2)
 *  · 볼트가 발화보다 **먼저** 간다 (§3.11)
 *  · 볼트가 실패하면 **발화를 안 보낸다** — 아무도 못 푸는 토큰을 남기지 않습니다
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionKey, memoryKeyStore, sealAll } from "@/modules/key-handler";

import { answerSlot, sendUtterance } from "./send";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
/** 시안·목업에서 쓰는 예시 값입니다 — 실제 계좌가 아닙니다 */
const ACCOUNT = "110-2345-678901";

/**
 * 나가는 토큰. 「계좌」로 단정할 수 있습니다 — `CARD` 하한을 14로 올린 뒤부터입니다
 * (2026-08-24 · `pii-masker/patterns.ts`). 그 전에는 13자리 + Luhn 통과라
 * `[카드-1]` 로 나갔습니다.
 */
const TOKENIZED = "[계좌-1]";

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

/**
 * **볼트를 이미 읽은 상태**로 부릅니다 — 아래 「모르면 번호를 안 붙인다」만
 * `vaultRead: false` 를 씁니다. 안 그러면 발화마다 볼트 조회가 한 번씩 더 붙어
 * 「무엇이 몇 번 나갔나」를 보는 시험들이 그 조회를 세게 됩니다
 */
const send = (text: string) =>
  sendUtterance({
    caseToken: TOKEN,
    text,
    mappings: [],
    vaultRead: true,
    store: memoryKeyStore(),
  });

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
    expect(said?.body).toContain(TOKENIZED);
  });

  it("볼트에도 원문이 안 들어간다 — 봉한 것만 갑니다", async () => {
    const calls = spyFetch(() => json(answer));
    await send(`${ACCOUNT} 로 보냈어요`);

    const kept = calls.find((c) => c.url.includes("/vault"));
    expect(kept?.body).not.toContain(ACCOUNT);
    // 토큰은 평문입니다 — 조회 키로 써야 하고 그 자체는 개인정보가 아닙니다
    expect(kept?.body).toContain(TOKENIZED);
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

describe("질문에 답하는 것도 같은 경계를 지난다 — §3.5", () => {
  const SLOT = "counterpart_account";
  const url = `/api/cases/${TOKEN}/slots/${SLOT}`;

  const slotOk = {
    slot: { slot_key: SLOT, state: "confirmed", value: TOKENIZED },
    plan_regenerated: true,
    next_question: null,
  };

  const ask = (action: "answer" | "unknown" | "mask" | "keep", value?: string) =>
    answerSlot({
      caseToken: TOKEN,
      slotKey: SLOT,
      action,
      ...(value === undefined ? {} : { value }),
      mappings: [],
      vaultRead: true,
      store: memoryKeyStore(),
    });

  it("볼트가 답보다 먼저 간다 — 발화와 같은 순서", async () => {
    const calls = spyFetch(() => json(slotOk));
    const result = await ask("answer", `상대 계좌는 ${ACCOUNT} 였어요`);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/vault");
    expect(calls[1]?.url).toBe(url);
  });

  it("**원문이 답에 안 실린다** → 불변 규칙 2", async () => {
    const calls = spyFetch(() => json(slotOk));
    await ask("answer", `상대 계좌는 ${ACCOUNT} 였어요`);

    const sent = calls.find((c) => c.url === url);
    expect(sent?.body).not.toContain(ACCOUNT);
    expect(sent?.body).toContain(TOKENIZED);
  });

  it("볼트가 실패하면 답을 아예 안 보낸다", async () => {
    const calls = spyFetch((at) =>
      at.includes("/vault") ? json({ error: { message: "맡기지 못했습니다" } }, 503) : json(slotOk),
    );
    const result = await ask("answer", `계좌는 ${ACCOUNT}`);

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("vault");
  });

  it("「모름」은 볼트도 값도 없이 간다 — **실패가 아니라 상태입니다**", async () => {
    const calls = spyFetch(() =>
      json({
        slot: { slot_key: SLOT, state: "unknown", value: null },
        plan_regenerated: false,
        next_question: null,
      }),
    );
    const result = await ask("unknown");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(url);
    expect(JSON.parse(calls[0]!.body)).toEqual({ action: "unknown" });
  });

  it.each(["mask", "keep"] as const)(
    "되묻기(`%s`)는 **다시 가리지 않는다** — 같은 값을 그대로 보낸다",
    async (action) => {
      // 다시 가리면 같은 값에 새 토큰이 붙어 **볼트에 쌍둥이**가 생깁니다.
      // AES-GCM 이라 암호문도 달라져 무엇이 무엇인지 알 수 없게 됩니다
      const calls = spyFetch(() => json(slotOk));
      const result = await ask(action, `상대 계좌는 ${TOKENIZED} 였어요`);

      expect(result.ok).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe(url);
      const body = JSON.parse(calls[0]!.body) as { action: string; value: string };
      expect(body.action).toBe(action);
      expect(body.value).toContain(TOKENIZED);
    },
  );

  it("되묻기가 오면 그대로 돌려준다 — 화면이 카드를 그립니다", async () => {
    spyFetch(() =>
      json({
        slot: { slot_key: SLOT, state: "pii_pending", value: null },
        pii_confirm: {
          found: [{ kind: "이름", text: "[이름-1]" }],
          text: "여기에 개인정보가 들어 있는 것 같습니다.",
          note: "가리면 이 값은 이 기기 밖으로 나가지 않습니다.",
          options: [
            { id: "mask", label: "맞아요 — 가릴게요" },
            { id: "keep", label: "아니에요 — 개인정보가 아닙니다" },
          ],
        },
        plan_regenerated: false,
        next_question: null,
      }),
    );
    const result = await ask("answer", "김철수 과장이라고 했어요");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.response.pii_confirm?.found[0]?.kind).toBe("이름");
    // 다시 보낼 값을 들고 나옵니다 — 되묻기에 답할 때 **같은 것**을 보내야 합니다
    expect(result.sent).toBe("김철수 과장이라고 했어요");
    expect(result.response.plan_regenerated).toBe(false);
  });

  it("실패해도 스스로 다시 안 부른다 → 에러 §3.1", async () => {
    const calls = spyFetch(() => json({ error: { message: "잠시 뒤에", retryable: true } }, 503));
    const result = await ask("unknown");

    expect(calls).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("answer");
    expect(!result.ok && result.fail.retryable).toBe(true);
  });
});

/**
 * ── 볼트에 무엇이 있는지 **모르는 채로는 번호를 안 붙입니다** ──────────
 *
 * 볼트는 `ON CONFLICT (case_id, token) DO UPDATE SET ciphertext` 로 덮어씁니다
 * (§3.11). 이미 `[계좌-1]` 이 맡겨져 있는데 모르고 1번을 다시 발급하면
 * **본인 칸이 지워집니다** — 며칠 뒤 옛 대화가 남의 계좌로 복원됩니다.
 */
describe("볼트를 못 읽었으면 번호를 새로 붙이지 않는다", () => {
  /** 본인이 맡겨 둔 칸 하나. **이 기기에는 그 열쇠가 없습니다**(가족 기기) */
  async function seeded() {
    const owner = await createSessionKey();
    return sealAll(owner, [
      { token: "[계좌-1]", kind: "계좌", seq: 1, original: ACCOUNT },
    ]);
  }

  /** GET `…/vault` 와 POST `…/vault` 를 메서드로 갈라 냅니다 */
  function stubVault(get: () => Response) {
    const calls: { url: string; method: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = String(init?.method ?? "GET");
        calls.push({ url, method, body: String(init?.body ?? "") });
        if (url.includes("/vault")) return method === "GET" ? get() : json({ stored: 1 });
        return json(answer);
      }),
    );
    return calls;
  }

  const blind = (text: string) =>
    sendUtterance({
      caseToken: TOKEN,
      text,
      mappings: [],
      // **못 읽은 상태입니다** — 첫 로드에서 볼트 조회가 실패했을 때 이렇습니다
      vaultRead: false,
      store: memoryKeyStore(),
    });

  it("먼저 물어보고, 이미 쓰인 번호를 피해서 붙인다", async () => {
    const entries = await seeded();
    const calls = stubVault(() => json({ entries }));
    const result = await blind("제 계좌는 301-1234-567890 이에요");

    expect(result.ok).toBe(true);
    // ① 물어보고 ② 맡기고 ③ 보냅니다
    expect(calls.map((c) => `${c.method} ${c.url.includes("/vault") ? "vault" : "messages"}`))
      .toEqual(["GET vault", "POST vault", "POST messages"]);

    // **1번을 다시 안 씁니다** — 썼으면 본인 칸이 이 발화로 덮였습니다
    const kept = calls.find((c) => c.method === "POST" && c.url.includes("/vault"));
    expect(kept?.body).toContain("[계좌-2]");
    expect(kept?.body).not.toContain("[계좌-1]");

    const said = calls.find((c) => c.url.includes("/messages"));
    expect(said?.body).toContain("[계좌-2]");
    // 다음 턴부터는 그냥 이어 씁니다
    expect(result.ok && result.vaultRead).toBe(true);
  });

  it("물어보지 못하면 **아무것도 안 보낸다**", async () => {
    const calls = stubVault(() => json({ error: { message: "잠시 뒤에" } }, 503));
    const result = await blind("제 계좌는 301-1234-567890 이에요");

    // 볼트에 맡기지도, 발화를 보내지도 않습니다
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.stage).toBe("vault");
    // 다시 보내는 것은 사용자가 합니다 → 에러 §3.1
    expect(!result.ok && result.fail.retryable).toBe(true);
  });

  it("가릴 것이 없으면 못 읽었어도 볼트를 안 부른다", async () => {
    const calls = stubVault(() => json({ entries: [] }));
    const result = await blind("이제 뭘 해야 하나요");

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("/messages");
    // 물어본 적이 없으니 여전히 모르는 상태입니다
    expect(result.ok && result.vaultRead).toBe(false);
  });

  it("열쇠가 없어도 원문은 안 나간다 — 되물어 온 이름표만 씁니다", async () => {
    const entries = await seeded();
    const calls = stubVault(() => json({ entries }));
    await blind("제 계좌는 301-1234-567890 이에요");

    for (const call of calls) {
      expect(call.body).not.toContain(ACCOUNT);
      expect(call.body).not.toContain("301-1234-567890");
    }
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
