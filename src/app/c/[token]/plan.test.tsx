/**
 * 사건 진행 레일 렌더 시험 — **아무것도 안 했는데 칠해져 있던 것**을 막습니다.
 *
 * 계약: spec/frontend/08-14-screens.md §S-07 「사건 진행 레일」·「단계 상태 어휘 — 여섯」
 * 근거: CLAUDE.md 불변 규칙 6(완료는 부산물이 판정) · 불변 규칙 7(화면이 날짜를 세지 않는다)
 *
 * ⚠️ **2026-08-27 까지 레일이 손으로 적은 상수였습니다.** 「지급정지」에 `"done"` 이
 * 박혀 있어 **진입 직후에도 첫 칸이 칠해졌고**, 상태를 색으로만 갈라 §S-07 의
 * *"색 하나로 가르지 않습니다"* 를 이 레일만 어기고 있었습니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PlanStep } from "@/modules/plan-viewer";

import PlanView from "./plan";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** §3.6 의 단계 한 줄. `body.step_key` 가 레일 칸에 걸리는 열쇠입니다 */
const stepOf = (stepKey: string, state: PlanStep["state"], seq = 10): PlanStep => ({
  step_id: `s-${stepKey}`,
  seq,
  title: `${stepKey} 단계`,
  state,
  conditional: null,
  body: { step_key: stepKey, action: "call" },
});

/** 사건을 막 만든 직후 — T0 공통 단계가 붙지만 **아무것도 안 했습니다** */
const FRESH: readonly PlanStep[] = [
  stepOf("report-112", "not_started", 10),
  stepOf("freeze-request", "not_started", 20),
  stepOf("relief-apply", "not_started", 30),
  stepOf("relief-documents", "not_started", 40),
  stepOf("debt-extinction-notice", "not_started", 50),
];

const draw = (steps: readonly PlanStep[]) =>
  renderToStaticMarkup(<PlanView steps={steps} deadlines={[]} />);

/**
 * 레일 부분만 잘라 냅니다.
 *
 * **아래 단계 목록과 섞이면 시험이 거짓으로 통과합니다** — 보드도 「증빙됨」을 쓰는데,
 * 그건 단계의 태그이지 레일 칸의 상태가 아닙니다. 보드의 머리글(`할 일`)에서 끊습니다.
 */
const railOf = (steps: readonly PlanStep[]) => {
  const text = textOf(draw(steps));
  const from = text.indexOf("사건 진행");
  expect(from).toBeGreaterThanOrEqual(0);
  const rest = text.slice(from);
  const to = rest.indexOf("할 일");
  return to > 0 ? rest.slice(0, to) : rest;
};

describe("아무것도 안 했으면 아무 칸도 안 칠해진다", () => {
  it("갓 만든 사건에 「증빙됨」이 하나도 없다", () => {
    // **이것이 그날의 결함입니다** — 「지급정지 = 완료」가 상수로 박혀 있었습니다
    expect(railOf(FRESH)).not.toContain("증빙됨");
  });

  it("단계가 아예 없어도 칠하지 않는다", () => {
    expect(railOf([])).not.toContain("증빙됨");
    expect(railOf([])).not.toContain("지금 차례");
  });
});

describe("칸의 상태는 단계에서 유도한다 — §S-07", () => {
  it("진행 중인 단계가 있으면 그 칸이 「지금 차례」다", () => {
    const rail = railOf([stepOf("freeze-request", "in_progress", 20)]);
    expect(rail).toContain("지금 차례");
  });

  it("부산물이 판정한 단계만 「증빙됨」이다", () => {
    expect(railOf([stepOf("freeze-request", "done_verified", 20)])).toContain("증빙됨");
  });

  it("「증빙 대기」(자기 신고)는 증빙됨이 아니다 — 불변 규칙 6", () => {
    // 사용자가 했다고만 말한 것은 완료가 아닙니다. 부산물이 판정합니다
    expect(railOf([stepOf("freeze-request", "unconfirmed", 20)])).not.toContain("증빙됨");
  });

  it("건너뛴 단계는 지우지 않고 「해당 없음」으로 둔다 — 왜 없는지가 정보입니다", () => {
    expect(railOf([stepOf("debt-extinction-notice", "skipped", 50)])).toContain("해당 없음");
  });

  it("피해구제는 둘 다 끝나야 증빙됨이다", () => {
    const half = railOf([
      stepOf("relief-apply", "done_verified", 30),
      stepOf("relief-documents", "not_started", 40),
    ]);
    expect(half).not.toContain("증빙됨");
  });
});

