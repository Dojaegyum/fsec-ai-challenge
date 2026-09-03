/**
 * 최후 누출검사 시험 — **상류를 고의로 뚫습니다.**
 *
 * `send.test.ts` 는 진짜 `outgoing` 을 쓰므로 여기서만 가짜를 씁니다:
 * 마스킹이 원문을 놓친 척하는 `outgoing` 을 꽂아, `assertNoLeak` 배선이
 * **발화를 네트워크에 태우기 전에** 막는지 봅니다 (불변 규칙 2).
 *
 * ⚠️ 2026-09-04 까지 이 방어선은 선언만 있고 호출이 없었습니다 — 그때는
 * 이 시험이 존재할 수 없었습니다(막는 코드가 없으니). 배선과 함께 태어난
 * 시험입니다.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryKeyStore } from "@/modules/key-handler";

/** 시안·목업에서 쓰는 예시 값입니다 — 실제 계좌가 아닙니다 */
const ACCOUNT = "110-2345-678901";

vi.mock("@/modules/chat-handler", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/chat-handler")>();
  return {
    ...real,
    // **마스킹을 놓친 척합니다** — 매핑은 만들었는데 content 에 원문이 남음
    outgoing: (text: string) => ({
      content: text,
      mappings: [{ kind: "계좌", seq: 1, original: ACCOUNT }],
      added: [],
    }),
  };
});

import { sendUtterance } from "./send";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("최후 누출검사 (assertNoLeak 배선)", () => {
  it("가린 결과에 원문이 남으면 발화를 보내지 않는다", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);

    const result = await sendUtterance({
      caseToken: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      text: `아까 ${ACCOUNT} 로 보냈어요`,
      mappings: [],
      vaultRead: true,
      store: memoryKeyStore(),
    });

    expect(result.ok).toBe(false);
    // **네트워크 호출 0회** — 볼트도 발화도 안 나갔습니다
    expect(spy).not.toHaveBeenCalled();
    if (!result.ok) {
      // 실패 문구에 원문을 싣지 않습니다
      expect(result.fail.message).not.toContain(ACCOUNT);
    }
  });
});
