/**
 * chat-receiver 시험.
 *
 * 검증 대상은 spec/backend/08-16-chat-context.md §1 §5 §6 §9 와
 * ADR-022 의 「절대 하지 않는 것」입니다.
 */

import { describe, expect, it, vi } from 'vitest'

import { KbCitationMissingError, KbUnavailableError } from '@/lib/errors'

import { createChatReceiver } from './receive'
import type {
  CaseContext,
  CitationOutcome,
  IssuedToken,
  KbEntry,
  ModelReply,
  PromptSource,
} from './types'

const TODAY = '2026-08-20'
const APPLIED: KbEntry[] = [
  {
    kbEntryId: 'relief-application',
    kbVersion: '2026.08.1',
    label: '피해구제 신청서 제출',
    body: '지급정지 뒤 3영업일 안에 신청서를 낸다.',
  },
]
const REFERENCE: KbEntry[] = [
  {
    kbEntryId: 'easypay-freeze',
    kbVersion: '2026.08.1',
    label: '간편송금 지급정지',
    body: '선불업자와 연계 은행 양쪽에 요청한다.',
    channelId: 'CH-easypay',
  },
]

const CTX: CaseContext = {
  caseId: 'CASE01',
  track: 'victim',
  channelId: 'CH-bank',
  orgId: 'kb-bank',
  caseTalk: [{ speaker: 'other', text: '금감원입니다' }],
  caseState: [{ label: '피해구제 신청 기한', value: '2026년 8월 21일' }],
  history: [],
}

const PASSING_REPLY: ModelReply = {
  insufficient: false,
  citations: [{ ref: 'kb-1', why: '다음 단계를 안내하는 데 썼습니다' }],
  reply: '다음은 피해구제 신청서 제출입니다.',
}

/** 프롬프트 조립기 — 실제 모듈의 계약만 흉내 냅니다 */
function fakePrompts(): PromptSource & { seen: unknown[] } {
  const seen: unknown[] = []
  return {
    seen,
    build(one) {
      seen.push(one)
      return {
        system: '시스템 지시문',
        user: `조립된 프롬프트: ${one.history.map((h) => h.text).join(' / ')}`,
        issued: [
          { ref: 'kb-1', label: '피해구제 신청서 제출', kbEntryId: 'relief-application', kbVersion: '2026.08.1' },
          { ref: 'case-1', label: '피해구제 신청 기한' },
        ],
        counts: { applied: one.kbApplied.length, reference: one.kbReference.length },
      }
    },
  }
}

function receiver(over: {
  reply?: ModelReply | ModelReply[]
  outcome?: CitationOutcome | CitationOutcome[]
  applied?: KbEntry[]
  reference?: KbEntry[]
  kbThrows?: unknown
  retry?: boolean
} = {}) {
  const replies = Array.isArray(over.reply)
    ? [...over.reply]
    : [over.reply ?? PASSING_REPLY]
  const outcomes = Array.isArray(over.outcome)
    ? [...over.outcome]
    : [over.outcome ?? { kind: 'pass' as const }]

  const prompts = fakePrompts()
  const llm = { complete: vi.fn(async () => replies.shift() ?? PASSING_REPLY) }
  const tokenize = vi.fn(
    async (
      text: string,
      ctx?: { allowedTerms?: readonly string[]; mappings?: readonly IssuedToken[] },
    ) => {
      void ctx
      const masked = text.replace(/110-234-567890/g, '[계좌-1]')
      const counts: Record<string, number> = masked === text ? {} : { account: 1 }
      return { masked, counts }
    },
  )
  const kbFind = vi.fn(async () => {
    if (over.kbThrows) throw over.kbThrows
    return {
      applied: over.applied ?? APPLIED,
      reference: over.reference ?? REFERENCE,
    }
  })
  const check = vi.fn(
    () => outcomes.shift() ?? ({ kind: 'pass' } as CitationOutcome),
  )

  const chat = createChatReceiver({
    tokenizer: { tokenize },
    orgTerms: { list: async (): Promise<readonly string[]> => [] },
    kb: { find: kbFind },
    prompts,
    llm,
    citations: { check },
    retry: { decide: () => ({ retry: over.retry ?? true, delayMs: 0 }) },
    clock: {
      today: () => TODAY,
      todayLabel: () => '2026년 8월 20일',
      nowMs: () => 0,
    },
  })

  return { chat, prompts, llm, tokenize, kbFind, check }
}

