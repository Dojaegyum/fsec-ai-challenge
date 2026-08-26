/**
 * 챗 한 턴 — 부르는 순서.
 *
 * 정본: spec/backend/08-16-chat-context.md §1 §5 §6 §9
 *
 * ```
 * 1. pii-tokenizer  개인정보를 토큰으로     ← 격리 경계
 * 2. kb-finder      두 묶음으로 조회
 * 3. prompt-builder 블록 여섯을 조립
 * 4. 모델 1회 호출
 * 5. citation-checker 인용 검증
 * ```
 *
 * **이 파일에 판정이 없습니다.** 갈래는 `citation-checker` 가 가르고, 형태는
 * `chat-publisher` 가 만들고, 저장과 감사 로그는 부른 쪽이 합니다 → ADR-022.
 */

import { KbCitationMissingError } from '@/lib/errors'

import type {
  ChatReceiver,
  ModelReply,
  CitationSource,
  Clock,
  KbContextRef,
  KbSource,
  LlmClient,
  PiiTokenizer,
  PromptSource,
  RetryJudge,
  SettledOutcome,
  TurnInput,
  TurnOutcome,
  Violation,
} from './types'

/**
 * 인용 형식 위반에 다시 부르는 횟수.
 *
 * ⬜ TODO(실측 필요): 1회가 맞는지 근거가 없습니다 →
 * 11-chat-context.md 「TODO」. 형식 실수를 감안한 값입니다.
 */
const MAX_ATTEMPTS = 2

export function createChatReceiver(deps: {
  tokenizer: PiiTokenizer
  /**
   * 토큰화하지 않을 낱말 → 04-pii-boundary.md 「토큰화 제외 목록」.
   *
   * **선택 인자로 두지 않았습니다.** 이 자리가 비어 있어도 챗은 멀쩡히 돌고,
   * 기관명만 조용히 `[이름-N]` 이 됩니다 — 실제로 그 상태였습니다.
   * 필수로 두면 **안 넘기는 순간 빌드가 깨집니다.**
   */
  orgTerms: { list(kbVersion: string): Promise<readonly string[]> }
  kb: KbSource
  prompts: PromptSource
  llm: LlmClient
  citations: CitationSource
  retry: RetryJudge
  clock: Clock
}): ChatReceiver {
  const { tokenizer, orgTerms, kb, prompts, llm, citations, retry, clock } = deps

  return {
    async receive(input: TurnInput): Promise<TurnOutcome> {
      const { caseContext: ctx } = input

      // 1. 격리 경계. 여기를 지나지 않은 텍스트는 모델로 갈 수 없습니다.
      //
      // **제외 목록을 함께 넘깁니다** → 04-pii-boundary.md. 안 넘기면 NER 이
      // 「토스로 보냈어요」의 기관명을 사람 이름으로 집어 유형 분기가 무너집니다.
      // 목록을 못 가져와도 발화는 그대로 진행합니다 — 불변 규칙 5
      const allowedTerms = await orgTerms
        .list(input.kbVersion)
        .catch((): readonly string[] => [])
      const { masked } = await tokenizer.tokenize(input.utterance, { allowedTerms })

      // 2. 조회 조건은 서버가 전부 압니다 — 모델에게 묻지 않습니다
      const groups = await kb.find({
        kbVersion: input.kbVersion,
        track: ctx.track,
        channelId: ctx.channelId,
        orgId: ctx.orgId,
        asOf: clock.today(),
      })

      // 3. 이번 발화는 대화 이력의 마지막 턴입니다 → §3.1
      const prompt = prompts.build({
        kbApplied: groups.applied,
        kbReference: groups.reference,
        caseTalk: ctx.caseTalk,
        caseState: ctx.caseState,
        history: [...ctx.history, { speaker: 'user', text: masked }],
        currentDate: clock.todayLabel(),
      })

      const kbResultEmpty =
        prompt.counts.applied === 0 && prompt.counts.reference === 0

      // 4·5. 모델 1회 → 인용 검증. 형식을 어겼을 때만 한 번 더
      const { reply, outcome, attempts } = await ask(
        { llm, citations, retry, clock },
        prompt,
        kbResultEmpty,
      )

      return {
        outcome,
        reply,
        issued: prompt.issued,
        kbContextRefs: contextRefs(groups),
        promptMasked: prompt.user,
        utteranceMasked: masked,
        counts: {
          applied: prompt.counts.applied,
          reference: prompt.counts.reference,
          transcriptLines: ctx.caseTalk.length,
        },
        attempts,
      }
    },
  }
}

/**
 * 모델을 부르고 인용을 검증한다.
 *
 * **`violation` 일 때만 다시 부릅니다** → §6.3. `insufficient: true` 는 모델이
 * 근거 없음을 선언한 것이라, 같은 프롬프트로 다시 물으면 같은 답이 옵니다.
 *
 * **재시도할지는 `retry-checker` 가 정합니다.** 여기서 예외 종류로 분기하지
 * 않습니다 → 10-errors.md §2.
 */
async function ask(
  deps: {
    llm: LlmClient
    citations: CitationSource
    retry: RetryJudge
    clock: Clock
  },
  prompt: { system: string; user: string; issued: readonly { ref: string }[] },
  kbResultEmpty: boolean,
): Promise<{ reply: ModelReply; outcome: SettledOutcome; attempts: number }> {
  const { llm, citations, retry, clock } = deps
  const issued = prompt.issued.map((one) => one.ref)
  const startedAt = clock.nowMs()

  let attempts = 0
  let lastViolations: readonly Violation[] = []

  while (attempts < MAX_ATTEMPTS) {
    attempts += 1

    const reply = await llm.complete({ system: prompt.system, user: prompt.user })
    const outcome = citations.check({ reply, issued, kbResultEmpty })

    if (outcome.kind !== 'retry') {
      return { reply, outcome, attempts }
    }

    lastViolations = outcome.violations

    const error = new KbCitationMissingError('인용 형식을 어겼습니다', {
      attempts,
      issued: issued.length,
      violations: outcome.violations,
    })
    const verdict = retry.decide({
      error,
      attempts,
      elapsedMs: clock.nowMs() - startedAt,
      lane: 'interactive',
    })

    // 예산을 넘겼거나 정책이 없으면 여기서 멈춥니다
    if (!verdict.retry) throw error
  }

  throw new KbCitationMissingError('인용 형식을 어겼습니다', {
    attempts,
    violations: lastViolations,
  })
}

/**
 * 프롬프트에 넣은 KB 항목의 식별자만 남긴다 → §7.1.
 *
 * **본문은 저장하지 않습니다.** `(kb_entry_id, kb_version)` 이 기본키라 둘로
 * 완전히 되살릴 수 있고, 매 턴 넣으므로 본문을 저장하면 중복이 대화 길이에
 * 비례해 늘어납니다.
 */
function contextRefs(groups: {
  applied: readonly { kbEntryId: string; kbVersion: string }[]
  reference: readonly { kbEntryId: string; kbVersion: string }[]
}): readonly KbContextRef[] {
  return [
    ...groups.applied.map((one) => ({
      kbEntryId: one.kbEntryId,
      kbVersion: one.kbVersion,
      group: 'applied' as const,
    })),
    ...groups.reference.map((one) => ({
      kbEntryId: one.kbEntryId,
      kbVersion: one.kbVersion,
      group: 'reference' as const,
    })),
  ]
}
