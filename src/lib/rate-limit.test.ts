/**
 * 속도 제한 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §1.3 · spec/backend/08-16-errors.md §3.1
 *
 * **표의 숫자를 시험이 다시 적습니다.** 값이 조용히 바뀌면 여기서 걸립니다 —
 * 상한을 낮추는 변경은 피해 직후의 사용자를 막는 변경이라 눈에 띄어야 합니다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createServerClock } from './clock'
import { RateLimitedError } from './errors'
import {
  RATE_RULES,
  createMemoryRateCounter,
  createRateLimiter,
  type RateCounterStore,
} from './rate-limit'

import { DEFAULT_LIMITS } from '@/modules/case-intake'

/** 손으로 감는 시계. 창이 넘어가는 순간을 정확히 보려는 것입니다 */
function fixedClock(startMs = 1_770_000_000_000) {
  let atMs = startMs
  return {
    clock: createServerClock(() => new Date(atMs)),
    advance: (ms: number) => {
      atMs += ms
    },
  }
}

/** 던진 것을 받아 온다. 안 던지면 시험이 그 자리에서 깨집니다 */
async function thrownBy(run: () => Promise<unknown>): Promise<RateLimitedError> {
  try {
    await run()
  } catch (error) {
    return error as RateLimitedError
  }
  throw new Error('던졌어야 합니다')
}

function limiterAt(startMs?: number) {
  const { clock, advance } = fixedClock(startMs)
  return {
    limiter: createRateLimiter({ counter: createMemoryRateCounter(), clock }),
    advance,
  }
}

describe('정본 §1.3 의 표', () => {
  it('챗은 사건당 분당 20턴', () => {
    expect(RATE_RULES.chat).toMatchObject({ scope: 'case', limit: 20, windowMs: 60_000 })
  })

  it('슬롯 응답은 사건당 분당 60회', () => {
    expect(RATE_RULES.slot).toMatchObject({ scope: 'case', limit: 60, windowMs: 60_000 })
  })

  it('사건 생성은 IP당 시간당 20건', () => {
    // 사건이 아직 없는 시점이라 다른 기준이 없습니다
    expect(RATE_RULES.caseCreate).toMatchObject({
      scope: 'ip',
      limit: 20,
      windowMs: 3_600_000,
    })
  })

  it('그 외 조회는 세션당 분당 300회', () => {
    // 폴링(§3.3)이 여기 포함됩니다
    expect(RATE_RULES.read).toMatchObject({
      scope: 'session',
      limit: 300,
      windowMs: 60_000,
    })
  })

  it('증거 업로드는 창이 아니라 누적 총량이고, 값은 case-intake 가 갖고 있다', () => {
    // 사건이 사는 동안의 합계라 창으로 세는 넷과 같은 자리에 둘 수 없습니다.
    // 같은 숫자를 lib 에 한 벌 더 적으면 정본이 둘이 됩니다
    expect(DEFAULT_LIMITS.maxFiles).toBe(30)
    expect(DEFAULT_LIMITS.maxTotalBytes).toBe(300 * 1024 * 1024)
    expect(Object.keys(RATE_RULES)).not.toContain('evidence')
  })
})

describe('상한을 넘으면 429 · RATE_LIMITED', () => {
  it('상한까지는 통과한다', async () => {
    const { limiter } = limiterAt()

    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await expect(limiter.check('chat', '01J8CASE')).resolves.toBeUndefined()
    }
  })

  it('한 번 더 부르면 던진다', async () => {
    const { limiter } = limiterAt()
    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await limiter.check('chat', '01J8CASE')
    }

    await expect(limiter.check('chat', '01J8CASE')).rejects.toBeInstanceOf(
      RateLimitedError,
    )
  })

  it('대상이 다르면 서로 안 셉니다', async () => {
    const { limiter } = limiterAt()
    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await limiter.check('chat', '01J8CASE')
    }

    // 다른 사건의 사용자가 남의 상한에 걸리면 안 됩니다
    await expect(limiter.check('chat', '01J8OTHER')).resolves.toBeUndefined()
  })

  it('갈래가 다르면 서로 안 셉니다', async () => {
    const { limiter } = limiterAt()
    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await limiter.check('chat', '01J8CASE')
    }

    await expect(limiter.check('slot', '01J8CASE')).resolves.toBeUndefined()
  })
})

