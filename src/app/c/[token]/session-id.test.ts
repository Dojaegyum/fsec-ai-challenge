/**
 * 세션 식별자 시험 — **탭마다 하나, 요청마다 하나가 아닙니다.**
 *
 * 계약: spec/common/08-14-api.md §1 · §1.3
 *
 * 값이 요청마다 바뀌면 세는 단위가 요청이 되어 제한이 뜻을 잃고, 아예 안 붙으면
 * 서버가 IP 로 세어 **한 NAT 뒤의 사용자들이 한 통에 들어갑니다**(ADR-085).
 *
 * **jsdom 을 안 씁니다.** 이 모듈이 만지는 것은 `globalThis` 의 셋(`window`·
 * `sessionStorage`·`crypto`)뿐이라 대역을 끼우면 그대로 보입니다 — 환경 준비에
 * 30초를 쓰지 않습니다 (`vitest.config.mts` 의 「상호작용을 봐야 하는 파일만」).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const KEY = "fin-ally:session-id";

/** 브라우저의 `sessionStorage` 자리 — 이 시험이 들여다볼 수 있는 대역 */
function fakeStorage(seed: Record<string, string> = {}) {
  const kept = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    kept,
  };
}

/** 모듈 안에 이 탭의 값이 남으므로 시험마다 새로 읽습니다 */
async function fresh() {
  vi.resetModules();
  return import("./session-id");
}

beforeEach(() => {
  // 이 모듈은 **탭이 있을 때만** 값을 만듭니다 — 서버에서 만들면 한 프로세스가
  // 한 값을 나눠 써 세션당 상한이 서버당 상한이 됩니다
  vi.stubGlobal("window", {});
  vi.stubGlobal("sessionStorage", fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("탭 하나에 값 하나 — §1", () => {
  it("UUID 를 만들어 sessionStorage 에 둔다", async () => {
    const store = fakeStorage();
    vi.stubGlobal("sessionStorage", store);
    const { sessionId } = await fresh();

    const id = sessionId();

    expect(id).toMatch(UUID);
    expect(store.kept.get(KEY)).toBe(id);
  });

  it("다시 불러도 같은 값이다 — 요청마다 새로 만들지 않습니다", async () => {
    const { sessionId } = await fresh();

    expect(sessionId()).toBe(sessionId());
  });

  it("이미 있으면 그것을 씁니다 — 새로고침해도 같은 탭입니다", async () => {
    vi.stubGlobal("sessionStorage", fakeStorage({ [KEY]: "3f1a7c62-9b0e-4d2a-8f55-1c9e0b7a4d31" }));
    const { sessionId } = await fresh();

    expect(sessionId()).toBe("3f1a7c62-9b0e-4d2a-8f55-1c9e0b7a4d31");
  });

  /**
   * 사이트 데이터를 막아 둔 브라우저에서는 보관소가 **던집니다**. 그때도 이 화면이
   * 사는 동안은 같은 값이어야 합니다 — 안 그러면 폴링 한 바퀴가 통을 넷 만듭니다.
   */
  it("보관소를 못 써도 이 화면이 사는 동안은 같은 값이다", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    });
    const { sessionId } = await fresh();

    const first = sessionId();
    expect(first).toMatch(UUID);
    expect(sessionId()).toBe(first);
  });

  /** 보관소를 안 여는 브라우저에서도 던지지 않습니다 */
  it("sessionStorage 가 없어도 값은 나온다", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    const { sessionId } = await fresh();

    expect(sessionId()).toMatch(UUID);
  });

  /** 탭이 없는 자리(서버 렌더)에서는 만들지 않습니다 — 한 값을 여럿이 나눠 쓰면 안 됩니다 */
  it("브라우저 밖에서는 null 이다", async () => {
    vi.stubGlobal("window", undefined);
    const { sessionId } = await fresh();

    expect(sessionId()).toBeNull();
  });

  /** 만들 수 없는 자리(옛 브라우저)에서는 헤더를 안 붙이고 서버가 IP 로 셉니다 */
  it("randomUUID 가 없으면 null 이다 — 막지 않습니다", async () => {
    vi.stubGlobal("crypto", {});
    const { sessionId, apiHeaders } = await fresh();

    expect(sessionId()).toBeNull();
    expect(apiHeaders({ accept: "application/json" })).toEqual({
      accept: "application/json",
    });
  });
});

describe("apiHeaders — 부르는 자리가 적은 헤더를 지우지 않는다", () => {
  it("X-Session-Id 를 얹는다", async () => {
    const { sessionId, apiHeaders } = await fresh();

    expect(apiHeaders({ accept: "application/json" })).toEqual({
      accept: "application/json",
      "X-Session-Id": sessionId(),
    });
  });

  it("빈 인자로도 부를 수 있다", async () => {
    const { apiHeaders } = await fresh();

    expect(Object.keys(apiHeaders())).toEqual(["X-Session-Id"]);
  });
});
