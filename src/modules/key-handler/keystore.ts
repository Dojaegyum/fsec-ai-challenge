/**
 * 세션키를 어디에 두는가.
 *
 * IndexedDB 를 씁니다. `CryptoKey` 는 구조화 복제로 저장되므로,
 * **`extractable: false` 인 채로 넣었다가 그대로 꺼낼 수 있습니다** —
 * 저장하려고 키를 평문으로 바꿀 필요가 없습니다.
 *
 * `localStorage` 를 쓰지 않는 이유가 여기 있습니다. 문자열만 담기므로
 * 키를 저장하려면 먼저 꺼내야 하고, 꺼낼 수 있으면 XSS 도 꺼낼 수 있습니다.
 */

import type { KeyStore, SessionKey } from "./types";

const DB_NAME = "finally-keys";
const STORE = "session-keys";
const DB_VERSION = 1;

/** 테스트와 서버 사이드 렌더 경로에서 씁니다. 새로고침하면 사라집니다 */
export function memoryKeyStore(): KeyStore {
  const map = new Map<string, SessionKey>();
  return {
    async put(caseToken, key) {
      map.set(caseToken, key);
    },
    async get(caseToken) {
      return map.get(caseToken) ?? null;
    },
    async drop(caseToken) {
      map.delete(caseToken);
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * 브라우저용. `indexedDB` 가 없는 자리에서 부르면 그 자리에서 던집니다 —
 * 조용히 메모리로 떨어지면 새로고침 뒤에 서류를 못 만드는데
 * **왜 못 만드는지 아무도 모릅니다.**
 */
export function indexedDbKeyStore(): KeyStore {
  if (typeof indexedDB === "undefined") {
    throw new Error(
      "key-handler: 이 자리에는 IndexedDB 가 없습니다. " +
        "브라우저에서만 부르세요 (서버 렌더 경로라면 memoryKeyStore).",
    );
  }

  return {
    async put(caseToken, key) {
      await run("readwrite", (s) => s.put(key, caseToken));
    },
    async get(caseToken) {
      const found = await run<SessionKey | undefined>("readonly", (s) =>
        s.get(caseToken),
      );
      return found ?? null;
    },
    async drop(caseToken) {
      await run("readwrite", (s) => s.delete(caseToken));
    },
  };
}

/**
 * 있으면 쓰고 없으면 만들어 둡니다.
 *
 * 사건 하나에 키 하나입니다. 두 번 만들면 **먼저 봉해 둔 볼트 칸을
 * 영영 못 엽니다** — 그래서 만들기 전에 반드시 먼저 찾습니다.
 */
export async function loadOrCreateKey(
  store: KeyStore,
  caseToken: string,
  create: () => Promise<SessionKey>,
): Promise<SessionKey> {
  const found = await store.get(caseToken);
  if (found) return found;

  const made = await create();
  await store.put(caseToken, made);
  return made;
}