describe('Retry-After — 남은 창 시간 → §3.1', () => {
  it('detail 에 남은 초를 싣는다', async () => {
    const { limiter, advance } = limiterAt()
    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await limiter.check('chat', '01J8CASE')
    }
    advance(20_000)

    const error = await thrownBy(() => limiter.check('chat', '01J8CASE'))

    // 창이 60초인데 20초가 지났으니 40초 남았습니다
    expect(error.detail.retryAfterSeconds).toBe(40)
  })

  it('0초를 내보내지 않는다', async () => {
    // 0 이면 화면이 「지금 다시」로 읽어 곧장 다시 칩니다
    const { limiter, advance } = limiterAt()
    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await limiter.check('chat', '01J8CASE')
    }
    advance(59_999)

    const error = await thrownBy(() => limiter.check('chat', '01J8CASE'))

    expect(error.detail.retryAfterSeconds).toBe(1)
  })

  it('detail 에 대상 값을 넣지 않는다', async () => {
    // 감사 로그로 흘러가는 자리이고 IP 는 그 자체로 사람에 가까운 값입니다
    const { limiter } = limiterAt()
    for (let i = 0; i < RATE_RULES.caseCreate.limit; i += 1) {
      await limiter.check('caseCreate', '203.0.113.9')
    }

    const error = await thrownBy(() => limiter.check('caseCreate', '203.0.113.9'))

    expect(JSON.stringify(error.detail)).not.toContain('203.0.113.9')
  })
})

describe('창이 지나면 다시 열린다', () => {
  it('1분 뒤에는 통과한다', async () => {
    const { limiter, advance } = limiterAt()
    for (let i = 0; i < RATE_RULES.chat.limit; i += 1) {
      await limiter.check('chat', '01J8CASE')
    }
    await expect(limiter.check('chat', '01J8CASE')).rejects.toBeInstanceOf(
      RateLimitedError,
    )

    advance(60_000)

    await expect(limiter.check('chat', '01J8CASE')).resolves.toBeUndefined()
  })
})

describe('세는 곳을 숨기지 않는다', () => {
  it('프로세스 메모리임을 밝힌다', () => {
    // 공유 저장소가 붙었으면 `shared` 입니다 → ADR-085. 못 하는 일을 숨기지 않습니다
    const { limiter } = limiterAt()

    expect(limiter.storeKind).toBe('memory')
  })

  it('항목이 상한을 넘으면 먼저 끝나는 창부터 버린다', async () => {
    const counter = createMemoryRateCounter(2)

    // 1시간짜리(사건 생성)와 1분짜리(조회)를 섞어 둡니다
    await counter.hit('caseCreate:1.2.3.4', 3_600_000, 1_000)
    await counter.hit('read:s:a', 60_000, 1_000)
    // 세 번째가 들어오면 자리가 없어 하나를 버려야 합니다
    await counter.hit('read:s:b', 60_000, 1_000)

    // 버려진 것은 먼저 끝나는 1분짜리여야 합니다 — 다시 부르면 1부터 셉니다
    expect((await counter.hit('read:s:a', 60_000, 1_000)).count).toBe(1)
  })

  it('오래 세야 하는 카운터를 짧은 창이 밀어내지 못한다', async () => {
    // 세션 식별자는 클라이언트가 아무 값이나 넣을 수 있어(정본 §1 이 형식을
    // 안 정했습니다) 매 요청 다른 값을 보내면 짧은 창이 무한히 쌓입니다.
    // 그때 사건 생성 카운터(1시간)가 밀려나면 §1.3 의 「IP당 시간당 20건」이
    // 통째로 0으로 돌아갑니다
    const counter = createMemoryRateCounter(8)

    await counter.hit('caseCreate:1.2.3.4', 3_600_000, 1_000)
    for (let i = 0; i < 50; i += 1) {
      await counter.hit(`read:s:${i}`, 60_000, 1_000)
    }

    // 사건 생성 카운터는 살아 있어야 합니다 — 두 번째니까 2
    expect((await counter.hit('caseCreate:1.2.3.4', 3_600_000, 1_000)).count).toBe(2)
  })

  it('상한이 0 이어도 멈춘다', async () => {
    // 버릴 것이 없는데 자리를 비우려 들면 고리가 안 끝납니다
    const counter = createMemoryRateCounter(0)

    await expect(counter.hit('a', 60_000, 1_000)).resolves.toMatchObject({ count: 1 })
  })
})

