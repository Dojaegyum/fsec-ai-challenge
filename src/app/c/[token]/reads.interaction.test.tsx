/**
 * @vitest-environment jsdom
 */

/**
 * 셸 폴링 시험 — **처리중인 자료를 화면과 무관하게 끝까지 묻는가.**
 *
 * 계약: spec/common/08-14-api.md §3.3 · §1.3(세션당 분당 300회) · §3.1(에러는 스스로 다시 안 부른다)
 * 근거: ADR-062(대응표는 그 응답에서 브라우저에) · ADR-078(폴링의 주인은 셸)
 *
 * ⚠️ **2026-09-06 까지 「처리중」이 25분 넘게 굳었습니다.** 팟에서는 판독이 끝나 있었는데,
 * 팟 결과를 서버로 옮기는 길은 §3.3 조회 하나이고, 그 조회는 **자료함 화면 안에서
 * 선택된 파일 하나에 대해서만** 돌았습니다. 통지문을 올리고 대화 탭으로 간 사람은
 * 영원히 「처리중」을 봤고, 그 줄을 클릭해야 조회가 나갔습니다. 팟은 끝난 작업을
 * 30분 뒤 버리므로 그 사례는 결과를 영영 잃기 5분 전이었습니다.
 *
 * 그래서 폴링의 주인을 화면에서 **사건 페이지 셸**로 올리고, 대상을 「선택된 것」에서
 * 「처리중인 것 전부」로 넓힙니다. 이 파일은 그 훅(`useEvidenceReads`)을 겨눕니다.
 */

import { act, useEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTLE_FOLLOWUP_MS, useEvidenceReads } from "./load";
import type { EvidenceReadHandlers, EvidenceReads } from "./load";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const processing = (id: string, percent = 0) =>
  json({ evidence_id: id, ingest_status: "processing", progress: { phase: "stt", percent }, poll_after_ms: 1 });

const done = (id: string, extra: Record<string, unknown> = {}) =>
  json({ evidence_id: id, ingest_status: "done", transcript: [], pii_tokens: [], shortfalls: [], ...extra });

/** 주소에서 증거 번호를 뽑는다 — `…/evidence/{id}` */
const idOf = (url: string) => url.split("/evidence/")[1] ?? "";

/** 요청을 증거 번호별로 세고, 번호마다 정해 둔 응답을 차례로 낸다 */
function serverOf(plan: Record<string, Array<Response | Error>>) {
  const calls: Record<string, number> = {};
  const spy = vi.fn(async (input: string | URL | Request) => {
    const id = idOf(String(input));
    const n = calls[id] ?? 0;
    calls[id] = n + 1;
    const replies = plan[id] ?? [];
    const reply = replies[Math.min(n, replies.length - 1)];
    if (!reply) throw new Error(`계획에 없는 조회: ${id}`);
    if (reply instanceof Error) throw reply;
    return reply.clone();
  });
  vi.stubGlobal("fetch", spy);
  return { calls, spy };
}

let host: HTMLDivElement;
let root: Root;
type Api = { reads: EvidenceReads; again: (id: string) => void };
/** 훅이 마지막으로 돌려준 것 — 시험이 `again` 을 누르고 상태를 읽는 자리 */
let api: Api | null = null;

