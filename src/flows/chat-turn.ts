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
 * ## 남기는 것이 둘 더 있습니다 — 감사
 *
 * `chat.context_built` 와 `llm.called` 를 여기서 남깁니다 → 11-chat-context.md
 * §7.2 · 09-data-model.md §10.2. **`chat-receiver` 가 남기지 않습니다** —
 * 저장도 감사도 부른 쪽의 몫이라고 ADR-022 가 정했습니다. 이 파일이 안 남기면
 * **이 제품의 유일한 외부 모델 호출이 감사 없이 지나갑니다.**
 *
 * ## ⚠️ `caseTalk` 이 매 턴 모델에 갑니다
 *
 * 전사문이 맥락으로 들어갑니다 → 11-chat-context.md. **이미 토큰화된 것만
 * 넣습니다** — 저장소의 `transcript_masked` 가 그것이고, 이름이 그 뜻입니다.
 * 원문을 넣으면 턴마다 외부 사업자에게 나갑니다.
 */

import 'server-only'

import { seoulDayLabel } from '@/lib/clock'
import type { Container } from '@/lib/container'
import { newUlid } from '@/lib/ids'

import type { Citation, NextQuestion, PublishInput } from '@/modules/chat-publisher'
import type { CaseContext, SettledOutcome } from '@/modules/chat-receiver'
import { readIssuedLedger } from '@/modules/pii-tokenizer'
import type { NextQuestion as SlotQuestion } from '@/modules/slot-checker'

import { readApiDeadlines, type ApiDeadline } from './api-deadlines'
import { readCasePlan } from './regenerate-plan'

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
  const [context, issuedTokens, kbVersion, plan] = await Promise.all([
    gatherContext(input.caseId, container),
    // **이 사건에서 이미 쓰인 이름표** → 04-pii-boundary.md 「번호의 단위」.
    // 서버 2차가 이번 발화에 붙일 번호가 여기 뒤에서 나갑니다 — 안 넘기면
    // 브라우저가 볼트에 맡긴 `[계좌-1]` 과 겹쳐 **복원이 엉뚱한 값을
    // 되살립니다.** 오는 것은 번호뿐이고 **원문은 없습니다**
    readIssuedLedger(input.caseId, {
      vault: container.vaultWrite,
      transcripts: container.messages,
    }),
    container.ports.kbVersion.current(),
    // **다음 문항을 화면과 같은 자리에서 구합니다** — §3.9 가 *"만드는 것도
    // 같은 슬롯 체커입니다"* 라고 못 박았습니다. 여기서 따로 만들면 문진 카드와
    // 챗이 서로 다른 것을 묻습니다
    readCasePlan(input.caseId, { container, store: container.ports.casePlan }),
  ])
  const nextQuestion = asWireQuestion(plan.nextQuestion)

  const outcome = await container.chatReceiver.receive({
    caseContext: context,
    utterance: input.content,
    kbVersion,
    issuedTokens,
  })

  // 09-data-model.md §10.2 · 11-chat-context.md §7.2 — **건수만 담습니다.**
  // 식별자도 본문도 토큰도 넣지 않습니다 (불변 규칙 2·3 · §10.1)
  await container.auditLogger.record({
    eventType: 'chat.context_built',
    actorType: 'system',
    caseId: input.caseId,
    detail: {
      applied: outcome.counts.applied,
      reference: outcome.counts.reference,
      kb_version: kbVersion,
      transcript_lines: outcome.counts.transcriptLines,
    },
  })

  // **이 제품의 유일한 외부 모델 호출입니다** → 04-pii-boundary.md 「감사」가
  // *"모든 LLM 호출을 감사 로그로 기록"* 한다고 정했는데 한 줄도 안 남고
  // 있었습니다. 송출 검사(`publish`)보다 **앞에서** 남깁니다 — 거기서 막혀도
  // 모델은 이미 불렸습니다.
  //
  // 정본의 예(§10.2)가 `{"model":…,"token_in":…}` 이고, 이제 **모델이 스스로
  // 밝힌 값**이 여기까지 옵니다 — `lib/llm.ts` 가 응답 본문의 `model` 과 `usage` 를
  // 읽어 `ModelReply.call` 로 실어 보냅니다.
  //
  // ⚠️ **환경변수의 모델 이름을 쓰지 않습니다.** 후보를 차례로 시도하는 구조라
  // 거기 적힌 것과 실제로 답한 것이 다를 수 있고, 그러면 **감사 기록이 거짓이
  // 됩니다.** 제공자가 안 밝히면 그 칸을 **비웁니다** — 지어내지 않습니다
  const call = outcome.reply.call
  await container.auditLogger.record({
    eventType: 'llm.called',
    actorType: 'model',
    caseId: input.caseId,
    detail: {
      attempts: outcome.attempts,
      ...(typeof call?.model === 'string' ? { model: call.model } : {}),
      ...(typeof call?.tokenIn === 'number' ? { token_in: call.tokenIn } : {}),
      ...(typeof call?.tokenOut === 'number' ? { token_out: call.tokenOut } : {}),
    },
  })

  const messageId = newUlid()

  // 갈래를 한 형태로 씌웁니다. **잔여 개인정보가 있으면 여기서 막힙니다** —
  // 통과시키고 로그만 남기는 경로는 없습니다 → 08-16-errors.md 원칙 1
  const body = container.chatPublisher.publish(
    publishInputOf(outcome.outcome.kind, {
      messageId,
      reply: outcome.reply.reply ?? '',
      citations: citationsOf(outcome),
      nextQuestion,
    }),
  )

  await container.messages.write({
    messageId,
    caseId: input.caseId,
    role: 'assistant',
    // ⚠️ **토큰화된 것만 남깁니다.** 이름이 그 뜻입니다.
    //
    // **실제로 나간 문장을 남깁니다.** 되묻기와 1332 갈래에는 모델의 `reply` 가
    // 아예 없어서(§6.3), 그것을 남기면 §3.12 이력에 **빈 말풍선**이 뜹니다 —
    // 사용자가 읽은 것과 다릅니다. 이 값은 송출 검사를 이미 지났습니다
    contentMasked: body.reply,
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
    referencedDeadlines: deadlinesCited(outcome),
  }
}

