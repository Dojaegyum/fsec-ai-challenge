/**
 * 플랜 저장소가 표에서 무엇을 되읽는가 — 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §3.6 (`generated_at`) ·
 *            spec/backend/08-16-data-model.md §6 (`plan_step.generated_at`)
 * 근거: ADR-047(단계 하나의 모양)
 *
 * **여기서 못 박는 것 둘:**
 * 1. `readSteps` 가 `generated_at` 을 **읽어 온다** — INSERT 는 적는데
 *    SELECT 에 칼럼이 없어 계약의 칸이 늘 비어 있었습니다
 * 2. 그 값이 **표에 있던 시각 그대로**다 — 읽은 때가 아니다
 *
 * 실제 DB 에는 붙지 않습니다. **버그가 살던 곳은 SELECT 목록과 옮기는
 * 자리**이고, 그건 질의문을 들여다보는 것으로 다 확인됩니다. 표 자체의
 * 동작(`ON CONFLICT` · 되살아나기)은 `db.live.test.ts` 가 봅니다.
 */

import { describe, expect, it } from 'vitest'

import type { Sql } from './db'
import { createCasePlanStore } from './db-plan'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** `plan_step` 한 줄이 표에서 읽혀 온 모양. `generated_at` 은 드라이버가 `Date` 로 줍니다 */
function stepRow(over: Record<string, unknown> = {}) {
  return {
    plan_step_id: '01J8STEP00000000000000000A',
    step_key: 'report-112',
    seq: 1,
    title: '112에 신고하기',
    actor: 'victim',
    conditional: null,
    state: 'not_started',
    body: { text: '112로 전화합니다' },
    kb_entry_id: 'report-112',
    kb_version: '2026.08.1',
    source_url: 'https://www.law.go.kr/...',
    effective_from: '2020-01-01',
    // 한국 시각 2026-08-27 15:30 — 표는 UTC 로 들고 있습니다
    generated_at: new Date('2026-08-27T06:30:00.000Z'),
    ...over,
  }
}

/**
 * 질의문을 들여다볼 수 있는 가짜 연결.
 *
 * `readSteps` 는 셋을 부릅니다 — 단계 · 근거(`kb_entry`) · 부산물(`artifact`).
 * 질의문으로 갈라 답합니다.
 */
function sqlOf(rows: readonly Record<string, unknown>[]) {
  const seen: string[] = []
  const fake = Object.assign(
    (strings: TemplateStringsArray, ...params: unknown[]) => {
      const text = strings.join('?')
      seen.push(text)
      void params
      if (text.includes('FROM plan_step')) return Promise.resolve([...rows])
      return Promise.resolve([])
    },
    { json: (value: unknown) => value },
  )
  return { sql: fake as unknown as Sql, seen }
}

const storeOf = (rows: readonly Record<string, unknown>[]) => {
  const { sql, seen } = sqlOf(rows)
  return { store: createCasePlanStore(sql, () => '01J8NEW000000000000000000'), seen }
}

describe('플랜 생성 시각을 되읽는다 — §3.6 `generated_at`', () => {
  it('SELECT 목록에 `generated_at` 이 있다', async () => {
    const one = storeOf([stepRow()])

    await one.store.readSteps(CASE_ID)

    const query = one.seen.find((text) => text.includes('FROM plan_step'))
    // 이 한 줄이 없어서 계약의 칸이 늘 `null` 이었습니다 — INSERT 는 적고
    // 있었는데 되읽는 자리만 없었습니다
    expect(query).toContain('generated_at')
  })

  it('**표에 있던 시각 그대로**를 돌려준다 — 읽은 때가 아니다', async () => {
    const one = storeOf([stepRow()])

    const steps = await one.store.readSteps(CASE_ID)

    // 서울 표기입니다 — `toISOString()` 의 `Z` 를 쓰면 자정 근처에서 날짜가
    // 하루 앞으로 보입니다 → `lib/clock.ts`
    expect(steps[0]!.generatedAt).toBe('2026-08-27T15:30:00.000+09:00')
  })

  it('단계마다 제 시각을 들고 온다 — 보존된 단계가 옛것을 그대로 들고 있습니다', async () => {
    // §6.1 이 「지우고 다시 넣지 않는다」라 한 플랜 안에 시각이 섞입니다.
    // 저장소가 한 값으로 뭉개면 흐름이 최대값을 고를 수 없습니다
    const one = storeOf([
      stepRow(),
      stepRow({
        plan_step_id: '01J8STEP00000000000000000B',
        step_key: 'bank-freeze',
        seq: 2,
        generated_at: new Date('2026-08-20T00:00:00.000Z'),
      }),
    ])

    const steps = await one.store.readSteps(CASE_ID)

    expect(steps.map((step) => step.generatedAt)).toEqual([
      '2026-08-27T15:30:00.000+09:00',
      '2026-08-20T09:00:00.000+09:00',
    ])
  })
})
