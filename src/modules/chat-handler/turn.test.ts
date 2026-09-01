import { describe, expect, it } from "vitest";
import { outgoing, sourceNote, toTurn } from "./turn";
import type { ChatResponse } from "./types";

const answer: ChatResponse = {
  message_id: "01J8XKRE",
  reply: "[계좌-1] 로 보내신 건은 지급정지가 걸렸습니다.",
  citations: [
    {
      ref: "kb-2",
      label: "피해구제 신청서 제출",
      kb_entry_id: "relief-application",
      legal_basis: "통신사기피해환급법 시행령 제3조",
      effective_from: "2026-07-01",
    },
    { ref: "case-3", label: "피해구제 신청 기한" },
  ],
  referenced_steps: ["01J8XKRD"],
};

const mapping = [{ token: "[계좌-1]", original: "1102345678901", label: "국민" }];

describe("답변을 화면에 옮긴다", () => {
  it("답변의 토큰을 원문으로 되돌린다", () => {
    const got = toTurn(answer, mapping);
    expect(got.reply).not.toContain("[계좌-1]");
  });

  it("인용 번호를 화면에 쓰지 않는다", () => {
    const got = toTurn(answer, mapping);
    expect(got.sourceNote).not.toContain("kb-2");
    expect(got.sourceNote).not.toContain("case-3");
  });

  it("판단 근거를 사용자 응답에 넣지 않는다", () => {
    const withWhy: ChatResponse = {
      ...answer,
      citations: [{ ref: "kb-2", label: "피해구제 신청서 제출", why: "다음 단계라서" }],
    };
    const got = toTurn(withWhy, mapping);
    expect(got.sourceNote).not.toContain("다음 단계라서");
  });

  /**
   * ⚠️ **`label` 이 없는 근거에 던지고 있었습니다** (2026-08-31).
   *
   * §3.12 이력이 내리는 근거에 `label` 이 빠져 있으면 `label.length` 에서
   * `TypeError` 가 나고, 그 예외가 첫 로드 밖으로 새어 **챗이 「불러오는 중」에서
   * 영영 멈췄습니다.** 서버 쪽은 고쳤지만 **이미 저장된 줄은 그대로 남아** 있어
   * 화면도 견뎌야 합니다 — 이름표가 없으면 근거 줄을 안 그릴 뿐입니다.
   */
  it("**이름표가 없는 근거에 던지지 않는다** — 옛 이력이 화면을 멈추면 안 됩니다", () => {
    const noLabel = [{ ref: "kb-2", why: "다음 단계라서" }] as unknown as ChatResponse["citations"];
    expect(() => sourceNote(noLabel ?? [])).not.toThrow();
    expect(sourceNote(noLabel ?? [])).toBeNull();

    const mixed = [
      { ref: "kb-1", why: "x" },
      { ref: "kb-2", label: "피해구제 신청서 제출" },
    ] as unknown as ChatResponse["citations"];
    expect(sourceNote(mixed ?? [])).toBe("피해구제 신청서 제출");
  });

  it("가리킨 단계를 그대로 넘긴다 — 오른쪽 열이 그걸로 열린다", () => {
    expect(toTurn(answer, mapping).referencedSteps).toEqual(["01J8XKRD"]);
  });
});

describe("근거는 매뉴얼 항목만 밝힌다", () => {
  it("kb- 항목만 센다 — 사건 정보와 전사는 지식베이스가 아니다", () => {
    expect(sourceNote(answer.citations!)).toBe("피해구제 신청서 제출");
  });

  it("kb- 가 없으면 아무 말도 하지 않는다", () => {
    expect(sourceNote([{ ref: "case-3", label: "피해구제 신청 기한" }])).toBeNull();
  });

  it("인용이 없어도 던지지 않는다", () => {
    expect(sourceNote([])).toBeNull();
  });
});

describe("되묻기는 에러가 아니다", () => {
  const asking: ChatResponse = {
    message_id: "01J8XKRF",
    reply: "정확한 안내를 위해 하나만 확인하겠습니다.",
    citations: [],
    next_question: {
      slot_key: "channel",
      text: "어떻게 보내셨나요?",
      input: "buttons",
      options: ["계좌이체", "간편송금", "모름·기억 안 남"],
    },
  };

  it("질문을 그대로 넘긴다", () => {
    expect(toTurn(asking, []).question?.slot_key).toBe("channel");
  });

  it("「모름」 선택지를 지우지 않는다", () => {
    const got = toTurn(asking, []);
    expect(got.question?.options).toContain("모름·기억 안 남");
  });

  it("질문이 없으면 null 이다 — 실행 보드는 그대로 열린다", () => {
    expect(toTurn(answer, mapping).question).toBeNull();
  });
});

describe("발화도 경계를 지나서 나간다", () => {
  it("계좌가 든 발화가 그대로 나가지 않는다", () => {
    const got = outgoing("352-0987-654321 로 보냈어요");
    expect(got.content).not.toContain("352-0987-654321");
    expect(got.added.length).toBeGreaterThan(0);
  });

  it("가릴 것이 없으면 그대로 나간다", () => {
    expect(outgoing("이제 뭘 해야 하나요").content).toBe("이제 뭘 해야 하나요");
  });
});
