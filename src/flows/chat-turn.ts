/**
 * 챗 한 턴을 도는 흐름 — 맥락을 모으고, 모듈에 넘기고, 남긴다.
 *
 * 정본: spec/common/08-14-api.md §3.9 · spec/backend/08-16-chat-context.md
 * 근거: ADR-028 · CLAUDE.md 불변 규칙 1(LLM 은 절차를 창작하지 않는다) ·
 *       불변 규칙 2(외부 모델에는 토큰화된 텍스트만)
 *
 * ## 이 파일이 하는 일은 맥락을 모으는 것뿐입니다
 *
 * 토큰화·조회·조립·모델 호출·인용 검증은 전부 `chat-receiver` 안에 있습니다.
 * 여기서는 **저장소에서 읽어 그 모듈이 요구하는 모양으로 옮기고**, 결과를
 * `chat-publisher` 에 넘겨 한 형태로 씌우고, 남깁니다.
 *
 * ## ⚠️ `caseTalk` 이 매 턴 모델에 갑니다
 *
 * 전사문이 맥락으로 들어갑니다 → 11-chat-context.md. **이미 토큰화된 것만
 * 넣습니다** — 저장소의 `transcript_masked` 가 그것이고, 이름이 그 뜻입니다.
 * 원문을 넣으면 턴마다 외부 사업자에게 나갑니다.
 */

import 'server-only'

import type { Container } from '@/lib/container'
import { newUlid } from '@/lib/ids'

import type { Citation } from '@/modules/chat-publisher'
import type { CaseContext } from '@/modules/chat-receiver'

/** 한 턴의 결과 — 라우트가 그대로 내보냅니다 */
export interface TurnResult {
  readonly body: Record<string, unknown>
  readonly referencedSteps: readonly string[]
  readonly referencedDeadlines: readonly string[]
}

/**
 * 한 턴을 돈다.
 *
 * @throws KbUnavailableError 조회가 실패했을 때. **챗을 멈춥니다** —
 *         근거 없이 답하느니 안 답하는 편이 낫습니다 → 11-chat-context.md §9
 */
export async function chatTurn(
  input: { readonly caseId: string; readonly content: string },
  container: Container,
): Promise<TurnResult> {
  const context = await gatherContext(input.caseId, container)
  const kbVersion = await container.ports.kbVersion.current()

  const outcome = await container.chatReceiver.receive({
    caseContext: context,
    utterance: input.content,
    kbVersion,
  })

  const messageId = newUlid()

  // 갈래를 한 형태로 씌웁니다. **잔여 개인정보가 있으면 여기서 막힙니다** —
  // 통과시키고 로그만 남기는 경로는 없습니다 → 08-16-errors.md 원칙 1
  const body =
    outcome.outcome.kind === 'guide_1332'
      ? container.chatPublisher.publish({ kind: 'guide_1332', messageId })
      : container.chatPublisher.publish({
          kind: 'answer',
          messageId,
          reply: outcome.reply.reply ?? '',
          citations: citationsOf(outcome),
        })

  await container.messages.write({
    messageId,
    caseId: input.caseId,
    // 사용자 발화와 답을 한 턴으로 셉니다
    turnNo: context.history.length + 1,
    role: 'assistant',
    // ⚠️ **토큰화된 것만 남깁니다.** 이름이 그 뜻입니다
    contentMasked: outcome.reply.reply ?? '',
    promptMasked: outcome.promptMasked,
    reasoningMasked: outcome.reply.reasoning ?? null,
    citations: [...outcome.reply.citations],
    kbContextRefs: [...outcome.kbContextRefs],
    insufficient: outcome.reply.insufficient,
    // 사용자가 실제로 무엇을 말했는지도 남깁니다 — 다음 턴의 맥락입니다
    utteranceMasked: outcome.utteranceMasked,
  })

  return {
    body: body as unknown as Record<string, unknown>,
    referencedSteps: stepsCited(outcome),
    // ⬜ **기한은 아직 안 나갑니다.** 프롬프트의 `case_state` 에 기한이 들어가지
    // 않아 되짚을 `ref` 자체가 없습니다 — 단계와 슬롯만 들어갑니다.
    // 기한을 넣으려면 무엇을 어떤 문장으로 넣을지부터 정해야 합니다 → §3.9
    referencedDeadlines: [],
  }
}

