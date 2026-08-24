/**
 * 기한 셈 시험 — **서버가 세는 이유가 여기 있습니다.**
 *
 * 화면이 `due_at` 에서 직접 세면 기기 시계가 틀릴 때 기한을 놓치고,
 * UTC 로 세면 한국 시각 아침이 전날로 잡혀 **하루가 어긋납니다.**
 */

import { describe, expect, it } from 'vitest'

import { daysLeft, elapsedRatio } from './deadline-view'

/** 마감은 그날 끝입니다 — 09-data-model.md 의 `due_at` 표기 그대로 */
const endOf = (day: string) => `${day}T23:59:59+09:00`

describe('며칠 남았나 — 달력 일수', () => {
  it('이틀 뒤면 2', () => {
    expect(daysLeft(endOf('2026-08-20'), '2026-08-18')).toBe(2)
  })

  it('**오늘이 마감이면 0**', () => {
    expect(daysLeft(endOf('2026-08-20'), '2026-08-20')).toBe(0)
  })

  it('하루 뒤면 1', () => {
    expect(daysLeft(endOf('2026-08-20'), '2026-08-19')).toBe(1)
  })

  it('**지났으면 `null`** — 부르는 쪽이 칸을 뺍니다', () => {
    // 음수를 보내면 화면이 그릴 곳이 없습니다. 「D+3」은 시안에 없습니다
    expect(daysLeft(endOf('2026-08-20'), '2026-08-21')).toBeNull()
    expect(daysLeft(endOf('2026-08-20'), '2026-09-01')).toBeNull()
  })

  it('영업일이 아니라 달력 일수다 — 주말을 건너뛰지 않는다', () => {
    // 2026-08-21(금) → 2026-08-24(월) 은 영업일로 1일이지만 달력으로 3일입니다.
    // D-day 배지는 **달력**을 보여줍니다. 영업일을 세는 것은 `date-checker` 입니다
    expect(daysLeft(endOf('2026-08-24'), '2026-08-21')).toBe(3)
  })

  it('달을 넘어가도 맞는다', () => {
    expect(daysLeft(endOf('2026-09-02'), '2026-08-31')).toBe(2)
  })

  it('**시간대를 안 섞는다** — 한국 시각 자정 직후도 그날이다', () => {
    // `2026-08-20T00:30:00+09:00` 은 UTC 로 8월 19일 15:30 입니다.
    // UTC 로 세면 하루 당겨집니다
    expect(daysLeft('2026-08-20T00:30:00+09:00', '2026-08-18')).toBe(2)
  })

  it('읽을 수 없는 값이면 `null`', () => {
    expect(daysLeft('언젠가', '2026-08-18')).toBeNull()
    expect(daysLeft(endOf('2026-08-20'), '내일')).toBeNull()
  })
})

describe('지금이 어디쯤인가 — 공고 대기 카드의 마커', () => {
  const from = '2026-08-20T00:00:00+09:00'
  const to = '2026-10-20T00:00:00+09:00'
  const at = (iso: string) => new Date(iso).getTime()

  it('한가운데면 0.5 언저리', () => {
    expect(elapsedRatio(from, to, at('2026-09-19T12:00:00+09:00'))).toBeCloseTo(0.5, 1)
  })

  it('시작 시점이면 0', () => {
    expect(elapsedRatio(from, to, at(from))).toBe(0)
  })

  it('만료 시점이면 1', () => {
    expect(elapsedRatio(from, to, at(to))).toBe(1)
  })

  it('**밖으로 안 나간다** — 마커가 카드를 벗어나면 안 됩니다', () => {
    expect(elapsedRatio(from, to, at('2026-07-01T00:00:00+09:00'))).toBe(0)
    expect(elapsedRatio(from, to, at('2027-01-01T00:00:00+09:00'))).toBe(1)
  })

  it('끝이 시작보다 앞이면 `null` — 못 재는 것을 0 으로 말하지 않습니다', () => {
    expect(elapsedRatio(to, from, at('2026-09-01T00:00:00+09:00'))).toBeNull()
    expect(elapsedRatio(from, from, at(from))).toBeNull()
  })

  it('읽을 수 없는 값이면 `null`', () => {
    expect(elapsedRatio('언젠가', to, at(from))).toBeNull()
  })
})
