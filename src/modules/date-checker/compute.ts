/**
 * 기한 계산 — 영업일·달력일·초일 불산입.
 *
 * 정본: spec/common/08-16-deadline-rules.md
 *
 * 날짜를 `YYYY-MM-DD` 문자열로만 다룹니다. `Date` 를 로컬 시간대로 쓰면 서버가
 * 어디에 있느냐에 따라 하루가 어긋나므로, 산술은 전부 UTC 자정으로 정규화해
 * 돌리고 시간대는 마지막에 한 번만 붙입니다 — 정본이 「Asia/Seoul 고정」이라
 * 정한 이유가 그것입니다.
 */

import type {
  Clock,
  ComputedDeadline,
  DateChecker,
  DeadlineInput,
  HolidayCalendar,
} from './types'

/** 그날 끝. 08-14-api.md §3.7 의 `due_at` 표기와 같습니다 */
const END_OF_DAY_KST = 'T23:59:59+09:00'

/**
 * 근로자의 날. **관공서 공휴일이 아니라 근로기준법상 유급휴일**이라
 * 특일 정보 API 에 나오지 않습니다.
 *
 * **이것을 빼지 않으면 5월 1일을 영업일로 세어 기한이 하루 앞당겨집니다.**
 * 기한을 내는 곳이 금융회사이므로 은행 기준으로 셉니다.
 */
const LABOR_DAY = '05-01'

export function createDateChecker(deps: {
  holidays: HolidayCalendar
  clock: Clock
}): DateChecker {
  const { holidays, clock } = deps

  return {
    /** 기한 하나를 계산한다 */
    compute(input: DeadlineInput): ComputedDeadline {
      const used: string[] = []
      const dueDate =
        input.rule.kind === 'business_days'
          ? addBusinessDays(input.anchor.date, input.rule.amount, holidays, used)
          : rollToNextOpenDay(
              input.rule.kind === 'months'
                ? addMonths(input.anchor.date, input.rule.amount)
                : addDays(input.anchor.date, input.rule.amount),
              holidays,
              used,
            )

      return {
        kind: input.kind,
        dueDate,
        dueAt: `${dueDate}${END_OF_DAY_KST}`,
        computedFrom: input.anchor.source,
        // 부산물로 확인되지 않았으면 추정이다. 확정 기한처럼 보이면 안 된다
        estimated: !input.anchor.confirmed,
        holidaysUsed: used,
      }
    },

    /**
     * 남은 날수. 음수면 지났다는 뜻이다.
     *
     * **지났다고 화면에서 지우지 않습니다** — 유예(14일)가 남아 있을 수 있습니다.
     */
    daysLeft(dueDate: string): number {
      return diffDays(clock.today(), dueDate)
    },

    /** 은행이 영업하는 날인가 */
    isBusinessDay(date: string): boolean {
      return isBusinessDay(date, holidays)
    },

    /**
     * 날짜에 일수를 더한다. **법정 기한이 아닙니다** — 말일 이월을 걸지 않습니다.
     * 보관 기한처럼 조문이 걸리지 않는 셈에만 씁니다.
     */
    addDays(date: string, amount: number): string {
      return addDays(date, amount)
    },
  }
}

/**
 * 영업일을 센다. **초일은 세지 않습니다** — 민법 제157조.
 *
 * 기산일 다음 날부터 세기 시작하므로, 3영업일이면 기산일 이후의
 * 세 번째 영업일이 만기입니다.
 */
function addBusinessDays(
  from: string,
  amount: number,
  holidays: HolidayCalendar,
  used: string[],
): string {
  let cursor = from
  let counted = 0

  // 상한을 둡니다. 공휴일 조회가 늘 참을 돌려주면 영영 돌 수 있습니다
  const limit = amount * 10 + 30
  let steps = 0

  while (counted < amount) {
    cursor = addDays(cursor, 1)
    steps += 1
    if (steps > limit) {
      throw new Error(`영업일을 셀 수 없습니다: ${from} +${amount}영업일`)
    }

    if (isBusinessDay(cursor, holidays)) {
      counted += 1
    } else if (!isWeekend(cursor)) {
      // 주말은 재현에 필요 없습니다 — 요일로 다시 알 수 있습니다.
      // 공휴일만 남겨야 데이터가 바뀌어도 과거 계산을 되살릴 수 있습니다
      used.push(cursor)
    }
  }

  return cursor
}

function isBusinessDay(date: string, holidays: HolidayCalendar): boolean {
  if (isWeekend(date)) return false
  if (date.slice(5) === LABOR_DAY) return false
  return !holidays.isPublicHoliday(date)
}

