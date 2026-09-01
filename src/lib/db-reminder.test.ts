/**
 * 리마인더 어댑터 시험 — **확정 판정과 날짜 표기가 안전한 쪽인가.**
 *
 * 검증 대상: spec/backend/08-16-data-model.md §8.2(`rule_snapshot.estimated`) · §8.4
 * 근거: ADR-021 · 08-16-deadline-rules.md(추정 기한으로 알리지 않는다)
 *
 * 실제 DB 에는 붙지 않습니다(`db-plan.test.ts` 와 같은 방식). 여기서 보는 것은
 * **행을 후보로 옮기는 자리의 규칙**입니다 — 표 자체의 동작은 `db.dbtest.ts` 가 봅니다.
 */

import { describe, expect, it } from 'vitest'

import type { Sql } from './db'
import { confirmedOf, createReminderSource, createSentLog } from './db-reminder'

/** 질의문을 들여다볼 수 있는 가짜 연결 → db-plan.test.ts 의 방식 그대로 */
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

describe('확정 판정 — `estimated: false` 가 적혀 있을 때만 확정이다', () => {
  it('false 면 확정', () => {
    expect(confirmedOf({ estimated: false })).toBe(true)
  })

  it('true 면 추정', () => {
    expect(confirmedOf({ estimated: true })).toBe(false)
  })

  it('없으면 추정으로 본다 — 화면과 반대 방향, 메일은 정정할 수 없습니다', () => {
    // DeadlineReader(화면)는 「없으면 확정」입니다 — 배지 오해를 막으려는 것.
    // 메일은 추정을 확정처럼 보내면 사용자가 그 날짜를 법정 기한으로 믿습니다
    expect(confirmedOf({})).toBe(false)
    expect(confirmedOf(null)).toBe(false)
    expect(confirmedOf(undefined)).toBe(false)
  })
})

describe('기한 후보', () => {
  it('행을 후보로 옮긴다 — 만기는 서울 날짜다', async () => {
    // UTC 18:00 은 서울로 다음 날 03:00 입니다. UTC 로 자르면 하루 어긋납니다
    const { sql } = sqlOf([
      {
        deadline_id: '01J8DL00000000000000000000',
        case_id: '01J8CASE000000000000000000',
        kind: 'primary',
        status: 'open',
        due_at: new Date('2026-08-20T18:00:00.000Z'),
        rule_snapshot: { estimated: false },
      },
    ])

    const found = await createReminderSource(sql).findDeadlines('2026-08-20', 1)

    expect(found).toEqual([
      {
        deadlineId: '01J8DL00000000000000000000',
        caseId: '01J8CASE000000000000000000',
        kind: 'primary',
        status: 'open',
        dueDate: '2026-08-21',
        confirmed: true,
      },
    ])
  })

  it('open 만 읽는다 — 이미 지켰거나 무효가 된 기한은 알리지 않는다', async () => {
    const { sql, seen } = sqlOf([])

    await createReminderSource(sql).findDeadlines('2026-08-20', 1)

    expect(seen[0]?.text).toContain("status = 'open'")
  })
})

describe('연락처', () => {
  it('없는 이메일도 줄로 온다 — 모듈이 no_email 로 셉니다 (ADR-021)', async () => {
    const { sql } = sqlOf([
      { case_id: '01J8CASE000000000000000000', notify_email: null },
    ])

    const found = await createReminderSource(sql).findContacts([
      '01J8CASE000000000000000000',
    ])

    expect(found).toEqual([{ caseId: '01J8CASE000000000000000000', email: null }])
  })

  it('빈 목록이면 조회 없이 빈 배열이다', async () => {
    const { sql, seen } = sqlOf([])

    expect(await createReminderSource(sql).findContacts([])).toEqual([])
    expect(seen).toHaveLength(0)
  })
})

describe('발송 이력', () => {
  it('markSent 는 열쇠와 사건을 함께 적는다 — 사건은 파기 연쇄용입니다', async () => {
    const { sql, seen } = sqlOf([])

    await createSentLog(sql).markSent('CASE|d:D1:2026-08-21', '01J8CASE000000000000000000')

    expect(seen[0]?.text).toContain('INSERT INTO reminder_sent')
    // 겹쳐 돌아도 터지지 않습니다 — 두 번째 INSERT 는 조용히 무시됩니다
    expect(seen[0]?.text).toContain('ON CONFLICT (dedupe_key) DO NOTHING')
    expect(seen[0]?.params).toEqual(['CASE|d:D1:2026-08-21', '01J8CASE000000000000000000'])
  })

  it('sentAlready 는 줄이 있으면 참이다', async () => {
    const there = sqlOf([{ ok: 1 }])
    const empty = sqlOf([])

    expect(await createSentLog(there.sql).sentAlready('k')).toBe(true)
    expect(await createSentLog(empty.sql).sentAlready('k')).toBe(false)
  })
})
