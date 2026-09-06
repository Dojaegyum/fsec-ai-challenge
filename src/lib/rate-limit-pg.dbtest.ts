/**
 * 공유 카운터를 실제 Postgres 에 붙여서 보는 시험 → ADR-085.
 *
 * ## 왜 DB 시험이어야 하나
 *
 * 이 카운터가 겨누는 것은 **동시성**입니다. 「증가와 조회가 한 문장」이라는
 * 약속(§1.3)은 문장을 실제로 보내 봐야 알 수 있고, 가짜 `sql` 로는
 * `ON CONFLICT … DO UPDATE … RETURNING` 이 정말 한 번에 도는지 확인할 수
 * 없습니다 — 2026-09-06 QA 가 잡은 사고가 정확히 「따로 세고 있었다」였습니다.
 *
 * 돌리는 법·건너뛰는 규칙은 [db.dbtest.ts](./db.dbtest.ts) 와 같습니다:
 *
 * ```
 * cd src && npm run migrate && npm run test:db
 * ```
 *
 * ⚠️ **개발 DB 를 함께 씁니다.** 키를 `test:` 로 시작하는 것만 만들고 끝에 지웁니다.
 */

import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, it } from 'vitest'

import { createSql } from './db'
import { readEnv } from './env'
import { createPostgresRateCounter } from './rate-limit-pg'

/** `.env.local` 을 아주 얇게 읽습니다 — 시험 하나 때문에 로더를 들이지 않습니다 */
function fromEnvLocal(key: string): string | undefined {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at < 0 || line.trimStart().startsWith('#')) continue
      if (line.slice(0, at).trim() !== key) continue
      return line
        .slice(at + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  } catch {
    // 파일이 없으면 그냥 건너뜁니다 — 없는 것이 정상인 환경이 있습니다
  }
  return undefined
}

const URL_ = process.env.DATABASE_URL ?? fromEnvLocal('DATABASE_URL')

if (!URL_) {
  console.warn('DATABASE_URL 이 없어 속도 제한 DB 시험을 건너뜁니다 (실패가 아닙니다).')
}

describe.skipIf(!URL_)('속도 제한 카운터가 실제 Postgres 에서', () => {
  const sql = createSql(readEnv({ DATABASE_URL: URL_ }))!

  afterAll(async () => {
    // 이 시험이 만든 것만 지웁니다 — 개발 DB 를 여럿이 나눠 씁니다
    await sql`DELETE FROM rate_limit_window WHERE key LIKE 'test:%'`
    await sql.end({ timeout: 5 })
  })

  it('같은 키를 같은 창에서 세 번 치면 3 이 되고, 창이 지나면 1 로 돌아간다', async () => {
    const counter = createPostgresRateCounter(sql)
    const key = `test:${Date.now()}`

    const a = await counter.hit(key, 60_000, 1_000_000)
    const b = await counter.hit(key, 60_000, 1_000_500)
    const c = await counter.hit(key, 60_000, 1_001_000)

    expect([a.count, b.count, c.count]).toEqual([1, 2, 3])
    // **창 끝은 처음 친 시각 + 창 길이입니다.** 칠 때마다 뒤로 밀면 상한에 걸린
    // 사람이 영영 못 빠져나옵니다
    expect(c.resetAtMs).toBe(1_060_000)

    const d = await counter.hit(key, 60_000, 1_060_001)
    expect(d.count).toBe(1)
  })

  it('동시에 20번 쳐도 20 이다 — 증가와 조회가 한 문장', async () => {
    const counter = createPostgresRateCounter(sql)
    const key = `test:conc:${Date.now()}`

    const results = await Promise.all(
      Array.from({ length: 20 }, () => counter.hit(key, 60_000, 2_000_000)),
    )

    // 읽고 나서 쓰면 여럿이 같은 값을 읽어 최댓값이 20 에 못 미칩니다 → §1.3
    expect(Math.max(...results.map((one) => one.count))).toBe(20)
  })

  it('키가 다르면 서로를 밀어내지 않는다', async () => {
    const counter = createPostgresRateCounter(sql)
    const stamp = Date.now()

    const mine = await counter.hit(`test:a:${stamp}`, 60_000, 3_000_000)
    const yours = await counter.hit(`test:b:${stamp}`, 60_000, 3_000_000)

    expect([mine.count, yours.count]).toEqual([1, 1])
  })

  it('끝난 창을 걷어내고 살아 있는 창은 남긴다 — purge 크론이 부르는 자리', async () => {
    const counter = createPostgresRateCounter(sql)
    const stamp = Date.now()
    const dead = `test:dead:${stamp}`
    const alive = `test:alive:${stamp}`

    // 창 길이를 음수로 줄 수 없으니 아주 짧은 창으로 만들고 그 뒤 시각으로 지웁니다
    await counter.hit(dead, 1, 4_000_000)
    await counter.hit(alive, 600_000, 4_000_000)

    // 지운 줄 수를 돌려줍니다 — 크론 응답의 `rate_windows_purged` 가 이 값입니다
    expect(await counter.purgeExpired(4_000_100)).toBeGreaterThanOrEqual(1)

    const back = await sql<{ key: string }[]>`
      SELECT key FROM rate_limit_window WHERE key IN (${dead}, ${alive})
    `
    expect(back.map((one) => one.key)).toEqual([alive])
  })
})
