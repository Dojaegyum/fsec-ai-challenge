/**
 * @vitest-environment jsdom
 */

/**
 * `useChatSend` 상태 시험 — **되묻기 카드와 질문이 함께 움직이나.**
 *
 * 계약: spec/common/08-14-api.md §3.4 · §3.5 · §3.9 · ADR-041(거부 대신 되묻기)
 *
 * `send.test.ts` 는 `answerSlot`·`screenAndSeal` 같은 **순수 함수**를 봅니다.
 * 여기는 훅이 들고 있는 상태 둘(`question`·`confirm`)이 서로 어긋나는 자리를
 * 봅니다 — 그건 실제로 렌더해서 순서대로 불러 봐야 드러납니다.
 *
 * ⚠️ **카드가 앞 질문의 것인데 답은 다음 질문의 슬롯으로 갔습니다.**
 * `send` 의 성공 경로가 `setQuestion(result.turn.question)` 만 하고 `confirm` 은
 * 그대로 뒀고(`send.ts`), 되묻기에 답하는 `put` 은 카드가 만들어진 슬롯이 아니라
 * **지금 질문의 `slot_key`** 로 보냈습니다.
 */

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextQuestion } from "@/modules/chat-handler";

import { useChatSend } from "./send";
import type { ChatSend } from "./send";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

/** 기관 이름 — 문진에서 자유 입력으로 받는 슬롯입니다 (`lib/questions.ts`) */
const ORG: NextQuestion = {
  slot_key: "org_name",
  text: "어느 기관이었나요?",
  input: "text",
};

/** 그 다음 문항 — 되묻기가 떠 있는 동안 서버가 내려보내는 것 */
const AMOUNT: NextQuestion = {
  slot_key: "amount",
  text: "얼마를 보내셨나요?",
  input: "amount",
};

const CARD = {
  found: [{ kind: "이름", text: "[이름-1]" }],
  text: "여기에 개인정보가 들어 있는 것 같습니다.",
  note: "가리면 이 값은 이 기기 밖으로 나가지 않습니다.",
  options: [
    { id: "mask", label: "맞아요 — 가릴게요" },
    { id: "keep", label: "아니에요 — 개인정보가 아닙니다" },
  ],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Call {
  readonly url: string;
  readonly body: string;
}

/**
 * 서버 대역.
 *
 *  · `GET …/vault` · `GET …/messages` — 첫 로드. 비어 있습니다
 *  · `PATCH …/slots/{slot_key}` — 슬롯 답. 첫 번은 되묻기를 내립니다
 *  · `POST …/messages` — 발화. **다음 문항을 함께 실어 보냅니다** (§3.9)
 */
function stubServer(calls: Call[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : "";
      if (init?.method !== undefined && init.method !== "GET") calls.push({ url, body });

      if (url.includes("/vault")) return json({ entries: [] });
      if (url.includes("/slots/")) {
        // 되묻기는 **한 번만** 내립니다 — 두 번째(mask·keep)는 받아들입니다
        const first = JSON.parse(body) as { action: string };
        return json(
          first.action === "answer"
            ? {
                slot: { slot_key: "org_name", state: "pii_pending", value: null },
                pii_confirm: CARD,
                plan_regenerated: false,
                next_question: AMOUNT,
              }
            : {
                slot: { slot_key: "org_name", state: "confirmed", value: "국민은행" },
                plan_regenerated: false,
                next_question: AMOUNT,
              },
        );
      }
      // 발화 — 답변과 **다음 문항**이 함께 옵니다
      return json({
        message_id: "01J8XKRE",
        reply: "네, 확인했습니다.",
        citations: [],
        referenced_steps: [],
        next_question: AMOUNT,
      });
    }),
  );
}

let host: HTMLDivElement;
let root: Root;

/** 훅이 지금 들고 있는 것 — 속성으로 담습니다(바깥 변수 재대입은 규칙 위반) */
const seen: { now: ChatSend | null } = { now: null };
const hookNow = () => seen.now as ChatSend;

