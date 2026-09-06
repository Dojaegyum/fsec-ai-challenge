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
 * ## 답이 아니라 질문이 나갈 수도 있습니다
 *
 * 응답은 **세 갈래가 한 형태로** 나갑니다 — 답변 · 되묻기 · 1332 안내
 * (§3.9 · 11-chat-context.md §6.3). 화면이 갈래를 분기하지 않도록
 * `chat-publisher` 가 같은 칸을 채웁니다 → ADR-022.
 *
 * **`next_question` 은 답변에도 실립니다.** 화면이 이 값으로 문진 카드를
 * 바꿔 다는데, `null` 을 받으면 **남은 질문을 지웁니다** — 말로 한 마디 했다고
 * 문진이 끝나 버립니다 (`c/[token]/send.ts` 의 `setQuestion`).
 *
 * ## 나가기 전에 한 번 더 봅니다
 *
 * `chat-publisher` 가 송출 직전에 잔여 개인정보를 검사합니다. 걸리면
 * `EgressBlockedError` 로 막습니다 — **통과시키고 로그만 남기는 경로는
 * 없습니다** → 08-16-errors.md 원칙 1.
 */

import { after } from 'next/server'

import { chatTurn } from '@/flows/chat-turn'
import { BadRequestError, readJsonObject } from '@/lib/http'
import { caseIdOf, handleRoute } from '@/lib/request'

/** 한 발화의 길이 상한. 넘으면 프롬프트가 맥락을 밀어냅니다 */
const MAX_CONTENT = 2000

/**
 * 화면에 내릴 대화 줄 수 상한 → §3.12.
 *
 * ⚠️ **`MessageStore.history()` 의 20턴을 그대로 쓰지 않습니다.** 그 숫자는
 * 모델 컨텍스트 예산에서 나온 것이고, 화면은 다른 이유로 정합니다 —
 * 가족이 링크를 열었을 때 「무슨 일이 있었나」가 보일 만큼입니다.
 *
 * 한 턴이 두 줄(사용자·비서)이라 60줄이면 30턴입니다. 넘으면 **오래된 것부터**
 * 자르고 `truncated: true` 를 실어 화면이 그 사실을 말하게 합니다.
 *
 * 정본 §3.12 도 같은 값입니다(2026-09-04 에 올렸습니다 — 그전엔 여기가 먼저 섰습니다).
 * 이름은 `MAX_TURNS` 지만 세는 단위는 **줄**입니다(60줄 = 30턴).
 */
const MAX_TURNS = 60

/**
 * `GET /api/cases/{case_token}/messages` — 대화 이력 (§3.12 · ADR-050).
 *
 * **왜 필요한가:** 사건 화면 헤더에 「가족에게 링크 보내기」 버튼이 있습니다.
 * 받은 사람이 열었을 때 대화가 비어 있으면 그 버튼이 거짓말이 됩니다.
 *
 * **`content` 는 토큰화된 상태입니다** — 칼럼 이름이 `content_masked` 인 것이
 * 그 뜻이고, 서버는 원문을 갖고 있지 않습니다. 푸는 것은 브라우저입니다.
 *
 * **`prompt_masked`·`reasoning_masked` 를 내리지 마세요** — 프롬프트와 판단
 * 근거는 사용자 응답에 넣지 않습니다 (ADR-022 · §5.4).
 *
 * **`referenced_steps`·`referenced_deadlines` 는 내립니다** — §3.9 가 낸 것을
 * 저장했다가 그대로 돌려주는 것이라 새 계산이 없습니다(ADR-065). 이 칸이 없어
 * 새로고침 뒤에 챗↔단계 연결이 사라지고 있었습니다(GitHub #41).
 */
/**
 * **10초에 안 끝납니다.** 모델을 290초까지 기다리는데(`lib/llm.ts`), 함수 상한이
 * 그보다 짧으면 함수가 먼저 죽습니다 — 사용자는 「응답 없음」만 보고
 * **무엇이 늦었는지 아무 데도 안 남습니다.**
 *
 * ⚠️ 2026-09-06: 60초로는 16:40~17:00 배포본에서 20턴 중 6턴이 (당시) 55초
 * 모델 예산에 끊겼습니다(모델 제공자 지연). 같은 배포에서 판독 수거 요청이
 * 69초를 넘겨도 살아 있었으므로 **플랫폼 상한은 60초가 아닙니다**(Fluid compute).
 * 100초·90초로 올린 뒤에도 같은 날 저녁 재검에서 한 턴이 93초로 끊겼습니다.
 *
 * **300 은 Hobby 플랜(Fluid compute)이 허용하는 최대입니다.** 우리가 먼저 끊지 않기로
 * 정했으므로(2026-09-06 저녁) 플랫폼 상한까지 열어 두고, 모델 예산(290초)은 그 바로
 * 아래에 둡니다 — 플랫폼이 죽이기 직전 10초에만 우리 503 이 나갑니다.
 */
