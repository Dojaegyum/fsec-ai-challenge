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

import ChatView, { MiniChat, QuestionBlock } from "./chat";
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
  confirmAnswer: nothing,
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
  absorb: async () => true,
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
    const text = textOf(renderToStaticMarkup(<MiniChat chat={chatOf()} token="T" />));
    expect(text).toContain("돈이 실제로 빠져나갔나요?");
    expect(text).toContain("네, 돈이 나갔어요");
  });

  it("하드코딩된 목업 대사가 남아 있지 않다", () => {
    const text = textOf(renderToStaticMarkup(<MiniChat chat={chatOf()} token="T" />));
    // 「다음은 피해구제 신청입니다. 8월 20일까지요」가 박혀 있었습니다 —
    // **화면이 날짜를 만들지 않습니다** (불변 규칙 7)
    expect(text).not.toContain("8월 20일");
    expect(text).not.toContain("뭐부터 하면 돼요");
  });

  it("주고받은 말을 그대로 그린다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <MiniChat chat={chatOf({ lines: [{ who: "me", text: "카카오페이로 보냈어요" }] })} token="T" />,
      ),
    );
    expect(text).toContain("카카오페이로 보냈어요");
  });

  it("보내는 중에는 무엇을 하는지 문장으로 말한다 — 점 3개를 쓰지 않습니다", () => {
    const text = textOf(
      renderToStaticMarkup(<MiniChat chat={chatOf({ sending: true })} token="T" />),
    );
    expect(text).not.toContain("...");
    expect(text.length).toBeGreaterThan(10);
  });

  it("못 보냈으면 말한다 — 스스로 다시 보내지 않습니다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <MiniChat
          token="T"
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

/**
 * 증거에서 뽑힌 상대 계좌의 되묻기 — 서버는 토큰까지만 내고, 번호는 이 브라우저가 되살립니다 (ADR-069).
 * 토큰 글자만 보이면 사용자가 「맞아요」를 판단할 수 없습니다.
 */
describe("되묻기 문구의 토큰은 브라우저가 되살린다 — ADR-069", () => {
  const confirmAccount: NextQuestion = {
    slot_key: "counterpart_account",
    text: "올린 자료에서 찾은 받는 쪽 계좌입니다: [계좌-2]. 맞나요?",
    // 되묻기는 제 `input` 을 갖습니다 — 그림은 버튼과 같고 답만 뜻으로 갑니다 (ADR-082)
    input: "confirm",
    options: ["맞아요", "아니에요, 다시 적을게요", "모름·기억 안 남"],
  };

  it("**선택지를 그린다** — `confirm` 도 버튼과 같은 모양이다 (ADR-082)", () => {
    // 안 그리면 되묻기 문항에 답할 수단이 없어 그 슬롯이 영영 `extracted` 로 남습니다
    const html = renderToStaticMarkup(
      <QuestionBlock ask={askOf({ question: confirmAccount })} onAnswered={() => {}} i={0} />,
    );
    const text = textOf(html);
    expect(text).toContain("맞아요");
    expect(text).toContain("아니에요, 다시 적을게요");
    expect(text).toContain("모름·기억 안 남");
  });

  it("복원 목록이 있으면 번호로 보인다", () => {
    const html = renderToStaticMarkup(
      <QuestionBlock
        ask={askOf({ question: confirmAccount })}
        restorable={[{ token: "[계좌-2]", original: "110-234-567890" }]}
        onAnswered={() => {}}
        i={0}
      />,
    );
    expect(textOf(html)).toContain("110-234-567890");
    expect(textOf(html)).not.toContain("[계좌-2]");
  });

  it("복원 목록이 없으면 토큰 그대로 — 지어내지 않는다", () => {
    const html = renderToStaticMarkup(
      <QuestionBlock ask={askOf({ question: confirmAccount })} onAnswered={() => {}} i={0} />,
    );
    expect(textOf(html)).toContain("[계좌-2]");
  });
});

describe("컴포저 받침은 바닥색을 칠하지 않는다 — 호라이즌 위의 직사각형", () => {
  it("배경 흐림과 마스크로 받치고, --ground 를 칠하지 않는다", () => {
    // 2026-09-06 사용자 지적 — 화면 바닥엔 HorizonGlow 가 깔려 있어, 컴포저 뒤에
    // 바닥색을 칠하면 열 너비의 어두운 직사각형 테두리가 글로우 위에 드러납니다.
    // 흐림은 매끈한 글로우를 그대로 두고 지나가는 말풍선만 눅입니다
    const html = renderToStaticMarkup(
      <ChatView atWork={false} token={null} chat={chatOf()} onPickChoice={() => {}} />,
    );
    const composer = html.match(/<div class="([^"]*sticky[^"]*)"/)?.[1] ?? "";
    expect(composer).toContain("backdrop-blur");
    expect(composer).toContain("mask");
    expect(composer).not.toContain("var(--ground)");
  });
});

/**
 * 인용 꼬리말 — **조사가 제목에 붙어 「합니다을」이 되던 것.**
 *
 * ⚠️ 2026-09-06 접수 전 점검에서 「112에 신고합니다을 보고 안내했습니다」가
 * 화면에 그대로 떴습니다. 조사는 앞 글자의 받침에 따라 달라지는데 매뉴얼 제목은
 * KB 가 정합니다 — 그래서 제목을 **따옴표로 감싸**(`chat-handler` 의 `sourceNote`)
 * 조사가 제목에 붙지 않게 합니다.
 */
describe("인용 꼬리말은 제목을 따옴표로 감싼다 — 조사가 붙지 않게", () => {
  const answered = (sourceNote: string | null) =>
    textOf(
      renderToStaticMarkup(
        <MiniChat
          chat={chatOf({
            lines: [
              {
                who: "ai",
                message_id: "01MSG",
                reply: "지급정지를 먼저 거세요.",
                question: null,
                sourceNote,
                referencedSteps: [],
              },
            ],
          })}
          token="T"
        />,
      ),
    );

  it("제목 뒤에 「를」이 온다", () => {
    const text = answered("「112에 신고합니다」");
    expect(text).toContain("「112에 신고합니다」를 보고 안내했습니다");
    expect(text).not.toContain("합니다을");
  });

  it("근거가 없으면 그 줄 자체가 없다", () => {
    expect(answered(null)).not.toContain("보고 안내했습니다");
  });
});
