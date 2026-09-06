import { describe, expect, it } from 'vitest'
import { RATE_RULES } from './rate-limit'

describe('관리자 로그인 상한 — API §1.3', () => {
  it('IP 기준 10분에 10회다', () => {
    expect(RATE_RULES.adminLogin).toEqual({
      bucket: 'adminLogin',
      scope: 'ip',
      limit: 10,
      windowMs: 10 * 60_000,
      what: '관리자 로그인',
    })
  })
})
