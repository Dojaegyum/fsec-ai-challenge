import { describe, expect, it, vi } from "vitest";
import { createSessionKey } from "./crypto";
import { indexedDbKeyStore, loadOrCreateKey, memoryKeyStore } from "./keystore";

describe("보관", () => {
  it("넣은 것을 그대로 꺼낸다", async () => {
    const store = memoryKeyStore();
    const s = await createSessionKey();

    await store.put("tok-1", s);
    const found = await store.get("tok-1");

    expect(found?.keyId).toBe(s.keyId);
    expect(found?.key.extractable).toBe(false);
  });

  it("없으면 null 이다 — 던지지 않는다", async () => {
    await expect(memoryKeyStore().get("없는-토큰")).resolves.toBeNull();
  });

  it("지우면 사라진다", async () => {
    const store = memoryKeyStore();
    await store.put("tok-1", await createSessionKey());
    await store.drop("tok-1");
    await expect(store.get("tok-1")).resolves.toBeNull();
  });

  it("사건마다 키가 따로다", async () => {
    const store = memoryKeyStore();
    const a = await createSessionKey();
    const b = await createSessionKey();

    await store.put("tok-a", a);
    await store.put("tok-b", b);

    expect((await store.get("tok-a"))?.keyId).toBe(a.keyId);
    expect((await store.get("tok-b"))?.keyId).toBe(b.keyId);
  });
});

describe("loadOrCreateKey", () => {
  it("없으면 만들고 넣어 둔다", async () => {
    const store = memoryKeyStore();
    const made = await loadOrCreateKey(store, "tok-1", createSessionKey);

    expect(await store.get("tok-1")).toStrictEqual(made);
  });

  it("있으면 다시 만들지 않는다 — 두 번 만들면 앞선 볼트 칸을 영영 못 연다", async () => {
    const store = memoryKeyStore();
    const create = vi.fn(createSessionKey);

    const first = await loadOrCreateKey(store, "tok-1", create);
    const second = await loadOrCreateKey(store, "tok-1", create);

    expect(create).toHaveBeenCalledTimes(1);
    expect(second.keyId).toBe(first.keyId);
  });
});

describe("IndexedDB 보관소", () => {
  it("IndexedDB 가 없는 자리에서는 그 자리에서 던진다", () => {
    // 조용히 메모리로 떨어지면, 새로고침 뒤에 서류를 못 만드는데
    // 왜 못 만드는지 아무도 모릅니다.
    expect(typeof indexedDB).toBe("undefined");
    expect(() => indexedDbKeyStore()).toThrow(/IndexedDB/);
  });
});
