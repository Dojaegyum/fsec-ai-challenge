import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './admin-password'

describe('scrypt 해시 — API §7.1', () => {
  it('만든 것은 통과한다', () => {
    const stored = hashPassword('correct horse battery staple')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true)
  })

  it('다른 비밀번호는 막힌다', () => {
    const stored = hashPassword('one')
    expect(verifyPassword('two', stored)).toBe(false)
  })

  it('같은 비밀번호도 솔트가 달라 해시가 다르다', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })

  it('형식이 아니면 던지지 않고 막힌다', () => {
    expect(verifyPassword('x', 'admin')).toBe(false)
    expect(verifyPassword('x', 'scrypt$16384$8$1$notbase64!$zz')).toBe(false)
    expect(verifyPassword('x', null)).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
  })

  it('해시 한 글자를 건드리면 막힌다', () => {
    const stored = hashPassword('pw')
    const parts = stored.split('$')
    const last = parts[5]!
    parts[5] = (last[0] === 'A' ? 'B' : 'A') + last.slice(1)
    expect(verifyPassword('pw', parts.join('$'))).toBe(false)
  })
})
