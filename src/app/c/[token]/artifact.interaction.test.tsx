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

import { L2_NOTES } from "@/modules/completion-checker/notes";

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

/**
 * 안내가 **판독 결과를 따라가는가** — §3.6 `artifacts[].verify_reason`.
 *
 * ⚠️ **2026-09-06 점검 — 패널이 「올린 자료를 읽는 중입니다」에 굳었습니다.**
 * 파일을 부산물로 내면 그 순간에는 아직 읽는 중이라 서버가 `reading_pending`
 * 으로 답하고, 판독이 끝나면 **서버가 다시 판정합니다**(ADR-077). 그런데 화면은
 * 낼 때 받은 `note` 만 들고 있어, 판정이 바뀐 뒤에도 같은 말을 했습니다 —
 * 사용자는 무엇을 더 해야 완료가 되는지 알 방법이 없었습니다.
 */
describe("안내는 판독 결과를 따라간다", () => {
  /** 파일을 냈을 때의 첫 응답 — 아직 읽는 중입니다 */
  const stubReadingPending = () =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              artifact_id: "01JART",
              verify_level: "L2",
              verify_result: "not_applicable",
              verify_detail: { reason: "reading_pending" },
              step_state: "unconfirmed",
              note: L2_NOTES.reading_pending,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

  const sendFile = async () => {
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      await hookNow().submit("01STEP-A", { kind: "receipt_doc", evidenceId: "01EV" });
    });
  };

  it("업로드 응답의 안내는 판독이 끝나면 단계의 verify_reason 으로 바뀐다", async () => {
    stubReadingPending();
    await sendFile();
    expect(hookNow().note).toBe(L2_NOTES.reading_pending);

    act(() =>
      hookNow().settle({
        step_id: "01STEP-A",
        state: "unconfirmed",
        artifacts: [{ verify_reason: "no_receipt_marks" }],
      }),
    );

    expect(hookNow().note).toBe(L2_NOTES.no_receipt_marks);
  });

  it("단계가 완료로 바뀌면 안내를 지운다 — 할 일이 없습니다", async () => {
    stubReadingPending();
    await sendFile();

    act(() =>
      hookNow().settle({
        step_id: "01STEP-A",
        state: "done_verified",
        artifacts: [{ verify_reason: "receipt_number_found" }],
      }),
    );

    expect(hookNow().note).toBeNull();
  });

  it("**다른 단계의 소식은 안 받습니다** — 남의 판정을 이 단계에 붙이지 않습니다", async () => {
    stubReadingPending();
    await sendFile();

    act(() =>
      hookNow().settle({
        step_id: "01STEP-B",
        state: "unconfirmed",
        artifacts: [{ verify_reason: "not_a_document" }],
      }),
    );

    expect(hookNow().note).toBe(L2_NOTES.reading_pending);
  });

  it("표에 없는 이유면 안내를 지웁니다 — 지어내지 않습니다", async () => {
    stubReadingPending();
    await sendFile();

    act(() =>
      hookNow().settle({
        step_id: "01STEP-A",
        state: "unconfirmed",
        artifacts: [{ verify_reason: "format_unchecked" }],
      }),
    );

    expect(hookNow().note).toBeNull();
  });

  it("걷어내면 안내도 함께 사라진다", async () => {
    stubReadingPending();
    await sendFile();

    act(() => hookNow().clear());

    expect(hookNow().note).toBeNull();
  });
});
