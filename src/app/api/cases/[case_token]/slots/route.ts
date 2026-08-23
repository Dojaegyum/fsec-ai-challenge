/**
 * `GET /api/cases/{case_token}/slots` — 지금 아는 것과 다음에 물을 것.
 *
 * 정본: spec/common/08-14-api.md §3.4
 * 근거: 08-14-slot-tiering.md(티어) · ADR-039(주소는 링크 토큰)
 *
 * ## ⚠️ `value` 는 토큰화된 값입니다
 *
 * `case_slot.value_masked` 를 그대로 내보냅니다 — 서버에는 복호화 키가
 * 없어 원문을 만들 수 없습니다. 화면에 뜨는 값의 복원은 **브라우저가**
 * 합니다 → 04-pii-boundary.md 규칙 3.
 *
 * ## 두 곳에서 읽는 이유
 *
 * 티어 판정과 다음 질문은 **슬롯 상태로 계산되는 것**이라 흐름이 냅니다.
 * 값은 화면에만 필요해서 조회를 따로 씁니다 — 플랜을 만드는 쪽에 값을
 * 흘려보내면 그쪽이 안 쓰는 개인정보를 들고 다니게 됩니다.
 */

import { readCasePlan } from '@/flows/regenerate-plan'
import { caseIdOf, handleRoute } from '@/lib/request'

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const [snapshot, slots] = await Promise.all([
      readCasePlan(caseId, { container, store: container.ports.casePlan }),
      container.slots.read(caseId),
    ])

    return {
      body: {
        slots: slots.map((one) => ({
          slot_key: one.slotKey,
          tier: one.tier,
          state: one.state,
          // 토큰화된 값입니다. 없으면 `null` — 「모름」도 정상 상태입니다
          value: one.valueMasked,
          // 있을 때만 붙입니다. 사용자가 직접 답한 값에는 신뢰도가 없습니다
          ...(one.confidence === null ? {} : { confidence: one.confidence }),
          ...(one.sourceRef === null ? {} : { source_ref: one.sourceRef }),
        })),
        tier_status: { T1: snapshot.t1, T2: snapshot.t2 },
        next_question: snapshot.nextQuestion
          ? {
              slot_key: snapshot.nextQuestion.slotKey,
              text: snapshot.nextQuestion.text,
              input: snapshot.nextQuestion.input,
              options: [...(snapshot.nextQuestion.options ?? [])],
            }
          : null,
      },
    }
  })
}
