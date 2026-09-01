/**
 * @vitest-environment jsdom
 */

/**
 * `Workspace` 상호작용 시험 — **못 낸 부산물을 낸 것처럼 보이게 하지 않는가.**
 *
 * 계약: spec/common/08-14-api.md §3.8 · §3.1(에러) · CLAUDE.md 불변 규칙 6
 *
 * ⚠️ **전송이 실패해도 입력칸만 비고 화면에는 아무 표시가 없었습니다.**
 * 통화 중 받아 적은 접수번호를 냈는데 요청이 실패하면, 입력칸은 비워지고 오류도
 * 판정도 안 떴습니다. 사용자는 기록됐다고 믿지만 단계는 안 끝나고, `after` 로
 * 묶인 다음 단계와 기한도 안 열립니다. 다시 보내려 해도 **적어 둔 번호가 이미
 * 화면에서 사라진 뒤**입니다.
 *
 * `artifact.ts` 는 그 반대를 계약으로 적어 두고 있었습니다 — *"낸 것을 지우지
 * 않습니다. 사용자가 적은 번호는 입력칸에 남습니다."* 그 약속을 지키는 자리가
 * 여기입니다. 사건 화면도 같은 말을 사용자에게 합니다("적던 접수번호가
 * 사라지지 않습니다").
 *
 * 렌더만으로는 못 봅니다 — 적고 → 누르고 → 실패하고 → 칸이 어떻게 되나는
 * 상태가 옮겨가는 것이라 `renderToStaticMarkup` 밖입니다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "./workspace";
import type { FullStep } from "./workspace";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const STEP = {
  step_id: "01JSTEP",
  seq: 1,
  state: "not_started",
  title: "112에 신고합니다",
  body: {
    action: "call",
    summary: "112는 24시간 받습니다.",
    steps: [{ text: "끊기 전에 사건접수번호를 받아 적으세요.", action: "write" }],
    required_artifact: { kind: "receipt_no", label: "사건접수번호" },
  },
} as unknown as FullStep;

const PASSED = {
  artifact_id: "01JART",
  verify_level: "L1",
  verify_result: "passed",
  step_state: "done_verified",
} as const;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = (ui: React.ReactElement) => {
  act(() => {
    root.render(ui);
  });
};

const field = () =>
  [...host.querySelectorAll("input")].find((one) => one.type !== "file") as HTMLInputElement;

const button = (label: string) =>
  [...host.querySelectorAll("button")].find((one) => one.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined;

const write = (text: string) => {
  const input = field();
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

/** 접수번호를 내는 버튼 (`ArtifactSlot`) */
const submitButton = () => button("입력");

const press = async (one: HTMLButtonElement | undefined) => {
  await act(async () => {
    one?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
};

describe("못 낸 것을 낸 것처럼 보이게 하지 않는다 — §3.8 · §3.1", () => {
  it("낸 값이 그대로 나간다", async () => {
    const onSubmit = vi.fn(async () => PASSED);
    draw(<Workspace step={STEP} onSubmit={onSubmit} />);

    write("2026-004512");
    await press(submitButton());

    expect(onSubmit).toHaveBeenCalledWith("01JSTEP", {
      kind: "receipt_no",
      value: "2026-004512",
    });
  });

  it("**실패하면 적은 번호가 입력칸에 남는다** — 다시 보내는 것은 사용자가 합니다", async () => {
    // 못 냈을 때 훅은 `null` 을 돌려줍니다 (`artifact.ts` 의 `submit`)
    const onSubmit = vi.fn(async () => null);
    draw(<Workspace step={STEP} onSubmit={onSubmit} />);

    write("2026-004512");
    await press(submitButton());

    expect(field().value).toBe("2026-004512");
  });

  it("냈으면 그때 비운다 — 같은 번호를 두 번 내지 않게", async () => {
    const onSubmit = vi.fn(async () => PASSED);
    draw(<Workspace step={STEP} onSubmit={onSubmit} />);

    write("2026-004512");
    await press(submitButton());

    expect(field().value).toBe("");
  });

  it("**실패를 화면이 말한다** — 아무 표시도 없으면 저장된 줄 압니다", async () => {
    draw(
      <Workspace
        step={STEP}
        onSubmit={async () => null}
        fail={{ retryable: true, message: "잠시 뒤 다시 시도해 주세요." }}
      />,
    );

    const alert = host.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("잠시 뒤 다시 시도해 주세요.");
  });
});