function Probe() {
  const now = useChatSend(TOKEN, ORG);
  // 렌더 중에 바깥을 건드리지 않습니다 — `act()` 가 효과까지 흘려보내므로
  // 시험이 읽는 시점에는 언제나 최신입니다
  useEffect(() => {
    seen.now = now;
  });
  return null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** 훅을 마운트하고 첫 로드(볼트·이력)가 끝날 때까지 기다립니다 */
async function mount(): Promise<void> {
  await act(async () => {
    root.render(<Probe />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe("되묻기 카드는 그 슬롯의 것이다 — §3.5 · ADR-041", () => {
  it("답하면 카드가 뜬다 — 질문은 그대로입니다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.answer("국민은행 김민수 과장");
    });

    expect(hookNow().ask.confirm).not.toBeNull();
    // 「되묻기가 오면 **질문은 그대로 두고** 카드를 겹칩니다」 — send.ts
    expect(hookNow().ask.question?.slot_key).toBe("org_name");
  });

  /**
   * ⚠️ **여기가 깨져 있었습니다.**
   *
   * 카드를 이해 못 한 사용자가 컴포저에 한 마디 적어 보내면, 서버는 그 답에
   * 다음 문항을 실어 보냅니다(§3.9). 훅이 그것을 그대로 받아 `question` 만
   * 옮기고 `confirm` 은 앞 슬롯의 것으로 남겨 두면, 화면은 **다음 질문의 문구 +
   * 앞 질문의 카드**를 함께 그립니다. 그 상태로 「맞아요 — 가릴게요」를 누르면
   * 앞 질문의 답이 **다음 질문의 슬롯**에 저장되고, 원래 슬롯은 `pii_pending`
   * 인 채로 다시는 안 물어봅니다(`slot-checker` 는 `empty` 만 순회합니다).
   */
  it("**카드가 떠 있는 동안 질문이 옮겨가지 않는다** — 발화를 보내도", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.answer("국민은행 김민수 과장");
    });
    await act(async () => {
      await hookNow().send("이게 무슨 뜻이에요?");
    });

    expect(hookNow().ask.confirm).not.toBeNull();
    expect(hookNow().ask.question?.slot_key).toBe("org_name");
  });

  it("**되묻기의 답은 카드가 만들어진 슬롯으로 간다**", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.answer("국민은행 김민수 과장");
    });
    await act(async () => {
      await hookNow().send("이게 무슨 뜻이에요?");
    });
    await act(async () => {
      await hookNow().ask.resolve("mask");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(patched).toHaveLength(2);
    // 두 번째가 되묻기의 답입니다 — **앞 질문의 슬롯**이어야 합니다
    expect(patched[1]?.url).toContain("/slots/org_name");
    expect(patched[1]?.url).not.toContain("/slots/amount");
  });

  it("되묻기가 끝나면 그때 다음 문항으로 넘어간다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.answer("국민은행 김민수 과장");
    });
    await act(async () => {
      await hookNow().ask.resolve("mask");
    });

    expect(hookNow().ask.confirm).toBeNull();
    expect(hookNow().ask.question?.slot_key).toBe("amount");
  });
});

/**
 * ⚠️ **전사가 만든 대응표가 그 자리에서 버려지고 있었습니다** (ADR-062).
 *
 * 서버는 토큰화한 그 폴링 응답에만 원문 포함 대응표를 실어 보냅니다 — 보관하지
 * 않으므로 **그 한 번이 짝의 유일한 생존 기회**입니다. 받는 쪽이 하는 일:
 * ① 자기 열쇠로 잠가 볼트에 맡기고(`POST …/vault`) ② 화면 복원 목록과
 * ③ 나가는 발화의 매핑 문맥에 합칩니다 — 같은 계좌를 나중에 타이핑하면
 * 같은 번호가 붙어야 합니다(「같은 값 → 같은 번호」).
 */
describe("전사가 만든 대응표를 이 기기 것으로 만든다 — absorb", () => {
  const FRESH = [
    { token: "[계좌-3]", kind: "계좌", seq: 3, original: "110-234-567,890" },
  ] as const;

  it("볼트에 맡기고, 복원 목록에 합쳐진다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    const ok = await act(async () => hookNow().absorb([...FRESH]));

    expect(ok).toBe(true);
    const vaulted = calls.filter((one) => one.url.includes("/vault"));
    expect(vaulted).toHaveLength(1);
    // 봉해서 보냅니다 — 원문이 본문에 그대로 실리면 안 됩니다
    expect(vaulted[0]?.body).not.toContain("110-234-567,890");
    expect(hookNow().restorable.map((m) => m.token)).toContain("[계좌-3]");
  });

  it("**볼트가 실패해도 화면에는 합친다** — 기회가 한 번뿐입니다", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (init?.method !== undefined && init.method !== "GET") calls.push({ url, body });
        if (url.includes("/vault") && init?.method === "POST")
          return json({ error: { message: "잠시 뒤에", retryable: true } }, 503);
        if (url.includes("/vault")) return json({ entries: [] });
        return json({ messages: [], truncated: false });
      }),
    );
    await mount();

    const ok = await act(async () => hookNow().absorb([...FRESH]));

    // 맡기지는 못했지만(다음 재접속에는 없음) 이번 화면에서는 보입니다
    expect(ok).toBe(false);
    expect(hookNow().restorable.map((m) => m.token)).toContain("[계좌-3]");
  });

  it("원문이 빈 항목은 안 합친다 — 뜻 없는 빈칸이 복원 목록을 어지럽힙니다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => hookNow().absorb([{ token: "[계좌-9]", kind: "계좌", seq: 9, original: "" }]));

    expect(hookNow().restorable.map((m) => m.token)).not.toContain("[계좌-9]");
  });
});
