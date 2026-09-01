/**
 * Mock 자료 불러오기 시험 — **시연이 실제 경로를 지나는가.**
 *
 * 계약: spec/common/08-14-api.md §3.2 (받는 `kind` 셋) · §S-05
 * 근거: ADR-043 「합성 데이터만 올립니다」
 *
 * 시연에서 파일을 손으로 고르지 않으려고 두는 자리입니다. **여기서 하는 일은
 * 파일을 만들어 주는 것뿐**이고, 그 뒤는 사람이 고른 파일과 **똑같은 문**을
 * 지납니다(`page.tsx` 의 `pick`). 그래야 시연에서 도는 것이 실제와 다르지 않습니다.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { kindOf } from "@/app/c/[token]/upload";

import { MOCK_EVIDENCE, loadMockEvidence } from "./mock";

afterEach(() => vi.unstubAllGlobals());

/** 받은 주소마다 조그만 몸통을 돌려주는 대역 */
function stubFiles(fail?: string) {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      seen.push(url);
      if (fail !== undefined && url.includes(fail)) {
        return new Response("no", { status: 404 });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }),
  );
  return seen;
}

describe("Mock 자료 셋 — 통화 하나 · 화면 둘", () => {
  it("**§3.2 가 받는 종류만 있습니다** — 하나라도 벗어나면 그 파일은 안 올라갑니다", () => {
    for (const one of MOCK_EVIDENCE) {
      expect(kindOf(one.type)).not.toBeNull();
    }
    expect(MOCK_EVIDENCE.map((one) => kindOf(one.type))).toEqual([
      "audio",
      "image",
      "image",
    ]);
  });

  it("슬롯 번호가 화면의 자료 종류와 맞습니다 — 통화 녹음·문자 캡처·이체 내역", () => {
    expect(MOCK_EVIDENCE.map((one) => one.slot)).toEqual([0, 1, 2]);
  });

  it("앱이 서빙하는 주소를 가리킵니다", () => {
    for (const one of MOCK_EVIDENCE) {
      expect(one.url.startsWith("/demo/")).toBe(true);
    }
  });
});

describe("불러오기", () => {
  it("셋을 다 받아 `File` 로 내놓는다", async () => {
    const seen = stubFiles();
    const got = await loadMockEvidence();

    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(seen).toEqual(MOCK_EVIDENCE.map((one) => one.url));
    expect(got.files).toHaveLength(3);
    expect(got.files[0]?.file).toBeInstanceOf(File);
    // **종류를 우리가 붙입니다** — 서버가 내려준 `content-type` 에 기대면
    // 배포마다 달라지고, `kindOf` 가 `null` 이면 그 파일만 조용히 빠집니다
    expect(got.files[0]?.file.type).toBe("audio/wav");
    expect(got.files[1]?.file.type).toBe("image/png");
  });

  it("이름에 무엇인지가 드러난다 — 발급 화면이 이름으로 말합니다", async () => {
    stubFiles();
    const got = await loadMockEvidence();

    expect(got.ok).toBe(true);
    if (!got.ok) return;
    for (const one of got.files) {
      expect(one.file.name.length).toBeGreaterThan(0);
    }
  });

  it("**하나라도 못 받으면 실패로 말한다** — 반쯤 담긴 채로 시연하지 않습니다", async () => {
    stubFiles("transfer");
    const got = await loadMockEvidence();

    expect(got.ok).toBe(false);
    if (got.ok) return;
    expect(got.fail.message.length).toBeGreaterThan(0);
    // 다시 눌러 볼 수 있어야 합니다 — 스스로 다시 부르지는 않습니다 (에러 §3.1)
    expect(got.fail.retryable).toBe(true);
  });

  it("연결이 끊겨도 던지지 않는다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );

    await expect(loadMockEvidence()).resolves.toMatchObject({ ok: false });
  });
});
