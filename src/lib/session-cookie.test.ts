/**
 * 관리자 세션 쿠키 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §5.1
 *
 * **여기서 못 박는 것 셋:**
 * 1. 설정이 없으면 **닫힌 쪽으로** 실패한다
 * 2. 우리가 서명한 것만 통과한다
 * 3. 비밀번호를 바꾸면 기존 세션이 끊긴다
 */

import { describe, expect, it } from 'vitest'

import { readEnv } from './env'
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_MAX_AGE_SECONDS,
  adminSessionClearCookie,
  adminSessionSetCookie,
  hasAdminSession,
  issueAdminSession,
  readCookie,
  readCookies,
  verifyAdminSession,
} from './session-cookie'

const NOW = 1_770_000_000_000

const CONFIGURED = readEnv({
  ADMIN_USERNAME: 'operator',
  ADMIN_PASSWORD_HASH: 'hash-of-a-password',
})

describe('설정이 없으면 닫힌 쪽으로 실패한다', () => {
  it('세션을 못 만든다', () => {
    // 관리자 계정이 설정 안 된 서버는 관리자 경로가 닫혀 있어야 맞습니다
    expect(issueAdminSession(readEnv({}), NOW)).toBeNull()
  })

  it('어떤 쿠키도 통과시키지 않는다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)

    expect(verifyAdminSession(made!.value, readEnv({}), NOW)).toBe(false)
  })
})

describe('우리가 서명한 것만 통과한다', () => {
  it('만든 것은 통과한다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)

    expect(verifyAdminSession(made!.value, CONFIGURED, NOW)).toBe(true)
  })

  it('서명을 건드리면 막힌다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)!
    const [version, expires, signature] = made.value.split('.')
    const flipped = signature.replace(/^./, (c) => (c === 'a' ? 'b' : 'a'))

    expect(verifyAdminSession(`${version}.${expires}.${flipped}`, CONFIGURED, NOW))
      .toBe(false)
  })

  it('만료 시각을 늘리면 막힌다 — 서명이 그 값을 덮고 있다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)!
    const [version, , signature] = made.value.split('.')
    const later = NOW + 10 * 365 * 24 * 3_600_000

    expect(verifyAdminSession(`${version}.${later}.${signature}`, CONFIGURED, NOW))
      .toBe(false)
  })

  it('지난 것은 막힌다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)!
    const afterExpiry = NOW + ADMIN_SESSION_MAX_AGE_SECONDS * 1000 + 1

    expect(verifyAdminSession(made.value, CONFIGURED, afterExpiry)).toBe(false)
  })

  it('모양이 아니면 막힌다', () => {
    for (const bad of ['', 'x', 'v1.123', 'v0.123.abc', 'v1.abc.def']) {
      expect(verifyAdminSession(bad, CONFIGURED, NOW), bad).toBe(false)
    }
  })

  it('어떤 서명이 와도 던지지 않는다', () => {
    // timingSafeEqual 은 두 버퍼의 **바이트** 길이가 다르면 예외를 던집니다.
    // 글자 수로 재는 것으로는 못 막습니다 — `é` 는 1글자 2바이트,
    // 이모지는 UTF-16 2칸에 4바이트입니다
    const future = NOW + 3_600_000

    for (const signature of [
      'a'.repeat(63) + '\u00e9',
      'a'.repeat(62) + '\u{1F642}',
      'a'.repeat(200),
      '',
      '\u0000'.repeat(64),
    ]) {
      const value = `v1.${future}.${signature}`
      expect(() => verifyAdminSession(value, CONFIGURED, NOW)).not.toThrow()
      expect(verifyAdminSession(value, CONFIGURED, NOW)).toBe(false)
    }
  })

  it('없으면 막힌다', () => {
    expect(verifyAdminSession(null, CONFIGURED, NOW)).toBe(false)
    expect(verifyAdminSession(undefined, CONFIGURED, NOW)).toBe(false)
  })
})

describe('비밀번호를 바꾸면 기존 세션이 끊긴다', () => {
  it('해시가 달라지면 안 맞는다', () => {
    // 서명 키를 ADMIN_PASSWORD_HASH 에서 파생하기 때문입니다 —
    // 새 환경변수를 만들지 않으면서 얻는 덤입니다
    const made = issueAdminSession(CONFIGURED, NOW)!
    const changed = readEnv({
      ADMIN_USERNAME: 'operator',
      ADMIN_PASSWORD_HASH: 'hash-of-a-NEW-password',
    })

    expect(verifyAdminSession(made.value, changed, NOW)).toBe(false)
  })
})