export const maxDuration = 300

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const read = await container.messages.turns(caseId, MAX_TURNS)

    return {
      body: {
        messages: read.turns.map((one) => ({
          message_id: one.messageId,
          role: one.role,
          content: one.contentMasked,
          // 근거는 비서 줄에만 붙습니다. 사용자 줄에는 빈 배열이 들어 있어
          // 그대로 내리면 화면이 「근거 없음」과 구별하지 못합니다.
          //
          // 답이 가리킨 단계·기한도 같은 자리입니다 — 라이브 턴(§3.9)과 같은
          // 모양이라야 새로고침 뒤에도 챗↔단계 연결이 남습니다(ADR-065).
          // **없으면 빈 배열이지 칸을 빼는 것이 아닙니다.** 그 사이 플랜이 다시
          // 생성돼 지금 플랜에 없는 id 가 섞여도 여기서 거르지 않습니다 —
          // 이력은 「그때 무엇을 가리켰나」이고, 모르는 id 는 화면이 무시합니다
          ...(one.role === 'user'
            ? {}
            : {
                citations: one.citations,
                referenced_steps: one.referencedSteps,
                referenced_deadlines: one.referencedDeadlines,
              }),
          ...(one.insufficient ? { insufficient: true } : {}),
          created_at: one.createdAt,
        })),
        truncated: read.truncated,
      },
    }
  })
}

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
    // 발화 한 턴은 활동입니다 — 파기일이 「마지막 활동일 + 180일」로 밀립니다(ADR-016)
    ctx.activity(caseId)

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

    // **진술에서 슬롯을 뽑는 것은 응답 뒤입니다** → ADR-087. 모델 호출 하나가 더 붙는
    // 일이라 턴 안에서 돌리면 사용자가 답을 보는 시각이 그만큼 밀립니다 — 뽑힌 값은
    // 다음 번들에서 되묻기 문항으로 나오면 되는 것이라 이 응답을 기다리게 하지 않습니다.
    // 흐름이 스스로 삼키므로 여기서 터질 것은 없습니다(불변 규칙 5)
    after(turn.deferred)

    // **계측 넷을 여기서 채웁니다** → §1.1. 안 채우면 넷 다 「없음」으로 나가는데,
    // 답변 생성이 **응답 경로의 유일한 외부 모델 호출**입니다 — 개인정보 보호가
    // 작동한다는 것을 응답이 증명해야 하는 자리가 바로 여기입니다.
    //
    // 위 `after` 로 미룬 슬롯 추출(ADR-087)도 모델을 한 번 부르지만 **응답 뒤**라
    // 이 계측에 안 셉니다 — 헤더는 이미 나간 뒤이고, 그 호출의 토큰·잔여는 이 응답이
    // 증명할 수 있는 것이 아닙니다. 세려면 감사 쪽(`llm.called`)에 따로 남길 일입니다
    ctx.telemetry.addTokenCounts(turn.telemetry.piiTokenCounts)
    ctx.telemetry.setEgressResidual(turn.telemetry.piiEgressResidual)
    ctx.telemetry.useKbVersion(turn.telemetry.kbVersion)
    ctx.telemetry.useAuditId(turn.telemetry.auditId)

    return {
      body: {
        ...turn.body,
        referenced_steps: turn.referencedSteps,
        referenced_deadlines: turn.referencedDeadlines,
        // **토큰화가 이 요청에서 막 일어났을 때만** 원문 포함 대응표를 건넵니다 →
        // §3.9 `pii_mappings` · ADR-075. 전사 라우트(§3.3 · ADR-062)와 같은 모양이라
        // 브라우저가 같은 `absorb` 로 봉해 볼트에 맡깁니다. 서버는 보관하지 않으므로
        // 이 한 번이 짝의 유일한 생존 기회입니다. 없으면 칸 자체를 빼는 것도 §3.3 과 같습니다
        ...(turn.freshMappings.length > 0
          ? {
              pii_mappings: turn.freshMappings.map((one) => ({
                token: one.token,
                kind: one.kind,
                seq: one.seq,
                original: one.original ?? '',
              })),
            }
          : {}),
      },
    }
  })
}
