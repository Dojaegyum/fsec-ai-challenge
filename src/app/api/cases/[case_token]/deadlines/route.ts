/**
 * `GET /api/cases/{case_token}/deadlines` — 계산해 둔 기한.
 *
 * 정본: spec/common/08-14-api.md §3.7 · spec/backend/08-16-data-model.md §8
 * 근거: CLAUDE.md 불변 규칙 7(기한 계산에 언어모델을 쓰지 않는다)
 *
 * ## 여기서 계산하지 않습니다
 *
 * 법정 기한은 **코드의 규칙**이 계산해 `deadline` 표에 적어 둡니다
 * (`date-checker`). 이 경로는 적힌 것을 읽기만 합니다 — 조회 때마다 다시
 * 계산하면 같은 사건의 기한이 부를 때마다 달라질 수 있습니다.
 *
 * ## 본 기한과 추가 기간을 합치지 않습니다
 *
 * 별도 항목으로 나갑니다 → §3.7 · 09-data-model.md §8.1. 합치면 사용자가
 * **추가 기간을 본 기한으로 착각**합니다 — 3영업일과 14일은 성격이 다릅니다.
 */

import { serverClock } from '@/lib/clock'
import { daysLeft, elapsedRatio } from '@/lib/deadline-view'
import { caseIdOf, handleRoute } from '@/lib/request'

/**
 * 사용자가 지켜야 하는 종류 — 여기에만 `days_left` 가 붙습니다.
 *
 * `kind: "info"` 는 기관이 하는 일이라 D-day 를 그리면 **사용자 기한으로
 * 오인시킵니다** → 09-data-model.md §8.3. 그쪽은 `starts_at`·`elapsed` 로
 * 「지금 어디쯤인가」만 보여줍니다.
 */
const USER_DEADLINES: ReadonlySet<string> = new Set(['primary', 'grace'])

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const rows = await container.deadlines.read(caseId)

    // **한 번만 읽습니다.** 줄마다 시계를 보면 목록 안에서 날짜가 갈릴 수 있습니다 —
    // 자정을 걸쳐 도는 요청에서 실제로 그렇습니다
    const today = serverClock.today()
    const nowMs = serverClock.nowMs()

    return {
      body: {
        deadlines: rows.map((one) => {
          // 지났으면 `null` 이고, 그때는 **칸을 뺍니다** → §3.7 확정.
          // 음수를 보내면 화면이 그릴 곳이 없습니다(「D+3」은 시안에 없습니다)
          const left = USER_DEADLINES.has(one.kind) ? daysLeft(one.dueAt, today) : null
          const elapsed =
            one.kind === 'info' && one.startsAt !== null
              ? elapsedRatio(one.startsAt, one.dueAt, nowMs)
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
            ...(one.kind === 'info' && one.startsAt !== null
              ? { starts_at: one.startsAt }
              : {}),
            ...(elapsed === null ? {} : { elapsed }),
            // `kind: "info"` 는 사용자가 지켜야 할 기한이 아닙니다.
            // note 로 그렇게 밝힙니다 → 09-data-model.md §8.3
            ...(one.note === null ? {} : { note: one.note }),
          }
        }),
      },
    }
  })
}