/**
 * ⚠️ **세는 곳을 DB 로 옮기면서 길목에 터질 것이 하나 생겼습니다** → ADR-085 「실패 모드」.
 *
 * `check` 는 모든 요청이 지납니다(`lib/request.ts`). 공유 카운터가 던지는 것을 그대로
 * 올리면 **표가 없거나 풀러가 몰린 동안 사건 생성도 조회도 전부 500** 이 됩니다 —
 * 정본 §1.3 의 *"제한이 정상 사용을 막으면 안 됩니다"* 의 가장 심한 형태입니다.
 *
 * **막지 않되 상한은 남깁니다** — 이 프로세스의 메모리 카운터로 떨어집니다.
 */
describe('공유 카운터가 터지면 이 인스턴스에서 센다 — ADR-085', () => {
  const warned: unknown[][] = []

  afterEach(() => {
    warned.length = 0
    vi.restoreAllMocks()
  })

  /** `hit` 이 늘 던지는 카운터. `purgeExpired` 는 안 쓰입니다 */
  function brokenCounter(): RateCounterStore {
    return {
      kind: 'shared',
      hit: async () => {
        throw new Error('relation "rate_limit_window" does not exist')
      },
      purgeExpired: async () => 0,
    }
  }

  function brokenLimiter() {
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args)
    })
    const { clock, advance } = fixedClock()
    return { limiter: createRateLimiter({ counter: brokenCounter(), clock }), advance }
  }

  it('요청을 막지 않는다 — 500 이 아니라 통과다', async () => {
    const { limiter } = brokenLimiter()

    await expect(limiter.check('read', 's:abc')).resolves.toBeUndefined()
  })

  it('그래도 센다 — 상한을 넘는 11번째는 떨어진 카운터가 거절한다', async () => {
    // 「사건 조회 실패」는 IP당 분당 10회입니다 (§1.3 · ADR-039 ④)
    const { limiter } = brokenLimiter()

    for (let i = 0; i < 10; i += 1) {
      await expect(limiter.check('notFound', '203.0.113.9')).resolves.toBeUndefined()
    }

    const thrown = await thrownBy(() => limiter.check('notFound', '203.0.113.9'))
    expect(thrown).toBeInstanceOf(RateLimitedError)
    expect(thrown.detail).toMatchObject({ bucket: 'notFound', limit: 10 })
  })

  it('실패마다 한 번씩 남긴다 — 대상 값은 안 적는다', async () => {
    const { limiter } = brokenLimiter()

    await limiter.check('read', 's:01J8SECRET')
    await limiter.check('read', 's:01J8SECRET')

    expect(warned).toHaveLength(2)
    expect(warned[0][0]).toBe('[rate-limit] 공유 카운터 실패 — 이 인스턴스의 메모리 카운터로 셉니다')
    expect(warned[0][1]).toEqual({ bucket: 'read', error: 'Error' })
    // IP·세션 값은 그 자체로 사람에 가까운 값입니다 → 09-data-model.md §10.1
    expect(JSON.stringify(warned)).not.toContain('01J8SECRET')
  })

  it('공유 카운터가 멀쩡하면 떨어지지 않는다 — 경고도 없다', async () => {
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args)
    })
    const { limiter } = limiterAt()

    await limiter.check('read', 's:abc')

    expect(warned).toHaveLength(0)
  })
})

