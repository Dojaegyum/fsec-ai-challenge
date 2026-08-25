/**
 * date-checker 시험.
 *
 * 검증 대상은 spec/common/08-16-deadline-rules.md 입니다.
 *
 * **하루가 틀리면 사용자가 권리를 잃습니다.** 그래서 초일 불산입·주말·공휴일·
 * 근로자의 날을 각각 따로 봅니다.
 */

import { describe, expect, it } from 'vitest'

import { createDateChecker } from './compute'
import type { HolidayCalendar } from './types'

/** 공휴일이 하나도 없는 달력 — 주말만 빠지는 경우를 보려는 것 */
const noHolidays: HolidayCalendar = { isPublicHoliday: () => false }

/** 정해준 날만 공휴일 */
function holidaysOn(...days: string[]): HolidayCalendar {
  return { isPublicHoliday: (d) => days.includes(d) }
}

function checker(holidays: HolidayCalendar = noHolidays, today = '2026-08-18') {
  return createDateChecker({ holidays, clock: { today: () => today } })
}

/** 2026-08-18 은 화요일입니다 */
const TUE = '2026-08-18'

describe('초일은 세지 않는다 — 민법 제157조', () => {
  it('달력일은 기산일에 그대로 더한다', () => {
    // 8/18 에 신청 → 8/19 가 1일차 → 14일차는 9/1
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    expect(r.dueDate).toBe('2026-09-01')
  })

  it('영업일도 기산일 다음 날부터 센다', () => {
    // 화(8/18) 기산 → 수 1, 목 2, 금 3
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.dueDate).toBe('2026-08-21')
  })
})

describe('영업일에서 무엇을 빼나', () => {
  it('주말을 건너뛴다', () => {
    // 목(8/20) 기산 → 금 1, (토·일 건너뜀) 월 2, 화 3
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-08-20', confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.dueDate).toBe('2026-08-25')
  })

  it('공휴일을 건너뛰고, 그 날짜를 재현용으로 남긴다', () => {
    // 수(8/19)가 공휴일이면 하루 밀린다
    const r = checker(holidaysOn('2026-08-19')).compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.dueDate).toBe('2026-08-24')
    // 공휴일 데이터가 바뀌어도 과거 계산을 되살릴 수 있어야 한다
    expect(r.holidaysUsed).toEqual(['2026-08-19'])
  })

  it('주말은 재현 목록에 넣지 않는다 — 요일로 다시 알 수 있다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-08-20', confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.holidaysUsed).toEqual([])
  })

  it('근로자의 날(5/1)을 뺀다 — 관공서는 일하지만 은행은 쉰다', () => {
    // 2026-05-01 은 금요일. 이것을 안 빼면 기한이 하루 앞당겨진다
    const withLabor = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-04-30', confirmed: true },
      rule: { kind: 'business_days', amount: 1 },
      kind: 'primary',
    })
    // 금(5/1) 이 빠지므로 다음 영업일인 월요일(5/4)
    expect(withLabor.dueDate).toBe('2026-05-04')
  })

  it('근로자의 날은 공휴일 조회가 몰라도 빠진다', () => {
    // 특일 정보 API 에 안 나오는 날이다. 모듈이 따로 뺀다
    expect(checker().isBusinessDay('2026-05-01')).toBe(false)
    expect(checker(noHolidays).isBusinessDay('2026-05-04')).toBe(true)
  })
})

describe('확정과 추정을 가른다', () => {
  it('부산물로 확인됐으면 확정이다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.estimated).toBe(false)
  })

  it('확인 안 됐으면 추정으로 표시한다', () => {
    // 추정 날짜를 확정 기한처럼 보여주면 사용자가 틀린 날짜를 믿고 권리를 잃는다
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: false },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.estimated).toBe(true)
  })
})

describe('만기 시각은 그날 끝이다', () => {
  it('Asia/Seoul 로 23:59:59 를 붙인다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.dueAt).toBe('2026-08-21T23:59:59+09:00')
  })

  it('기산이 된 자리를 그대로 옮긴다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.computedFrom).toBe('relief_applied_at')
  })
})

