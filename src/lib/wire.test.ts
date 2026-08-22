/**
 * 조립본이 프로세스에 하나인지 확인하는 시험.
 *
 * **이게 깨지면 속도 제한이 통째로 무력해집니다.** 요청마다 조립본이 새로 나면
 * 카운터도 새로 나서 아무도 상한에 안 걸립니다 → 08-14-api.md §1.3.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { getContainer, resetContainer } from './wire'

afterEach(() => {
  resetContainer()
})

describe('프로세스에 하나', () => {
  it('두 번 불러도 같은 것이다', () => {
    expect(getContainer()).toBe(getContainer())
  })

  it('속도 제한 카운터가 요청 사이에 이어진다', async () => {
    const first = getContainer()
    await first.rateLimiter.check('chat', '01J8SAME')

    // 다음 요청이 같은 카운터를 봐야 상한이 뜻을 가집니다
    const second = getContainer()
    expect(second.rateLimiter).toBe(first.rateLimiter)
  })

  it('버리면 새로 만든다 — 시험이 서로 안 물려받게', () => {
    const first = getContainer()
    resetContainer()

    expect(getContainer()).not.toBe(first)
  })
})

describe('자원이 하나도 없어도 뜬다', () => {
  it('던지지 않는다', () => {
    // 하나 때문에 서버가 안 뜨면 붙어 있는 것도 못 씁니다
    expect(() => getContainer()).not.toThrow()
  })
})
