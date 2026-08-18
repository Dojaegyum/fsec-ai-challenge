/**
 * ULID — 정렬 가능한 26자 식별자.
 *
 * `session_key_id`가 `CHAR(26)`이고 `case_id`와 같은 계열입니다
 * → spec/backend/08-16-data-model.md §2.
 *
 * 의존성을 하나 더 들이지 않으려고 여기 둡니다. 하는 일이 작습니다 —
 * 48비트 시각 + 80비트 난수를 Crockford Base32로 씁니다.
 */

/** Crockford Base32 — I·L·O·U를 뺍니다. 손으로 옮겨 적을 때 헷갈리는 글자들입니다 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(ms: number): string {
  let out = "";
  let n = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 32];
  return out;
}

/**
 * 새 ULID 하나.
 *
 * ⚠️ **세션키에서 파생하지 않습니다.** 난수와 시각만 씁니다 —
 * 키에서 파생된 값이 서버에 올라가면 안 됩니다 → `types.ts` `SessionKey.keyId`.
 */
export function newUlid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

/** 모양이 ULID인지. 길이와 글자만 봅니다 */
export function isUlid(value: string): boolean {
  if (value.length !== TIME_LEN + RANDOM_LEN) return false;
  for (const ch of value) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
