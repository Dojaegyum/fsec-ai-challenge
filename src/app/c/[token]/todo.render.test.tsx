/**
 * 단계 리스트가 열을 넓히지 않는지 — **회귀 방지.**
 *
 * ⚠️ **긴 제목이 왼쪽 열을 넘어 채팅 열을 침범했습니다** (2026-09-03).
 * 원인은 `<ol className="grid">` — 명시적 열이 없는 grid 는 암묵 열을
 * `auto`(max-content)로 잡아, 긴 제목의 `<li>` 가 열 폭이 아니라 제목 길이만큼
 * 자랐습니다. `flex flex-col` 은 자식을 열 폭에 stretch 시켜 truncate 가 실제로
 * 자릅니다. 이 시험은 그 선택이 되돌아가는 것을 막습니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PlanStep } from "@/modules/plan-viewer";

import TodoRail from "./todo";

const LONG = "돈이 빠져나간 금융회사에 지급정지를 요청합니다 그리고 아주 긴 제목이 계속 이어집니다";

const steps: PlanStep[] = [
  { step_id: "s1", seq: 10, state: "not_started", title: LONG, conditional: null, body: { step_key: "freeze-request", action: "call" } },
] as unknown as PlanStep[];

const html = renderToStaticMarkup(
  <TodoRail steps={steps} deadlines={[]} activeStepId={null} onPickStep={() => {}} />,
);

describe("긴 제목은 열을 넓히지 않는다", () => {
  it("단계 리스트가 `grid` 가 아니다 — 암묵 auto 열이 max-content 로 커집니다", () => {
    // `<ol>` 이 grid 면 li 가 제목 길이만큼 자라 옆 열을 침범합니다
    expect(html).not.toMatch(/<ol[^>]*class="[^"]*\bgrid\b/);
    expect(html).toMatch(/<ol[^>]*class="[^"]*flex flex-col/);
  });

  it("제목 줄에 truncate 가 붙어 있다 — 열 폭에서 잘립니다", () => {
    expect(html).toContain("truncate");
  });
});
