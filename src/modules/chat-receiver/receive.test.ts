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
  KbSelectedEntry,
  ModelReply,
  PromptSource,
  SelectorSource,
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
      // 서버 2차가 이름을 집은 척합니다 — 막 만든 대응표는 **원문 포함**으로 `added` 에 나옵니다
      const masked = text
        .replace(/110-234-567890/g, '[계좌-1]')
        .replace(/김민수/g, '[이름-1]')
      const counts: Record<string, number> = {}
      const added: { token: string; kind: string; seq: number; original: string }[] = []
      if (text.includes('110-234-567890')) {
        counts.account = 1
        added.push({ token: '[계좌-1]', kind: '계좌', seq: 1, original: '110-234-567890' })
      }
      if (text.includes('김민수')) {
        counts.name = 1
        added.push({ token: '[이름-1]', kind: '이름', seq: 1, original: '김민수' })
      }
      return { masked, counts, added }
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

    expect(turn.counts).toEqual({ applied: 1, reference: 1, selected: 0, transcriptLines: 1 })
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

/**
 * ⚠️ **서버가 막 만든 대응표가 이 자리에서 버려지고 있었습니다.**
 *
 * 토큰화 결과에서 `masked` 와 `counts` 만 받았습니다. 2차(NER)가 이름에 붙인
 * `[이름-1]` 의 짝은 서버가 보관하지 않으므로(불변 규칙 3), 여기서 흘리면
 * **어디에도 남지 않습니다** — 새로고침 뒤 내 말풍선이 `[이름-1]` 로 굳습니다.
 * 전사 경로는 ADR-062 가 응답에 실어 브라우저가 봉하게 했고, 챗도 같은 길입니다.
 */
describe('서버가 막 만든 대응표를 그대로 돌려준다 — 보관하지 않는다 (ADR-062 의 챗 경로)', () => {
  it('이번 발화에서 만든 것이 원문 포함으로 freshMappings 에 나온다', async () => {
    const { chat } = receiver()

    const turn = await chat.receive({
      caseContext: CTX,
      utterance: '제 이름은 김민수입니다',
      kbVersion: '2026.08.1',
    })

    expect(turn.utteranceMasked).toBe('제 이름은 [이름-1]입니다')
    expect(turn.freshMappings).toEqual([
      { token: '[이름-1]', kind: '이름', seq: 1, original: '김민수' },
    ])
  })

  it('가린 것이 없으면 빈 배열이다 — 칸을 빼지 않는다', async () => {
    const { chat } = receiver()

    const turn = await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(turn.freshMappings).toEqual([])
  })
})

