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

/**
 * 자료에서 뽑힌 값의 되묻기 — **그 값의 출처가 실려 옵니다** (§3.4 `held_ref`).
 */
const HELD: NextQuestion = {
  slot_key: "amount",
  text: "올린 자료에서 찾은 보낸 금액입니다: 32,000,000원. 맞나요?",
  input: "confirm",
  options: ["맞아요", "아니에요, 다시 적을게요", "모름·기억 안 남"],
  held_ref: "01J8XKQZ3M7N2P4R6T8V0W2Y4B",
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
  /** 실린 헤더 — 속도 제한이 세는 단위가 붙었나 (§1.3) */
  readonly headers: Record<string, string>;
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
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (init?.method !== undefined && init.method !== "GET") {
        calls.push({ url, body, headers });
      }

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

/**
 * `question` 은 **셸이 번들에서 내려주는 첫 문항**입니다(`page.tsx` 의 `bundle.question`).
 * 다시 그리며 바꿀 수 있게 속성으로 받습니다 — 번들이 갱신되는 자리를 세웁니다.
 */
function Probe({ question = ORG }: { question?: NextQuestion | null }) {
  const now = useChatSend(TOKEN, question);
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
async function mount(question: NextQuestion | null = ORG): Promise<void> {
  await act(async () => {
    root.render(<Probe question={question} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** 번들이 갱신돼 셸이 새 문항을 내려주는 자리 — 같은 훅을 다시 그립니다 */
async function rerender(question: NextQuestion | null): Promise<void> {
  await act(async () => {
    root.render(<Probe question={question} />);
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
 * 되묻기의 답은 **뜻으로** 나간다 — ADR-082.
 *
 * 2026-09-06 배포본에서는 버튼 글자가 그대로 실려 나갔고, 브라우저가 보내기 전에
 * 「요」를 `[이름-5]` 로 바꾸는 바람에(ADR-081) 서버의 글자 비교가 어긋나 그 글자가
 * 피해 금액으로 저장됐습니다. 이제 `value` 를 아예 안 싣습니다.
 */
describe("되묻기의 답 — confirmAnswer 는 뜻만 보낸다 (ADR-082)", () => {
  it("「맞아요」는 { action: 'confirm' } — 값은 싣지 않는다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.confirmAnswer("confirm");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(patched).toHaveLength(1);
    expect(JSON.parse(patched[0]!.body)).toEqual({ action: "confirm" });
  });

  it("「아니에요」는 { action: 'reject' }", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.confirmAnswer("reject");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(JSON.parse(patched[0]!.body)).toEqual({ action: "reject" });
  });

  it("지금 질문의 슬롯으로 간다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.confirmAnswer("confirm");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(patched[0]?.url).toContain("/slots/org_name");
  });
});

/**
 * 셸이 번들을 다시 읽어 **새 문항**을 들고 오면 챗에도 떠야 합니다 — §3.3 · ADR-086.
 *
 * ⚠️ **8초 뒤 후속 읽기가 뽑아 온 되묻기가 챗에 안 나타났습니다.** 판독이 끝난 뒤 기관
 * 보정·슬롯 추출은 응답 뒤에 돌고(ADR-086), 그 결과는 다음 번들 조회에서 옵니다. 그런데
 * 훅이 셸의 문항을 `useState` **초기값으로만** 써서, 번들이 갱신돼도 챗의 문항은 옛것
 * 그대로였습니다 — 왼쪽 사건 파일 카드의 「확인 중」 표시만 바뀌어 화면이 어긋났습니다.
 */
describe("번들이 새 문항을 들고 오면 챗에 뜬다 — ADR-086", () => {
  it("문항이 없던 자리에 새 되묻기가 뜬다", async () => {
    stubServer([]);
    await mount(null);

    expect(hookNow().ask.question).toBeNull();

    // 8초 뒤 후속 읽기 — 미룬 추출이 금액을 뽑아 되묻기가 생겼습니다
    await rerender(HELD);

    expect(hookNow().ask.question?.slot_key).toBe("amount");
    expect(hookNow().ask.question?.held_ref).toBe(HELD.held_ref);
  });

  /**
   * **로컬이 더 새로우면 덮지 않습니다.** 답이 오가는 사이에 출발한 번들은 그 답을
   * 아직 모릅니다 — 그것으로 덮으면 방금 답한 문항이 화면에 되살아납니다.
   */
  it("이미 답한 문항을 들고 온 번들은 무시한다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount(ORG);

    // 「모름」으로 답했고 서버가 다음 문항을 내려줬습니다
    await act(async () => {
      await hookNow().ask.skip();
    });
    expect(hookNow().ask.question?.slot_key).toBe("amount");

    // 그 답을 아직 모르는 번들이 도착합니다(같은 문항의 새 객체)
    await rerender({ ...ORG });

    expect(hookNow().ask.question?.slot_key).toBe("amount");
  });

  it("답한 직후라도 **새** 문항은 그대로 뜬다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount(ORG);

    await act(async () => {
      await hookNow().ask.skip();
    });
    await rerender(HELD);

    expect(hookNow().ask.question?.slot_key).toBe("amount");
    expect(hookNow().ask.question?.input).toBe("confirm");
  });

  /** 번들이 「물을 것 없음」을 들고 와도 화면의 문항을 지우지 않습니다 — 지우는 것은 답의 응답입니다 */
  it("번들의 null 로는 문항을 지우지 않는다", async () => {
    stubServer([]);
    await mount(ORG);

    await rerender(null);

    expect(hookNow().ask.question?.slot_key).toBe("org_name");
  });
});

/**
 * 되묻기의 「맞아요」는 **내가 본 값**에만 붙습니다 — ADR-082 × ADR-087.
 *
 * 답에 값이 안 실리므로 서버는 지금 DB 값을 닫습니다. 되묻기가 떠 있는 동안 미룬
 * 추출(ADR-086)이 그 칸을 덮으면 **본 적 없는 값이 확정**됩니다 — 문항이 실어 준
 * 출처를 그대로 되돌려 주면 서버가 그 어긋남을 봅니다.
 */
describe("되묻기의 답이 물었던 값의 출처를 되돌려 준다 — §3.5 held_ref", () => {
  it("「맞아요」에 held_ref 가 실린다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount(HELD);

    await act(async () => {
      await hookNow().ask.confirmAnswer("confirm");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(JSON.parse(patched[0]!.body)).toEqual({
      action: "confirm",
      held_ref: HELD.held_ref,
    });
  });

  it("「아니에요」는 지금까지대로 뜻만 보낸다 — 비우는 데는 짝이 필요 없습니다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount(HELD);

    await act(async () => {
      await hookNow().ask.confirmAnswer("reject");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(JSON.parse(patched[0]!.body)).toEqual({ action: "reject" });
  });

  it("출처가 없는 문항에는 안 싣는다 — 옛 서버가 낸 문항", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount({ ...HELD, held_ref: undefined });

    await act(async () => {
      await hookNow().ask.confirmAnswer("confirm");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(JSON.parse(patched[0]!.body)).toEqual({ action: "confirm" });
  });
});

/**
 * 속도 제한이 **세션당**으로 서려면 브라우저가 그 값을 보내야 합니다 — §1.3.
 *
 * ⚠️ 2026-09-06 까지 이 헤더를 **어디서도 안 보냈습니다.** 서버는 없으면 IP 로 세는데
 * (`lib/request.ts`), ADR-085 로 카운터가 공유 저장소가 되면서 그 합산이 진짜로
 * 걸리기 시작했습니다 — 같은 NAT 뒤의 사용자 둘이면 판독 폴링만으로 300회를 넘겨
 * 사건 화면이 「불러오지 못했습니다」가 됩니다.
 */
describe("모든 요청에 이 탭의 세션 식별자가 실린다 — §1.3", () => {
  it("슬롯 답에 X-Session-Id 가 붙는다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.confirmAnswer("confirm");
    });

    const patched = calls.filter((one) => one.url.includes("/slots/"));
    expect(patched[0]?.headers["X-Session-Id"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it("발화도 같은 값으로 나간다 — 한 탭이 한 통입니다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.confirmAnswer("confirm");
    });
    await act(async () => {
      await hookNow().send("이게 무슨 뜻이에요?");
    });

    const ids = calls.map((one) => one.headers["X-Session-Id"]);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(1);
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
        if (init?.method !== undefined && init.method !== "GET") {
          calls.push({ url, body, headers: (init.headers ?? {}) as Record<string, string> });
        }
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

/**
 * 새로고침 뒤 마지막 언급 다시 잡기 — 감사(2026-09-06) 회귀.
 *
 * §3.12 에는 ADR-065 로 이미 `referenced_steps` 칸이 있고 `history.ts` 도
 * 파싱해 두고 있었는데, `useChatSend` 는 살아있는 턴에서만 `onReferenced` 를
 * 불러 매 새로고침마다 워크스페이스의 연결이 사라졌습니다.
 */
describe("새로고침해도 마지막 언급을 다시 잡는다 — §3.12 referenced_steps", () => {
  const HISTORY_ROW = (referencedSteps: readonly string[]) => ({
    messages: [
      {
        message_id: "m1",
        role: "user",
        content: "돈을 보냈어요",
        created_at: "2026-09-01T00:00:00+09:00",
      },
      {
        message_id: "m2",
        role: "assistant",
        content: "지급정지부터 하세요.",
        citations: [],
        referenced_steps: referencedSteps,
        created_at: "2026-09-01T00:00:05+09:00",
      },
    ],
    truncated: false,
  });

  async function mountWith(onReferenced: (stepIds: readonly string[]) => void) {
    function ReferencedProbe() {
      useChatSend(TOKEN, ORG, undefined, onReferenced);
      return null;
    }
    await act(async () => {
      root.render(<ReferencedProbe />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    // `openVault` 다음에야 `fetchHistory` 가 불립니다 — 두 왕복이 순서대로라
    // 한 번의 마이크로태스크 비움으로 안 끝날 수 있습니다
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("이력을 다 읽으면 마지막 비서 턴의 언급을 한 번 흘려보낸다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/vault")) return json({ entries: [] });
        return json(HISTORY_ROW(["01JSTEP"]));
      }),
    );
    const onReferenced = vi.fn();

    await mountWith(onReferenced);

    expect(onReferenced).toHaveBeenCalledWith(["01JSTEP"]);
  });

  it("마지막 비서 턴에 언급이 없으면 부르지 않는다 — 지어내지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/vault")) return json({ entries: [] });
        return json(HISTORY_ROW([]));
      }),
    );
    const onReferenced = vi.fn();

    await mountWith(onReferenced);

    expect(onReferenced).not.toHaveBeenCalled();
  });

  it("대화가 아예 없으면 부르지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/vault")) return json({ entries: [] });
        return json({ messages: [], truncated: false });
      }),
    );
    const onReferenced = vi.fn();

    await mountWith(onReferenced);

    expect(onReferenced).not.toHaveBeenCalled();
  });
});

