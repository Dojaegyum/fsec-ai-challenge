/**
 * 선별 후보 풀 — 실제 Postgres 에 붙어 조회문 셋이 도는지 본다.
 *
 * `schema-names` 는 표·칸 이름만 보고, 단위 시험은 SQL 을 돌리지 않습니다. `DISTINCT ON` ·
 * `NULLS FIRST` · 날짜 비교가 실제로 통하는지는 여기서만 압니다 → `npm run test:db`.
 *
 * 공유 DB 의 **현재 릴리스**를 그대로 읽습니다. 쓰지 않으므로 다른 시험과 부딪히지 않습니다.
 */

import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, it } from 'vitest'

import { createSql } from './db'
import { createSelectorPool } from './db-selector'
import { readEnv } from './env'

function fromEnvLocal(name: string): string | undefined {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    const line = text.split('\n').find((one) => one.startsWith(`${name}=`))
    return line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') || undefined
  } catch {
    return undefined
  }
}

const URL_ = process.env.DATABASE_URL ?? fromEnvLocal('DATABASE_URL')
const KB_VERSION = process.env.KB_VERSION ?? fromEnvLocal('KB_VERSION')

if (!URL_ || !KB_VERSION) {
  console.warn('DATABASE_URL · KB_VERSION 이 없어 선별 풀 DB 시험을 건너뜁니다 (실패가 아닙니다).')
}

describe.skipIf(!URL_ || !KB_VERSION)('선별 후보 풀을 실제 DB 에서 읽는다', () => {
  const sql = createSql(readEnv({ DATABASE_URL: URL_ }))!
  const pool = createSelectorPool(sql)
  const today = new Date().toISOString().slice(0, 10)

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('절차·기관·조문이 한 번에 오고, 열쇠가 겹치지 않는다', async () => {
    const snapshot = await pool.load({ kbVersion: KB_VERSION!, asOf: today })

    const kinds = new Set(snapshot.candidates.map((one) => one.kind))
    expect(kinds.has('kb')).toBe(true)
    expect(kinds.has('org')).toBe(true)

    const keys = snapshot.candidates.map((one) => one.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(snapshot.entries.size).toBe(keys.length)
    for (const key of keys) expect(snapshot.entries.has(key)).toBe(true)

    const counts = { kb: 0, org: 0, law: 0 }
    for (const one of snapshot.candidates) counts[one.kind] += 1
    console.info(`[선별 풀] 절차 ${counts.kb} · 기관 ${counts.org} · 조문 ${counts.law} (릴리스 ${KB_VERSION})`)
  })

  it('한 줄 미리보기는 200자 안이고 태그가 비지 않는다', async () => {
    const snapshot = await pool.load({ kbVersion: KB_VERSION!, asOf: today })
    for (const one of snapshot.candidates) {
      expect(one.tag.length).toBeGreaterThan(0)
      expect(one.preview.length).toBeLessThanOrEqual(200)
      expect(one.preview).not.toContain('\n')
    }
  })

  it('조문은 source_key 마다 한 판만 — 최신본', async () => {
    const snapshot = await pool.load({ kbVersion: KB_VERSION!, asOf: today })
    const law = snapshot.candidates.filter((one) => one.kind === 'law')
    const sourceKeys = law.map((one) => one.key.replace(/^law:/, ''))
    expect(new Set(sourceKeys).size).toBe(sourceKeys.length)
    for (const one of law) {
      const entry = snapshot.entries.get(one.key)
      expect(entry?.kind).toBe('law')
      if (entry?.kind === 'law') expect(entry.law.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('없는 릴리스면 절차·기관은 비고 조문만 남는다 — 조문은 릴리스에 안 묶인다', async () => {
    const snapshot = await pool.load({ kbVersion: 'no.such.release', asOf: today })
    expect(snapshot.candidates.every((one) => one.kind === 'law')).toBe(true)
  })
})
