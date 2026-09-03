/**
 * 마스킹 검산(①'') 시험 — **상류를 고의로 뚫습니다.**
 *
 * `send.test.ts` 는 진짜 `outgoing` 을 쓰므로 여기서만 가짜를 씁니다.
 * 시나리오는 **재방문**입니다: 지난 턴의 매핑(입력 `mappings`)에 있는 계좌가
 * 이번 발화에 다시 나왔는데 치환이 비껴갔다(패턴 회귀) — 그래서 `added` 가
 * 비는 것이 실제 `maskText` 동작과 맞습니다(문맥에 있는 값은 재사용이라
 * `added` 에 안 실립니다).
 *
 * 보는 것 셋:
 *  · 발화가 네트워크에 안 나간다 — 검산이 볼트 POST 보다 앞이라 **호출 0회**
 *  · 실패의 자리가 `stage: "mask"` 다 — 볼트 실패로 오설명하지 않는다
 *  · 실패 문구에 원문이 없다
 *
 * 그리고 **이름은 막지 않습니다** — 이름은 브라우저 1차가 못 가리는 종류라
 * (서버 2차 pii-tokenizer 의 몫) 검산 대상이 아닙니다. 전사 NER 이 만든
 * 이름 매핑 때문에 그 이름이 든 발화가 영구 차단되던 결함(2026-09-03 검증)의
 * 회귀 방지입니다.
 *
 * ⚠️ 2026-09-03 까지 `assertNoLeak` 은 선언만 있고 호출이 없었습니다.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { memoryKeyStore } from "@/modules/key-handler";
import type { PiiMapping } from "@/modules/pii-masker";

/** 시안·목업에서 쓰는 예시 값입니다 — 실제 계좌가 아닙니다 */
const ACCOUNT = "110-2345-678901";
const NAME = "김민수";

const ACCOUNT_MAPPING: PiiMapping = {
  token: "[계좌-1]",
  kind: "계좌",
  seq: 1,
  original: ACCOUNT,
};

/** 전사 NER(서버 2차)이 만든 이름 매핑 — 런타임에는 이 kind 가 섞여 들어옵니다 */
const NAME_MAPPING = {
  token: "[이름-1]",
  kind: "이름",
  seq: 1,
  original: NAME,
} as unknown as PiiMapping;

vi.mock("@/modules/chat-handler", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/modules/chat-handler")>();
  return {
    ...real,
    // **치환이 비껴간 척합니다** — 문맥 매핑은 그대로 들고 있는데 content 에
    // 원문이 남음. 문맥 재사용이라 added 는 비는 것이 실제 동작과 같습니다
    outgoing: (text: string, ctx: { mappings: PiiMapping[] }) => ({
      content: text,
      mappings: ctx.mappings,
      added: [],
    }),
  };
});

import { sendUtterance } from "./send";

afterEach(() => {
  vi.unstubAllGlobals();
});

const send = (text: string, mappings: PiiMapping[]) =>
  sendUtterance({
    caseToken: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
    text,
    mappings,
    vaultRead: true,
    store: memoryKeyStore(),
  });

describe("마스킹 검산 (assertNoLeak 배선)", () => {
  it("1차 종류의 원문이 남으면 보내지 않는다 — 네트워크 0회 · stage=mask", async () => {
    const spy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", spy);

    const result = await send(`아까 ${ACCOUNT} 로 보냈어요`, [ACCOUNT_MAPPING]);

    expect(result.ok).toBe(false);
    // 검산이 볼트 POST 보다 앞이라 **아무것도 안 나갔습니다**
    expect(spy).not.toHaveBeenCalled();
    if (!result.ok) {
      // 볼트 실패로 오설명하면 화면이 엉뚱한 부연을 답니다 (chat.tsx 의 vault 분기)
      expect(result.stage).toBe("mask");
      // 실패 문구에 원문을 싣지 않습니다
      expect(result.fail.message).not.toContain(ACCOUNT);
    }
  });

  it("이름 매핑은 막지 않는다 — 서버 2차의 몫이라 발화가 정상 송출된다", async () => {
    const spy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message_id: "01J8XKRE000000000000000000",
            reply: "안내드립니다.",
            citations: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", spy);

    const result = await send(`${NAME}가 전화했어요`, [NAME_MAPPING]);

    // 이름까지 검산하면 이 발화가 영구 차단됩니다 — 그 결함의 회귀 방지
    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalled();
  });
});
