/**
 * `GET /api/cases/{case_token}` — 재방문 진입.
 *
 * 정본: spec/common/08-14-api.md §3.10
 * 근거: ADR-021(며칠 뒤 링크를 열면 곧장 플랜으로) · ADR-039(주소는 링크 토큰)
 *
 * ## 화면 첫 로드의 유일한 입구입니다
 *
 * `/c/{token}` 이 이것 하나만 부릅니다. 셋으로 나눠 부르면 **왕복이 셋이고,
 * 사이에 화면이 반쯤 그려진 상태**가 생깁니다 — 며칠 만에 링크를 연 사람에게
 * 슬롯만 뜨고 플랜이 아직 없는 화면을 보여주게 됩니다.
 *
 * ## 모양을 여기서 다시 정의하지 않습니다
 *
 * 세 덩어리는 **§3.4 · §3.6 · §3.7 의 응답 그대로**입니다. 갈라지면 프론트가
 * 같은 것을 두 번 구현합니다 → §3.10 「구조를 다시 정의하지 않습니다」.
 */

import { toApiChannel, toApiStep } from '@/flows/api-plan'
import { readCasePlan } from '@/flows/regenerate-plan'
import { CaseNotFoundError } from '@/lib/http'
import { caseIdOf, handleRoute } from '@/lib/request'

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    // 넷을 한꺼번에 부릅니다. 차례로 부르면 왕복이 넷이고, 서버 함수에서
    // 그 값이 큽니다 — 저장소가 서울에 있어도 왕복마다 수십 밀리초입니다
    const [found, snapshot, slots, deadlines] = await Promise.all([
      container.caseRead.read(caseId),
      readCasePlan(caseId, { container, store: container.ports.casePlan }),
      container.slots.read(caseId),
      container.deadlines.read(caseId),
    ])

    // 링크 토큰으로는 찾았는데 사건 행이 없으면 파기된 것입니다
    if (!found) throw new CaseNotFoundError('그 사건을 찾지 못했습니다')

    if (snapshot.kbVersion) ctx.telemetry.useKbVersion(snapshot.kbVersion)

    return {
      body: {
        case_id: caseId,
        track: found.track,
        created_at: found.createdAt,
        last_activity_at: found.lastActivityAt,
        // 마지막 활동일부터 180일 → ADR-016
        purge_after: found.purgeAfter,

        // §3.4 그대로
        slots: {
          slots: slots.map((one) => ({
            slot_key: one.slotKey,
            tier: one.tier,
            state: one.state,
            value: one.valueMasked,
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

        // §3.6 그대로
        plan: {
          is_superset: snapshot.isSuperset,
          generated_at: null,
          kb_version: snapshot.kbVersion,
          channels: snapshot.channels.map(toApiChannel),
          steps: snapshot.steps.map(toApiStep),
        },

        // §3.7 그대로
        deadlines: {
          deadlines: deadlines.map((one) => ({
            deadline_id: one.deadlineId,
            step_id: one.stepId,
            title: one.title,
            kind: one.kind,
            due_at: one.dueAt,
            status: one.status,
            ...(one.computedFrom === null ? {} : { computed_from: one.computedFrom }),
            ...(one.onMiss === null ? {} : { on_miss: one.onMiss }),
            ...(one.note === null ? {} : { note: one.note }),
          })),
        },
      },
    }
  })
}