/**
 * ⚠️ **챗에 적은 이름이 새로고침 뒤 `[이름-1]` 로 남았습니다.**
 *
 * 계좌는 브라우저가 1차에서 가리며 짝을 봉해 볼트에 맡기지만, 이름은 서버 2차(NER)가
 * 가리고 그 짝은 서버가 보관하지 않습니다. 전사 경로는 ADR-062 가 응답에 실어
 * `absorb` 로 봉하게 했는데 **챗 응답은 그 칸이 없어** 짝이 그 자리에서 사라졌습니다.
 * 챗 응답의 대응표도 같은 길로 갑니다 — ① 봉해 볼트에 ② 복원 목록에.
 */
describe("챗 응답이 실어 온 대응표도 이 기기 것으로 만든다 — ADR-062 의 챗 경로", () => {
  const NAME = "김민수";
  const FRESH = [{ token: "[이름-1]", kind: "이름", seq: 1, original: NAME }];

  /** 서버 대역 — 발화 응답에 **원문 포함 대응표**가 한 번 실려 옵니다 (§3.9) */
  function stubNamedServer(calls: Call[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (init?.method !== undefined && init.method !== "GET") {
          calls.push({ url, body, headers: (init.headers ?? {}) as Record<string, string> });
        }
        if (url.includes("/vault") && init?.method === "POST") return json({ stored: 1 });
        if (url.includes("/vault")) return json({ entries: [] });
        if (url.includes("/messages") && init?.method === "POST") {
          return json({
            message_id: "01J8XKRE",
            reply: "[이름-1]님, 확인했습니다.",
            citations: [],
            referenced_steps: [],
            next_question: null,
            pii_mappings: FRESH,
          });
        }
        return json({ messages: [], truncated: false });
      }),
    );
  }

  it("봉해서 볼트에 맡긴다 — 이름표는 본문에 있고 원문은 없다", async () => {
    const calls: Call[] = [];
    stubNamedServer(calls);
    await mount();

    await act(async () => {
      await hookNow().send(`제 이름은 ${NAME}입니다`);
    });

    const vaulted = calls.filter((one) => one.url.includes("/vault"));
    expect(vaulted).toHaveLength(1);
    expect(vaulted[0]?.body).toContain("[이름-1]");
    expect(vaulted[0]?.body).not.toContain(NAME);
  });

  it("복원 목록에 들어가고, 비서 답이 원문으로 그려진다", async () => {
    const calls: Call[] = [];
    stubNamedServer(calls);
    await mount();

    await act(async () => {
      await hookNow().send(`제 이름은 ${NAME}입니다`);
    });

    expect(hookNow().restorable.map((m) => m.token)).toContain("[이름-1]");
    const last = hookNow().lines.at(-1);
    expect(last?.who).toBe("ai");
    expect(last?.who === "ai" && last.reply).toContain(NAME);
  });
});

