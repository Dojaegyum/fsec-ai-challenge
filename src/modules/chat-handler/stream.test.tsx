/**
 * `AnswerBubble`·`QuestionButtons` 렌더 시험 — **금지 규칙만** 봅니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnswerBubble, QuestionButtons, toTurn } from "./index";
import type { ChatResponse, NextQuestion } from "./types";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const question: NextQuestion = {
  slot_key: "channel",
  text: "돈이 어떻게 나갔나요?",
  input: "buttons",
  options: ["계좌로 이체했어요", "간편송금 앱으로 보냈어요", "기억이 안 나요"],
};

describe("「모름」을 지우지 않는다", () => {
  it("선택지에 그대로 남는다", () => {
    const text = textOf(renderToStaticMarkup(<QuestionButtons question={question} />));
    expect(text).toContain("기억이 안 나요");
  });

  it("같은 크기·같은 자리에 둔다 — 글자색만 내린다", () => {
    const html = renderToStaticMarkup(<QuestionButtons question={question} />);
    // 세 버튼이 같은 최소 높이를 갖습니다. 「모름」만 작아지면 고르면 안 되는 답처럼 보입니다
    expect(html.match(/min-h-\[48px\]/g)).toHaveLength(3);
  });
});

describe("한 번에 하나, 전부 버튼, 기본 선택 없음", () => {
  it("미리 골라 두지 않는다", () => {
    const html = renderToStaticMarkup(<QuestionButtons question={question} />);
    expect(html).not.toContain('aria-checked="true"');
  });

  it("버튼이 아닌 입력 유형은 아직 그리지 않는다", () => {
    const html = renderToStaticMarkup(
      <QuestionButtons question={{ ...question, input: "text", options: undefined }} />,
    );
    expect(html).toBe("");
  });
});

describe("인용 번호와 판단 근거를 화면에 쓰지 않는다", () => {
  const response: ChatResponse = {
    message_id: "01J",
    reply: "지급정지가 걸렸습니다.",
    citations: [
      { ref: "kb-2", label: "피해구제 신청서 제출", why: "다음 단계라서" },
      { ref: "case-3", label: "피해구제 신청 기한" },
    ],
  };

  it("매뉴얼 이름만 한 줄로 밝힌다", () => {
    const text = textOf(renderToStaticMarkup(<AnswerBubble turn={toTurn(response, [])} />));
    expect(text).toContain("피해구제 신청서 제출을 보고 안내했습니다");
    expect(text).not.toContain("kb-2");
    expect(text).not.toContain("다음 단계라서");
    // 사건 정보(case-)는 지식베이스가 아니라 근거로 표시하지 않습니다
    expect(text).not.toContain("피해구제 신청 기한");
  });

  it("근거가 없으면 그 줄 자체가 없다", () => {
    const bare: ChatResponse = { message_id: "01J", reply: "네, 확인했습니다." };
    const text = textOf(renderToStaticMarkup(<AnswerBubble turn={toTurn(bare, [])} />));
    expect(text).toBe("네, 확인했습니다.");
  });
});
