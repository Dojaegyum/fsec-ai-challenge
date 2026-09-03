/**
 * IndexedDB **실경로** 시험 — `fake-indexeddb` 로 브라우저 경로를 그대로 돌립니다.
 *
 * ⚠️ 2026-09-03 까지 이 경로는 시험된 적이 없었습니다 (감사 F8) —
 * `keystore.test.ts` 는 memoryKeyStore 와 「없으면 던진다」만 봤고,
 * put/get 의 실제 IDB 동작·onupgradeneeded 스토어 생성·트랜잭션 뒤
 * db.close() 는 한 번도 실행된 적이 없었습니다. **새로고침 뒤 키를 못
 * 꺼내는 회귀**(= 다른 기기도 아닌데 서류 값을 못 푸는 것)를 잡는 것이
 * 이 파일의 일입니다.
 *
 * 키는 진짜 CryptoKey 대신 구조화 복제가 되는 대역을 씁니다 — IDB 가
 * 보관·반환하는 경로 자체를 보는 시험이라 키의 암호학은 `crypto.test.ts` 몫입니다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { indexedDbKeyStore } from "./keystore";
import type { SessionKey } from "./types";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
/** 구조화 복제 가능한 대역 — CryptoKey 자리 */
const KEY = { kind: "fake-session-key", n: 1 } as unknown as SessionKey;

beforeEach(() => {
  // 시험마다 **새 공장** — 앞 시험의 DB 가 남으면 「비어 있음」 시험이 거짓말합니다
  vi.stubGlobal("indexedDB", new IDBFactory());
});

describe("indexedDbKeyStore — 실제 IDB 경로", () => {
  it("맡긴 키를 그대로 돌려준다 (put → get)", async () => {
    const store = indexedDbKeyStore();
    await store.put(TOKEN, KEY);
    expect(await store.get(TOKEN)).toEqual(KEY);
  });

  it("스토어를 새로 열어도 꺼내진다 — 새로고침의 모형", async () => {
    // 첫 방문: 키를 맡긴다
    await indexedDbKeyStore().put(TOKEN, KEY);
    // 새로고침: **새 스토어 인스턴스**가 같은 DB 를 다시 연다
    const reopened = indexedDbKeyStore();
    expect(await reopened.get(TOKEN)).toEqual(KEY);
  });

  it("없는 사건은 null — 던지지 않는다", async () => {
    expect(await indexedDbKeyStore().get(TOKEN)).toBeNull();
  });

  it("drop 하면 다시 꺼낼 수 없다", async () => {
    const store = indexedDbKeyStore();
    await store.put(TOKEN, KEY);
    await store.drop(TOKEN);
    expect(await store.get(TOKEN)).toBeNull();
  });

  it("사건마다 칸이 다르다 — 한 사건을 지워도 다른 사건은 남는다", async () => {
    const other = "01BX5ZZKBKACTAV9WEVGEMMVRZ";
    const store = indexedDbKeyStore();
    await store.put(TOKEN, KEY);
    await store.put(other, { kind: "fake-session-key", n: 2 } as unknown as SessionKey);
    await store.drop(TOKEN);
    expect(await store.get(TOKEN)).toBeNull();
    expect(await store.get(other)).toEqual({ kind: "fake-session-key", n: 2 });
  });
});
