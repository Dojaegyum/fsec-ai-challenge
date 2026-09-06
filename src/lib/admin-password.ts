/**
 * 관리자 비밀번호 해시 — API §7.1 · ADR-087.
 *
 * 형식 `scrypt$N$r$p$<salt base64>$<hash base64>`. `node:crypto` 만 씁니다 — 의존성을 늘리지
 * 않으려는 것이고, scrypt 는 Node 가 내장합니다. **대조는 어떤 입력에도 던지지 않습니다** —
 * 형식이 아니면 그냥 `false` 입니다. 로그인 경로가 500 을 내면 그 자체가 힌트가 됩니다.
 */
import 'server-only'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const PREFIX = 'scrypt'
const KEY_LENGTH = 32
const DEFAULT = { N: 16384, r: 8, p: 1 } as const

export function hashPassword(plain: string, params: { N: number; r: number; p: number } = DEFAULT): string {
  const salt = randomBytes(16)
  const hash = scryptSync(plain, salt, KEY_LENGTH, params)
  return [PREFIX, params.N, params.r, params.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

export function verifyPassword(plain: string, stored: string | null | undefined): boolean {
  if (typeof stored !== 'string' || stored.length === 0) return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== PREFIX) return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![N, r, p].every((one) => Number.isSafeInteger(one) && one > 0)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4]!, 'base64')
    expected = Buffer.from(parts[5]!, 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  let actual: Buffer
  try {
    actual = scryptSync(plain, salt, expected.length, { N, r, p })
  } catch {
    // N·r·p 가 메모리 한도를 넘는 값이면 scrypt 가 던집니다 — 닫힌 쪽으로
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
