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
 *
 * ## 그런데 **낡은 번들로 갈아끼우면 더 나빠집니다** (검토 1회차)
 *
 * `settle` 은 번들이 바뀔 때마다 불립니다. 그런데 부산물을 막 냈을 때의 번들은
 * **그 부산물을 아직 모릅니다** — 서버를 다시 읽는 것은 판독이 끝난 뒤입니다.
 * 그 낡은 번들로 안내를 다시 고르면
 *
 *  · 방금 올린 파일에 **앞 시도의 실패 문구**가 붙거나
 *  · L1·L3 처럼 **판독이 뒤집을 것이 없는 판정**의 말이 일반 문구로 덮입니다.
 *
 * 그래서 `settle` 은 **낸 그 부산물(`artifact_id`)이 번들에 들어왔고, 그 이유가
 * 더 이상 `reading_pending` 이 아닐 때만** 안내를 갈아끼웁니다.
 */
describe("안내는 판독 결과를 따라간다", () => {
  const READING = {
    artifact_id: "A1",
    verify_level: "L2",
    verify_result: "not_applicable",
    verify_detail: { reason: "reading_pending" },
    step_state: "unconfirmed",
    note: L2_NOTES.reading_pending,
  };

  /** L3 「번호 없이 접수했다고 표시」 — `verify_detail` 이 없습니다 */
  const SELF_REPORT = "완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요";
  const SELF_REPORTED = {
    artifact_id: "A9",
    verify_level: "L3",
    verify_result: "not_applicable",
    step_state: "unconfirmed",
    note: SELF_REPORT,
  };

  /** L1 실패 — 다음 길이 함께 옵니다. 판독이 뒤집을 것이 없습니다 */
  const NOT_IDENTIFIER = {
    artifact_id: "A7",
    verify_level: "L1",
    verify_result: "failed",
    verify_detail: { reason: "not_identifier" },
    step_state: "in_progress",
    note: "접수번호로 보이지 않습니다. 받아 적으신 번호를 그대로 적어 주세요",
  };

  const stubVerdict = (body: Record<string, unknown>) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

  /** 부산물 하나를 내고(단계 A) 그 판정을 받습니다 */
  const send = async (
    body: Record<string, unknown>,
    submission: Parameters<ArtifactSend["submit"]>[1] = {
      kind: "receipt_doc",
      evidenceId: "01EV",
    },
  ) => {
    stubVerdict(body);
    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      await hookNow().submit("01STEP-A", submission);
    });
  };

  const stepWith = (
    artifacts: readonly { artifact_id: string; verify_reason: string | null }[],
    state = "unconfirmed",
  ) => ({ step_id: "01STEP-A", state, artifacts });

  it("낸 그 부산물이 아직 읽는 중이면 안내를 그대로 둔다", async () => {
    await send(READING);
    expect(hookNow().note).toBe(L2_NOTES.reading_pending);

    act(() => hookNow().settle(stepWith([{ artifact_id: "A1", verify_reason: "reading_pending" }])));

    expect(hookNow().note).toBe(L2_NOTES.reading_pending);
  });

  it("판독이 끝나 이유가 바뀌면 그 말로 갈아끼운다", async () => {
    await send(READING);

    act(() =>
      hookNow().settle(stepWith([{ artifact_id: "A1", verify_reason: "no_receipt_marks" }])),
    );

    expect(hookNow().note).toBe(L2_NOTES.no_receipt_marks);
  });

  /**
   * ⚠️ **여기가 검토 1회차가 잡은 자리입니다.** 막 냈을 때의 번들은 그 부산물을
   * 아직 모릅니다 — 그 목록의 마지막 줄은 **앞 시도**입니다. 그것으로 갈아끼우면
   * 방금 올린 파일에 앞 시도의 실패 문구가 붙습니다
   */
  it("번들이 아직 낸 부산물을 모르면 아무것도 안 한다 — 앞 시도의 말이 새 파일에 붙지 않게", async () => {
    await send(READING);

    act(() =>
      hookNow().settle(stepWith([{ artifact_id: "A0", verify_reason: "no_receipt_marks" }])),
    );

    expect(hookNow().note).toBe(L2_NOTES.reading_pending);
  });

  it("단계가 완료로 바뀌면 안내를 지운다 — 할 일이 없습니다", async () => {
    await send(READING);

    act(() =>
      hookNow().settle(
        stepWith([{ artifact_id: "A1", verify_reason: "receipt_number_found" }], "done_verified"),
      ),
    );

    expect(hookNow().note).toBeNull();
  });

  it("**L3 자기 신고의 말은 그대로 남는다** — 판독이 뒤집을 것이 없습니다", async () => {
    await send(SELF_REPORTED, { kind: "other", selfReported: true });
    expect(hookNow().note).toBe(SELF_REPORT);

    // 낼 때의 번들(그 부산물을 아직 모르는)로 불려도 그대로입니다
    act(() => hookNow().settle(stepWith([{ artifact_id: "A0", verify_reason: null }])));

    expect(hookNow().note).toBe(SELF_REPORT);
  });

  it("**L1 판정도 안 덮는다** — 번들이 그 부산물을 알게 된 뒤에도", async () => {
    await send(NOT_IDENTIFIER, { kind: "receipt_no", value: "받아적음" });
    expect(hookNow().note).toBe(NOT_IDENTIFIER.note);

    act(() => hookNow().settle(stepWith([{ artifact_id: "A7", verify_reason: "not_identifier" }])));

    expect(hookNow().note).toBe(NOT_IDENTIFIER.note);
  });

  it("**다른 단계의 소식은 안 받습니다** — 남의 판정을 이 단계에 붙이지 않습니다", async () => {
    await send(READING);

    act(() =>
      hookNow().settle({
        step_id: "01STEP-B",
        state: "unconfirmed",
        artifacts: [{ artifact_id: "A1", verify_reason: "not_a_document" }],
      }),
    );

    expect(hookNow().note).toBe(L2_NOTES.reading_pending);
  });

  it("표에 없는 이유면 하던 말을 둔다 — 지어내지도, 지우지도 않습니다", async () => {
    await send(READING);

    act(() =>
      hookNow().settle(stepWith([{ artifact_id: "A1", verify_reason: "format_unchecked" }])),
    );

    expect(hookNow().note).toBe(L2_NOTES.reading_pending);
  });

  it("걷어내면 안내도 함께 사라진다", async () => {
    await send(READING);

    act(() => hookNow().clear());

    expect(hookNow().note).toBeNull();
  });
});
