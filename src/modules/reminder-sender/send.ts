/**
 * 리마인더 — 보낼지 말지를 판단하고, 보낼 것만 넘긴다.
 *
 * 정본: spec/common/08-16-module-names.md 층 4 · spec/common/08-16-deadline-rules.md
 *
 * **이 모듈의 알맹이는 판정입니다.** ADR-025 가 이렇게 적었습니다 —
 * *"리마인더는 보낼지 말지를 판단해야 합니다: 이메일이 있는가, 기한이 확정인가,
 * 이미 보낸 건 아닌가. **이건 규칙이지 쿼리가 아닙니다.**"*
 */

import type {
  CaseContact,
  Clock,
  DateGap,
  DeadlineCandidate,
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
} from './types'

/**
 * 기본 창.
 *
 * ⬜ TODO(미정): 주기와 문구가 정본에 없습니다 → 12-module-names.md 층 4.
 * **며칠 전에 몇 번인지 정해지지 않아** 값을 밖에서 받을 수 있게 두었습니다.
 */
export const DEFAULT_WINDOW: ReminderWindow = {
  daysBefore: 1,
  // 지났다고 알리기를 멈추지 않습니다 — 유예가 남아 있을 수 있습니다
  includePassed: true,
}

/** 알릴 수 있는 기한 상태. 이미 지켰거나 무효가 된 것은 알리지 않습니다 */
const OPEN = 'open'

/** 한 사건에 모인 알릴 거리 */
interface Bundle {
  deadlines: DeadlineCandidate[]
  /** 지난 기한이 섞여 있는가. 유예가 남아 있을 수 있어 더 급합니다 */
  hasPassed: boolean
  steps: StepCandidate[]
  /** 확정 안 된 기한 때문에 빠진 것이 있는가 */
  hasEstimated: boolean
}

export function createReminderSender(deps: {
  source: ReminderSource
  sentLog: SentLog
  mailer: Mailer
  clock: Clock
  dates: DateGap
}): ReminderSender {
  const { source, sentLog, mailer, clock, dates } = deps

  return {
    async run(window): Promise<ReminderRun> {
      const win = { ...DEFAULT_WINDOW, ...window }
      const asOf = clock.today()

      const [deadlines, steps] = await Promise.all([
        source.findDeadlines(asOf, win.daysBefore),
        source.findUnconfirmedSteps(asOf),
      ])

      const byCase = groupByCase(deadlines, steps, win, dates)
      if (byCase.size === 0) {
        return { sent: [], skipped: [], failed: [] }
      }

      const contacts = new Map(
        (await source.findContacts([...byCase.keys()])).map((one) => [one.caseId, one]),
      )

      const sent: Reminder[] = []
      const skipped: SkippedCase[] = []
      const failed: { caseId: string; error: string }[] = []

      for (const [caseId, bundle] of byCase) {
        const reminder = decide(caseId, bundle, contacts.get(caseId))

        if (typeof reminder === 'string') {
          skipped.push({ caseId, reason: reminder })
          continue
        }

        if (await sentLog.sentAlready(reminder.dedupeKey)) {
          skipped.push({ caseId, reason: 'already_sent' })
          continue
        }

        try {
          await mailer.send(reminder)
          // 보낸 뒤에 표시합니다. 먼저 표시하고 발송이 실패하면 영영 안 갑니다
          await sentLog.markSent(reminder.dedupeKey)
          sent.push(reminder)
        } catch (error) {
          // 한 사건이 실패해도 나머지를 계속합니다. 다음 회차가 다시 집습니다
          failed.push({ caseId, error: String(error) })
        }
      }

      return { sent, skipped, failed }
    },
  }
}

/**
 * 사건별로 모으면서 **알릴 수 없는 것을 먼저 걸러냅니다.**
 *
 * **확정되지 않은 기한은 여기서 빠집니다.** 부산물이 아직 없으면 기한은 추정일
 * 뿐이고, 추정 날짜를 메일로 보내면 사용자는 그것을 확정으로 읽습니다
 * → 08-16-deadline-rules.md.
 */
function groupByCase(
  deadlines: readonly DeadlineCandidate[],
  steps: readonly StepCandidate[],
  win: ReminderWindow,
  dates: DateGap,
): Map<string, Bundle> {
  const byCase = new Map<string, Bundle>()

  const bucket = (caseId: string): Bundle => {
    let found = byCase.get(caseId)
    if (!found) {
      found = { deadlines: [], hasPassed: false, steps: [], hasEstimated: false }
      byCase.set(caseId, found)
    }
    return found
  }

  for (const one of deadlines) {
    // 이미 지켰거나 무효가 된 기한은 알리지 않습니다
    if (one.status !== OPEN) continue

    const left = dates.daysLeft(one.dueDate)
    // 아직 창에 들지 않았습니다
    if (left > win.daysBefore) continue
    if (left < 0 && !win.includePassed) continue

    const into = bucket(one.caseId)

    if (!one.confirmed) {
      // 추정 기한입니다. 담지 않되 「그래서 건너뛴다」를 말할 수 있게 표시합니다
      into.hasEstimated = true
      continue
    }

    into.deadlines.push(one)
    if (left < 0) into.hasPassed = true
  }

  for (const one of steps) {
    if (one.state !== 'unconfirmed') continue
    bucket(one.caseId).steps.push(one)
  }

  return byCase
}

/**
 * 이 사건에 보낼 것인가. 못 보내면 그 이유를 돌려줍니다.
 *
 * 순서가 있습니다 — **이메일이 없으면 나머지를 볼 이유가 없습니다.**
 */
function decide(
  caseId: string,
  bundle: Bundle,
  contact: CaseContact | undefined,
): Reminder | SkipReason {
  // 이메일이 없는 사건도 정상 사건입니다. 새로 요구하지 않습니다 → ADR-021
  if (!contact?.email) return 'no_email'

  if (bundle.deadlines.length === 0 && bundle.steps.length === 0) {
    // 추정 기한 때문에 비었으면 그 이유를 말합니다
    return bundle.hasEstimated ? 'not_confirmed' : 'nothing_due'
  }

  return {
    caseId,
    email: contact.email,
    reason: reasonOf(bundle),
    dedupeKey: dedupeKey(caseId, bundle),
    deadlines: bundle.deadlines,
    steps: bundle.steps,
  }
}

/**
 * 무엇 때문에 보내나.
 *
 * **지난 기한이 있으면 그쪽이 먼저입니다** — 유예가 남아 있을 수 있어 더 급합니다.
 */
function reasonOf(bundle: Bundle): ReminderReason {
  if (bundle.hasPassed) return 'deadline_passed'
  if (bundle.deadlines.length > 0) return 'deadline_near'
  return 'step_unconfirmed'
}

/**
 * 같은 것을 두 번 보내지 않기 위한 열쇠.
 *
 * **무엇을 알리는지가 바뀌면 열쇠도 바뀝니다.** 기한이 하나 더 창에 들면 새
 * 메일이 나가야 하고, 그대로면 안 나가야 합니다. 정렬하는 것은 조회 순서가
 * 흔들려도 같은 열쇠가 나오게 하려는 것입니다.
 */
function dedupeKey(caseId: string, bundle: Bundle): string {
  const parts = [
    ...bundle.deadlines.map((one) => `d:${one.deadlineId}:${one.dueDate}`),
    ...bundle.steps.map((one) => `s:${one.planStepId}`),
  ].sort()

  return `${caseId}|${parts.join(',')}`
}