function isWeekend(date: string): boolean {
  const day = utc(date).getUTCDay()
  return day === 0 || day === 6
}

/**
 * 말일이 토요일·공휴일이면 다음 날로 미룬다 — **민법 제161조.**
 *
 * 달력일로 정한 기간(14일 유예)에만 씁니다. 영업일로 정한 기간은 애초에 공휴일을
 * 세지 않아 말일이 휴일일 수 없습니다 → [기한 계산 규칙] §「초일은 세지 않습니다」.
 *
 * **근로자의 날은 여기서 빼지 않습니다.** 조문이 말하는 「공휴일」은 관공서 공휴일이고,
 * 근로자의 날은 거기 들어가지 않습니다 — 영업일 계산과 기준이 다릅니다.
 */
function rollToNextOpenDay(
  date: string,
  holidays: HolidayCalendar,
  used: string[],
): string {
  let cursor = date

  for (let steps = 0; steps <= 30; steps += 1) {
    const weekend = isWeekend(cursor)
    if (!weekend && !holidays.isPublicHoliday(cursor)) return cursor
    // 주말은 요일로 다시 알 수 있으니 공휴일만 남깁니다
    if (!weekend) used.push(cursor)
    cursor = addDays(cursor, 1)
  }

  throw new Error(`말일을 정할 수 없습니다: ${date}`)
}

/**
 * 달을 더한다 — **민법 제160조 「역에 의한 계산」.**
 *
 * **60일이 아닙니다.** 2개월을 60일로 세면 8월에 시작한 공고가 이틀 일찍
 * 끝난 것으로 보입니다. 조문이 정한 것은 날수가 아니라 **달력의 같은 날**입니다.
 *
 * | 근거 | 무엇 |
 * | --- | --- |
 * | 제157조 | **초일 불산입.** 기산일은 공고일 다음 날입니다 |
 * | 제160조 ② | 최후의 월에서 **그 기산일에 해당한 날의 전일**로 만료 |
 * | 제160조 ③ | 최종의 월에 **해당일이 없으면 그 월의 말일**로 만료 |
 *
 * 그래서 8월 20일 공고는 10월 20일에 만료합니다(기산일 8/21 → 10/21 의 전일).
 * 12월 30일 공고는 2월 31일이 없으므로 **2월 말일**입니다.
 *
 * 왜 이 자리가 오래 비어 있었나 — 말일 처리의 근거를 `spec/` 안에서 찾다
 * 못 찾았기 때문입니다. **조문에 있습니다**(제160조 ③). 지어낼 것이 아니라
 * 법령을 찾을 일이었습니다.
 *
 * 근거: 민법 제157조·제160조 · 통신사기피해환급법 제9조
 * https://www.law.go.kr/법령/민법/제160조
 */
function addMonths(from: string, amount: number): string {
  // 제157조 — 초일은 세지 않습니다
  const start = utc(addDays(from, 1))
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth() + amount
  const day = start.getUTCDate()

  // `day 0` 은 그 달의 전날, 곧 앞 달의 말일입니다
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()

  // 제160조 ③ — 2월 31일 같은 날은 그 달 말일로 내려앉습니다
  if (day > lastDay) {
    return new Date(Date.UTC(year, month, lastDay)).toISOString().slice(0, 10)
  }

  // 제160조 ② — 기산일에 해당한 날의 **전일**.
  // `day - 1` 이 0 이 되면 위와 같은 규칙으로 앞 달 말일이 됩니다.
  // 1월 31일 공고 + 1개월이 그 경우이고, 조문대로 2월 말일이 나옵니다
  return new Date(Date.UTC(year, month, day - 1)).toISOString().slice(0, 10)
}

/**
 * 달력일을 더한다. **초일 불산입이라 그대로 더하면 됩니다** —
 * 기산일 다음 날이 1일차이므로 `기산일 + amount` 가 마지막 날입니다.
 */
function addDays(date: string, amount: number): string {
  const d = utc(date)
  d.setUTCDate(d.getUTCDate() + amount)
  return d.toISOString().slice(0, 10)
}

function diffDays(from: string, to: string): number {
  const ms = utc(to).getTime() - utc(from).getTime()
  return Math.round(ms / 86_400_000)
}

/** `YYYY-MM-DD` 를 UTC 자정으로 읽습니다. 시간대에 흔들리지 않게 하려는 것입니다 */
function utc(date: string): Date {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`날짜 형식이 아닙니다: ${date}`)
  }
  return d
}
