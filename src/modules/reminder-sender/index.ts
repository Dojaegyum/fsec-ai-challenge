/**
 * reminder-sender — 다가온 기한과 `미확인` 단계를 찾아 이메일로 알린다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createReminderSender, DEFAULT_WINDOW } from './send'
export type {
  CaseContact,
  Clock,
  DateGap,
  DeadlineCandidate,
  DeadlineKind,
  DeadlineStatus,
  Mailer,
  Reminder,
  ReminderReason,
  ReminderRun,
  ReminderSender,
  ReminderSource,
  ReminderWindow,
  SentLog,
  SkipReason,
  SkippedCase,
  StepCandidate,
  StepState,
} from './types'
