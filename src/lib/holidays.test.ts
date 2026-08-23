/**
 * 공휴일 달력 시험.
 *
 * 검증 대상: spec/common/08-16-deadline-rules.md 「영업일」 ·
 *            관공서의 공휴일에 관한 규정 (대체공휴일 포함)
 *
 * **여기서 못 박는 것 넷:**
 * 1. 대체공휴일이 들어 있다 — 빠지면 영업일을 하나 더 센다
 * 2. **근로자의 날은 이 표에 없다** — 기준이 다르다(`date-checker` 의 몫)
 * 3. **모르는 해는 「아니다」로 답하지 않고 던진다** — 조용히 틀리느니 멈춘다
 * 4. 무엇이 빠졌는지를 스스로 말한다
 */

import { describe, expect, it } from 'vitest'

import { createHolidayCalendar } from './holidays'

const calendar = createHolidayCalendar()

describe('관공서 공휴일을 안다', () => {
  it('고정 공휴일', () => {
    expect(calendar.isPublicHoliday('2026-01-01')).toBe(true) // 신정
    expect(calendar.isPublicHoliday('2026-03-01')).toBe(true) // 삼일절
    expect(calendar.isPublicHoliday('2026-06-06')).toBe(true) // 현충일
    expect(calendar.isPublicHoliday('2026-08-15')).toBe(true) // 광복절
    expect(calendar.isPublicHoliday('2026-12-25')).toBe(true) // 성탄절
  })

  it('음력 공휴일 — 해마다 날짜가 다르다', () => {
    // 2026 설: 2/16~2/18
    expect(calendar.isPublicHoliday('2026-02-17')).toBe(true)
    // 2026 추석: 9/24~9/26
    expect(calendar.isPublicHoliday('2026-09-25')).toBe(true)
    // 2025 설은 1월이었습니다 — 표가 해마다 다른 것을 담고 있어야 합니다
    expect(calendar.isPublicHoliday('2025-01-29')).toBe(true)
    expect(calendar.isPublicHoliday('2026-01-29')).toBe(false)
  })

  it('**대체공휴일이 들어 있다** — 빠지면 영업일을 하나 더 센다', () => {
    // 2026-08-15(광복절)가 토요일이라 8/17(월)이 대체공휴일입니다.
    // 정본의 `rule_snapshot` 예시가 그 날짜를 `holidays_used` 로 듭니다
    expect(calendar.isPublicHoliday('2026-08-17')).toBe(true)
    // 2026-03-01(삼일절)이 일요일 → 3/2 대체
    expect(calendar.isPublicHoliday('2026-03-02')).toBe(true)
  })

  it('평일은 공휴일이 아니다', () => {
    expect(calendar.isPublicHoliday('2026-08-20')).toBe(false)
    expect(calendar.isPublicHoliday('2026-08-21')).toBe(false)
  })
})

describe('근로자의 날은 이 표에 없다 — 기준이 다르다', () => {
  it('5월 1일을 공휴일로 답하지 않는다', () => {
    // 관공서 공휴일이 아니라 근로기준법상 유급휴일입니다.
    // **은행은 쉽니다** — 그 처리는 `date-checker` 가 따로 합니다.
    // 여기에 섞으면 기준이 다른 둘이 한 표에 들어가 나중에 못 가릅니다
    expect(calendar.isPublicHoliday('2026-05-01')).toBe(false)
    expect(calendar.isPublicHoliday('2027-05-01')).toBe(false)
  })

  it('제헌절도 없다 — 2008년에 공휴일에서 빠졌다', () => {
    expect(calendar.isPublicHoliday('2026-07-17')).toBe(false)
  })
})

describe('모르는 해는 조용히 답하지 않는다', () => {
  it('표 밖의 해를 물으면 던진다', () => {
    // 「아니다」로 답하면 **그 해의 모든 날이 영업일**이 되어 기한이 통째로
    // 틀립니다. 이 서비스에서 하루 차이는 권리 상실입니다
    expect(() => calendar.isPublicHoliday('2050-01-01')).toThrow('공휴일 표에 없는 해')
    expect(() => calendar.isPublicHoliday('2000-01-01')).toThrow('공휴일 표에 없는 해')
  })

  it('던지는 말에 다음 수를 담는다', () => {
    const failed = (() => {
      try {
        calendar.isPublicHoliday('2050-01-01')
      } catch (error) {
        return (error as Error).message
      }
      return ''
    })()

    expect(failed).toContain('특일 정보 API')
  })

  it('담긴 범위의 끝은 답한다', () => {
    expect(() => calendar.isPublicHoliday(`${calendar.covered.from}-06-15`)).not.toThrow()
    expect(() => calendar.isPublicHoliday(`${calendar.covered.to}-06-15`)).not.toThrow()
  })
})

describe('무엇이 빠졌는지 스스로 말한다', () => {
  it('표로 답하고 있다고 밝힌다', () => {
    expect(calendar.source).toBe('table')
  })

  it('**임시공휴일이 안 들어왔다고 밝힌다**', () => {
    // 이 값이 참이 되려면 특일 정보 API 가 붙어야 합니다.
    // 숨기면 기한이 하루 앞당겨진 것을 아무도 모릅니다
    expect(calendar.coversAdHoc).toBe(false)
  })
})