/**
 * 판정 셋을 송출 갈래로 옮긴다 → §3.9 · 11-chat-context.md §6.3.
 *
 * ## 셋을 다 씁니다
 *
 * `guide_1332` 만 갈라 두고 나머지를 답변으로 씌웠더니, 모델이 「답할 근거가
 * 없다」고 선언한 턴(`ask_slot`)이 답변으로 떨어졌습니다. **그 턴에는 `reply`
 * 가 아예 없어서 빈 답이 나갔습니다** — `chat-publisher` 에 되묻기 갈래가
 * 이미 서 있는데 부르는 자리가 없었습니다.
 *
 * ## 물을 것이 없으면 되물을 수 없습니다
 *
 * 슬롯을 다 채웠는데도 근거를 못 찾은 자리입니다. **그때가 1332 안내입니다**
 * → §6.3 의 마지막 줄 · 10-errors.md §4.1. 여기서 빈 질문을 실어 보내면
 * 화면이 답할 수 없는 카드를 띄웁니다.
 *
 * **판정 자체는 하지 않습니다.** 그것은 `citation-checker` 의 일이고, 여기는
 * 그 판정을 송출 모양으로 옮기기만 합니다 → ADR-022.
 */
function publishInputOf(
  kind: SettledOutcome['kind'],
  one: {
    readonly messageId: string
    readonly reply: string
    readonly citations: readonly Citation[]
    readonly nextQuestion: NextQuestion | null
  },
): PublishInput {
  if (kind === 'guide_1332') return { kind: 'guide_1332', messageId: one.messageId }

  if (kind === 'ask_slot') {
    return one.nextQuestion
      ? { kind: 'ask_slot', messageId: one.messageId, nextQuestion: one.nextQuestion }
      : { kind: 'guide_1332', messageId: one.messageId }
  }

  return {
    kind: 'answer',
    messageId: one.messageId,
    reply: one.reply,
    citations: one.citations,
    // **답변에도 싣습니다.** 안 실으면 화면이 `null` 을 받아 문진을 **지웁니다** —
    // 말로 한 마디 했다고 남은 질문이 사라집니다 (`send.ts` 의 `setQuestion`)
    nextQuestion: one.nextQuestion,
  }
}