/**
 * 챗 응답으로 받은 이름 짝은 발화 문맥에도 합쳐집니다(`absorb` ③). 그러면 **같은 이름을
 * 다시 말할 때 브라우저가 보내기 전에 `[이름-1]` 로 바꿉니다** → ADR-079. 안 바꾸면 서버는
 * 원문을 모르는 장부만 들고 있어 `[이름-2]` 를 새로 붙이고, 모델이 두 사람으로 읽습니다.
 */
describe("같은 이름을 다시 말하면 이번엔 브라우저가 가려 보낸다 — ADR-079", () => {
  const NAME = "김민수";
  const FRESH = [{ token: "[이름-1]", kind: "이름", seq: 1, original: NAME }];

  /** 첫 발화 응답에만 대응표가 실립니다 — 서버는 보관하지 않으니 둘째부터는 없습니다 */
  function stubOnceNamedServer(calls: Call[]) {
    let turns = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = typeof init?.body === "string" ? init.body : "";
        if (init?.method !== undefined && init.method !== "GET") {
          calls.push({ url, body, headers: (init.headers ?? {}) as Record<string, string> });
        }
        if (url.includes("/vault") && init?.method === "POST") return json({ stored: 1 });
        if (url.includes("/vault")) return json({ entries: [] });
        if (url.includes("/messages") && init?.method === "POST") {
          turns += 1;
          return json({
            message_id: `01J8XKRE${turns}`,
            reply: "네, 확인했습니다.",
            citations: [],
            referenced_steps: [],
            next_question: null,
            ...(turns === 1 ? { pii_mappings: FRESH } : {}),
          });
        }
        return json({ messages: [], truncated: false });
      }),
    );
  }

  it("둘째 발화는 [이름-1] 로 나가고 원문은 안 나간다", async () => {
    const calls: Call[] = [];
    stubOnceNamedServer(calls);
    await mount();

    await act(async () => {
      await hookNow().send(`제 이름은 ${NAME}입니다`);
    });
    await act(async () => {
      await hookNow().send(`${NAME} 맞습니다. 이제 뭘 하죠`);
    });

    const said = calls.filter((one) => one.url.includes("/messages"));
    expect(said).toHaveLength(2);
    // 첫 발화는 브라우저가 이름을 모르므로 원문이 나갑니다 — 그것은 서버 2차의 몫입니다
    expect(said[0]?.body).toContain(NAME);
    // 둘째부터는 압니다
    expect(said[1]?.body).toContain("[이름-1]");
    expect(said[1]?.body).not.toContain(NAME);
    // 볼트에는 첫 응답의 짝을 맡긴 한 번뿐입니다
    expect(calls.filter((one) => one.url.includes("/vault"))).toHaveLength(1);
  });
});

