/**
 * `Workspace` 렌더 시험 — **부산물을 낼 자리가 실제로 그려지는가.**
 *
 * 2026-08-26 까지 이 자리가 없어서 완료 판정이 시작되지 못했습니다. 패널은
 * 있었지만 시안 값을 하드코딩했고 버튼에 동작이 없었습니다. 그래서 이 시험은
 * **「서버가 준 것이 그려지는가」와 「낼 자리가 있는가」** 둘을 겨눕니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Workspace } from "./workspace";
import type { FullStep } from "./workspace";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const step = (over: Partial<FullStep> = {}): FullStep =>
  ({
    step_id: "01JSTEP",
    seq: 1,
    state: "not_started",
    title: "112에 신고합니다",
    body: {
      action: "call",
      summary: "112는 24시간 받습니다.",
      steps: [
        { text: "112로 전화해 신고합니다.", action: "call", contact: "112" },
        { text: "끊기 전에 사건접수번호를 받아 적으세요.", action: "write" },
      ],
      required_artifact: { kind: "receipt_no", label: "사건접수번호" },
      ...(over.body ?? {}),
    },
    ...over,
  }) as FullStep;

const draw = (props: Partial<Parameters<typeof Workspace>[0]> = {}) =>
  renderToStaticMarkup(<Workspace step={step()} onSubmit={() => {}} {...props} />);

describe("서버가 준 것을 그립니다 — 화면이 지어내지 않습니다", () => {
  it("KB 의 요약과 줄이 그대로 나온다", () => {
    const text = textOf(draw());
    expect(text).toContain("112는 24시간 받습니다.");
    expect(text).toContain("112로 전화해 신고합니다.");
    expect(text).toContain("끊기 전에 사건접수번호를 받아 적으세요.");
  });

  it("부산물 이름은 `required_artifact` 에서 온다", () => {
    expect(textOf(draw())).toContain("사건접수번호");
  });

  it("전화번호는 서버가 `contact_ref` 를 푼 값이다", () => {
    expect(textOf(draw())).toContain("112");
  });
});

describe("어떤 패널을 여는가 — `body.action` 하나가 정합니다", () => {
  const eyebrowOf = (action: string) =>
    textOf(draw({ step: step({ body: { action } } as Partial<FullStep>) }));

  it("`call` 은 통화 패널", () => {
    expect(eyebrowOf("call")).toContain("통화");
  });

  it("`upload` 는 제출 패널", () => {
    expect(eyebrowOf("upload")).toContain("제출");
  });

  it("`wait` 는 기다리기 패널", () => {
    expect(eyebrowOf("wait")).toContain("기다리기");
  });

  it("**표 밖이면 아무것도 안 그린다** — 모르는 것을 「읽기만 하면 되는 것」으로 바꾸지 않습니다", () => {
    // 서버가 새 `action` 을 추가했는데 화면이 아직 모르는 경우입니다.
    // `WS-read` 로 떨어뜨리면 해야 할 일을 안 해도 되는 것처럼 보입니다
    expect(draw({ step: step({ body: { action: "sign" } } as Partial<FullStep>) })).toBe("");
  });

  it("`action` 이 아예 없으면 안 그린다", () => {
    expect(draw({ step: step({ body: {} } as Partial<FullStep>) })).toBe("");
  });

  it("열린 단계가 없으면 안 그린다", () => {
    expect(draw({ step: null })).toBe("");
  });
});

describe("부산물을 낼 자리 — 셋을 늘 함께 냅니다", () => {
  it("접수번호 칸과 「했다고 표시」는 늘 있다", () => {
    const html = draw();
    expect(html).toContain('placeholder="접수번호"');
    expect(textOf(html)).toContain("번호 없이 했다고 표시");
  });

  it("**파일 올리기는 낼 자리가 있을 때만** 그린다", () => {
    // 개발 경로(`?view=`)에는 사건 토큰이 없어 올릴 곳이 없습니다
    expect(textOf(draw())).not.toContain("접수증·캡처 올리기");
    expect(textOf(draw({ onPickFile: () => {} }))).toContain("접수증·캡처 올리기");
  });

  it("보내는 중에는 버튼이 잠긴다 — 두 번 눌러 두 줄이 남지 않게", () => {
    const html = draw({ onPickFile: () => {}, busy: true });
    expect(html).toContain("disabled");
    expect(textOf(html)).toContain("올리는 중…");
  });
});

describe("판정을 그립니다 — L1 실패가 막다른 길이 아닙니다", () => {
  it("실패하면 서버가 준 다음 길을 그대로 보여준다", () => {
    const text = textOf(
      draw({
        verdict: {
          verify_result: "failed",
          step_state: "in_progress",
          next_options: [
            { level: "L2", label: "접수 문자 캡처를 올려주세요" },
            { level: "L3", label: "번호 없이 접수했다고 표시" },
          ],
        },
      }),
    );
    expect(text).toContain("접수 문자 캡처를 올려주세요");
    expect(text).toContain("번호 없이 접수했다고 표시");
  });

  it("`unconfirmed` 는 완료가 아니라고 말한다", () => {
    const text = textOf(
      draw({ verdict: { verify_result: "not_applicable", step_state: "unconfirmed" } }),
    );
    expect(text).toContain("아직 완료로 기록하지 않았습니다");
  });

  it("**끝났으면 열린 단계를 함께 보여준다** — 증거 연쇄가 눈에 보여야 합니다", () => {
    const text = textOf(
      draw({
        verdict: {
          verify_result: "passed",
          step_state: "done_verified",
          unlocked_steps: [{ step_id: "01JNEXT", title: "피해구제를 신청합니다" }],
        },
      }),
    );
    expect(text).toContain("이 단계는 끝났습니다");
    expect(text).toContain("피해구제를 신청합니다");
  });
});
