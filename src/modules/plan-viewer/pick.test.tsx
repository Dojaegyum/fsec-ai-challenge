/**
 * 보드에서 눌러 여는 자리 — **키보드로도 열려야 합니다.**
 *
 * 이 서비스는 마우스를 못 쓰는 사람도 씁니다. 줄 전체를 누르는 자리로 만들면
 * 손가락에는 편하지만 키보드에는 안 보입니다 — `role`·`tabIndex` 가 그것을 막습니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlanBoard } from "./index";
import type { PlanStep } from "./types";

const STEPS: readonly PlanStep[] = [
  {
    step_id: "01JA",
    seq: 1,
    title: "112에 신고합니다",
    state: "not_started",
    actor: "victim",
    body: { after: [], step_key: "report-112" },
  } as unknown as PlanStep,
];

describe("누를 수 있는 줄", () => {
  it("**넘기지 않으면 안 눌립니다** — 그냥 목록입니다", () => {
    const html = renderToStaticMarkup(<PlanBoard steps={STEPS} />);
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("tabindex");
  });

  it("넘기면 키보드로도 닿는 자리가 된다", () => {
    const html = renderToStaticMarkup(<PlanBoard steps={STEPS} onPickStep={() => {}} />);
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
  });
});
