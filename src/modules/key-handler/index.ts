/**
 * key-handler — 세션키를 만들고 지키며, 매핑을 봉하고 연다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md
 * 근거: ADR-009(매핑은 볼트에, 키는 클라이언트에) · ADR-023(층 C)
 */

export { createSessionKey, sealMapping, sealAll, openMapping } from "./crypto";
export {
  memoryKeyStore,
  indexedDbKeyStore,
  loadOrCreateKey,
} from "./keystore";
export { newUlid, isUlid } from "./ulid";
export type { KeyStore, SessionKey, VaultEntry } from "./types";
