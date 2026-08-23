/**
 * 식별자 발급 시험.
 *
 * 검증 대상: decisions/039-link-token.md ② ·
 *            spec/backend/08-16-data-model.md §4 (`case_id` · `link_token`)
 *
 * **여기서 못 박는 것 셋:**
 * 1. `case_id` 는 시간순으로 정렬된다 — 그래서 URL 에 쓰면 안 된다
 * 2. **링크 토큰은 시각을 흘리지 않는다** — 이게 ADR-039 의 존재 이유다
 * 3. 형식 검사로는 둘을 못 가른다 — 그 사실 자체를 시험으로 남긴다
 */

import { describe, expect, it } from 'vitest'

import {
  LINK_TOKEN_LENGTH,
  ULID_LENGTH,
  isTokenShaped,
  isUlid,
  newLinkToken,
  newUlid,
} from './ids'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

describe('case_id — 정렬 가능해야 한다', () => {
  it('26자다', () => {
    expect(newUlid()).toHaveLength(ULID_LENGTH)
  })

  it('나중에 만든 것이 사전순으로도 뒤에 온다', () => {
    const earlier = newUlid(1_700_000_000_000)
    const later = newUlid(1_700_000_001_000)
    expect(earlier < later).toBe(true)
  })

  it('같은 시각이어도 값이 다르다', () => {
    const at = 1_700_000_000_000
    const many = new Set(Array.from({ length: 200 }, () => newUlid(at)))
    expect(many.size).toBe(200)
  })
})

describe('링크 토큰 — 추측을 막아야 한다 — ADR-039 ②', () => {
  it('26자다', () => {
    expect(newLinkToken()).toHaveLength(LINK_TOKEN_LENGTH)
  })

  it('Crockford Base32 만 쓴다 — I·L·O·U 가 없다', () => {
    const token = newLinkToken()
    for (const char of token) expect(ALPHABET).toContain(char)
    expect(token).not.toMatch(/[ILOU]/)
  })

  it('**앞자리가 시각을 흘리지 않는다** — 이게 이 토큰의 존재 이유다', () => {
    // case_id 는 앞 10자가 생성 시각이라, 같은 순간에 만들면 앞자리가 같습니다.
    // 링크 토큰이 그러면 하나를 아는 사람이 이웃 사건을 좁혀서 찔러볼 수 있습니다
    const ulids = Array.from({ length: 50 }, () => newUlid(1_700_000_000_000))
    expect(new Set(ulids.map((one) => one.slice(0, 10))).size).toBe(1)

    const tokens = Array.from({ length: 50 }, () => newLinkToken())
    // 50개를 뽑았는데 앞 10자가 겹치는 것이 있으면 난수가 아닙니다
    expect(new Set(tokens.map((one) => one.slice(0, 10))).size).toBe(50)
  })

  it('겹치지 않는다', () => {
    const many = new Set(Array.from({ length: 2000 }, () => newLinkToken()))
    expect(many.size).toBe(2000)
  })

  it('32글자를 고르게 쓴다 — 한쪽으로 쏠리면 실질 자릿수가 준다', () => {
    const counts = new Map<string, number>()
    for (let i = 0; i < 500; i += 1) {
      for (const char of newLinkToken()) {
        counts.set(char, (counts.get(char) ?? 0) + 1)
      }
    }
    // 13,000 글자를 32종에 나누면 종당 약 406개.
    // 치우침이 없으면 어느 글자도 절반 아래나 두 배 위로 가지 않습니다
    expect(counts.size).toBe(32)
    for (const [char, n] of counts) {
      expect(n, `${char} 가 ${n}번`).toBeGreaterThan(200)
      expect(n, `${char} 가 ${n}번`).toBeLessThan(800)
    }
  })
})

describe('형식만으로는 둘을 못 가른다 — 그래서 조회가 필요하다', () => {
  it('같은 검사가 양쪽을 다 통과시킨다', () => {
    // ADR-039 가 「주석으로 경고」를 기각하고 이름을 바꾼 이유입니다.
    // 이 시험이 통과한다는 것은 **형식 검사를 신분 확인으로 쓰면 안 된다**는 뜻입니다
    expect(isUlid(newUlid())).toBe(true)
    expect(isUlid(newLinkToken())).toBe(true)
    expect(isTokenShaped(newUlid())).toBe(true)
    expect(isTokenShaped(newLinkToken())).toBe(true)
  })

  it('명백한 쓰레기는 걸러낸다', () => {
    expect(isTokenShaped('')).toBe(false)
    expect(isTokenShaped('짧다')).toBe(false)
    // I·L·O·U 는 알파벳에 없습니다
    expect(isTokenShaped('IIIIIIIIIIIIIIIIIIIIIIIIII')).toBe(false)
    expect(isTokenShaped('0123456789ABCDEFGHJKMNPQRSTVWXYZ')).toBe(false)
    expect(isTokenShaped('../../etc/passwd')).toBe(false)
  })
})
