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
 *
 * ## 옮기는 것은 여기가 아닙니다
 *
 * §3.10 이 같은 모양을 써야 해서 [api-deadlines.ts](../../../../../flows/api-deadlines.ts)
 * 한 자리로 모았습니다. 전에는 둘이 각자 옮겼고, **§3.10 쪽에 세 칸이
 * 빠져 있었습니다.**
 */

import { readApiDeadlines } from '@/flows/api-deadlines'
import { caseIdOf, handleRoute } from '@/lib/request'

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    return { body: { deadlines: await readApiDeadlines(caseId, container) } }
  })
}
