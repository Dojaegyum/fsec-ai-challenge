/**
 * `POST /api/cases/{case_token}/messages` — 대응 비서 챗 (`F-07`).
 *
 * 정본: spec/common/08-14-api.md §3.9 · spec/backend/08-16-chat-context.md ·
 *       §1.3(사건당 분당 20턴)
 * 근거: CLAUDE.md 불변 규칙 1(LLM 은 절차를 창작하지 않는다) ·
 *       불변 규칙 2(외부 모델에는 토큰화된 텍스트만) · ADR-028
 *
 * ## 근거 없이 답하지 않습니다
 *
 * 모델이 인용 형식을 못 맞추면 **한 번 더 부르고, 그래도 안 되면 멈춥니다**
 * (`KbCitationMissingError`). 조회 자체가 실패해도 멈춥니다 — 근거 없이
 * 답하느니 안 답하는 편이 낫습니다. 잘못된 안내가 곧 금전 손실입니다.
 *
 * ## 나가기 전에 한 번 더 봅니다
 *
 * `chat-publisher` 가 송출 직전에 잔여 개인정보를 검사합니다. 걸리면
 * `EgressBlockedError` 로 막습니다 — **통과시키고 로그만 남기는 경로는
 * 없습니다** → 08-16-errors.md 원칙 1.
 */

import { chatTurn } from '@/flows/chat-turn'
import { BadRequestError, readJsonObject } from '@/lib/http'
import { caseIdOf, handleRoute } from '@/lib/request'

/** 한 발화의 길이 상한. 넘으면 프롬프트가 맥락을 밀어냅니다 */
const MAX_CONTENT = 2000

interface MessageBody {
  readonly content?: unknown
}

export async function POST(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    // 사건당 분당 20턴 → §1.3. **가장 비싼 경로입니다** — 모델을 부릅니다.
    // 경로 파라미터를 읽은 뒤에야 걸 수 있습니다(세는 단위가 사건)
    await ctx.limit('chat', caseId)

    const body = await readJsonObject<MessageBody>(ctx.request)
    if (typeof body.content !== 'string' || body.content.trim().length === 0) {
      throw new BadRequestError('content 가 없습니다', { param: 'content' })
    }
    if (body.content.length > MAX_CONTENT) {
      // ⚠️ **받은 값을 detail 에 넣지 않습니다** — 사용자가 타이핑한 글입니다
      throw new BadRequestError('content 가 너무 깁니다', {
        param: 'content',
        limit: MAX_CONTENT,
      })
    }

    const turn = await chatTurn({ caseId, content: body.content }, container)

    return {
      body: {
        ...turn.body,
        referenced_steps: turn.referencedSteps,
        referenced_deadlines: turn.referencedDeadlines,
      },
    }
  })
}
