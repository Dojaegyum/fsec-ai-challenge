/**
 * `PATCH /api/cases/{case_token}/slots/{slot_key}` — 질문에 답한다.
 *
 * 정본: spec/common/08-14-api.md §3.5 · §1.3(사건당 분당 60회)
 * 근거: ADR-040(쓰기도 경계를 지난다) · ADR-041(거부 대신 되묻기) ·
 *       CLAUDE.md 불변 규칙 5(「모름」은 실패가 아니다)
 *
 * ## 판단은 흐름이 합니다
 *
 * 이 파일은 본문을 읽고 계약의 표기로 옮기기만 합니다. 경계를 지나는
 * 판단(토큰화·되묻기·저장)은 `flows/answer-slot.ts` 에 있습니다 — 라우트에
 * 두면 그 순서가 라우트마다 복제되고, 복제된 것 중 하나가 토큰화를
 * 빠뜨리면 원문이 그대로 저장됩니다.
 */

import { afterAnswer, answerSlot, type SlotAction } from '@/flows/answer-slot'
import { BadRequestError, readJsonObject } from '@/lib/http'
import { caseIdOf, handleRoute } from '@/lib/request'

/** §3.5 가 정한 넷 */
const ACTIONS: readonly SlotAction[] = ['answer', 'unknown', 'mask', 'keep']

interface AnswerBody {
  readonly action?: unknown
  readonly value?: unknown
}

function readAction(body: AnswerBody): SlotAction {
  if (typeof body.action !== 'string' || !ACTIONS.includes(body.action as SlotAction)) {
    // ⚠️ **받은 값을 detail 에 넣지 않습니다** — 감사 기록으로 가는 자리이고,
    // 여기 오는 본문에는 사용자가 타이핑한 개인정보가 있을 수 있습니다
    throw new BadRequestError('action 값이 목록 밖입니다', {
      param: 'action',
      allowed: [...ACTIONS],
    })
  }
  return body.action as SlotAction
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ case_token: string; slot_key: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)
    const { slot_key: slotKey } = await route.params

    // 사건당 분당 60회 → §1.3. 버튼 연타를 흡수합니다.
    // **경로 파라미터를 읽은 뒤에야 걸 수 있습니다** — 세는 단위가 사건입니다
    await ctx.limit('slot', caseId)

    const body = await readJsonObject<AnswerBody>(ctx.request)
    const action = readAction(body)

    const result = await answerSlot(
      {
        caseId,
        slotKey,
        action,
        ...(typeof body.value === 'string' ? { value: body.value } : {}),
      },
      container,
    )

    // **확인이 플랜을 막지 않습니다** → ADR-041. `pii_pending` 으로 남아도
    // 다음 질문은 나가고 T0 와 유형 기본은 그대로입니다
    const after = await afterAnswer(caseId, container)

    return {
      body: {
        slot: {
          slot_key: result.slotKey,
          state: result.state,
          value: result.value,
        },
        ...(result.piiConfirm
          ? {
              pii_confirm: {
                found: result.piiConfirm.found,
                // 문구는 `S-11` 의 어휘를 씁니다 — 「가려진 것」·「나간 것」.
                // **토큰·마스킹·API 같은 말을 화면에 쓰지 않습니다**
                text: '여기에 개인정보가 들어 있는 것 같습니다.',
                note: '가리면 이 값은 이 기기 밖으로 나가지 않습니다.',
                options: [
                  { id: 'mask', label: '맞아요 — 가릴게요' },
                  { id: 'keep', label: '아니에요 — 개인정보가 아닙니다' },
                ],
              },
            }
          : {}),
        plan_regenerated: result.planRegenerated,
        next_question: after.nextQuestion
          ? {
              slot_key: after.nextQuestion.slotKey,
              text: after.nextQuestion.text,
              input: after.nextQuestion.input,
              options: [...(after.nextQuestion.options ?? [])],
            }
          : null,
        // ⬜ **기한 변화가 아직 안 나갑니다.** 답 하나가 기한을 옮기려면
        // `date-checker` 가 답 뒤에 다시 돌아야 하는데, 그 자리를 아직
        // 안 붙였습니다. 빈 배열이 「안 바뀌었다」로 읽히는 것은 맞습니다 —
        // 실제로 지금은 아무것도 안 바뀝니다
        changed_deadlines: [],
      },
    }
  })
}
