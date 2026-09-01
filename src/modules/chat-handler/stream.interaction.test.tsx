/**
 * @vitest-environment jsdom
 */

/**
 * `QuestionField` 상호작용 시험 — **적은 글이 언제 남고 언제 비워지나.**
 *
 * 계약: spec/frontend/08-14-screens.md §S-06 · spec/common/08-14-api.md §3.4 · §3.1(에러)
 *
 * 여기만 `jsdom` 을 답니다. 나머지 렌더 시험은 `renderToStaticMarkup` 으로 충분하지만
 * 「적고 → 누르고 → 칸이 어떻게 되나」는 상태가 옮겨가는 것이라 정적 HTML 로는 못 봅니다
 * (`vitest.config.mts` 의 `environment: "node"` 주석이 말하는 그 자리입니다).
 *
 * ⚠️ **적은 글이 다음 질문으로 딸려 갔습니다.** `draft` 가 질문과 무관하게 살아 있어서,
 * 「얼마를 보내셨나요」에 답하고 나면 다음 질문 칸에 **앞의 답이 그대로 앉아** 있었습니다.
 * 그대로 「답하기」를 누르면 **다른 슬롯에 앞 질문의 값이 들어갑니다.**
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionField } from "./stream";
import type { NextQuestion } from "./types";

// React 19 는 이 표식이 있어야 `act` 밖 갱신을 경고합니다 — 상호작용 시험의 전제입니다
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const AMOUNT: NextQuestion = {
  slot_key: "amount",
  text: "얼마를 보내셨나요?",
  input: "amount",
};

const WHEN: NextQuestion = {
  slot_key: "occurred_at",
  text: "언제 있었던 일인가요?",
  input: "text",
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = (ui: React.ReactElement) => {
  act(() => {
    root.render(ui);
  });
};

const field = () => host.querySelector("input") as HTMLInputElement;

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((one) => one.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined;

/** 제어 입력에 실제로 타이핑한 것처럼 — 네이티브 setter 로 값을 넣고 이벤트를 흘립니다 */
const write = (text: string) => {
  const input = field();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const press = (label: string) => {
  const one = button(label);
  act(() => {
    one?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("적은 글은 그 질문의 것이다", () => {
  it("답하면 그 값이 나간다", () => {
    const onAnswer = vi.fn();
    draw(<QuestionField question={AMOUNT} onAnswer={onAnswer} />);
    write("300만원");
    press("답하기");
    expect(onAnswer).toHaveBeenCalledWith("300만원");
  });

  it("**다음 질문으로 딸려 가지 않는다** — 그대로 누르면 다른 슬롯에 앞의 답이 들어간다", () => {
    draw(<QuestionField question={AMOUNT} onAnswer={() => undefined} />);
    write("300만원");
    press("답하기");

    // 답이 넘어가면 서버가 다음 질문을 내립니다 (§3.4 `next_question`)
    draw(<QuestionField question={WHEN} onAnswer={() => undefined} />);
    expect(field().value).toBe("");
    expect(button("답하기")?.disabled).toBe(true);
  });

  it("「모름」으로 넘어가도 마찬가지다 — 적다 만 글이 다음 질문에 남지 않는다", () => {
    draw(<QuestionField question={AMOUNT} onAnswer={() => undefined} onSkip={() => undefined} />);
    write("300만");
    press("기억이 안 나요");

    draw(<QuestionField question={WHEN} onAnswer={() => undefined} />);
    expect(field().value).toBe("");
  });

  it("**못 보냈으면 그대로 남는다** — 스스로 다시 보내지 않으니 다시 적게 하면 안 된다 (§3.1)", () => {
    // 실패하면 질문이 그대로 있습니다 (`send.ts` 의 `put` — `setQuestion` 까지 못 갑니다)
    draw(<QuestionField question={AMOUNT} onAnswer={() => undefined} />);
    write("300만원");
    press("답하기");

    draw(<QuestionField question={AMOUNT} onAnswer={() => undefined} busy={false} />);
    expect(field().value).toBe("300만원");
  });
});
