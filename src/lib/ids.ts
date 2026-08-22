/**
 * 정렬 가능한 식별자(ULID) 발급 — 서버용.
 *
 * 정본: spec/backend/08-16-data-model.md — 모든 `CHAR(26)` 키
 *
 * **왜 직접 만드나** — 외부 라이브러리를 하나 더 들이지 않으려는 것입니다.
 * 규격이 짧고(48비트 시각 + 80비트 난수, Crockford Base32) 정본이 요구하는 것은
 * 「26자이고 시간순으로 정렬된다」뿐입니다.
 *
 * ⬜ `key-handler` 에도 발급기가 있지만 **그것은 층 C(브라우저) 모듈**이라
 * 서버가 import 하면 ADR-028 의 실행 경계가 흐려집니다. 같은 규격을 두 곳에
 * 두는 대가를 치르고 경계를 지킵니다.
 */

import 'server-only'

import { randomBytes } from 'node:crypto'

/** Crockford Base32 — `I`·`L`·`O`·`U` 를 뺀 32자. 눈으로 읽을 때 헷갈리지 않게 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const TIME_CHARS = 10
const RANDOM_CHARS = 16
export const ULID_LENGTH = TIME_CHARS + RANDOM_CHARS

function encodeTime(ms: number): string {
  let out = ''
  let left = ms
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = ALPHABET[left % 32] + out
    left = Math.floor(left / 32)
  }
  return out
}

function encodeRandom(): string {
  // 5비트씩 잘라 쓰므로 문자 하나에 바이트 하나를 씁니다.
  // Math.random 을 쓰지 않습니다 — 링크 토큰처럼 추측을 막아야 하는 자리에
  // 같은 발급기가 쓰일 수 있습니다
  const bytes = randomBytes(RANDOM_CHARS)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % 32]
  return out
}

export function newUlid(at: number = Date.now()): string {
  return encodeTime(at) + encodeRandom()
}

/** 26자이고 허용 문자만 있는가. 경로 파라미터 검사에 씁니다 */
export function isUlid(value: string): boolean {
  if (value.length !== ULID_LENGTH) return false
  for (const char of value) {
    if (!ALPHABET.includes(char)) return false
  }
  return true
}

/**
 * 링크 토큰의 길이. **ULID 와 같은 26자입니다** → ADR-039 ②.
 *
 * 같은 이유로 `isUlid` 가 링크 토큰도 통과시킵니다. 형식으로는 둘을 못 가릅니다.
 */
export const LINK_TOKEN_LENGTH = 26

/**
 * 사건을 여는 주소에 들어가는 값 → ADR-039.
 *
 * **`case_id` 에서 파생하지 않습니다.** ULID 는 앞 10자가 생성 시각이라, 그대로
 * 주소에 쓰면 하나를 아는 사람이 비슷한 시각의 사건을 좁혀서 찔러볼 수 있습니다.
 * 계정이 없어 주소를 아는 사람이 곧 주인이므로(ADR-021) 이 값이 사실상
 * 비밀번호입니다 — 따로 뽑은 난수여야 합니다.
 *
 * 규격: **CSPRNG 128비트 · Crockford Base32 · 26자** (09-data-model.md §4).
 * 글자마다 32값을 고르게 쓰므로 26자에 130비트가 실립니다 — 요구치를 넘습니다.
 * (`byte % 32` 에 치우침이 없는 이유는 256 이 32 로 나누어떨어지기 때문입니다.)
 */
export function newLinkToken(): string {
  const bytes = randomBytes(LINK_TOKEN_LENGTH)
  let out = ''
  for (const byte of bytes) out += ALPHABET[byte % 32]
  return out
}

/**
 * 26자이고 허용 문자만 있는가.
 *
 * ⚠️ **이것으로 링크 토큰과 `case_id` 를 가를 수 없습니다.** 규격이 같아서
 * `isUlid` 와 결과가 언제나 같습니다. 이 함수는 **저장소를 두드리기 전에
 * 명백한 쓰레기를 걸러내는 용도**일 뿐이고, 「이 값이 어느 사건인가」는
 * 반드시 조회로 답해야 합니다 → `CaseTokenResolver`.
 *
 * 이름을 따로 둔 이유는 부르는 쪽의 의도를 드러내려는 것입니다 — ADR-039 가
 * *"이름이 함정이면 이름을 고칩니다"* 로 기각한 것이 그 반대 경우입니다.
 */
export function isTokenShaped(value: string): boolean {
  return isUlid(value)
}

/** `case-intake` 의 `IdSource` · `audit-logger` 의 `newId` 자리에 그대로 들어갑니다 */
export const ulidSource = { next: () => newUlid() }

/** `case-intake` 의 `LinkTokenSource` 자리에 그대로 들어갑니다 */
export const linkTokenSource = { next: () => newLinkToken() }
