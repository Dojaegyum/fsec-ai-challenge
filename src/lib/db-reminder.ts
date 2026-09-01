/**
 * 리마인더가 읽고 쓰는 자리 → `reminder-sender` 의 `ReminderSource` · `SentLog`.
 *
 * 정본: spec/backend/08-16-data-model.md §2 `notify_email` · §6 · §8 · §8.4
 * 근거: ADR-021(이메일은 선택·미검증) · ADR-025(보낼지 말지는 규칙) ·
 *       ADR-028(자원 접근 구현은 `src/lib/`)
 *
 * `db.ts` 와 나눈 이유는 `db-plan.ts` 와 같습니다 — 이쪽은 **모듈 하나의
 * 요구**이고, 그 모듈이 선언한 인터페이스 둘을 채우는 것이 전부입니다.
 *
 * ## 판단은 여기 없습니다
 *
 * 「보낼지 말지」는 전부 `reminder-sender` 가 정합니다 — 이메일이 있는가,
 * 기한이 확정인가, 이미 보낸 건 아닌가(ADR-025 *"이건 규칙이지 쿼리가
 * 아닙니다"*). 이 자리는 후보를 넓게 퍼 주고, 좁히는 것은 모듈의 몫입니다.
 * 여기서 미리 좁히면 같은 규칙이 SQL 과 코드 두 곳에 생깁니다.
 */

import 'server-only'

import { seoulDay } from './clock'
import type { Sql } from './db'

import type {
  CaseContact,
  DeadlineCandidate,
  DeadlineKind,
  DeadlineStatus,
  ReminderSource,
  SentLog,
  StepCandidate,
  StepState,
} from '@/modules/reminder-sender'

/**
 * 기산점이 부산물로 확인됐는가 — `rule_snapshot.estimated` 를 읽습니다.
 *
 * ⚠️ **화면(`db.ts` 의 `DeadlineReader`)과 반대 방향으로 기울입니다.**
 * 그쪽은 「없으면 확정」입니다 — 확정 기한에 미확인 배지가 붙는 오해를
 * 막으려는 것이고, 화면은 다음 폴링에 바로 잡힙니다. 메일은 다릅니다:
 * **추정을 확정처럼 보내면 정정할 방법이 없습니다** — 사용자는 그 날짜를
 * 법정 기한으로 믿습니다(08-16-deadline-rules.md). 그래서 여기서는
 * `estimated: false` 가 **명시적으로 적혀 있을 때만** 확정으로 봅니다.
 *
 * 제품 경로(`flows/compute-deadlines.ts`)는 이 값을 늘 적으므로, 없는 줄은
 * 손으로 심은 것뿐입니다 — 그런 줄로 메일을 안 보내는 쪽이 안전합니다.
 */
export function confirmedOf(snapshot: unknown): boolean {
  if (snapshot === null || typeof snapshot !== 'object') return false
  return (snapshot as { estimated?: unknown }).estimated === false
}

export function createReminderSource(sql: Sql): ReminderSource {
  return {
    /**
     * 창에 들었거나 이미 지난 `open` 기한.
     *
     * **지난 것도 퍼 줍니다** — 유예가 남아 있을 수 있고, 지난 기한을 화면에서
     * 지우지 않는 것과 같은 이유입니다. `includePassed: false` 로 거르는 것은
     * 모듈이 합니다(`daysLeft` 가 음수면 지난 것).
     *
     * 날짜 비교는 **서울 날짜끼리** 합니다. `due_at` 은 시각인데 세는 것은
     * 날이라, UTC 로 견주면 한국 아침 기한이 전날로 잡혀 하루 어긋납니다
     * → `lib/clock.ts` 의 `seoulDay`.
     */
    async findDeadlines(asOf, daysBefore) {
      const rows = await sql<
        {
          deadline_id: string
          case_id: string
          kind: string
          status: string
          due_at: Date
          rule_snapshot: Record<string, unknown> | null
        }[]
      >`
        SELECT deadline_id, case_id, kind, status, due_at, rule_snapshot
        FROM deadline
        WHERE status = 'open'
          AND (due_at AT TIME ZONE 'Asia/Seoul')::date
              <= (${asOf}::date + ${daysBefore}::int)
      `
      return rows.map(
        (one): DeadlineCandidate => ({
          deadlineId: one.deadline_id,
          caseId: one.case_id,
          kind: one.kind as DeadlineKind,
          status: one.status as DeadlineStatus,
          dueDate: seoulDay(one.due_at),
          confirmed: confirmedOf(one.rule_snapshot),
        }),
      )
    },

    /** `미확인` 단계 — 사용자가 했다고는 안 했는데 정황이 맞는 것 (§6) */
    async findUnconfirmedSteps() {
      const rows = await sql<
        { plan_step_id: string; case_id: string; state: string; title: string }[]
      >`
        SELECT plan_step_id, case_id, state, title
        FROM plan_step WHERE state = 'unconfirmed'
      `
      return rows.map(
        (one): StepCandidate => ({
          planStepId: one.plan_step_id,
          caseId: one.case_id,
          state: one.state as StepState,
          title: one.title,
        }),
      )
    },

    /**
     * 사건별 연락처. **없는 것도 줄로 돌려줍니다**(`email: null`) —
     * 이메일 없는 사건도 정상 사건이고, 모듈이 `no_email` 로 셉니다(ADR-021).
     */
    async findContacts(caseIds) {
      if (caseIds.length === 0) return []
      const rows = await sql<
        { case_id: string; notify_email: string | null; link_token: string }[]
      >`
        SELECT case_id, notify_email, link_token FROM "case"
        WHERE case_id = ANY(${[...caseIds]}::char(26)[])
      `
      return rows.map(
        (one): CaseContact => ({
          caseId: one.case_id,
          email: one.notify_email,
          // 재진입 링크의 몸통 — 메일이 「돌아오는 길」을 실어야 합니다 (types.ts)
          linkToken: one.link_token,
        }),
      )
    },
  }
}

/**
 * 발송 이력 → `reminder_sent` (§8.4).
 *
 * **보낸 뒤에 표시합니다** — 순서는 모듈이 지킵니다. 여기는 적고 대조할 뿐입니다.
 */
export function createSentLog(sql: Sql): SentLog {
  return {
    async sentAlready(dedupeKey) {
      const rows = await sql<{ ok: number }[]>`
        SELECT 1 AS ok FROM reminder_sent WHERE dedupe_key = ${dedupeKey}
      `
      return rows.length > 0
    },

    async markSent(dedupeKey, caseId) {
      // 같은 열쇠가 이미 있으면 그대로 둡니다 — 두 크론이 겹쳐 돌아도
      // 두 번째 INSERT 가 조용히 무시될 뿐, 터지지 않습니다.
      // `case_id` 는 파기 연쇄용입니다(§8.4) — 사건이 지워지면 이력도 함께 갑니다
      await sql`
        INSERT INTO reminder_sent (dedupe_key, case_id)
        VALUES (${dedupeKey}, ${caseId})
        ON CONFLICT (dedupe_key) DO NOTHING
      `
    },
  }
}
