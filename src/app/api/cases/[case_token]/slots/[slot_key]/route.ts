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

import { isSlotKey } from '@/modules/slot-checker'
import { WIRE_NAME, type TokenKind } from '@/modules/pii-tokenizer'

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

/**
 * 슬롯 이름이 §5.1 목록 안인가 → `modules/slot-checker` 의 `isSlotKey`.
 *
 * **목록 밖 이름을 그대로 저장하면 표에 죽은 줄이 쌓입니다.** 아무도 안 읽는
 * 값이면서 `tierOf`·`valueTypeOf` 는 이름을 모르는 채로 지나가고, 그 뒤로는
 * 슬롯 체커가 그 줄을 어느 티어로도 세지 않습니다 — **틀린 답을 받아 놓고
 * 아무 일도 안 일어난 것처럼 보입니다.**
 *
 * 목록은 `check.ts` 의 표 하나가 정본입니다(09-data-model.md §5.1 을 그대로
 * 옮긴 것). **여기서 다시 적지 않습니다** — 두 벌이면 슬롯을 하나 늘릴 때
 * 한쪽만 고쳐집니다.
 *
 * `BAD_REQUEST`(400)입니다 → 08-16-errors.md §3. 경로 파라미터의 모양이 틀린
 * 것이라 `caseTokenOf`·`ulidParamOf` 와 같은 자리입니다.
 */
function readSlotKey(slotKey: string): string {
  if (!isSlotKey(slotKey)) {
    // ⚠️ **값을 detail 에 넣지 않습니다** — 감사 기록으로 갑니다.
    // 이름 자체는 개인정보가 아니지만, 주소에서 온 값을 그대로 옮겨 적는
    // 습관이 다른 자리(링크 토큰)에서 그대로 되풀이됩니다
    throw new BadRequestError('slot_key 가 목록 밖입니다', { param: 'slot_key' })
  }
  return slotKey
}

/**
 * 되묻기에 실린 개인정보 후보를 **유형별 건수**로 → 08-14-api.md §1.1.
 *
 * **값이 아니라 건수만 담습니다.** 헤더는 「경계가 실제로 돌았다」를 증명하는
 * 자리이지 무엇을 잡았는지 알리는 자리가 아닙니다 → 04-pii-boundary.md.
 *
 * 이름은 영문(`account`·`name`)입니다 — 토큰 자체는 한국어(`[계좌-1]`)인데
 * §1.1 이 `account=1;name=2` 로 못 박았습니다. 옮기는 표가
 * `pii-tokenizer` 의 `WIRE_NAME` 하나입니다.
 *
 * ⬜ **여기서 셀 수 있는 것은 되묻기로 나간 것뿐입니다.** `flows/answer-slot.ts`
 * 의 `AnswerResult` 에 건수 칸이 없어, 「가릴게요(`mask`)」로 실제 치환이 일어난
 * 답은 이 헤더에 안 잡힙니다. 그 흐름에 `counts` 를 실어야 메워집니다 —
 * `TokenizeResult.counts` 가 이미 그 값을 들고 있습니다.
 */
function tokenCounts(found: readonly { readonly kind: string }[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const one of found) {
    const name = Object.hasOwn(WIRE_NAME, one.kind)
      ? WIRE_NAME[one.kind as TokenKind]
      : one.kind
    counts[name] = (counts[name] ?? 0) + 1
  }
  return counts
}

export async function PATCH(
  request: Request,
  route: { params: Promise<{ case_token: string; slot_key: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)
    // **목록 밖 이름을 받아 놓고 아무 일도 안 하지 않습니다** → 아래 `readSlotKey`
    const slotKey = readSlotKey((await route.params).slot_key)

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

    // **경계가 돌았다는 것을 응답이 증명합니다** → §1.1. 안 채우면 헤더가
    // 언제나 `none` 이라, 토큰화가 도는지 멈췄는지를 응답만 봐서는 못 가립니다
    if (result.piiConfirm) {
      ctx.telemetry.addTokenCounts(tokenCounts(result.piiConfirm.found))
    }

    // **확인이 플랜을 막지 않습니다** → ADR-041. `pii_pending` 으로 남아도
    // 다음 질문은 나가고 T0 와 유형 기본은 그대로입니다
    const after = await afterAnswer(caseId, container, result.planRegenerated)

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
        // **안 바뀐 기한은 안 실립니다** → §3.5. 매번 전부 실으면 화면이
        // 아무 일도 없었는데 「날짜가 바뀌었습니다」를 띄웁니다.
        //
        // 기산 슬롯이 아직 안 채워졌으면 빈 배열이고, 그것이 정상입니다 —
        // 「3영업일」은 무엇으로부터인지가 정해져야 날짜가 됩니다
        changed_deadlines: after.changedDeadlines.map((one) => ({
          deadline_id: one.deadlineId,
          kind: one.kind,
          due_at: one.dueAt,
          // 새로 생긴 기한에는 옮겨지기 전 날짜가 없습니다
          ...(one.changedFrom === null ? {} : { changed_from: one.changedFrom }),
        })),
      },
    }
  })
}
