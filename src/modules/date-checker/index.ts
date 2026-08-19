/**
 * date-checker — 법정 기한을 규칙으로 계산하고 잔여일을 추적한다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createDateChecker } from './compute'
export type {
  Anchor,
  Clock,
  ComputedDeadline,
  DateChecker,
  DeadlineInput,
  DeadlineKind,
  HolidayCalendar,
  PeriodKind,
  PeriodRule,
} from './types'
