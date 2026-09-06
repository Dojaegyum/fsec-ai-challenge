/**
 * @vitest-environment jsdom
 */

/**
 * `QuestionBlock` 상호작용 시험 — **어느 선택지가 어느 `action` 으로 나가나.**
 *
 * 계약: spec/common/08-14-api.md §3.4 · §3.5
 * 근거: ADR-082(되묻기의 답은 글자가 아니라 뜻으로) · ADR-061(모름은 `action: "unknown"`)
 *
 * ⚠️ **2026-09-06 배포본에서 되묻기의 답이 버튼 글자로 나갔습니다.** 브라우저가 보내기
 * 전에 「요」를 `[이름-5]` 로 바꿔(ADR-081) 「아니에[이름-5], 다시 적을게[이름-5]」가
 * 서버에 도착했고, 글자 비교가 어긋나 **그 글자가 피해 금액으로 저장**됐습니다.
 * 이제 나가는 것은 자리(0·1·2)의 뜻이고, 글자는 사람이 읽는 것뿐입니다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NextQuestion } from "@/modules/chat-handler";

import { QuestionBlock } from "./chat";
import type { ChatSend } from "./send";

// React 19 는 이 표식이 있어야 `act` 밖 갱신을 경고합니다 — 상호작용 시험의 전제입니다
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** 자료에서 뽑힌 금액의 되묻기 — `lib/questions.ts` 의 `confirmForm` 이 내는 모양 그대로 */
const CONFIRM: NextQuestion = {
  slot_key: "amount",
  text: "올린 자료에서 찾은 보낸 금액입니다: 32,000,000원. 맞나요?",
  input: "confirm",
  options: ["맞아요", "아니에요, 다시 적을게요", "모름·기억 안 남"],
};

/** 보통 문항 — 되묻기가 아닌 것은 지금까지대로 값으로 답합니다 */
const BUTTONS: NextQuestion = {
  slot_key: "transferred",
  text: "돈이 실제로 빠져나갔나요?",
  input: "buttons",
  options: ["네, 돈이 나갔어요", "아니요, 나가지는 않았어요", "모름·기억 안 남"],
};

const nothing = async () => undefined;

function askOf(over: Partial<ChatSend["ask"]>): ChatSend["ask"] {
  return {
    question: CONFIRM,
    confirm: null,
    busy: false,
    fail: null,
    answer: nothing,
    skip: nothing,
    resolve: nothing,
    confirmAnswer: nothing,
    ...over,
  };
}

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

const draw = (ask: ChatSend["ask"]) => {
  act(() => {
    root.render(<QuestionBlock ask={ask} onAnswered={() => {}} i={0} />);
  });
};

const press = (label: string) => {
  const one = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.includes(label),
  );
  act(() => {
    one?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

describe("되묻기의 답은 뜻으로 나간다 — ADR-082", () => {
  it("「맞아요」는 confirm — 값은 싣지 않는다", () => {
    const confirmAnswer = vi.fn(nothing);
    const answer = vi.fn(nothing);
    draw(askOf({ confirmAnswer, answer }));

    press("맞아요");

    expect(confirmAnswer).toHaveBeenCalledWith("confirm");
    expect(answer).not.toHaveBeenCalled();
  });

  it("「아니에요, 다시 적을게요」는 reject", () => {
    const confirmAnswer = vi.fn(nothing);
    const answer = vi.fn(nothing);
    draw(askOf({ confirmAnswer, answer }));

    press("아니에요, 다시 적을게요");

    expect(confirmAnswer).toHaveBeenCalledWith("reject");
    expect(answer).not.toHaveBeenCalled();
  });

  it("「모름」은 지금까지대로 unknown 이다 — ADR-061", () => {
    const confirmAnswer = vi.fn(nothing);
    const skip = vi.fn(nothing);
    draw(askOf({ confirmAnswer, skip }));

    press("모름·기억 안 남");

    expect(skip).toHaveBeenCalled();
    expect(confirmAnswer).not.toHaveBeenCalled();
  });

  it("되묻기가 아닌 문항은 그대로 값으로 답한다", () => {
    const confirmAnswer = vi.fn(nothing);
    const answer = vi.fn(nothing);
    draw(askOf({ question: BUTTONS, confirmAnswer, answer }));

    press("네, 돈이 나갔어요");

    expect(answer).toHaveBeenCalledWith("네, 돈이 나갔어요");
    expect(confirmAnswer).not.toHaveBeenCalled();
  });
});