describe('법정 기한이 아닌 날짜 셈', () => {
  it('말일 이월을 걸지 않는다 — 보관 기한은 조문이 없다', () => {
    // 2028-03-05 는 일요일. compute() 였다면 3/6 으로 밀렸을 자리다
    expect(checker().addDays('2028-02-20', 14)).toBe('2028-03-05')
  })

  it('보관 기한 180일을 센다', () => {
    expect(checker().addDays('2026-08-18', 180)).toBe('2027-02-14')
  })
})

describe('남은 날수', () => {
  it('오늘과의 차이를 센다', () => {
    expect(checker(noHolidays, '2026-08-18').daysLeft('2026-08-21')).toBe(3)
  })

  it('지난 기한은 음수로 나온다 — 지우지 않고 유예를 안내해야 한다', () => {
    expect(checker(noHolidays, '2026-08-25').daysLeft('2026-08-21')).toBe(-4)
  })

  it('오늘이 만기면 0이다', () => {
    expect(checker(noHolidays, '2026-08-21').daysLeft('2026-08-21')).toBe(0)
  })
})

describe('시간대에 흔들리지 않는다', () => {
  it('월을 넘어가도 맞다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-08-31', confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    expect(r.dueDate).toBe('2026-09-14')
  })

  it('해를 넘어가도 맞다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-12-30', confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    expect(r.dueDate).toBe('2027-01-13')
  })

  it('윤년 2월을 넘어가도 맞다', () => {
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2028-02-20', confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    // 2/20 + 14 = 3/5 인데 일요일이라 민법 제161조로 하루 밀립니다
    expect(r.dueDate).toBe('2028-03-06')
  })
})

describe('달은 날수가 아니라 달력으로 센다 — 민법 제160조', () => {
  /** 채권소멸공고를 세는 규칙 — 통신사기피해환급법 제9조 「공고일부터 2개월」 */
  const notice = (date: string) =>
    checker().compute({
      anchor: { source: 'notice_started_at', date, confirmed: true },
      rule: { kind: 'months', amount: 2 },
      kind: 'info',
    })

  it('공고일과 **같은 날짜**에 만료한다 — 계약 §3.7 의 예가 그것이다', () => {
    // 8/20 공고 → 기산일 8/21 → 10/21 의 전일 (제160조 ②)
    expect(notice('2026-08-20').dueDate).toBe('2026-10-20')
  })

  it('60일로 세면 안 된다 — 달마다 길이가 다르다', () => {
    // 8/20 + 60일이면 10/19 라 하루 이릅니다. 9월이 30일이기 때문입니다
    const naive = checker().compute({
      anchor: { source: 'notice_started_at', date: '2026-08-20', confirmed: true },
      rule: { kind: 'calendar_days', amount: 60 },
      kind: 'info',
    })
    expect(naive.dueDate).not.toBe(notice('2026-08-20').dueDate)
  })

  it('윤년이면 하루 더 간다 — 제160조 ③ 이 그대로 보이는 자리', () => {
    // 2027-12-30 공고 → 기산일 12/31 → 2028-02-31 은 없으니 말일.
    // 2028 은 윤년이라 2/29 이고, 그날이 화요일이라 이월도 없습니다
    expect(notice('2027-12-30').dueDate).toBe('2028-02-29')
  })

  it('말일이 휴일이면 **두 번** 옮겨진다 — 제160조 ③ 뒤에 제161조', () => {
    // 2026-12-30 공고 → 기산일 12/31 → 2027-02-31 은 없으니 말일 2/28.
    // 그런데 그날이 일요일이라 제161조로 3/1(월)로 다시 밀립니다.
    // **두 조문이 이어서 걸리는 유일한 모양**이라 따로 봅니다
    expect(notice('2026-12-30').dueDate).toBe('2027-03-01')
  })

  it('기산일이 1일이면 앞 달 말일로 내려앉는다', () => {
    // 1/31 공고 → 기산일 2/1 → 4/1 의 전일 = 3/31
    expect(notice('2027-01-31').dueDate).toBe('2027-03-31')
  })

  it('해를 넘겨도 맞는다', () => {
    // 11/15 공고 → 기산일 11/16 → 1/16 의 전일 = 1/15
    expect(notice('2026-11-15').dueDate).toBe('2027-01-15')
  })

  it('말일이 휴일이면 달도 미룬다 — 제161조는 같이 적용된다', () => {
    // 8/22 공고 → 기산일 8/23 → 10/23 의 전일 = 10/22(목).
    // 그날이 공휴일이면 다음 열린 날로 밀립니다
    const r = checker(holidaysOn('2026-10-22')).compute({
      anchor: { source: 'notice_started_at', date: '2026-08-22', confirmed: true },
      rule: { kind: 'months', amount: 2 },
      kind: 'info',
    })
    expect(r.dueDate).toBe('2026-10-23')
    expect(r.holidaysUsed).toContain('2026-10-22')
  })
})

