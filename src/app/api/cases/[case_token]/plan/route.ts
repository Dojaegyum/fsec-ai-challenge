/**
 * `GET /api/cases/{case_token}/plan` — 지금 플랜.
 *
 * 정본: spec/common/08-14-api.md §3.6
 * 근거: ADR-047(단계 하나의 모양) · ADR-039(주소는 링크 토큰)
 *
 * ## 조회는 아무것도 안 바꿉니다
 *
 * 화면이 이 경로를 폴링으로 반복해서 부릅니다(§1.3). 그때마다 플랜을
 * 다시 만들면 감사 기록이 조회 횟수만큼 쌓이고, KB 릴리스가 바뀌는 순간
 * 사용자가 보던 플랜이 새로고침 한 번에 달라집니다
 * → `flows/regenerate-plan.ts` 의 `readCasePlan`.
 */

import { toApiStep } from '@/flows/api-plan'
import { readCasePlan } from '@/flows/regenerate-plan'
import { caseIdOf, handleRoute } from '@/lib/request'

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const snapshot = await readCasePlan(caseId, {
      container,
      store: container.ports.casePlan,
    })

    if (snapshot.kbVersion) ctx.telemetry.useKbVersion(snapshot.kbVersion)

    return {
      body: {
        is_superset: snapshot.isSuperset,
        // **단계가 만들어진 시각입니다.** 지금 시각을 넣으면 화면이 매번
        // 「방금 갱신됨」으로 보입니다
        generated_at: null,
        kb_version: snapshot.kbVersion,
        // ⬜ **경유 서비스 목록이 아직 안 나갑니다.** §3.6 의 `channels` 는
        // `case_channel` 의 여러 줄인데 `CasePlanStore.readChannel` 은 하나만
        // 돌려줍니다. 여럿을 읽는 자리를 만들기 전에는 빈 배열이 정직합니다
        channels: [],
        steps: snapshot.steps.map(toApiStep),
      },
    }
  })
}
