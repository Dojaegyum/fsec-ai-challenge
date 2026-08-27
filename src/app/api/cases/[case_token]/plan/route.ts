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

import { toApiChannel, toApiStep } from '@/flows/api-plan'
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
        // ⬜ **TODO(근거 필요 아님 — 이을 자리가 없음): §3.6 이 정한 칸인데 값을
        // 실을 길이 없습니다.**
        //
        // 값은 표에 **이미 있습니다** — `plan_step.generated_at`(09-data-model.md §6)
        // 에 `planner` 가 만든 시각이 들어가고, `lib/db-plan.ts` 의 INSERT 가
        // 그것을 적습니다. **되읽는 자리만 없습니다**: `readSteps` 의 SELECT 에
        // 그 칼럼이 없고, `StoredStep`(flows/regenerate-plan.ts)에도
        // `PlanSnapshot` 에도 칸이 없습니다.
        //
        // **지금 시각을 넣으면 안 됩니다.** 화면이 아무 일도 없었는데 매번
        // 「방금 갱신됨」으로 보입니다 — 없는 것을 없다고 두는 편이 낫습니다.
        //
        // 이으려면 셋을 함께 고쳐야 합니다 — SELECT 에 `generated_at` 추가 ·
        // `StoredStep` 에 `generatedAt` 칸 · `PlanSnapshot` 에 **가장 최근
        // 것**(보존된 단계는 옛 시각을 그대로 들고 있습니다).
        generated_at: null,
        kb_version: snapshot.kbVersion,
        channels: snapshot.channels.map(toApiChannel),
        steps: snapshot.steps.map(toApiStep),
      },
    }
  })
}
