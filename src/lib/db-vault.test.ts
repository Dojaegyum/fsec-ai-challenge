/**
 * 볼트가 무엇을 가져오는가 — 시험.
 *
 * 검증 대상: spec/common/08-14-pii-boundary.md 「번호의 단위」 · 불변 규칙 1 ·
 *            spec/common/08-14-api.md §3.11
 * 근거: ADR-009(매핑은 암호문으로 서버에) · ADR-027(키는 브라우저에만) · ADR-049
 *
 * **여기서 못 박는 것 둘:**
 * 1. 이름표 목록 질의가 **`ciphertext` 를 안 고른다** — 안 가져오는 것이
 *    이 설계의 요점입니다. 번호를 잇는 데 값이 필요 없습니다
 * 2. 사건 하나로 좁힌다 — 남의 사건 번호를 이어받으면 안 됩니다
 *
 * 실제 DB 에는 붙지 않습니다. **버그가 살 수 있는 곳은 SELECT 목록**이고,
 * 그건 질의문을 들여다보는 것으로 확인됩니다. 표 자체의 동작은
 * `db.live.test.ts` 가 봅니다.
 */

import { describe, expect, it } from 'vitest'

import { createVaultMappings } from './db'
import type { Sql } from './db'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** 질의문과 넘긴 값을 들여다볼 수 있는 가짜 연결 */
function sqlOf(rows: readonly Record<string, unknown>[]) {
  const seen: { text: string; params: unknown[] }[] = []
  const fake = Object.assign(
    (strings: TemplateStringsArray, ...params: unknown[]) => {
      seen.push({ text: strings.join('?'), params })
      return Promise.resolve([...rows])
    },
    { json: (value: unknown) => value },
  )
  return { sql: fake as unknown as Sql, seen }
}

describe('쓰인 이름표만 가져온다 — 값은 안 가져온다', () => {
  it('질의에 `ciphertext` 가 없다', async () => {
    const { sql, seen } = sqlOf([{ token: '[계좌-1]' }])

    await createVaultMappings(sql).tokens(CASE_ID)

    expect(seen).toHaveLength(1)
    // ⚠️ **여기가 이 고침의 핵심입니다.** 서버는 「어느 번호가 쓰였나」만 알고
    // 「그 값이 무엇인가」는 끝까지 모릅니다 → 불변 규칙 1
    expect(seen[0].text).not.toContain('ciphertext')
    expect(seen[0].text).toContain('token')
    expect(seen[0].text).toContain('case_vault.restore_mapping')
  })

  it('사건 하나로 좁힌다', async () => {
    const { sql, seen } = sqlOf([])

    await createVaultMappings(sql).tokens(CASE_ID)

    expect(seen[0].text).toContain('WHERE case_id =')
    expect(seen[0].params).toContain(CASE_ID)
  })

  it('이름표 문자열만 돌려준다', async () => {
    const { sql } = sqlOf([{ token: '[계좌-1]' }, { token: '[이름-2]' }])

    expect(await createVaultMappings(sql).tokens(CASE_ID)).toEqual([
      '[계좌-1]',
      '[이름-2]',
    ])
  })

  /** 새 사건은 맡긴 것이 없습니다. 그때가 1번부터입니다 */
  it('맡긴 것이 없으면 빈 목록', async () => {
    const { sql } = sqlOf([])

    expect(await createVaultMappings(sql).tokens(CASE_ID)).toEqual([])
  })
})

describe('되받는 자리는 암호문을 그대로 낸다 — §3.11 `GET`', () => {
  /** 이쪽은 브라우저가 열 것이라 암호문이 나가야 합니다 → ADR-050 */
  it('`list` 는 암호문까지 가져온다', async () => {
    const { sql, seen } = sqlOf([{ token: '[계좌-1]', ciphertext: 'AAAA' }])

    const got = await createVaultMappings(sql).list(CASE_ID)

    expect(seen[0].text).toContain('ciphertext')
    expect(got).toEqual([{ token: '[계좌-1]', ciphertext: 'AAAA' }])
  })
})
