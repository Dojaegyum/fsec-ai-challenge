/**
 * 공휴일을 답하는 자리 → `date-checker` 의 `HolidayCalendar`.
 *
 * 정본: spec/common/08-16-deadline-rules.md 「영업일」·「공휴일의 정본」
 * 근거: ADR-028(자원 접근 구현은 `src/lib/`) · CLAUDE.md 불변 규칙 7
 *       (기한 계산에 언어모델을 쓰지 않는다 — 규칙으로 센다)
 *
 * ## 지금은 표를 씁니다. 정본이 정한 자리는 API 입니다
 *
 * 정본이 한국천문연구원 특일 정보 API(공공데이터포털 15012690)를 공휴일의
 * 정본으로 정했고, **하드코딩한 배열을 굽지 말라**고 못 박았습니다.
 * 지금은 키가 없어 표를 씁니다 → `holidays-table.ts`.
 *
 * **무엇이 빠지나** — 임시공휴일. 정부가 갑자기 하루를 쉬게 만들면 그날
 * 은행이 문을 닫는데 표에는 안 들어옵니다. 그러면 영업일을 하나 더 세어
 * **기한이 하루 앞당겨지고**, 사용자는 아직 시간이 있다고 믿습니다.
 *
 * **그 사실을 숨기지 않습니다** — `source` 가 무엇으로 답했는지 말하고,
 * 설정 현황이 그것을 드러냅니다 → `config-report.ts`.
 *
 * ## 범위 밖은 던집니다
 *
 * 표에 없는 연도를 「공휴일이 아니다」로 답하면 **그 해는 모든 날이
 * 영업일이 되어** 기한이 통째로 틀립니다. 조용히 틀리느니 멈춥니다 —
 * 이 서비스에서 하루 차이는 권리 상실입니다.
 */

import 'server-only'

import { COVERED_YEARS, PUBLIC_HOLIDAYS } from './holidays-table'

import type { HolidayCalendar } from '@/modules/date-checker'

/** 어디서 답했나. 화면·설정 현황이 한계를 밝힐 때 씁니다 */
export type HolidaySource = 'table' | 'api'

export interface HolidayCalendarInfo extends HolidayCalendar {
  readonly source: HolidaySource
  /** 표로 답할 수 있는 연도 범위 */
  readonly covered: { readonly from: number; readonly to: number }
  /** ⚠️ 임시공휴일이 반영됐나. 표로 답하는 동안은 거짓 */
  readonly coversAdHoc: boolean
}

const HOLIDAYS = new Set(PUBLIC_HOLIDAYS)

/**
 * 표로 답하는 달력.
 *
 * **접속 정보를 안 받습니다** — 표는 언제나 있습니다. 그래서 이 자리는
 * 「미설정」이 될 수 없고, 대신 **무엇이 빠졌는지**를 들고 다닙니다.
 */
export function createHolidayCalendar(): HolidayCalendarInfo {
  return {
    source: 'table',
    covered: COVERED_YEARS,
    // ⚠️ **거짓입니다.** API 가 붙기 전에는 임시공휴일을 모릅니다
    coversAdHoc: false,

    isPublicHoliday(date: string): boolean {
      const year = Number(date.slice(0, 4))
      if (!Number.isInteger(year)) {
        throw new Error(`날짜 형식이 아닙니다: ${date.length}자`)
      }

      // **모르는 해를 「아니다」로 답하지 않습니다.** 그러면 그 해의 모든 날이
      // 영업일이 되어 기한이 통째로 틀립니다 → 위 「범위 밖은 던집니다」
      if (year < COVERED_YEARS.from || year > COVERED_YEARS.to) {
        throw new Error(
          `공휴일 표에 없는 해입니다: ${year} ` +
            `(표는 ${COVERED_YEARS.from}~${COVERED_YEARS.to}). ` +
            '특일 정보 API 를 붙이면 해소됩니다',
        )
      }

      return HOLIDAYS.has(date)
    },
  }
}