describe('선별기 — 두 묶음 밖의 자료를 발화에 맞춰 (ADR-089 · §2.6)', () => {
  const PICKED: KbSelectedEntry[] = [
    {
      kind: 'kb',
      label: '카드사 지급정지 신청',
      body: '카드사 콜센터에 지급정지를 요청합니다.',
      kbEntryId: 'card-freeze',
      kbVersion: '2026.08.1',
    },
    { kind: 'org', label: 'KB국민은행 연락처', body: '신고 전화: 1588-9999' },
  ]

  function withSelector(
    over: { entries?: KbSelectedEntry[]; throws?: boolean; ms?: number; skipped?: string } = {},
  ) {
    const prompts = fakePrompts()
    const llm = { complete: vi.fn(async () => PASSING_REPLY) }
    const select = vi.fn<SelectorSource['select']>(async () => {
      if (over.throws) throw new Error('풀을 못 읽었습니다')
      const entries = over.entries ?? []
      return {
        entries,
        stats: {
          pool: 100,
          groups: 2,
          rounds: 1,
          ms: over.ms ?? 1_200,
          picked: entries.map((one) => one.label),
          calls: [{ model: 'fast', tokenIn: 900, tokenOut: 20 }],
          ...(over.skipped ? { skipped: over.skipped } : {}),
        },
      }
    })
    const chat = createChatReceiver({
      tokenizer: {
        tokenize: async (text: string) => ({
          masked: text.replace(/110-234-567890/g, '[계좌-1]'),
          counts: {},
          added: [],
        }),
      },
      orgTerms: { list: async (): Promise<readonly string[]> => [] },
      kb: { find: async () => ({ applied: APPLIED, reference: REFERENCE }) },
      prompts,
      llm,
      citations: { check: () => ({ kind: 'pass' as const }) },
      retry: { decide: () => ({ retry: false }) },
      clock: { today: () => TODAY, todayLabel: () => '2026년 8월 20일', nowMs: () => 0 },
      selector: { select },
    })
    return { chat, prompts, llm, select }
  }

  it('토큰화한 대화만 보고, 두 묶음의 절차는 제외 목록으로 넘긴다', async () => {
    const { chat, select } = withSelector()

    await chat.receive({
      caseContext: { ...CTX, history: [{ speaker: 'assistant', text: '이전 답변' }] },
      utterance: '110-234-567890 은행에 전화했는데 안 받아요',
      kbVersion: '2026.08.1',
    })

    expect(select).toHaveBeenCalledTimes(1)
    const input = select.mock.calls[0]![0]
    expect(input.history.at(-1)).toEqual({
      speaker: 'user',
      text: '[계좌-1] 은행에 전화했는데 안 받아요',
    })
    expect(input.kbVersion).toBe('2026.08.1')
    expect(input.asOf).toBe(TODAY)
    expect([...input.exclude].sort()).toEqual(['kb:easypay-freeze', 'kb:relief-application'])
    expect(input.orgId).toBe('kb-bank')
    expect(input.channelId).toBe('CH-bank')
  })

  it('고른 것이 프롬프트의 선별 블록으로 가고, 절차는 문맥 참조에 selected 로 남는다', async () => {
    const { chat, prompts } = withSelector({ entries: PICKED })

    const turn = await chat.receive({ caseContext: CTX, utterance: '카드로 보냈으면요?', kbVersion: '2026.08.1' })

    const built = prompts.seen[0] as { kbSelected?: KbSelectedEntry[] }
    expect(built.kbSelected).toEqual(PICKED)
    expect(turn.counts.selected).toBe(2)
    expect(turn.selection).toMatchObject({ pool: 100, groups: 2, rounds: 1, ms: 1_200 })
    expect(turn.kbContextRefs).toContainEqual({
      kbEntryId: 'card-freeze',
      kbVersion: '2026.08.1',
      group: 'selected',
    })
    // 기관 연락처는 KB 항목이 아니라 문맥 참조에 안 남는다
    expect(turn.kbContextRefs.filter((one) => one.group === 'selected')).toHaveLength(1)
  })

  it('선별기가 던져도 답변은 나간다 — 빈 선택 · skipped=error (ADR-089 ④)', async () => {
    const { chat, prompts, llm } = withSelector({ throws: true })

    const turn = await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(llm.complete).toHaveBeenCalledTimes(1)
    expect((prompts.seen[0] as { kbSelected?: unknown[] }).kbSelected).toEqual([])
    expect(turn.selection?.skipped).toBe('error')
    expect(turn.counts.selected).toBe(0)
  })

  it('답변 예산은 90초에서 선별에 쓴 시간을 뺀 값이다', async () => {
    const { chat, llm } = withSelector({ ms: 4_200 })

    await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(llm.complete).toHaveBeenCalledWith(expect.anything(), { timeoutMs: 290_000 - 4_200 })
  })

  it('선별이 예산을 다 먹어도 답변은 20초는 기다린다', async () => {
    // 예산 290초에서 280초를 선별이 먹으면 남는 10초 < 바닥 20초 → 바닥이 이긴다
    const { chat, llm } = withSelector({ ms: 280_000 })

    await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(llm.complete).toHaveBeenCalledWith(expect.anything(), { timeoutMs: 20_000 })
  })

  it('선별기가 없으면 지금까지와 같다 — selection 은 null, 예산은 전부', async () => {
    const { chat, llm, prompts } = receiver()

    const turn = await chat.receive({ caseContext: CTX, utterance: '안녕', kbVersion: '2026.08.1' })

    expect(turn.selection).toBe(null)
    expect(turn.counts.selected).toBe(0)
    expect((prompts.seen[0] as { kbSelected?: unknown[] }).kbSelected).toEqual([])
    expect(llm.complete).toHaveBeenCalledWith(expect.anything(), { timeoutMs: 290_000 })
  })
})