describe("이 기기가 1차에서 가린 값은 보내자마자 복원 목록에 있다 — 배포본 점검 2026-09-06", () => {
  it("발화 속 계좌번호 → 볼트에 봉해 맡기고, restorable 에도 바로 합쳐진다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().send("받는 계좌는 국민은행 110-123-456789 예요");
    });

    const vaulted = calls.filter((one) => one.url.includes("/vault"));
    expect(vaulted.length).toBeGreaterThanOrEqual(1);
    expect(vaulted[0]?.body).not.toContain("110-123-456789");
    const said = calls.find((one) => one.url.includes("/messages"));
    expect(said?.body).not.toContain("110-123-456789");
    // 새로고침 없이 — 기재 안내·되묻기 카드가 이 목록으로 되돌립니다
    const one = hookNow().restorable.find((m) => /^\[계좌-\d+\]$/.test(m.token));
    expect(one?.original).toBe("110-123-456789");
  });

  it("문항 답 속 계좌번호도 같다", async () => {
    const calls: Call[] = [];
    stubServer(calls);
    await mount();

    await act(async () => {
      await hookNow().ask.answer("352-0912-3456-73");
    });

    const tokens = hookNow().restorable.map((m) => m.token);
    expect(tokens.some((t) => /^\[계좌-\d+\]$/.test(t))).toBe(true);
  });
});