describe("칸은 넷이고 「환급」은 늘 미시작이다", () => {
  it("네 국면이 전부 있다", () => {
    const rail = railOf(FRESH);
    for (const label of ["지급정지", "피해구제", "공고 2개월", "환급"]) {
      expect(rail).toContain(label);
    }
  });

  it("탈락한 시안의 「결정」 칸은 없다", () => {
    // 기관이 하는 일이라 KB 에 단계가 없습니다 — 영영 미시작으로 남을 칸입니다
    expect(railOf(FRESH)).not.toMatch(/(^|[\s·])결정([\s·]|$)/);
  });
});

describe("색 하나로 가르지 않는다 — §S-07", () => {
  it("기호와 태그가 함께 간다", () => {
    const rail = railOf([stepOf("freeze-request", "done_verified", 20)]);
    // 색을 못 보는 사람도 상태를 읽을 수 있어야 합니다
    expect(rail).toMatch(/✓|→|○|—/);
    expect(rail).toContain("증빙됨");
  });

  it("무엇을 보는 줄인지 말한다 — 진행률로 읽히지 않게", () => {
    expect(railOf(FRESH)).toContain("절차의 전체 흐름");
  });

  it("빨강을 쓰지 않는다", () => {
    expect(draw(FRESH)).not.toMatch(/text-red|bg-red|border-red/);
  });
});

describe("화면이 날짜를 세지 않는다 — 불변 규칙 7", () => {
  it("기한이 하나도 없으면 D-day 를 만들지 않는다", () => {
    // 서버가 `days_left` 를 안 주면 배지가 통째로 안 뜹니다
    expect(textOf(draw(FRESH))).not.toMatch(/D-\d/);
  });
});

describe("히어로의 주 버튼 둘이 실제로 눌린다", () => {
  const RUNNING: readonly PlanStep[] = [stepOf("freeze-request", "in_progress", 20)];

  it("「지금 하기」가 그 단계를 연다", () => {
    // 2026-08-27 까지 이 버튼에 핸들러가 없었습니다 — 화면에서 가장 크게 읽히는
    // 버튼인데 눌러도 아무 일이 없었습니다
    let picked: string | null = null;
    const html = renderToStaticMarkup(
      <PlanView
        steps={RUNNING}
        deadlines={[]}
        onPickStep={(id) => {
          picked = id;
        }}
        onOpenDoc={() => {}}
      />,
    );
    expect(html).toContain("지금 하기");
    expect(picked).toBeNull(); // 렌더만으로는 안 눌립니다
  });

  it("문을 안 넘기면 **그 버튼을 아예 안 그린다** — 비활성 버튼보다 없는 편이 낫습니다", () => {
    const text = textOf(renderToStaticMarkup(<PlanView steps={RUNNING} deadlines={[]} />));
    // 「무엇을 적는지 보기」는 제출처를 가진 유일한 화면으로 가는 문입니다 (ADR-042).
    // **가리키는 문장도 함께 사라져야** 합니다 — 눌러도 안 열리는 버튼을 가리키면
    // 사용자가 그 첫 줄을 영영 못 찾습니다
    expect(text).not.toContain("무엇을 적는지 보기");
    expect(text).not.toContain("내는 곳은 은행마다 다릅니다");
  });

  it("그 버튼을 가리키는 문장이 함께 있다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <PlanView steps={RUNNING} deadlines={[]} onOpenDoc={() => {}} onPickStep={() => {}} />,
      ),
    );
    // 제출처는 은행마다 다르므로 히어로가 말하지 않습니다 — 대신 그 문을 가리킵니다
    expect(text).toContain("무엇을 적는지 보기");
    expect(text).toContain("내는 곳은 은행마다 다릅니다");
  });
});
