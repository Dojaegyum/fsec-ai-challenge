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

import { caseIdOf, handleRoute } from '@/lib/request'

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const rows = await container.deadlines.read(caseId)

    return {
      body: {
        deadlines: rows.map((one) => ({
          deadline_id: one.deadlineId,
          step_id: one.stepId,
          title: one.title,
          kind: one.kind,
          due_at: one.dueAt,
          status: one.status,
          ...(one.computedFrom === null ? {} : { computed_from: one.computedFrom }),
          ...(one.onMiss === null ? {} : { on_miss: one.onMiss }),
          // `kind: "info"` 는 사용자가 지켜야 할 기한이 아닙니다.
          // note 로 그렇게 밝힙니다 → 09-data-model.md §8.3
          ...(one.note === null ? {} : { note: one.note }),
        })),
      },
    }
  })
}
