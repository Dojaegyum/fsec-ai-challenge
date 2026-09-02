/**
 * @vitest-environment jsdom
 */

/**
 * 부산물 판정 꼬리표 시험 — **판정이 어느 단계의 것인지 아는가.**
 *
 * ⚠️ 한 단계를 완료하면 워크스페이스가 다음 단계로 넘어가는데, **아직 아무것도
 * 안 한 그 단계 아래에** 「확인했습니다. 이 단계는 끝났습니다」가 그대로 떠
 * 있었습니다. 판정에 단계 꼬리표가 없어 부르는 쪽이 거를 수 없었기 때문입니다.
 */

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useArtifact } from "./artifact";
import type { ArtifactSend } from "./artifact";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

let host: HTMLDivElement;
let root: Root;
const seen: { now: ArtifactSend | null } = { now: null };
const hookNow = () => seen.now as ArtifactSend;

function Probe() {
  const now = useArtifact(TOKEN);
  useEffect(() => {
    seen.now = now;
  });
  return null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("판정은 자기 단계에만 붙는다", () => {
  it("낸 단계의 번호가 판정에 딸려 온다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              artifact_id: "01JART",
              verify_level: "L1",
              verify_result: "passed",
              step_state: "done_verified",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await act(async () => {
      root.render(<Probe />);
    });

    await act(async () => {
      await hookNow().submit("01STEP-A", { kind: "receipt_no", value: "2026-1234" });
    });

    expect(hookNow().verdict?.verify_result).toBe("passed");
    expect(hookNow().verdictStepId).toBe("01STEP-A");
  });

  it("걷어내면 꼬리표도 함께 사라진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              artifact_id: "01JART",
              verify_level: "L1",
              verify_result: "passed",
              step_state: "done_verified",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      await hookNow().submit("01STEP-A", { kind: "receipt_no", value: "2026-1234" });
    });

    act(() => hookNow().clear());

    expect(hookNow().verdict).toBeNull();
    expect(hookNow().verdictStepId).toBeNull();
  });
});
