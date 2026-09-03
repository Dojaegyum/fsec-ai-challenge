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

  /**
   * 「언제든」 판정은 보드(plan.tsx)와 같아야 합니다 — **모든 종류의 기한**을
   * 봅니다. 본 기한(primary)만 보면 추가 기간(grace)만 붙은 단계가 「언제든」이
   * 되는데, 추가 기간 시계가 도는 단계에 「언제든」은 틀린 안내입니다
   * (2026-09-03 검증 발견 — 판정이 두 벌로 갈라졌던 것).
   */
  it("추가 기간(grace)만 붙은 단계는 「언제든」이 아니다", () => {
    // m3 의 primary 를 지워 m3 에는 grace 만 남기고, **다른 단계는 전부
    // 끝난 것으로** — 남는 상태 태그가 m3 것 하나뿐이어야 단언이 그 행을 봅니다
    // (기한 없는 not_started 단계는 정당하게 「언제든」을 답니다)
    const graceOnly = deadlines.filter((d) => d.kind !== "primary");
    const only3 = steps.map((s) =>
      s.step_id === "m3"
        ? { ...s, state: "not_started" as const }
        : { ...s, state: "done_verified" as const },
    );
    const text = textOf(draw({ steps: only3, deadlines: graceOnly }));
    expect(text).not.toContain("언제든");
    expect(text).toContain("미시작");
  });

  /**
   * now 인데 그릴 D-day 가 없으면(기한 없는 단계가 검증 실패로 in_progress)
   * 「지금 차례」 — 비워 두면 이 행만 읽히는 상태 글자가 없어집니다
   * (2026-09-03 검증 발견).
   */
  it("진행 중 + 기한 없음이면 「지금 차례」가 읽힌다", () => {
    // m1(기한 없는 단계)을 in_progress 로 — 픽스처 기한은 전부 m3 소속입니다
    const running = steps.map((s) =>
      s.step_id === "m1"
        ? { ...s, state: "in_progress" as const }
        : s.state === "in_progress"
          ? { ...s, state: "not_started" as const }
          : s,
    );
    expect(textOf(draw({ steps: running }))).toContain("지금 차례");
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
