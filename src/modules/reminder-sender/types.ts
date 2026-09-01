/**
 * reminder-sender — 다가온 기한과 `미확인` 단계를 찾아 이메일로 알린다
 *
 * 계약: spec/common/08-16-module-names.md 층 4 · spec/backend/08-16-data-model.md §6 §8
 * 근거: ADR-021(이메일은 선택) · ADR-025(보낼지 말지는 규칙) · ADR-028
 *
 * 절대 하지 않는 것: **확정 안 된 기한으로 알리기** · **연락처를 새로 요구하기** ·
 * 같은 것을 두 번 보내기 · 문구를 여기서 짓기
 */

/** 09-data-model.md §8 */
export type DeadlineKind = 'primary' | 'grace' | 'info'

/** 09-data-model.md §8 */
export type DeadlineStatus = 'open' | 'met' | 'missed' | 'void'

/** 09-data-model.md §6 */
export type StepState =
  | 'not_started'
  | 'in_progress'
  | 'done_verified'
  | 'unconfirmed'
  | 'skipped'

/** 알릴 후보 — 기한 하나 */
export interface DeadlineCandidate {
  readonly deadlineId: string
  readonly caseId: string
  readonly kind: DeadlineKind
  readonly status: DeadlineStatus
  /** `YYYY-MM-DD` */
  readonly dueDate: string
  /**
   * 기산점이 부산물로 확인됐는가.
   *
   * **거짓이면 추정입니다.** 추정 날짜를 메일로 보내면 사용자는 그것을
   * 확정으로 읽습니다 → 08-16-deadline-rules.md.
   */
  readonly confirmed: boolean
}

/** 알릴 후보 — `미확인` 단계 하나 */
export interface StepCandidate {
  readonly planStepId: string
  readonly caseId: string
  readonly state: StepState
  readonly title: string
}

/** 사건에서 발송 판정에 필요한 것 */
export interface CaseContact {
  readonly caseId: string
  /**
   * 재진입 링크의 몸통 → ADR-021 · ADR-039.
   *
   * **링크 없는 알림은 재진입이 아닙니다** — 이 메일의 존재 이유가
   * 「돌아오는 길」이라, 주소를 함께 싣지 못하면 보낼 뜻이 없습니다.
   */
  readonly linkToken: string
  /**
   * 알림용 이메일. **선택입니다** → ADR-021.
   *
   * **없는 사건도 정상 사건입니다.** 새로 요구하는 흐름을 만들지 마세요.
   */
  readonly email: string | null
}

/** 보낼 것 하나 */
export interface Reminder {
  readonly caseId: string
  readonly email: string
  /** 재진입 링크의 몸통. `CaseContact` 에서 그대로 옮겨 옵니다 */
  readonly linkToken: string
  /** 무엇 때문에 보내나 */
  readonly reason: ReminderReason
  /** 중복 발송을 막는 열쇠. 같은 값으로 두 번 보내지 않습니다 */
  readonly dedupeKey: string
  readonly deadlines: readonly DeadlineCandidate[]
  readonly steps: readonly StepCandidate[]
}

/**
 * 보내는 이유.
 *
 * **문구는 여기서 짓지 않습니다.** 이유만 정하고 문장은 발송 쪽이 만듭니다 —
 * ⬜ 주기와 문구가 아직 정본에 없습니다 → 12-module-names.md 층 4 TODO.
 */
export type ReminderReason = 'deadline_near' | 'deadline_passed' | 'step_unconfirmed'

/** 왜 안 보냈나. 관측에 씁니다 */
export type SkipReason =
  /** 이메일이 없다 — 정상입니다 */
  | 'no_email'
  /** 기산점이 부산물로 확인되지 않았다 — 추정 기한입니다 */
  | 'not_confirmed'
  /** 이미 보냈다 */
  | 'already_sent'
  /** 알릴 것이 없다 */
  | 'nothing_due'

export interface SkippedCase {
  readonly caseId: string
  readonly reason: SkipReason
}

/** 며칠 전에 알리나 */
export interface ReminderWindow {
  /**
   * 만기 며칠 전부터 알리나.
   *
   * ⬜ TODO(미정): 주기와 문구가 정본에 없습니다. 값을 밖에서 받는 이유입니다.
   */
  readonly daysBefore: number
  /** 지난 기한도 알리나. 유예가 남아 있을 수 있습니다 */
  readonly includePassed: boolean
}

/** 이 모듈이 밖에 요구하는 것 — 알릴 거리 찾기 */
export interface ReminderSource {
  /** 오늘 기준으로 창에 든 기한 */
  findDeadlines(asOf: string, daysBefore: number): Promise<readonly DeadlineCandidate[]>
  /** `미확인` 상태인 단계 */
  findUnconfirmedSteps(asOf: string): Promise<readonly StepCandidate[]>
  /** 사건별 연락처 */
  findContacts(caseIds: readonly string[]): Promise<readonly CaseContact[]>
}

/**
 * 이 모듈이 밖에 요구하는 것 — 이미 보냈는지 기억하는 자리.
 *
 * 정본이 생겼습니다 — `reminder_sent` 표 → 09-data-model.md §8.4 (2026-09-01).
 */
export interface SentLog {
  sentAlready(dedupeKey: string): Promise<boolean>
  /**
   * 보냈다고 적는다. **보낸 뒤에 부릅니다.**
   *
   * `caseId` 를 함께 받는 것은 **파기 연쇄** 때문입니다 — 사건이 파기되면
   * 발송 이력도 함께 사라져야 하는데(불변 규칙 3), 열쇠 문자열을 저장소가
   * 쪼개 읽게 하면 열쇠 형식이 바뀌는 순간 조용히 깨집니다.
   */
  markSent(dedupeKey: string, caseId: string): Promise<void>
}

/**
 * 이 모듈이 밖에 요구하는 것 — 메일 발송.
 *
 * ⬜ **발송 수단이 아직 정해지지 않았습니다** → ADR-021 「남은 것」.
 */
export interface Mailer {
  send(reminder: Reminder): Promise<void>
}

/** 이 모듈이 밖에 요구하는 것 — 서버 시계 */
export interface Clock {
  /** `YYYY-MM-DD` · Asia/Seoul */
  today(): string
}

/** 이 모듈이 밖에 요구하는 것 — 날짜 차이 계산 (`date-checker`) */
export interface DateGap {
  /** 오늘부터 그날까지 남은 날수. 음수면 지났다는 뜻입니다 */
  daysLeft(dueDate: string): number
}

/** 한 번 돌린 결과 */
export interface ReminderRun {
  readonly sent: readonly Reminder[]
  readonly skipped: readonly SkippedCase[]
  /** 보내다 실패한 것. 다음 회차가 다시 집습니다 */
  readonly failed: readonly { caseId: string; error: string }[]
}

export interface ReminderSender {
  /**
   * 알릴 것을 찾아 보낸다.
   *
   * **보낼 수 없는 사건이 있습니다.** 이메일이 없거나 기한이 추정이면 건너뜁니다 —
   * 실패가 아니라 정상입니다 → ADR-021.
   *
   * **예외를 던지지 않습니다.** 한 사건이 실패해도 나머지를 계속하고,
   * 무엇을 왜 건너뛰었는지를 결과로 돌려줍니다.
   */
  run(window?: Partial<ReminderWindow>): Promise<ReminderRun>
}