describe('부르는 순서', () => {
  it('토큰화한 발화가 프롬프트로 들어간다', async () => {
    // 원문이 조립 단계에 닿으면 격리 경계가 무너집니다
    const { chat } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '110-234-567890 으로 보냈어요',
      kbVersion: '2026.08.1',
    })

    expect(turn.utteranceMasked).toContain('[계좌-1]')
    expect(turn.promptMasked).toContain('[계좌-1]')
    expect(turn.promptMasked).not.toContain('110-234-567890')
  })

  it('조회 조건을 서버가 채운다 — 모델에게 묻지 않는다', async () => {
    const { chat, kbFind } = receiver()

    await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(kbFind).toHaveBeenCalledWith({
      kbVersion: '2026.08.1',
      track: 'victim',
      channelId: 'CH-bank',
      orgId: 'kb-bank',
      asOf: TODAY,
    })
  })

  it('이번 발화가 대화 이력의 마지막 턴으로 붙는다', async () => {
    const { chat, prompts } = receiver()

    await chat.receive({
      caseContext: { ...CTX, history: [{ speaker: 'assistant', text: '이전 답변' }] },
      utterance: '이번 질문',
      kbVersion: '2026.08.1',
    })

    const built = prompts.seen[0] as { history: { text: string }[] }
    expect(built.history.map((one) => one.text)).toEqual(['이전 답변', '이번 질문'])
  })

  it('모델을 한 번만 부른다', async () => {
    const { chat, llm } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(llm.complete).toHaveBeenCalledTimes(1)
    expect(turn.attempts).toBe(1)
  })
})

describe('판정을 하지 않고 그대로 넘긴다 — ADR-022', () => {
  for (const kind of ['pass', 'ask_slot', 'guide_1332'] as const) {
    it(`${kind} 판정을 그대로 싣는다`, async () => {
      const { chat } = receiver({ outcome: { kind } })

      const turn = await chat.receive({
        caseContext: CTX,
        utterance: '안녕',
        kbVersion: '2026.08.1',
      })

      expect(turn.outcome.kind).toBe(kind)
    })
  }

  it('응답 형태를 만들지 않는다', async () => {
    // 껍데기를 씌우는 것은 chat-publisher 의 일입니다
    const { chat } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(turn).not.toHaveProperty('kind')
    expect(turn).not.toHaveProperty('message_id')
    expect(turn).not.toHaveProperty('citations')
  })

  it('판단 근거를 걸러내지 않고 그대로 둔다', async () => {
    // 여기서 지우면 chat-publisher 가 분리할 것이 없어집니다.
    // 사용자에게 못 나가게 막는 것은 그쪽 책임입니다
    const { chat } = receiver({
      reply: { ...PASSING_REPLY, reasoning: '지급정지가 확인됐다' },
    })

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(turn.reply.reasoning).toBe('지급정지가 확인됐다')
  })
})

describe('인용 형식을 어겼을 때만 다시 부른다', () => {
  it('한 번 어기면 다시 부르고, 통과하면 그 답을 쓴다', async () => {
    const { chat, llm } = receiver({
      outcome: [
        { kind: 'retry', violations: [{ rule: 'why_empty', ref: 'kb-1' }] },
        { kind: 'pass' },
      ],
    })

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(llm.complete).toHaveBeenCalledTimes(2)
    expect(turn.attempts).toBe(2)
    expect(turn.outcome.kind).toBe('pass')
  })

  it('두 번 어기면 던진다', async () => {
    const { chat, llm } = receiver({
      outcome: [
        { kind: 'retry', violations: [{ rule: 'unknown_ref', ref: 'kb-9' }] },
        { kind: 'retry', violations: [{ rule: 'unknown_ref', ref: 'kb-9' }] },
      ],
    })

    await expect(
      chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' }),
    ).rejects.toBeInstanceOf(KbCitationMissingError)
    expect(llm.complete).toHaveBeenCalledTimes(2)
  })

  it('재시도 판단은 retry-checker 가 한다 — 아니라면 바로 던진다', async () => {
    const { chat, llm } = receiver({
      outcome: [{ kind: 'retry', violations: [{ rule: 'why_empty', ref: 'kb-1' }] }],
      retry: false,
    })

    await expect(
      chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' }),
    ).rejects.toBeInstanceOf(KbCitationMissingError)
    expect(llm.complete).toHaveBeenCalledTimes(1)
  })

  it('근거 없음(insufficient)으로는 다시 부르지 않는다', async () => {
    // 같은 프롬프트로 다시 물으면 같은 답이 옵니다 → §6.3
    const { chat, llm } = receiver({
      reply: { insufficient: true, citations: [] },
      outcome: { kind: 'ask_slot' },
    })

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(llm.complete).toHaveBeenCalledTimes(1)
    expect(turn.outcome.kind).toBe('ask_slot')
  })
})

