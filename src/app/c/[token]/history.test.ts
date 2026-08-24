/**
 * 지난 것을 되살리는 시험 — **열쇠가 없으면 원문이 안 나오는 것**이 핵심입니다.
 *
 * 가족이 링크를 받아 열면 세션키가 없습니다(ADR-027). 그때 원문이 한 글자라도
 * 나오면 「링크가 새어도 계좌번호는 안 나간다」가 깨집니다 → ADR-050.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionKey, memoryKeyStore, sealAll } from "@/modules/key-handler";
import type { KeyStore, SessionKey } from "@/modules/key-handler";

import { fetchHistory, openVault } from "./history";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const ACCOUNT = "110-2345-678901";
const NAME = "김민수";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** 볼트 응답과 이력 응답을 경로로 갈라 냅니다 */
function stubApi(entries: unknown, messages: unknown, truncated = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.includes("/vault")
        ? json({ entries })
        : json({ messages, truncated }),
    ),
  );
}

/** 한 사건의 볼트를 실제로 봉해 둡니다 — 암호는 흉내 내지 않습니다 */
async function seeded(): Promise<{ store: KeyStore; session: SessionKey; entries: unknown }> {
  const store = memoryKeyStore();
  const session = await createSessionKey();
  await store.put(TOKEN, session);
  const entries = await sealAll(session, [
    { token: "[계좌-1]", kind: "계좌", seq: 1, original: ACCOUNT },
    { token: "[이름-1]", kind: "계좌", seq: 1, original: NAME },
  ]);
  return { store, session, entries };
}

afterEach(() => vi.unstubAllGlobals());

describe("열쇠가 없으면 안 풀린다", () => {
  it("남의 기기에서는 원문이 한 글자도 안 나온다 → ADR-050", async () => {
    const { entries } = await seeded();
    stubApi(entries, [{ message_id: "m1", role: "user", content: "[계좌-1] 로 보냈어요" }]);

    // **키를 넣지 않은 저장소** — 가족이 링크를 받아 연 상황입니다
    const vault = await openVault(TOKEN, memoryKeyStore());
    expect(vault.hasKey).toBe(false);
    expect(vault.restorable).toHaveLength(0);
    // 몇 칸이 있었는지는 압니다 — 화면이 「열쇠가 없어서」를 말할 근거입니다
    expect(vault.stored).toBe(2);

    const past = await fetchHistory(TOKEN, vault.restorable);
    const shown = past.lines.map((l) => (l.who === "me" ? l.text : l.reply)).join(" ");
    expect(shown).not.toContain(ACCOUNT);
    expect(shown).toContain("[계좌-1]");
  });

  it("열쇠가 없는 것과 맡긴 것이 없는 것을 가른다", async () => {
    stubApi([], []);
    const vault = await openVault(TOKEN, memoryKeyStore());
    // 새 사건입니다 — 「잠겼다」고 말하면 안 됩니다
    expect(vault.stored).toBe(0);
  });
});

describe("내 기기에서는 되살아난다", () => {
  it("내가 한 말은 전부 펼친다 — user-input", async () => {
    const { store, entries } = await seeded();
    stubApi(entries, [{ message_id: "m1", role: "user", content: "[계좌-1] 로 보냈어요" }]);

    const vault = await openVault(TOKEN, store);
    expect(vault.hasKey).toBe(true);
    expect(vault.failed).toBe(0);

    const past = await fetchHistory(TOKEN, vault.restorable);
    expect(past.lines[0]?.who).toBe("me");
    expect(past.lines[0]?.who === "me" && past.lines[0].text).toBe(`${ACCOUNT} 로 보냈어요`);
  });

  it("비서의 답은 종류별 부분 복원이다 — chat-answer", async () => {
    const { store, entries } = await seeded();
    stubApi(entries, [
      {
        message_id: "m2",
        role: "assistant",
        content: "[계좌-1] 로 보내신 것을 확인했습니다",
        citations: [{ ref: "kb-2", label: "피해구제 신청서 제출" }],
      },
    ]);

    const vault = await openVault(TOKEN, store);
    const past = await fetchHistory(TOKEN, vault.restorable);
    const line = past.lines[0];

    expect(line?.who).toBe("ai");
    if (line?.who !== "ai") return;
    // **전부 펼치지 않습니다** — 인젝션으로 값을 캐내려는 시도를 막는 자리입니다 (§3.9)
    expect(line.reply).not.toContain(ACCOUNT);
    expect(line.sourceNote).toBe("피해구제 신청서 제출");
  });

  it("다음 발화가 같은 번호를 이어 쓰게 매핑을 넘긴다", async () => {
    const { store, entries } = await seeded();
    stubApi(entries, []);
    const vault = await openVault(TOKEN, store);

    // 1차 종류만 들어갑니다. 서버 NER 이 만든 `[이름-N]` 은 여기 없습니다 —
    // `PiiKind` 에 없는 값을 넣으면 다음 마스킹이 그 종류를 못 셉니다
    expect(vault.maskContext.map((m) => m.token)).toEqual(["[계좌-1]"]);
    expect(vault.maskContext[0]?.original).toBe(ACCOUNT);
    // 되살리는 쪽은 둘 다 씁니다
    expect(vault.restorable).toHaveLength(2);
  });
});

describe("못 열린 칸을 조용히 버리지 않는다", () => {
  it("다른 키로 봉한 칸은 센다", async () => {
    const { store } = await seeded();
    const other = await createSessionKey();
    const strange = await sealAll(other, [
      { token: "[계좌-9]", kind: "계좌", seq: 9, original: "999-9999-999999" },
    ]);
    stubApi(strange, []);

    const vault = await openVault(TOKEN, store);
    expect(vault.hasKey).toBe(true);
    expect(vault.failed).toBe(1);
    expect(vault.restorable).toHaveLength(0);
  });
});

describe("잘렸으면 말한다", () => {
  it("truncated 를 그대로 올린다 → §3.12", async () => {
    stubApi([], [], true);
    const past = await fetchHistory(TOKEN, []);
    expect(past.truncated).toBe(true);
  });
});