/**
 * 모델이 인용한 것 중 **단계를 가리키는 것**만 골라 냅니다 → §3.9 `referenced_steps`.
 *
 * 화면은 이걸로 작업 패널을 옮깁니다(`work-handler` 의 `applySignal`) —
 * *"지급정지를 걸고 3영업일 안에 신청하세요"* 처럼 둘을 가리켜도 **패널은
 * 하나**이고, 그 고르는 일은 화면이 합니다.
 *
 * **`kb-` 는 여기 안 옵니다.** 그쪽은 절차 지식이지 이 사건의 단계가 아닙니다 —
 * 같은 KB 항목이 여러 사건에 걸리고, 이 사건에 그 단계가 서 있다는 보장도
 * 없습니다. 단계를 가리키는 것은 `case_state` 에 실린 `case-N` 뿐입니다.
 *
 * **중복은 걷어냅니다.** 모델이 같은 줄을 두 번 인용하면 화면이 같은 단계를
 * 두 번 받습니다.
 */
export function stepsCited(outcome: {
  reply: { citations: readonly { ref: string }[] }
  issued: readonly { ref: string; stepId?: string }[]
}): readonly string[] {
  const stepOf = new Map(
    outcome.issued.filter((one) => one.stepId).map((one) => [one.ref, one.stepId!]),
  )

  const out: string[] = []
  for (const one of outcome.reply.citations) {
    const stepId = stepOf.get(one.ref)
    if (stepId && !out.includes(stepId)) out.push(stepId)
  }
  return out
}

/** 모델이 쓴 근거에 KB 의 네 칸을 붙인다 → 불변 규칙 1 */
function citationsOf(outcome: {
  reply: { citations: readonly { ref: string; why: string }[] }
  issued: readonly { ref: string; label: string; kbEntryId?: string; kbVersion?: string }[]
}): Citation[] {
  const labelOf = new Map(outcome.issued.map((one) => [one.ref, one]))

  return outcome.reply.citations.map((one) => {
    const issued = labelOf.get(one.ref)
    return {
      ref: one.ref,
      why: one.why,
      ...(issued?.label ? { label: issued.label } : {}),
      ...(issued?.kbEntryId ? { kb_entry_id: issued.kbEntryId } : {}),
      ...(issued?.kbVersion ? { kb_version: issued.kbVersion } : {}),
    }
  })
}

/**
 * 모델에 넘길 맥락을 모은다 → 11-chat-context.md.
 *
 * 넷을 한꺼번에 읽습니다. 차례로 읽으면 왕복이 넷이고, 챗은 사용자가
 * 기다리는 자리입니다.
 */
async function gatherContext(
  caseId: string,
  container: Container,
): Promise<CaseContext> {
  const [found, channel, slots, steps, history, transcript] = await Promise.all([
    container.ports.casePlan.readCase(caseId),
    container.ports.casePlan.readChannel(caseId),
    container.slots.read(caseId),
    container.ports.casePlan.readSteps(caseId),
    container.messages.history(caseId),
    container.messages.transcript(caseId),
  ])

  return {
    caseId,
    // 사건이 없으면 여기 오지 않습니다 — 라우트가 먼저 404 를 냅니다
    track: found?.track ?? 'victim',
    channelId: channel?.channelId ?? null,
    orgId: channel?.orgId ?? null,
    // ⚠️ 이미 토큰화된 전사문입니다
    caseTalk: transcript,
    caseState: [
      ...slots
        // 「모름」과 「확인 전」은 값이 아닙니다 — 넣으면 모델이 그것을 사실로 씁니다
        .filter((one) => one.state === 'confirmed' && one.valueMasked !== null)
        .map((one) => ({ label: one.slotKey, value: one.valueMasked ?? '' })),
      // `stepId` 는 프롬프트에 안 들어갑니다 — 모델이 `case-N` 을 인용했을 때
      // 그것이 어느 단계였는지 되짚는 데만 씁니다 (§3.9 `referenced_steps`)
      ...steps.map((one) => ({
        label: `단계: ${one.title}`,
        value: one.state,
        stepId: one.planStepId,
      })),
    ],
    history,
  }
}
