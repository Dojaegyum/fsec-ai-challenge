/**
 * date-checker — 법정 기한을 규칙으로 계산하고 잔여일을 추적한다
 *
 * 계약: spec/common/08-16-deadline-rules.md · spec/backend/08-16-data-model.md §8
 * 근거: CLAUDE.md 불변 규칙 7 · ADR-028
 *
 * 절대 하지 않는 것: LLM 에 날짜를 계산시키기 · 기한 값을 코드에 굽기 ·
 * 클라이언트 시계를 믿기 · 확정 안 된 기산점으로 기한을 확정하기
 */

/**
 * 기간을 세는 단위.
 *
 * `rule_snapshot.rule.kind` 가 이 값을 갖습니다 → 09-data-model.md §8.2.
 *
 * `months` 는 **일수가 아닙니다** — 민법 제160조 「역에 의한 계산」입니다.
 * 2개월을 60일로 세면 달마다 하루씩 어긋납니다. 채권소멸공고가 그 경우이고
 * (통신사기피해환급법 제9조 *"공고일부터 2개월이 경과하면"*), 말일 처리의
 * 근거는 같은 조 ③항입니다 → `compute.ts` 의 `addMonths`.
 */
export type PeriodKind = 'business_days' | 'calendar_days' | 'months'

/** 기한 하나를 세는 규칙. 값의 정본은 KB 항목의 `body.deadline` 입니다(RFC-002 · data-model §11.4) */
export interface PeriodRule {
  readonly kind: PeriodKind
  readonly amount: number
}

/** 09-data-model.md §8 의 `kind` */
export type DeadlineKind = 'primary' | 'grace' | 'info'

/**
 * 기산점.
 *
 * **부산물의 시점입니다** — '사용자가 했다고 말한 시점'이 아닙니다.
 * 그래야 완수 검증과 기한 추적이 같은 사실 위에 섭니다.
 */
export interface Anchor {
  /** 기산이 된 slot_key 또는 artifact. `deadline.computed_from` 에 그대로 들어갑니다 */
  readonly source: string
  /** `YYYY-MM-DD` (Asia/Seoul 기준 날짜) */
  readonly date: string
  /**
   * 부산물로 확인된 값인가.
   *
   * **거짓이면 추정입니다.** 화면에 「미확인」 배지와 함께 보여야 하고,
   * 확정 기한처럼 표시하면 사용자가 틀린 날짜를 믿고 권리를 잃습니다.
   */
  readonly confirmed: boolean
}

export interface DeadlineInput {
  readonly anchor: Anchor
  readonly rule: PeriodRule
  readonly kind: DeadlineKind
}

export interface ComputedDeadline {
  readonly kind: DeadlineKind
  /** ISO 8601 · Asia/Seoul · 그날 끝 (`2026-08-20T23:59:59+09:00`) */
  readonly dueAt: string
  /** `YYYY-MM-DD` */
  readonly dueDate: string
  readonly computedFrom: string
  /**
   * 추정인가. 기산점이 부산물로 확인되지 않았으면 참입니다.
   * `deadline` 표에는 이 값이 없고, 화면 배지와 `rule_snapshot` 으로 남습니다.
   */
  readonly estimated: boolean
  /**
   * 계산에 실제로 반영한 휴일. `rule_snapshot.holidays_used` 에 그대로 들어갑니다.
   * **공휴일 데이터가 바뀌어도 과거 계산을 재현하기 위한 것입니다.**
   */
  readonly holidaysUsed: readonly string[]
}

/** 이 모듈이 밖에 내놓는 것 */
export interface DateChecker {
  /** 기한 하나를 계산한다 */
  compute(input: DeadlineInput): ComputedDeadline
  /**
   * 남은 날수. 음수면 지났다는 뜻입니다.
   *
   * **지났다고 화면에서 지우지 않습니다** — 유예(14일)가 남아 있을 수 있습니다.
   */
  daysLeft(dueDate: string): number
  /** 은행이 영업하는 날인가 */
  isBusinessDay(date: string): boolean
  /**
   * 날짜에 일수를 더한다. **법정 기한이 아닙니다.**
   *
   * 보관 기한(`case.purge_after`)처럼 **조문이 걸리지 않는 날짜 셈**에만 씁니다 —
   * 민법 제161조 말일 이월을 적용하지 않습니다. 법정 기한은 `compute()` 로 계산하세요.
   *
   * 여기 있는 이유는 시간대 때문입니다. 밖에서 `Date` 로 날짜를 더하면 서버 위치에
   * 따라 하루가 어긋나므로, 날짜 산술은 이 모듈 하나에 모읍니다.
   */
  addDays(date: string, amount: number): string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 그 날이 공휴일인가.
 *
 * 정본은 **한국천문연구원 특일 정보 API** 입니다(공공데이터포털 15012690).
 * **하드코딩한 배열을 코드에 굽지 않습니다** — 매년 바뀌고 임시공휴일은 갑자기 생깁니다.
 *
 * 근로자의 날(5/1)은 여기서 답하지 않아도 됩니다. 관공서 공휴일이 아니라
 * 근로기준법상 유급휴일이라 API 에 안 나오고, 이 모듈이 따로 뺍니다.
 */
export interface HolidayCalendar {
  /** `YYYY-MM-DD` 가 관공서 공휴일인가 */
  isPublicHoliday(date: string): boolean
}

/** 잔여일 계산에 쓰는 오늘. **서버 시계입니다** — 클라이언트 시계를 믿지 않습니다 */
export interface Clock {
  /** `YYYY-MM-DD` (Asia/Seoul 기준 오늘) */
  today(): string
}
