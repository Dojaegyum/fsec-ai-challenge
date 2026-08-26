/**
 * 기한을 계약의 표기로 옮기는 자리 — **옮기는 곳을 하나로 둡니다.**
 *
 * 정본: spec/common/08-14-api.md §3.7 §3.10
 *
 * ## 왜 함수로 뺐나
 *
 * §3.10 은 *"§3.7 응답 그대로"* 라고 정했는데, 두 라우트가 각자 옮기고 있어
 * **§3.10 쪽이 얇았습니다** — `days_left`·`starts_at`·`elapsed` 셋이 빠져 있었습니다.
 * 재방문 화면은 이 경로 하나만 부르므로(§3.10 「화면 첫 로드의 유일한 입구」),
 * 며칠 만에 링크를 연 사람에게 **D-day 도 공고 진행률도 안 보입니다.**
 *
 * JSON 이라 컴파일이 안 막습니다. 한쪽에만 칸을 더하면 조용히 갈라집니다.
 *
 * ## 지난 기한을 여기서 함께 정리합니다
 *
 * §3.7 이 경고한 자리입니다 — *"`days_left` 계산과 `status` 전이를 **같은
 * 자리에서** 하세요"*. 서버가 `missed` 를 늦게 붙이면 그 사이 지난 기한이
 * **아직 안 지난 것처럼** 보이고, 화면에는 알아챌 신호가 없습니다.
 *
 * 조회가 쓰기를 하는 셈이지만 **계산이 아닙니다** — 이미 적힌 날짜와 지금
 * 시각을 견주기만 하는 상태 전이라, 부를 때마다 기한이 달라지지 않습니다.
 */

import 'server-only'

import { serverClock } from '@/lib/clock'
import type { Container } from '@/lib/container'
import type { DeadlineView } from '@/lib/db'
import { daysLeft, elapsedRatio } from '@/lib/deadline-view'

/**
 * 사용자가 지켜야 하는 종류 — 여기에만 `days_left` 가 붙습니다.
 *
 * `kind: "info"` 는 기관이 하는 일이라 D-day 를 그리면 **사용자 기한으로
 * 오인시킵니다** → 09-data-model.md §8.3. 그쪽은 `starts_at`·`elapsed` 로
 * 「지금 어디쯤인가」만 보여줍니다.
 */
const USER_DEADLINES: ReadonlySet<string> = new Set(['primary', 'grace'])

/** 계약의 `deadlines[]` 한 칸 → §3.7 */
export interface ApiDeadline {
  readonly deadline_id: string
  readonly step_id: string | null
  readonly title: string
  readonly kind: string
  readonly due_at: string
  readonly status: string
  readonly days_left?: number
  readonly computed_from?: string
  readonly on_miss?: string
  readonly condition?: string
  readonly starts_at?: string
  readonly elapsed?: number
  readonly note?: string
}

/**
 * 기한 하나를 계약의 모양으로.
 *
 * `today`·`nowMs` 를 **밖에서 받습니다.** 줄마다 시계를 보면 목록 안에서
 * 날짜가 갈릴 수 있습니다 — 자정을 걸쳐 도는 요청에서 실제로 그렇습니다.
 */
export function toApiDeadline(
  one: DeadlineView,
  at: { readonly today: string; readonly nowMs: number },
): ApiDeadline {
  // 지났으면 `null` 이고, 그때는 **칸을 뺍니다** → §3.7 확정.
  // 음수를 보내면 화면이 그릴 곳이 없습니다(「D+3」은 시안에 없습니다)
  const left = USER_DEADLINES.has(one.kind) ? daysLeft(one.dueAt, at.today) : null
  const elapsed =
    one.kind === 'info' && one.startsAt !== null
      ? elapsedRatio(one.startsAt, one.dueAt, at.nowMs)
      : null

  return {
    deadline_id: one.deadlineId,
    step_id: one.stepId,
    title: one.title,
    kind: one.kind,
    due_at: one.dueAt,
    status: one.status,
    // **화면이 날짜를 세지 않습니다** — 기기 시계가 틀리면 기한을 놓칩니다
    ...(left === null ? {} : { days_left: left }),
    ...(one.computedFrom === null ? {} : { computed_from: one.computedFrom }),
    ...(one.onMiss === null ? {} : { on_miss: one.onMiss }),
    // 유예가 어떤 조건에서 주어지나 — 없으면 **추가 기간을 본 기한으로
    // 착각**합니다 (§8.1)
    ...(one.condition === null ? {} : { condition: one.condition }),
    // 공고 대기 카드의 달력 앵커 — 왼쪽 끝과 마커 (ADR-048)
    ...(one.kind === 'info' && one.startsAt !== null ? { starts_at: one.startsAt } : {}),
    ...(elapsed === null ? {} : { elapsed }),
    // `kind: "info"` 는 사용자가 지켜야 할 기한이 아닙니다.
    // note 로 그렇게 밝힙니다 → 09-data-model.md §8.3
    ...(one.note === null ? {} : { note: one.note }),
  }
}

/**
 * 지난 것을 정리하고 **§3.7 모양 그대로** 읽어 온다.
 *
 * 두 라우트(§3.7 · §3.10)가 이것 하나를 부릅니다.
 */
export async function readApiDeadlines(
  caseId: string,
  container: Container,
): Promise<readonly ApiDeadline[]> {
  await container.deadlineWrite.sweepOverdue(caseId, serverClock.now())

  const rows = await container.deadlines.read(caseId)

  // **한 번만 읽습니다** — 위 주석과 같은 이유입니다
  const at = { today: serverClock.today(), nowMs: serverClock.nowMs() }
  return rows.map((one) => toApiDeadline(one, at))
}
