/**
 * @vitest-environment jsdom
 */

/**
 * 자료 레일이 **시작 화면의 업로드를 이어받는가.**
 *
 * 계약: spec/common/08-14-api.md §3.2 `GET` · spec/frontend/08-14-screens.md §S-08
 * 근거: ADR-078(폴링의 주인은 셸) · CLAUDE.md 불변 규칙 5(막지 않는다)
 *
 * ⚠️ **2026-09-06 점검 — 시연 경로의 자료 셋 중 뒤의 둘이 안 보였습니다.** 시작
 * 화면은 파일을 하나씩 올리는데 사용자를 세우지 않으므로(불변 규칙 5), 사건
 * 화면은 **다 올라가기 전에** 열립니다. 그런데 이 훅은 목록을 **한 번만** 읽어,
 * 그 뒤에 올라간 파일은 레일에 없고 → 셸 폴링(`useEvidenceReads`)이 묻지도
 * 않아 → 영영 「처리중」에 남았습니다. 목록에 들어와야 폴링이 시작됩니다.
 */

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pendingKey, useUploads, type Uploads } from "./upload";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const KEY = pendingKey(TOKEN);

const row = (id: string, kind: string) => ({
  evidence_id: id,
  kind,
  ingest_status: "processing",
  created_at: "2026-09-06T09:18:00+09:00",
});

/** 목록 조회를 부를 때마다 다음 목록을 내는 가짜 서버 */
function listServer(pages: readonly (readonly ReturnType<typeof row>[])[]) {
  let n = 0;
  const spy = vi.fn(async () => {
    const body = pages[Math.min(n, pages.length - 1)];
    n += 1;
    return new Response(JSON.stringify({ evidence: body }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

let host: HTMLDivElement;
let root: Root;
let api: Uploads | null = null;

function Probe() {
  const got = useUploads(TOKEN);
  useEffect(() => {
    api = got;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api = null;
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const draw = async () => {
  await act(async () => {
    root.render(<Probe />);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

describe("시작 화면이 아직 올리는 중이면 목록을 다시 읽는다", () => {
  it("이어받을 업로드가 있으면 늦게 생긴 자료를 합친다", async () => {
    sessionStorage.setItem(KEY, "2");
    listServer([
      [row("E1", "audio")],
      [row("E1", "audio"), row("E2", "image")],
      [row("E1", "audio"), row("E2", "image"), row("E3", "image")],
    ]);

    await draw();
    expect(api?.files).toHaveLength(1);

    await tick(4_000);
    expect(api?.files).toHaveLength(2);

    await tick(4_000);
    expect(api?.files).toHaveLength(3);
    // 다 들어왔으면 표시를 지웁니다 — 남겨 두면 다음 사건까지 헛돕니다
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("다 들어오면 더 묻지 않는다 — 셸 폴링이 이어받습니다", async () => {
    sessionStorage.setItem(KEY, "1");
    const spy = listServer([[row("E1", "audio")], [row("E1", "audio"), row("E2", "image")]]);

    await draw();
    await tick(4_000);
    const after = spy.mock.calls.length;
    await tick(20_000);

    expect(spy.mock.calls.length).toBe(after);
  });

  it("이어받을 것이 없으면 한 번만 읽는다", async () => {
    const spy = listServer([[row("E1", "audio")]]);

    await draw();
    await tick(20_000);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  /**
   * 시작 화면이 못 올린 파일이 있으면 그 수는 영영 안 채워집니다 — 그때도
   * 무한정 묻지 않습니다. 그 뒤는 사용자가 「+ 올리기」로 다시 올립니다
   */
  it("60초가 지나면 그만둔다 — 안 올라온 파일을 영영 기다리지 않습니다", async () => {
    sessionStorage.setItem(KEY, "3");
    const spy = listServer([[row("E1", "audio")]]);

    await draw();
    await tick(64_000);
    const after = spy.mock.calls.length;
    await tick(60_000);

    expect(spy.mock.calls.length).toBe(after);
    // 4초마다이므로 60초까지면 열일곱 번쯤입니다 — 끊긴 것이 시간이라는 증거
    expect(after).toBeLessThanOrEqual(20);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });
});
