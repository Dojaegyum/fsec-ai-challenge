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

/** `case-intake` 의 `IdSource` · `audit-logger` 의 `newId` 자리에 그대로 들어갑니다 */
export const ulidSource = { next: () => newUlid() }
