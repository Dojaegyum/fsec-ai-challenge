/**
 * 세션키 생성과 매핑 봉하기·열기.
 *
 * AES-GCM 256. 볼트에 올라가는 것은 `iv || 암호문`의 base64 하나뿐이고,
 * 서버는 이것을 열 수 없습니다 → ADR-009.
 *
 * 이 파일에 네트워크 호출이 없어야 합니다.
 */

import type { PiiMapping } from "@/modules/pii-masker";
import { newUlid } from "./ulid";
import type { SessionKey, VaultEntry } from "./types";

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
/** AES-GCM 권장 IV 길이. 암호화마다 새로 뽑습니다 — 재사용하면 GCM이 무너집니다 */
const IV_BYTES = 12;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(value: string): Uint8Array {
  const s = atob(value);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

/**
 * 사건 하나의 세션키를 만듭니다.
 *
 * **`extractable: false`입니다.** 이 값을 `true`로 바꾸면
 * 「키는 이 브라우저에만 있다」는 약속이 구조적 보장에서 부탁으로 내려갑니다
 * → 2026-08-18 확정. 바꾸려면 먼저 사람에게 물으세요.
 */
export async function createSessionKey(): Promise<SessionKey> {
  const key = await crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ["encrypt", "decrypt"],
  );
  return { keyId: newUlid(), key };
}

/** 매핑 하나를 볼트에 올릴 형태로 봉합니다. 원문은 여기서 암호문이 됩니다 */
export async function sealMapping(
  session: SessionKey,
  mapping: PiiMapping,
): Promise<VaultEntry> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);

  const encoded = new TextEncoder().encode(mapping.original);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: ALGORITHM, iv }, session.key, encoded),
  );

  const joined = new Uint8Array(iv.length + sealed.length);
  joined.set(iv, 0);
  joined.set(sealed, iv.length);

  return { token: mapping.token, ciphertext: toBase64(joined) };
}

/**
 * 볼트에서 받은 칸을 엽니다. 원문이 나오는 유일한 자리입니다.
 *
 * 키가 다르거나 암호문이 손상되면 던집니다 — **조용히 빈 문자열을 내지 않습니다.**
 * 복원 실패를 성공으로 위장하면 화면에 빈칸이 뜨고, 사용자는 그것이
 * 값이 없어서인지 못 열어서인지 알 수 없습니다.
 */
export async function openMapping(
  session: SessionKey,
  entry: VaultEntry,
): Promise<string> {
  const joined = fromBase64(entry.ciphertext);
  if (joined.length <= IV_BYTES) {
    throw new Error(`key-handler: 볼트 칸이 너무 짧습니다 (${entry.token})`);
  }

  const iv = joined.slice(0, IV_BYTES);
  const body = joined.slice(IV_BYTES);

  try {
    const plain = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      session.key,
      body,
    );
    return new TextDecoder().decode(plain);
  } catch {
    throw new Error(
      `key-handler: 볼트 칸을 열지 못했습니다 (${entry.token}). ` +
        `키가 다르거나 암호문이 손상됐습니다.`,
    );
  }
}

/** 여러 매핑을 한 번에. 순서는 입력 순서를 지킵니다 */
export async function sealAll(
  session: SessionKey,
  mappings: PiiMapping[],
): Promise<VaultEntry[]> {
  return Promise.all(mappings.map((m) => sealMapping(session, m)));
}