describe('쿠키에 담는 것', () => {
  it('아이디도 개인정보도 담지 않는다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)!

    expect(made.value).not.toContain('operator')
    expect(made.value).not.toContain('hash-of-a-password')
  })

  it('스크립트가 못 읽고, 평문 연결로 안 나가고, 남의 사이트에서 안 실린다', () => {
    const line = adminSessionSetCookie('v1.1.abc', ADMIN_SESSION_MAX_AGE_SECONDS)

    expect(line).toContain('HttpOnly')
    expect(line).toContain('Secure')
    expect(line).toContain('SameSite=Strict')
  })

  it('로그아웃은 수명 0 으로 덮는다', () => {
    expect(adminSessionClearCookie()).toContain('Max-Age=0')
  })
})

describe('Cookie 헤더 읽기', () => {
  it('이름으로 하나를 꺼낸다', () => {
    const header = `other=1; ${ADMIN_SESSION_COOKIE}=v1.2.abc; last=z`

    expect(readCookie(header, ADMIN_SESSION_COOKIE)).toBe('v1.2.abc')
  })

  it('이름이 비슷한 것에 속지 않는다', () => {
    const header = `not_${ADMIN_SESSION_COOKIE}=nope`

    expect(readCookie(header, ADMIN_SESSION_COOKIE)).toBeNull()
  })

  it('헤더가 없으면 null 이다', () => {
    expect(readCookie(null, ADMIN_SESSION_COOKIE)).toBeNull()
  })

  it('깨진 인코딩에 던지지 않는다', () => {
    // decodeURIComponent('%') 는 예외를 던집니다. 문지기가 그걸 맞으면
    // 인증 없는 요청 한 줄이 401 대신 500 이 됩니다
    for (const bad of ['%', '%E0%A4%A', '%zz']) {
      expect(() => readCookies(`${ADMIN_SESSION_COOKIE}=${bad}`, ADMIN_SESSION_COOKIE))
        .not.toThrow()
    }
  })

  it('같은 이름이 여럿이면 전부 돌려준다', () => {
    const header = `${ADMIN_SESSION_COOKIE}=first; ${ADMIN_SESSION_COOKIE}=second`

    expect(readCookies(header, ADMIN_SESSION_COOKIE)).toEqual(['first', 'second'])
  })
})

describe('가짜 쿠키를 앞에 끼워 진짜를 밀어낼 수 없다', () => {
  it('실려 온 것 중 하나라도 맞으면 통과한다', () => {
    // 이웃 서브도메인이 같은 이름으로 하나 심으면, 앞의 것만 보는 구현에서는
    // 진짜 관리자가 로그인해도 계속 401 을 받아 조사가 막힙니다.
    // 서명은 못 만드니 권한이 올라가지는 않지만 잠기는 것도 사고입니다
    const real = issueAdminSession(CONFIGURED, NOW)!
    const request = new Request('http://x/api/admin/x', {
      headers: {
        cookie: `${ADMIN_SESSION_COOKIE}=fake; ${ADMIN_SESSION_COOKIE}=${real.value}`,
      },
    })

    expect(hasAdminSession(request, CONFIGURED, NOW)).toBe(true)
  })

  it('이름 자체가 서브도메인 덮어쓰기를 막는 접두사를 쓴다', () => {
    // __Host- 가 붙은 쿠키는 Secure · Path=/ · Domain 없음일 때만 저장되고,
    // 다른 서브도메인이 같은 이름으로 덮어쓸 수 없습니다
    expect(ADMIN_SESSION_COOKIE.startsWith('__Host-')).toBe(true)

    const line = adminSessionSetCookie('v1.1.abc', 60)
    expect(line).toContain('Path=/')
    expect(line).toContain('Secure')
    expect(line).not.toContain('Domain=')
  })
})

describe('요청 하나로 판단한다', () => {
  it('쿠키를 실은 요청은 통과한다', () => {
    const made = issueAdminSession(CONFIGURED, NOW)!
    const request = new Request('http://x/api/admin/x', {
      headers: { cookie: `${ADMIN_SESSION_COOKIE}=${made.value}` },
    })

    expect(hasAdminSession(request, CONFIGURED, NOW)).toBe(true)
  })

  it('안 실은 요청은 막힌다', () => {
    expect(hasAdminSession(new Request('http://x/api/admin/x'), CONFIGURED, NOW))
      .toBe(false)
  })
})
