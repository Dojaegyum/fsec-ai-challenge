/**
 * 할 일 레일 시험 — ADR-063 로 플랜 보드가 왼쪽 레일이 되면서 지켜야 할 것들.
 *
 * **여기서 못 박는 것 넷:**
 * 1. 지금 카드가 진행 중 단계 하나를 말한다 — 「다음 것」을 지어내지 않는다
 * 2. D-day 는 서버 값(`days_left`)이 있을 때만 그린다 — 화면이 날짜를 세지 않는다
 * 3. `unconfirmed` 는 완료가 아니라 「증빙 대기」다 (불변 규칙 6 · 어휘 정본 tagOf)
 * 4. 챗이 가리킨 단계(`activeStepId`)가 강조된다 — 「채팅 상황에 맞는」의 뜻
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { Deadline } from "@/modules/deadline-viewer";
import type { PlanStep } from "@/modules/plan-viewer";

import { FIXTURE_BUNDLE } from "./fixtures";
import TodoRail from "./todo";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const steps = FIXTURE_BUNDLE.steps as readonly PlanStep[];
const deadlines = FIXTURE_BUNDLE.deadlines as readonly Deadline[];

const draw = (over: Partial<Parameters<typeof TodoRail>[0]> = {}) =>
  renderToStaticMarkup(
    <TodoRail steps={steps} deadlines={deadlines} activeStepId={null} {...over} />,
  );

describe("지금 카드 — 이 레일의 첫 줄이 「지금 뭘 해야 하나」의 답입니다", () => {
  it("진행 중 단계 하나를 말한다", () => {
    expect(textOf(draw())).toContain("피해구제 신청서 제출");
  });

  /**
   * ⚠️ **진행 중이 없다고 「기다리는 구간」이 아닙니다** (2026-09-03). 갓 만든
   * 사건은 단계가 전부 not_started 이고 in_progress 는 접수번호 검증 실패에서만
   * 생깁니다 — 그때 「지금 하실 일 없음」이 뜨면 막 신고를 마치고 들어온 사람이
   * 첫 줄로 그걸 읽습니다. 히어로·헤더 배지와 같은 판정(`currentStep`)입니다.
   */
  it("진행 중이 없어도 남은 단계 중 앞선 것을 가리킨다", () => {
    const fresh = steps.map((s) =>
      s.state === "in_progress" ? { ...s, state: "not_started" as const } : s,
    );
    const text = textOf(draw({ steps: fresh }));
    // 남은 것이 있으니 「기다리는 구간」이 아니라 그 단계를 말합니다
    expect(text).not.toContain("기다리는 구간입니다");
    expect(text).not.toContain("지금 하실 일 없음");
  });

  it("정말로 남은 것이 없을 때만 「기다리는 구간」", () => {
    const allDone = steps.map((s) =>
      s.state === "skipped" ? s : { ...s, state: "done_verified" as const },
    );
    expect(textOf(draw({ steps: allDone }))).toContain("기다리는 구간입니다");
  });
});

describe("D-day — 서버가 센 값만 그립니다 (불변 규칙 7)", () => {
  it("`days_left` 가 없으면 D-day 를 안 그린다", () => {
    // 픽스처 기한에는 days_left 가 없습니다 — 그러면 배지도 없어야 합니다
    expect(textOf(draw())).not.toMatch(/D-\d/);
  });

  it("`days_left` 가 오면 그 값 그대로", () => {
    const withDays = deadlines.map((d) =>
      d.kind === "primary" ? { ...d, days_left: 2 } : d,
    );
    expect(textOf(draw({ deadlines: withDays }))).toContain("D-2");
  });
});

describe("상태 어휘 — §S-07 그대로", () => {
  // 낱말은 plan-viewer(tagOf)가 정본 — 「확인 필요」는 2026-08-23 에 피한 「미확인」
  // 계열이라 레일이 되살렸던 것을 2026-09-03 에 되돌렸습니다 (감사 F5)
  it("`unconfirmed` 는 「증빙 대기」다 — 완료가 아닙니다 (불변 규칙 6)", () => {
    const one = steps.map((s, i) => (i === 0 ? { ...s, state: "unconfirmed" as const } : s));
    const text = textOf(draw({ steps: one }));
    expect(text).toContain("증빙 대기");
    expect(text).not.toContain("확인 필요");
  });

  it("`done_verified` 는 「증빙됨」", () => {
    expect(textOf(draw())).toContain("증빙됨");
  });
});

describe("채팅 상황을 따라간다", () => {
  it("`activeStepId` 단계가 강조된다", () => {
    const html = draw({ activeStepId: "m3" });
    expect(html).toContain('aria-current="step"');
  });

  it("`onPickStep` 이 없으면 안 눌린다", () => {
    expect(draw()).toContain("disabled");
  });
});

describe("출구 — 있을 때만 그립니다", () => {
  it("「무엇을 적는지 보기」는 onOpenDoc 이 올 때만 (ADR-042)", () => {
    expect(textOf(draw())).not.toContain("무엇을 적는지 보기");
    expect(textOf(draw({ onOpenDoc: () => {} }))).toContain("무엇을 적는지 보기");
  });
});