describe('저장할 재료를 함께 돌려준다 — 저장은 하지 않는다', () => {
  it('KB 식별자만 남기고 본문은 안 남긴다', async () => {
    // (kb_entry_id, kb_version) 이 기본키라 둘로 되살릴 수 있고,
    // 매 턴 넣으므로 본문을 저장하면 중복이 대화 길이에 비례해 늘어납니다
    const { chat } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(turn.kbContextRefs).toEqual([
      { kbEntryId: 'relief-application', kbVersion: '2026.08.1', group: 'applied' },
      { kbEntryId: 'easypay-freeze', kbVersion: '2026.08.1', group: 'reference' },
    ])
    expect(JSON.stringify(turn.kbContextRefs)).not.toContain('신청서를 낸다')
  })

  it('감사 로그에 넣을 건수를 돌려준다 — 쓰지는 않는다', async () => {
    const { chat } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(turn.counts).toEqual({ applied: 1, reference: 1, transcriptLines: 1 })
  })

  it('발급한 참조를 그대로 넘긴다 — 인용을 채우는 것은 chat-publisher', async () => {
    const { chat } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
    })

    expect(turn.issued.map((one) => one.ref)).toEqual(['kb-1', 'case-1'])
  })
})

describe('조회가 실패하면 챗을 멈춘다', () => {
  it('KB 조회 실패를 그대로 올린다', async () => {
    // 근거를 확인할 수 없는 상태에서 답하지 않습니다 → §9.
    // 공통 안전 절차로 폴백할 수도 없습니다 — T0 도 KB 항목이라서입니다
    const { chat, llm } = receiver({
      kbThrows: new KbUnavailableError('조회 실패'),
    })

    await expect(
      chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' }),
    ).rejects.toBeInstanceOf(KbUnavailableError)
    expect(llm.complete).not.toHaveBeenCalled()
  })

  it('조회 결과가 0건인 것은 실패가 아니다', async () => {
    const { chat, check } = receiver({ applied: [], reference: [] })

    await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({ kbResultEmpty: true }),
    )
  })
})

/**
 * 이름표 번호는 **사건 하나**를 단위로 합니다 → 04-pii-boundary.md 「번호의 단위」.
 *
 * 브라우저와 서버가 **같은 이름 공간**을 쓰기 때문에, 안 이어받으면 브라우저가
 * 볼트에 맡긴 `[계좌-1]` 자리에 이번 턴의 다른 계좌가 겹쳐 앉습니다 —
 * 화면이 복원할 때 **엉뚱한 계좌가 그려집니다.**
 *
 * **모으는 것은 부른 쪽입니다**(`flows/chat-turn.ts`). 이 모듈은 받은 것을
 * 경계로 넘기기만 합니다 → ADR-022.
 */
describe('쓰인 이름표를 토큰화에 이어 넘긴다', () => {
  const ISSUED: readonly IssuedToken[] = [{ token: '[계좌-1]', kind: '계좌', seq: 1 }]

  it('받은 장부가 그대로 경계로 간다', async () => {
    const { chat, tokenize } = receiver()

    await chat.receive({
      caseContext: CTX,
      utterance: '안녕',
      kbVersion: '2026.08.1',
      issuedTokens: ISSUED,
    })

    expect(tokenize.mock.calls[0][1]?.mappings).toEqual(ISSUED)
  })

  /** **회귀** — 안 넘어와도 챗은 섭니다. 그때가 1번부터입니다 */
  it('안 넘어오면 빈 장부로 부른다 — 던지지 않는다', async () => {
    const { chat, tokenize } = receiver()

    await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(tokenize.mock.calls[0][1]?.mappings).toEqual([])
  })
})