describe('말일이 휴일이면 다음 날 — 민법 제161조', () => {
  it('달력일의 말일이 토요일이면 미룬다', () => {
    // 2026-08-08 은 토요일
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-07-25', confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    expect(r.dueDate).toBe('2026-08-10')
  })

  it('말일이 공휴일이면 미루고, 그 날짜를 재현용으로 남긴다', () => {
    // 8/18 + 14 = 9/1(화). 그날이 공휴일이면 9/2 로 밀린다
    const r = checker(holidaysOn('2026-09-01')).compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    expect(r.dueDate).toBe('2026-09-02')
    expect(r.holidaysUsed).toEqual(['2026-09-01'])
  })

  it('영업일로 정한 기간에는 겹치지 않는다', () => {
    // 영업일은 애초에 휴일을 세지 않아 말일이 휴일일 수 없습니다.
    // 금요일이 만기로 나왔는데 161조가 또 밀면 하루가 늘어납니다
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
      rule: { kind: 'business_days', amount: 3 },
      kind: 'primary',
    })
    expect(r.dueDate).toBe('2026-08-21')
  })

  it('근로자의 날은 미루는 사유가 아니다 — 관공서 공휴일이 아니다', () => {
    // 2026-05-01(금)이 말일이어도 달력일 기간은 그날 만료합니다.
    // 영업일 계산과 기준이 다릅니다
    const r = checker().compute({
      anchor: { source: 'relief_applied_at', date: '2026-04-17', confirmed: true },
      rule: { kind: 'calendar_days', amount: 14 },
      kind: 'grace',
    })
    expect(r.dueDate).toBe('2026-05-01')
  })

  it('공휴일 조회가 늘 참이어도 영영 돌지 않는다', () => {
    const always: HolidayCalendar = { isPublicHoliday: () => true }
    expect(() =>
      checker(always).compute({
        anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
        rule: { kind: 'calendar_days', amount: 14 },
        kind: 'grace',
      }),
    ).toThrow(/말일을 정할 수 없습니다/)
  })
})

describe('잘못된 입력을 조용히 넘기지 않는다', () => {
  it('날짜 형식이 아니면 던진다', () => {
    expect(() =>
      checker().compute({
        anchor: { source: 'relief_applied_at', date: '8월 18일', confirmed: true },
        rule: { kind: 'calendar_days', amount: 14 },
        kind: 'grace',
      }),
    ).toThrow()
  })

  it('공휴일 조회가 늘 참이어도 영영 돌지 않는다', () => {
    const always: HolidayCalendar = { isPublicHoliday: () => true }
    expect(() =>
      checker(always).compute({
        anchor: { source: 'relief_applied_at', date: TUE, confirmed: true },
        rule: { kind: 'business_days', amount: 3 },
        kind: 'primary',
      }),
    ).toThrow(/영업일을 셀 수 없습니다/)
  })
})
