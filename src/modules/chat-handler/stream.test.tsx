/**
 * `AnswerBubble`·`QuestionButtons` 렌더 시험 — **금지 규칙만** 봅니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AnswerBubble,
  PiiConfirmCard,
  QuestionButtons,
  QuestionField,
  isDontKnow,
  toTurn,
} from "./index";
import type { ChatResponse, NextQuestion, PiiConfirm } from "./types";

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

  it("버튼이 아닌 입력 유형은 버튼으로 그리지 않는다", () => {
    const html = renderToStaticMarkup(
      <QuestionButtons question={{ ...question, input: "text", options: undefined }} />,
    );
    expect(html).toBe("");
  });
});

describe("타이핑으로 받는 질문 — `text`·`date`·`amount`", () => {
  const typed = (input: NextQuestion["input"]) =>
    renderToStaticMarkup(
      <QuestionField question={{ ...question, input, options: undefined }} />,
    );

  it("버튼 질문에는 안 뜬다 — 자리가 둘이 되면 안 됩니다", () => {
    expect(renderToStaticMarkup(<QuestionField question={question} />)).toBe("");
  });

  it("셋 다 입력칸이 생긴다", () => {
    for (const input of ["text", "date", "amount"] as const) {
      expect(typed(input)).toContain("<input");
    }
  });

  it("날짜는 날짜 입력으로 받는다", () => {
    expect(typed("date")).toContain('type="date"');
  });

  it("**「모름」이 여기에도 있다** — 버튼 질문에만 있으면 답을 모르는 사람이 막힌다", () => {
    // 불변 규칙 5 · F-05b. 「기억이 안 나요」가 상시라는 것이 그 뜻입니다
    expect(textOf(typed("text"))).toContain("기억이 안 나요");
  });

  it("「모름」이 답하기 버튼과 같은 크기다 — 글자색만 내린다 (§S-06)", () => {
    const html = typed("text");
    expect(html).toContain("min-h-[48px]");
    expect(html).toContain("text-ink-3");
  });
});

describe("「모름」을 가르는 판정이 하나다", () => {
  it("문구로 알아본다", () => {
    expect(isDontKnow("기억이 안 나요")).toBe(true);
    expect(isDontKnow("모름")).toBe(true);
    expect(isDontKnow("계좌로 이체했어요")).toBe(false);
  });
});

describe("되묻기 카드 — 거부가 아니라 확인 (ADR-041)", () => {
  const confirm: PiiConfirm = {
    found: [{ kind: "이름", text: "[이름-1]" }],
    text: "여기에 개인정보가 들어 있는 것 같습니다.",
    note: "가리면 이 값은 이 기기 밖으로 나가지 않습니다.",
    options: [
      { id: "mask", label: "맞아요 — 가릴게요" },
      { id: "keep", label: "아니에요 — 개인정보가 아닙니다" },
    ],
  };

  const html = renderToStaticMarkup(
    <PiiConfirmCard confirm={confirm} typed="김철수 과장이라고 했어요" />,
  );

  it("사용자가 적은 값을 그대로 보여준다 — 화면은 원문 (ADR-034)", () => {
    expect(textOf(html)).toContain("김철수 과장이라고 했어요");
  });

  it("**서버가 붙인 이름표를 그리지 않는다** — 사용자에게는 뜻이 없다", () => {
    expect(html).not.toContain("[이름-1]");
  });

  it("문구는 서버가 준 것을 쓴다 — 화면이 다시 적지 않는다", () => {
    const text = textOf(html);
    expect(text).toContain(confirm.text);
    expect(text).toContain(confirm.note);
    expect(text).toContain("맞아요 — 가릴게요");
    expect(text).toContain("아니에요 — 개인정보가 아닙니다");
  });

  it("토큰·마스킹 같은 말을 쓰지 않는다 (§3.5)", () => {
    const text = textOf(html);
    for (const word of ["토큰", "마스킹", "API", "PII"]) {
      expect(text).not.toContain(word);
    }
  });

  it("빨강을 쓰지 않는다 — 확인이지 오류가 아니다", () => {
    expect(html).not.toMatch(/text-red|bg-red|border-red/);
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
