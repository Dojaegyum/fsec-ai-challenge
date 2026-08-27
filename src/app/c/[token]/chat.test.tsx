/**
 * 문진 렌더 시험 — **서버가 문항을 내는데 화면에 그릴 자리가 없던 것**을 막습니다.
 *
 * 계약: spec/common/08-14-api.md §3.4 · spec/frontend/08-14-screens.md §S-06
 * 근거: ADR-041(거부 대신 되묻기) · CLAUDE.md 불변 규칙 5
 *
 * ⚠️ **2026-08-27 까지 프로덕션에서 문진이 한 번도 안 그려졌습니다.**
 * `chat.tsx` 의 문항 블록이 `!atWork` 로 막혀 있었고, 사건은 만들어지자마자 T0
 * 단계가 붙어 **언제나 워크스페이스가 열린 채로** 열립니다(`case-opener` 의 `side`).
 * 서버·상태 배선은 멀쩡했고 시험도 1,352건이 통과하고 있었습니다 —
 * **셋을 잇는 렌더 게이트만 아무도 안 봤습니다.**
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { NextQuestion } from "@/modules/chat-handler";

import { MiniChat, QuestionBlock } from "./chat";
import type { ChatSend } from "./send";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const BUTTONS: NextQuestion = {
  slot_key: "transferred",
  text: "돈이 실제로 빠져나갔나요?",
  input: "buttons",
  options: ["네, 돈이 나갔어요", "아니요, 나가지는 않았어요", "모름·기억 안 남"],
};

const nothing = async () => undefined;

const askOf = (over: Partial<ChatSend["ask"]> = {}): ChatSend["ask"] => ({
  question: BUTTONS,
  confirm: null,
  busy: false,
  fail: null,
  answer: nothing,
  skip: nothing,
  resolve: nothing,
  ...over,
});

const chatOf = (over: Partial<ChatSend> = {}): ChatSend => ({
  lines: [],
  sending: false,
  fail: null,
  send: async () => true,
  loading: false,
  truncated: false,
  pastFailed: false,
  locked: false,
  restorable: [],
  ask: askOf(),
  ...over,
});

describe("문항은 입력 유형 넷을 다 그린다 — §3.4", () => {
  it("버튼이면 선택지가 전부 나온다", () => {
    const text = textOf(
      renderToStaticMarkup(<QuestionBlock ask={askOf()} onAnswered={() => {}} i={0} />),
    );
    expect(text).toContain("돈이 실제로 빠져나갔나요?");
    expect(text).toContain("네, 돈이 나갔어요");
  });

  it.each(["text", "date", "amount"] as const)("%s 도 그릴 것이 있다", (input) => {
    // 그릴 것이 없으면 **그 질문이 영영 안 끝납니다** — 같은 질문이 계속 돌아옵니다
    const html = renderToStaticMarkup(
      <QuestionBlock
        ask={askOf({ question: { slot_key: "amount", text: "얼마를 보내셨나요?", input } })}
        onAnswered={() => {}}
        i={0}
      />,
    );
    expect(textOf(html)).toContain("얼마를 보내셨나요?");
    expect(html).toContain("<input");
  });

  it("물을 것이 없으면 아무것도 안 그린다", () => {
    expect(
      renderToStaticMarkup(
        <QuestionBlock ask={askOf({ question: null })} onAnswered={() => {}} i={0} />,
      ),
    ).toBe("");
  });
});

describe("「모름」은 지우지 않는다 — 불변 규칙 5", () => {
  it("버튼 질문에 「모름」 자리가 있다", () => {
    const text = textOf(
      renderToStaticMarkup(<QuestionBlock ask={askOf()} onAnswered={() => {}} i={0} />),
    );
    // 어느 것이 「모름」인지는 `chat-handler` 가 가릅니다 — 여기서는 있기만 하면 됩니다
    expect(text).toMatch(/모름|기억이 안 나요|기억 안 남/);
  });
});

describe("되묻기가 오면 선택지 대신 카드다 — ADR-041", () => {
  const confirming = askOf({
    confirm: {
      card: {
        found: [{ kind: "계좌번호", text: "[계좌-1]" }],
        text: "여기에 개인정보가 들어 있는 것 같습니다.",
        note: "가리면 이 값은 이 기기 밖으로 나가지 않습니다.",
        options: [
          { id: "mask", label: "맞아요 — 가릴게요" },
          { id: "keep", label: "아니에요 — 개인정보가 아닙니다" },
        ],
      },
      typed: "352-0912-3456-73",
    },
  });

  it("확인 카드가 뜨고 선택지는 안 뜬다", () => {
    const text = textOf(
      renderToStaticMarkup(<QuestionBlock ask={confirming} onAnswered={() => {}} i={0} />),
    );
    expect(text).toContain("맞아요");
    // 아직 답한 것이 아니라서 선택지를 겹쳐 그리지 않습니다
    expect(text).not.toContain("네, 돈이 나갔어요");
  });
});

describe("미니 챗이 실제 대화를 그린다 — 목업이 아니다", () => {
  it("워크스페이스가 열려 있어도 문항이 보인다", () => {
    // **이것이 그날의 결함입니다.** 오른쪽 열의 대응 비서는 본문이 플랜일 때
    // 뜨는데, 실사건은 언제나 플랜으로 열립니다 — 여기 문항이 없으면 문진이
    // 프로덕션에서 한 번도 안 그려집니다
    const text = textOf(renderToStaticMarkup(<MiniChat chat={chatOf()} />));
    expect(text).toContain("돈이 실제로 빠져나갔나요?");
    expect(text).toContain("네, 돈이 나갔어요");
  });

  it("하드코딩된 목업 대사가 남아 있지 않다", () => {
    const text = textOf(renderToStaticMarkup(<MiniChat chat={chatOf()} />));
    // 「다음은 피해구제 신청입니다. 8월 20일까지요」가 박혀 있었습니다 —
    // **화면이 날짜를 만들지 않습니다** (불변 규칙 7)
    expect(text).not.toContain("8월 20일");
    expect(text).not.toContain("뭐부터 하면 돼요");
  });

  it("주고받은 말을 그대로 그린다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <MiniChat chat={chatOf({ lines: [{ who: "me", text: "카카오페이로 보냈어요" }] })} />,
      ),
    );
    expect(text).toContain("카카오페이로 보냈어요");
  });

  it("보내는 중에는 무엇을 하는지 문장으로 말한다 — 점 3개를 쓰지 않습니다", () => {
    const text = textOf(
      renderToStaticMarkup(<MiniChat chat={chatOf({ sending: true })} />),
    );
    expect(text).not.toContain("...");
    expect(text.length).toBeGreaterThan(10);
  });

  it("못 보냈으면 말한다 — 스스로 다시 보내지 않습니다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <MiniChat
          chat={chatOf({
            fail: {
              stage: "message",
              fail: { poll: false, reason: "error", message: "보내지 못했습니다." },
            },
          })}
        />,
      ),
    );
    expect(text).toContain("보내지 못했습니다.");
  });
});