/**
 * ⚠️ **`X-Session-Id` 는 클라이언트가 아무 값이나 넣습니다** (§1 이 형식을 안 정했습니다).
 *
 * 그 값이 열쇠에 그대로 실리면 (1) btree 색인 상한(약 2704바이트)을 넘는 헤더 하나가
 * 기본키 삽입을 터뜨리고 (2) 매 요청 다른 값을 보내면 요청마다 한 줄이 늘어납니다.
 * → ADR-085 「세는 키는 지문입니다」
 */
describe('세는 키는 대상의 지문이다 — ADR-085', () => {
  /** 카운터가 실제로 받은 열쇠를 들여다봅니다 */
  function spyCounter() {
    const keys: string[] = []
    const inner = createMemoryRateCounter()
    const counter: RateCounterStore = {
      kind: 'shared',
      hit: async (key, windowMs, nowMs) => {
        keys.push(key)
        return inner.hit(key, windowMs, nowMs)
      },
      purgeExpired: async (nowMs) => inner.purgeExpired(nowMs),
    }
    const { clock } = fixedClock()
    return { keys, limiter: createRateLimiter({ counter, clock }) }
  }

  it('10KB 짜리 대상도 길이가 고정된다', async () => {
    const { keys, limiter } = spyCounter()

    await limiter.check('read', 'x'.repeat(10_000))

    // 갈래 이름은 우리 것이라 그대로, 대상만 SHA-256 앞 32자로
    expect(keys[0]).toBe(`read:${keys[0].slice('read:'.length)}`)
    expect(keys[0]).toHaveLength('read:'.length + 32)
    expect(keys[0]).toMatch(/^read:[0-9a-f]{32}$/)
  })

  it('짧은 대상도 같은 길이다 — 열쇠 길이가 값을 흘리지 않는다', async () => {
    const { keys, limiter } = spyCounter()

    await limiter.check('read', 'a')
    await limiter.check('read', 'x'.repeat(4_000))

    expect(keys[0]).toHaveLength(keys[1].length)
  })

  it('다른 대상은 다른 열쇠다 — 표본 안에서 겹치지 않는다', async () => {
    const { keys, limiter } = spyCounter()
    const subjects = [
      '203.0.113.9',
      '203.0.113.10',
      's:01J8XKQZ3M7N2P4R6T8V0W2Y4A',
      's:01J8XKQZ3M7N2P4R6T8V0W2Y4B',
      '01J8CASE000000000000000000',
      '', // 헤더가 비어 온 경우
      'x'.repeat(10_000),
      `${'x'.repeat(9_999)}y`,
    ]

    for (const one of subjects) await limiter.check('read', one)

    expect(new Set(keys).size).toBe(subjects.length)
  })

  it('같은 대상은 같은 열쇠다 — 안 그러면 아무도 상한에 안 걸린다', async () => {
    const { keys, limiter } = spyCounter()

    await limiter.check('read', 's:same')
    await limiter.check('read', 's:same')

    expect(keys[0]).toBe(keys[1])
  })

  it('갈래가 다르면 서로를 밀어내지 않는다', async () => {
    const { keys, limiter } = spyCounter()

    await limiter.check('read', 'same-subject')
    await limiter.check('notFound', 'same-subject')

    expect(keys[0]).not.toBe(keys[1])
    expect(keys[0].startsWith('read:')).toBe(true)
    expect(keys[1].startsWith('notFound:')).toBe(true)
  })
})
