/**
 * chat-publisher — 나가는 것을 마지막으로 만지는 자리.
 *
 * 정본: spec/common/08-14-api.md §3.9 · §5.4
 *       spec/backend/08-16-chat-context.md §9 · spec/backend/08-16-errors.md §4.1
 * 근거: ADR-022 (이 모듈을 세운 결정) · ADR-028
 *
 * 책임 셋 → ADR-022 결정 둘.
 *   1. 세 갈래를 한 형태로 씌운다
 *   2. 판단 근거를 분리한다
 *   3. 잔여 PII 를 검사한다
 *
 * **어느 갈래인지 판정하지 않습니다.** 그것은 citation-checker 의 일이고, 판정이
 * 이쪽으로 새면 갈래가 두 곳에서 결정됩니다.
 */

import { EgressBlockedError } from '@/lib/errors'

import type {
  ChatPublisher,
  ChatResponseBody,
  PublishInput,
  ResidualPiiScanner,
} from './contract'

export type {
  ChatPublisher,
  ChatResponseBody,
  Citation,
  NextQuestion,
  PublishInput,
  ResidualPiiScanner,
} from './contract'

/**
 * KB 조회가 0건일 때의 문구. 정본은 08-16-errors.md §4.1 입니다.
 *
 * **절차를 말하지 않습니다.** 이때 `citations` 가 비어도 규칙 위반이 아닌 이유가
 * 절차를 언급하지 않았기 때문입니다. 연락처 안내라 인용이 필요 없습니다.
 */
const GUIDE_1332_REPLY =
  '말씀하신 경우에 대한 확인된 절차를 아직 갖고 있지 않습니다. ' +
  '금융감독원 1332로 연락하시면 상담받으실 수 있습니다.'

/** 되묻기로 넘어갈 때의 문구. 정본은 08-14-api.md §3.9 */
const ASK_SLOT_REPLY = '정확한 안내를 위해 하나만 확인하겠습니다.'

export function createChatPublisher(deps: {
  residualPii: ResidualPiiScanner
}): ChatPublisher {
  const { residualPii } = deps

  return {
    publish(input: PublishInput): ChatResponseBody {
      const body = buildBody(input)

      // 송출 직전 검사. 여기를 통과해야만 응답이 나간다
      const counts = residualPii.scan(outgoingText(body))
      if (Object.keys(counts).length > 0) {
        // 값이 아니라 건수만 담는다 → 08-16-errors.md 원칙 2.
        // 통과시키고 로그만 남기는 경로를 만들지 않는다 → 원칙 1
        throw new EgressBlockedError(
          '개인정보가 남아 있어 요청을 중단했습니다.',
          { counts },
        )
      }

      return body
    },
  }
}

/**
 * 갈래를 한 형태로 옮긴다.
 *
 * **판단 근거를 받는 자리가 계약에 없다.** 화이트리스트로 거르는 것이 아니라
 * 애초에 담을 수 없어서, 실수로 새는 경로가 생기지 않는다 → 08-14-api.md §5.4.
 */
function buildBody(input: PublishInput): ChatResponseBody {
  switch (input.kind) {
    case 'answer':
      return {
        message_id: input.messageId,
        reply: input.reply,
        citations: input.citations,
        next_question: input.nextQuestion ?? null,
      }

    case 'guide_1332':
      return {
        message_id: input.messageId,
        reply: GUIDE_1332_REPLY,
        citations: [],
        next_question: null,
        kb_result: 'empty',
      }

    case 'ask_slot':
      return {
        message_id: input.messageId,
        reply: ASK_SLOT_REPLY,
        citations: [],
        next_question: input.nextQuestion,
      }
  }
}

/**
 * 검사 대상이 되는 문자열을 모은다.
 *
 * **모델이나 사용자가 쓴 것만 봅니다.** `ref`·`kb_entry_id`·`kb_version`·`source_url`·
 * `message_id` 는 서버가 발급하거나 KB 에서 온 값이라 개인정보가 들어갈 자리가 아니고,
 * 넣으면 식별자 숫자가 계좌로 오인될 위험만 생깁니다.
 */
function outgoingText(body: ChatResponseBody): string {
  const parts: string[] = [body.reply]

  for (const citation of body.citations) {
    if (citation.label) parts.push(citation.label)
    if (citation.why) parts.push(citation.why)
    if (citation.legal_basis) parts.push(citation.legal_basis)
  }

  if (body.next_question) {
    parts.push(body.next_question.text)
    if (body.next_question.options) parts.push(...body.next_question.options)
  }

  return parts.join('\n')
}