/**
 * 슬롯 체커의 문항을 계약의 모양으로 옮긴다 → §3.4.
 *
 * **이름이 다릅니다** — 모듈은 `slotKey`, 계약은 `slot_key` 입니다.
 *
 * `options` 를 없으면 빈 배열로 둡니다. 같은 문항을 내는 다른 두 자리
 * (§3.10 의 `route.ts` · §3.5 의 `slots/[slot_key]/route.ts`)가 그렇게 내고
 * 있어서, 여기만 칸을 빼면 **같은 질문이 경로마다 다른 모양**으로 갑니다.
 */
function asWireQuestion(one: SlotQuestion | null): NextQuestion | null {
  if (!one) return null

  return {
    slot_key: one.slotKey,
    text: one.text,
    input: one.input,
    options: [...(one.options ?? [])],
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
  return cited(outcome, (one) => one.stepId)
}

/**
 * 모델이 인용한 것 중 **기한을 가리키는 것**만 → §3.9 `referenced_deadlines`.
 *
 * *"8월 20일까지 하셔야 합니다"* 라고 답하면서 `case-3`(피해구제 신청 기한)을
 * 인용하면 그 기한 번호가 나갑니다. 화면이 그 카드를 짚을 수 있습니다.
 *
 * **단계와 나뉘는 이유는 셈이 다르기 때문입니다.** 한 단계에 본 기한과 추가
 * 기간이 **각각 한 줄**로 서고(09-data-model.md §8.1), 단계 없이 선 기한도
 * 있습니다 — 그래서 단계 번호로 기한을 찾을 수 없습니다.
 */
export function deadlinesCited(outcome: {
  reply: { citations: readonly { ref: string }[] }
  issued: readonly { ref: string; deadlineId?: string }[]
}): readonly string[] {
  return cited(outcome, (one) => one.deadlineId)
}

/**
 * 인용된 `ref` 를 이번 턴의 발급 기록으로 되짚는다.
 *
 * **모델이 발급하지 않은 번호를 지어내면 조용히 버립니다** — 던지면 답 전체가
 * 날아갑니다. 형식 검증은 `citation-checker` 의 일이고, 여기는 화면에 보낼
 * 신호를 고르는 자리입니다.
 *
 * **같은 줄을 두 번 인용해도 한 번만** 냅니다.
 */
function cited<T extends { ref: string }>(
  outcome: {
    reply: { citations: readonly { ref: string }[] }
    issued: readonly T[]
  },
  pick: (one: T) => string | undefined,
): readonly string[] {
  const idOf = new Map<string, string>()
  for (const one of outcome.issued) {
    const id = pick(one)
    if (id) idOf.set(one.ref, id)
  }

  const out: string[] = []
  for (const one of outcome.reply.citations) {
    const id = idOf.get(one.ref)
    if (id && !out.includes(id)) out.push(id)
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
  const [found, channel, slots, steps, history, transcript, deadlines] =
    await Promise.all([
      container.ports.casePlan.readCase(caseId),
      container.ports.casePlan.readChannel(caseId),
      container.slots.read(caseId),
      container.ports.casePlan.readSteps(caseId),
      container.messages.history(caseId),
      container.messages.transcript(caseId),
      // **화면과 같은 경로로 읽습니다** → §3.7 · §3.10 이 부르는 그것입니다.
      // 따로 읽으면 지난 기한을 화면은 「지났습니다」로, 챗은 「아직 시간이
      // 있습니다」로 말할 수 있습니다 — `sweepOverdue` 가 저 안에 있습니다
      readApiDeadlines(caseId, container),
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
      ...deadlineState(deadlines),
    ],
    history,
  }
}

/**
 * 기산점이 확인 안 된 기한에 붙는 한 마디 → 08-16-deadline-rules.md.
 *
 * **화면의 「미확인」 배지와 같은 말입니다.** 두 자리가 다른 말을 하면
 * 사용자는 더 단정적인 쪽을 믿습니다.
 *
 * **「사용자」라고 쓰지 않습니다.** 모델이 이 마디를 거의 그대로 옮기는데,
 * 처음에 「사용자가 말한 날」로 뒀더니 답변에 *"사용자가 말씀하신 날"* 이
 * 그대로 나왔습니다 — 읽는 사람이 자기 자신인데 3인칭으로 불립니다.
 * 화면 문구(`plan.tsx` 히어로)와 같은 말로 둡니다.
 */
const ESTIMATED_NOTE =
  '이 날짜는 말씀해 주신 날짜에서 센 것이라 아직 확정이 아닙니다. ' +
  '접수증이 올라오면 다시 셉니다'

/** 기한 종류를 사람 말로 → §3.7 `kind`. **셋을 합치지 않습니다** (09 §8.1) */
const KIND_LABEL: Readonly<Record<string, string>> = {
  primary: '기한',
  grace: '추가 기간',
  // 사용자가 지킬 기한이 아닙니다 — 기관이 진행하는 절차의 길이입니다 (09 §8.3)
  info: '기관 진행 기간',
}

/**
 * 기한을 **사건 정보 줄로** 옮긴다 → 11-chat-context.md §3.3 §3.4.
 *
 * ## 여기 오기까지 모델은 기한을 몰랐습니다
 *
 * 계약이 *"`case-` 는 슬롯·단계·**기한**·부산물을 가리킨다"* 라고 정했는데
 * (§3.4) 프롬프트에는 슬롯과 단계만 들어갔습니다. 그래서 *"언제까지죠"* 에
 * 답할 근거가 없었고, `referenced_deadlines` 도 되짚을 번호가 없어 늘
 * 빈 배열이었습니다.
 *
 * ## 날짜는 이미 세어져 있습니다
 *
 * **모델은 이 날짜를 문장에 넣기만 합니다** — 「3영업일 뒤」를 세지 않습니다
 * (불변 규칙 7 · §3.3). 남은 날도 서버가 센 `days_left` 를 그대로 옮깁니다.
 *
 * ## 붙는 말은 전부 KB 가 쓴 것입니다
 *
 * 유예의 조건(`condition`)과 기관 절차의 설명(`note`)을 그대로 붙입니다.
 * 없으면 안 붙입니다 — **지어내지 않습니다**(불변 규칙 1). 조건이 빠지면
 * 모델이 추가 기간을 본 기한처럼 말합니다(09 §8.1).
 *
 * ## 추정 기한은 추정이라고 말합니다
 *
 * 기산점이 부산물로 확인 안 된 기한(`estimated`)을 확정처럼 실으면 모델이
 * 그것을 사실로 옮겨 적습니다. **화면에는 「미확인」 배지가 붙는데 챗만 단정하면
 * 두 자리가 다른 말을 합니다** → 08-16-deadline-rules.md.
 */
export function deadlineState(
  rows: readonly ApiDeadline[],
): readonly { label: string; value: string; deadlineId: string }[] {
  const out: { label: string; value: string; deadlineId: string }[] = []

  for (const one of rows) {
    const day = seoulDayLabel(one.due_at)
    // 날짜를 못 읽으면 **줄을 안 만듭니다** — 이름만 있는 기한을 넣으면
    // 모델이 날짜 없이 「기한이 있습니다」라고 말합니다
    if (!day) continue

    out.push({
      label: `${KIND_LABEL[one.kind] ?? '기한'}: ${one.title}`,
      value: [
        dayText(one, day),
        // **확정이 아니라고 먼저 말합니다** — 조건·설명보다 앞입니다.
        // 뒤에 붙이면 모델이 날짜만 옮겨 적고 이 마디를 흘립니다
        one.estimated ? ESTIMATED_NOTE : null,
        one.condition,
        one.note,
      ]
        .filter(Boolean)
        .join(' · '),
      deadlineId: one.deadline_id,
    })
  }

  return out
}

/** 날짜 한 마디 — 지났는지·며칠 남았는지까지 */
function dayText(one: ApiDeadline, day: string): string {
  // 기관이 진행하는 기간에는 「까지」를 안 붙입니다 — 사용자가 그때까지
  // 무엇을 해야 하는 것으로 읽힙니다 (09 §8.3)
  if (one.kind === 'info') return `${day}에 끝납니다`

  if (one.status === 'missed') return `${day}까지였고 이미 지났습니다`
  if (one.status === 'met') return `${day}까지였고 지켰습니다`

  // **서버가 센 값입니다** — 없으면 안 말합니다 (불변 규칙 7)
  if (one.days_left === 0) return `${day}까지 (오늘이 마지막 날입니다)`
  if (one.days_left !== undefined) return `${day}까지 (${one.days_left}일 남았습니다)`
  return `${day}까지`
}