/** 렌더 중에 바깥 변수를 건드리지 않습니다(리액트 규칙) — 그린 뒤 효과에서 건넵니다 */
function Probe({ wanted, on }: { wanted: readonly string[]; on: EvidenceReadHandlers }) {
  const got = useEvidenceReads(TOKEN, wanted, on);
  useEffect(() => {
    api = got;
  });
  return null;
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api = null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const handlers = (): EvidenceReadHandlers => ({
  onSettled: vi.fn(),
  onProgress: vi.fn(),
  onMappings: vi.fn(),
});

const draw = async (ui: React.ReactElement) => {
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

/** 폴링 몇 바퀴가 돌 만큼 기다린다 — 응답의 `poll_after_ms` 가 1 이라 짧습니다 */
const settle = async (ms = 30) => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

describe("처리중인 자료는 선택과 무관하게 전부 묻는다", () => {
  it("둘이 처리중이면 둘 다 조회가 나간다", async () => {
    const { calls } = serverOf({ E1: [done("E1")], E2: [done("E2")] });

    await draw(<Probe wanted={["E1", "E2"]} on={handlers()} />);
    await settle();

    expect(calls.E1).toBe(1);
    expect(calls.E2).toBe(1);
  });

  it("끝나면 `onSettled` 를 바로 한 번 부르고 더 묻지 않는다", async () => {
    const { calls } = serverOf({ E1: [processing("E1"), done("E1")] });
    const on = handlers();

    await draw(<Probe wanted={["E1"]} on={on} />);
    await settle();
    const after = calls.E1;
    await settle();

    // 8초 뒤에 한 번 더 부르는 것은 아래 「`done` 뒤에 한 번 더 읽는다」가 봅니다 —
    // 여기 `settle` 은 30ms 라 그 예약에 닿지 않습니다 (ADR-086)
    expect(on.onSettled).toHaveBeenCalledTimes(1);
    expect(on.onSettled).toHaveBeenCalledWith("E1", "done");
    expect(after).toBe(2);
    // 끝난 뒤에는 조회가 더 나가지 않습니다
    expect(calls.E1).toBe(after);
  });

  it("실패도 `onSettled` 로 알린다 — 그래야 레일에 실패 갈림길이 뜬다", async () => {
    serverOf({ E1: [json({ evidence_id: "E1", ingest_status: "failed", reason: "empty" })] });
    const on = handlers();

    await draw(<Probe wanted={["E1"]} on={on} />);
    await settle();

    expect(on.onSettled).toHaveBeenCalledWith("E1", "failed");
  });

  it("진행률을 넘긴다 — 서버가 준 값 그대로", async () => {
    serverOf({ E1: [processing("E1", 42), done("E1")] });
    const on = handlers();

    await draw(<Probe wanted={["E1"]} on={on} />);
    await settle();

    expect(on.onProgress).toHaveBeenCalledWith("E1", 42);
  });

  it("막 만든 대응표는 받은 즉시 건넨다 — 그 응답 한 번뿐이다 (ADR-062)", async () => {
    serverOf({
      E1: [
        done("E1", {
          pii_mappings: [{ token: "[계좌-1]", kind: "계좌", seq: 1, original: "110-234-567890" }],
        }),
      ],
    });
    const on = handlers();

    await draw(<Probe wanted={["E1"]} on={on} />);
    await settle();

    expect(on.onMappings).toHaveBeenCalledTimes(1);
    expect(on.onMappings).toHaveBeenCalledWith([
      { token: "[계좌-1]", kind: "계좌", seq: 1, original: "110-234-567890" },
    ]);
  });
});

describe("이미 끝난 것은 다시 묻지 않는다", () => {
  it("wanted 에 다른 번호가 더해져도 끝난 번호는 조회가 안 나간다", async () => {
    const { calls } = serverOf({ E1: [done("E1")], E2: [done("E2")] });
    const on = handlers();

    await draw(<Probe wanted={["E1"]} on={on} />);
    await settle();
    await draw(<Probe wanted={["E1", "E2"]} on={on} />);
    await settle();

    expect(calls.E1).toBe(1);
    expect(calls.E2).toBe(1);
  });

  it("끝난 것의 전사문은 `reads` 에 남아 화면이 그릴 수 있다", async () => {
    serverOf({
      E1: [done("E1", { transcript: [{ speaker: "A", text: "[계좌-1] 로 보내라", start_ms: 0 }] })],
    });

    await draw(<Probe wanted={["E1"]} on={handlers()} />);
    await settle();

    const got = api?.reads.E1;
    expect(got?.phase).toBe("ready");
    if (got?.phase !== "ready") throw new Error("읽혔어야 합니다");
    expect(got.read.transcript?.[0]?.text).toBe("[계좌-1] 로 보내라");
  });
});

describe("조회가 끊기면 스스로 다시 부르지 않는다 — §3.1", () => {
  it("실패는 `failed` 로 남고 조회는 한 번뿐이다", async () => {
    const { calls } = serverOf({ E1: [new TypeError("network")] });

    await draw(<Probe wanted={["E1"]} on={handlers()} />);
    await settle();

    expect(api?.reads.E1?.phase).toBe("failed");
    expect(calls.E1).toBe(1);
  });

  it("`again` 을 부르면 그 번호만 처음부터 다시 묻는다", async () => {
    const { calls } = serverOf({ E1: [new TypeError("network"), done("E1")], E2: [done("E2")] });

    await draw(<Probe wanted={["E1", "E2"]} on={handlers()} />);
    await settle();
    await act(async () => {
      api?.again("E1");
    });
    await settle();

    expect(calls.E1).toBe(2);
    expect(api?.reads.E1?.phase).toBe("ready");
    // 다른 번호는 건드리지 않습니다
    expect(calls.E2).toBe(1);
  });
});

describe("한 바퀴에 넷까지만 묻는다 — 세션당 분당 300회 안에서 (§1.3)", () => {
  const ids = ["E1", "E2", "E3", "E4", "E5", "E6"];

  /**
   * 응답을 **시험이 놓아줄 때까지** 붙들어 둡니다. 응답이 바로 오면 둘째 바퀴가
   * 언제 도는지가 `act` 의 타이밍에 걸려 시험이 흔들립니다(2026-09-06 · #84 CI 에서
   * 4회 기대에 8회). 붙들어 두면 「응답 전에는 넷」이 타이밍과 무관하게 섭니다
   */
  function heldServer(pollAfterMs: number) {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const spy = vi.fn(async (input: string | URL | Request) => {
      await gate;
      return json({
        evidence_id: idOf(String(input)),
        ingest_status: "processing",
        progress: { phase: "stt", percent: 0 },
        poll_after_ms: pollAfterMs,
      });
    });
    vi.stubGlobal("fetch", spy);
    return { spy, release: () => release() };
  }

  it("여섯이 처리중이어도 응답이 오기 전에는 넷까지만 묻는다", async () => {
    const { spy } = heldServer(5000);

    await draw(<Probe wanted={ids} on={handlers()} />);
    await settle(20);

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("나머지 둘도 서버가 준 간격 뒤에 묻는다 — 바퀴 사이 간격이 §1.3 을 지킨다", async () => {
    // 첫 바퀴 넷이 「5초 뒤에 다시」를 받았습니다. 그 사이에 나머지 둘을 곧장 물으면
    // 여섯 파일이 간격 없이 돌아 요청 수가 파일 수에 비례해 치솟습니다
    const { spy, release } = heldServer(5000);

    await draw(<Probe wanted={ids} on={handlers()} />);
    release();
    await settle(60);

    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("간격이 짧으면 다음 바퀴에 남은 둘을 먼저 묻는다 — 뒤에 있다고 굶지 않는다", async () => {
    const { calls } = serverOf(Object.fromEntries(ids.map((id) => [id, [processing(id)]])));

    await draw(<Probe wanted={ids} on={handlers()} />);
    await settle(10);

    expect(calls.E5).toBeGreaterThanOrEqual(1);
    expect(calls.E6).toBeGreaterThanOrEqual(1);
  });
});

/**
 * ⚠️ **응답이 왔다고 서버 일이 다 끝난 것이 아닙니다** → ADR-086.
 *
 * 수거 요청은 마스킹·저장·부산물 판정까지만 기다리고 답합니다. **기관명 보정과
 * 슬롯 추출은 `after()` 로 응답 뒤에** 돌고, 그 결과가 기관 확정과 되묻기 문항입니다.
 * 셸이 `done` 에서 한 번 읽고 멈추면 그 둘을 **이 화면이 영영 못 봅니다** — 계약
 * §3.3 이 「몇 초 뒤 번들에 반영된다」고 적은 그 몇 초를 아무도 안 기다리게 됩니다.
 */
describe("`done` 뒤에 한 번 더 읽는다 — ADR-086", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 가짜 시계 위에서 그린다 — 폴링과 예약이 전부 타이머라 손으로 감습니다 */
  const drawFake = async (ui: React.ReactElement) => {
    await act(async () => {
      root.render(ui);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
  };

  it("`done` 직후 한 번, 8초 뒤에 한 번 더 부른다", async () => {
    serverOf({ E1: [done("E1")] });
    const on = handlers();

    await drawFake(<Probe wanted={["E1"]} on={on} />);

    expect(on.onSettled).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_FOLLOWUP_MS);
    });

    expect(on.onSettled).toHaveBeenCalledTimes(2);
    expect(on.onSettled).toHaveBeenLastCalledWith("E1", "done");
  });

  it("두 번뿐이다 — 되풀이하지 않는다", async () => {
    serverOf({ E1: [done("E1")] });
    const on = handlers();

    await drawFake(<Probe wanted={["E1"]} on={on} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_FOLLOWUP_MS * 5);
    });

    expect(on.onSettled).toHaveBeenCalledTimes(2);
  });

  it("화면을 떠나면 두 번째는 안 나간다", async () => {
    serverOf({ E1: [done("E1")] });
    const on = handlers();

    await drawFake(<Probe wanted={["E1"]} on={on} />);
    expect(on.onSettled).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    // 바깥 `afterEach` 가 한 번 더 unmount 해도 되게 새로 세워 둡니다
    root = createRoot(host);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_FOLLOWUP_MS * 2);
    });

    expect(on.onSettled).toHaveBeenCalledTimes(1);
  });

  /**
   * 실제 호출부(`page.tsx`)와 **같은 모양** — 끝난 파일은 `wanted` 에서 빠집니다.
   *
   * ⚠️ 여기가 이 훅의 함정이었습니다. `onSettled` 이 `uploads.mark(id, 'done')` 을 부르면
   * 그 번호가 「처리중」이 아니게 되어 `wanted` 에서 빠지고, 바퀴 효과가 다시 섭니다.
   * 후속 예약이 그 효과의 클로저 안에 있으면 방금 잡은 8초짜리가 거기서 걷혀
   * **두 번째 읽기가 영영 안 나갑니다** (ADR-086 이 지키려던 바로 그 경우)
   */
  function ShrinkingProbe({
    ids,
    onSettled,
  }: {
    ids: readonly string[];
    onSettled: EvidenceReadHandlers["onSettled"];
  }) {
    const [wanted, setWanted] = useState<readonly string[]>(ids);
    const on = useMemo<EvidenceReadHandlers>(
      () => ({
        onSettled: (id, status) => {
          setWanted((prev) => prev.filter((one) => one !== id));
          onSettled(id, status);
        },
        onProgress: () => {},
        onMappings: () => {},
      }),
      [onSettled],
    );
    return <Probe wanted={wanted} on={on} />;
  }

  it("호출부가 끝난 번호를 `wanted` 에서 빼도 두 번째는 나간다", async () => {
    serverOf({ E1: [done("E1")], E2: [done("E2")] });
    const onSettled = vi.fn<EvidenceReadHandlers["onSettled"]>();

    await drawFake(<ShrinkingProbe ids={["E1", "E2"]} onSettled={onSettled} />);

    // 즉시 한 번씩 — 그리고 그 순간 둘 다 `wanted` 에서 빠집니다
    expect(onSettled).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_FOLLOWUP_MS);
    });

    const times = (id: string) => onSettled.mock.calls.filter(([one]) => one === id).length;
    expect(times("E1")).toBe(2);
    expect(times("E2")).toBe(2);
  });

  it("같은 번호에 후속 예약은 하나뿐이다 — `again` 으로 `done` 을 두 번 봐도", async () => {
    serverOf({ E1: [done("E1")] });
    const on = handlers();

    await drawFake(<Probe wanted={["E1"]} on={on} />);
    expect(on.onSettled).toHaveBeenCalledTimes(1);

    // 8초가 되기 전에 「다시 확인」 — 서버는 `done` 을 다시 말합니다
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      api?.again("E1");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(on.onSettled).toHaveBeenCalledTimes(2);

    // 후속은 먼저 잡은 하나뿐입니다 — 즉시 둘 + 후속 하나
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_FOLLOWUP_MS * 2);
    });
    expect(on.onSettled).toHaveBeenCalledTimes(3);
  });

  it("실패도 한 번 더 읽는다 — 부산물 판정이 그 뒤에 끝날 수 있다", async () => {
    serverOf({ E1: [json({ evidence_id: "E1", ingest_status: "failed", reason: "empty" })] });
    const on = handlers();

    await drawFake(<Probe wanted={["E1"]} on={on} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTLE_FOLLOWUP_MS);
    });

    expect(on.onSettled).toHaveBeenCalledTimes(2);
    expect(on.onSettled).toHaveBeenLastCalledWith("E1", "failed");
  });
});
