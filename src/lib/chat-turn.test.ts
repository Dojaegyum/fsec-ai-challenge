/**
 * 층 2 한 턴을 실제로 이어 보는 시험 — 모듈끼리 맞물리는지 확인한다.
 *
 * 각 모듈은 자기 시험을 따로 갖고 있다. 이 파일은 **그 사이의 이음매**만 본다 —
 * 한쪽이 내놓는 것을 다른 쪽이 받을 수 있는지, 변환이 필요한 자리가 어디인지.
 *
 * 정본 흐름: spec/backend/08-16-chat-context.md §1 · ARCHITECTURE.md §4 층 2
 *
 *   pii-masker → [ chat-receiver: pii-tokenizer → kb-finder → prompt-builder
 *                   → 모델 1회 → citation-checker ] → chat-publisher → pii-restorer
 *
 * 사건의 생애(접수 → 플랜 → 기한 → 완료 → 리마인더 → 파기)는
 * [case-lifecycle.test.ts](./case-lifecycle.test.ts)가 따로 본다.
 *
 * `pii-tokenizer` 와 모델 어댑터는 아직 없어 인터페이스 자리에 대역을 넣는다.
 */

import { describe, expect, it } from 'vitest'

import type { ApiDeadline } from '@/flows/api-deadlines'
import { chatTurn, deadlineState, deadlinesCited, stepsCited } from '@/flows/chat-turn'
import type { CasePlanStore } from '@/flows/regenerate-plan'

import { createContainer, unconfiguredPorts } from '@/lib/container'
import type { Container, Ports } from '@/lib/container'
import { createMessageStore } from '@/lib/db'
import { KbCitationMissingError, KbUnavailableError } from '@/lib/errors'
import type { MessageStore, Sql } from '@/lib/db'
import { readEnv } from '@/lib/env'

import { createAuditLogger, verifyChain } from '@/modules/audit-logger'
import type { AuditRecord, AuditStore } from '@/modules/audit-logger'
import { createChatPublisher } from '@/modules/chat-publisher'
import type { ChatResponseBody } from '@/modules/chat-publisher'
import { createChatReceiver } from '@/modules/chat-receiver'
import type { KbEntry, TurnOutcome } from '@/modules/chat-receiver'
import { createCitationChecker } from '@/modules/citation-checker'
import { createKbFinder } from '@/modules/kb-finder'
import type { KbFinder, KbQuery, KbRow } from '@/modules/kb-finder'
import { maskText } from '@/modules/pii-masker'
import { restore } from '@/modules/pii-restorer'
import { createPromptBuilder } from '@/modules/prompt-builder'
import { createSlotChecker } from '@/modules/slot-checker'

const KB_APPLIED = [
  {
    kbEntryId: 'relief-application',
    kbVersion: '2026.08.1',
    label: '피해구제 신청서 제출',
    body: '지급정지 뒤 3영업일 안에 신청서를 낸다. 접수하면 접수증이 나온다.',
  },
]

describe('층 2 한 턴이 끝까지 이어진다', () => {
  it('마스킹 → 조립 → 검증 → 송출 → 복원', () => {
    // 1. 브라우저: 보내기 전 1차 마스킹
    const masked = maskText('110-234-567890 으로 보냈어요. 이제 뭘 하죠')

    expect(masked.masked).toContain('[계좌-1]')
    expect(masked.mappings).toHaveLength(1)

    // 2. 서버: 프롬프트 조립
    const builder = createPromptBuilder()
    const prompt = builder.build({
      kbApplied: KB_APPLIED,
      kbReference: [],
      caseTalk: [],
      caseState: [{ label: '피해구제 신청 기한', value: '2026년 8월 20일' }],
      history: [{ speaker: 'user', text: masked.masked }],
      currentDate: '2026년 8월 18일',
    })

    // 마스킹된 텍스트가 그대로 프롬프트에 들어간다 — 원문은 브라우저를 안 떠났다
    expect(prompt.user).toContain('[계좌-1]')
    expect(prompt.user).not.toContain('110-234-567890')

    // 3. 모델이 이렇게 답했다고 하자 (ref 와 why 만 쓴다)
    const modelReply = {
      insufficient: false,
      citations: [
        { ref: 'kb-1', why: '다음 단계가 신청서라고 안내하는 데 썼습니다' },
        { ref: 'case-1', why: '8월 20일을 문장에 옮기는 데 썼습니다' },
      ],
    }
    const replyText =
      '다음은 피해구제 신청서 제출입니다. 2026년 8월 20일까지 하셔야 합니다. ' +
      '접수증이 오면 올려주세요.'

    // 4. 인용 검증 — **여기가 이음매다.** 발급 목록에서 ref 만 뽑아 넘긴다
    const citationChecker = createCitationChecker()
    const outcome = citationChecker.check({
      reply: modelReply,
      issued: prompt.issued.map((one) => one.ref),
      kbResultEmpty: prompt.counts.applied === 0 && prompt.counts.reference === 0,
    })

    expect(outcome.kind).toBe('pass')

    // 5. 송출 — **여기도 이음매다.** citation-checker 의 'pass' 가
    //    chat-publisher 에서는 'answer' 다
    const publisher = createChatPublisher({ residualPii: { scan: () => ({}) } })
    if (outcome.kind !== 'pass') throw new Error('통과했어야 합니다')

    const body = publisher.publish({
      kind: 'answer',
      messageId: '01J8XKRE',
      reply: replyText,
      // 서버가 ref 로 나머지를 채운다 — 모델은 ref·why 만 썼다
      citations: modelReply.citations.map((one) => {
        const source = prompt.issued.find((issued) => issued.ref === one.ref)
        return {
          ref: one.ref,
          why: one.why,
          label: source?.label,
          kb_entry_id: source?.kbEntryId,
          kb_version: source?.kbVersion,
        }
      }),
    })

    // 서버가 채운 값이 실려 나간다
    expect(body.citations[0].kb_entry_id).toBe('relief-application')
    expect(body.citations[0].label).toBe('피해구제 신청서 제출')
    // 사건 정보 인용에는 식별자가 없다
    expect(body.citations[1].kb_entry_id).toBeUndefined()

    // 6. 브라우저: **전체 복원** → ADR-034 「브라우저 화면에는 원문」
    //    **이음매: 마스킹이 만든 매핑을 복원이 그대로 받는다** — 필요한 칸이 같다
    const shown = restore(`${body.reply} [계좌-1]`, masked.mappings, {
      site: 'chat-answer',
    })
    expect(shown).toContain('110-234-567890')
    // **나간 것은 여전히 토큰뿐입니다** — 화면 표시와 무관합니다 (불변 규칙 2)
    expect(body.reply).not.toContain('110-234-567890')
  })
})

describe('되묻기 갈래도 이어진다', () => {
  it('근거를 못 찾으면 슬롯 질문이 응답에 실린다', () => {
    const citationChecker = createCitationChecker()
    const outcome = citationChecker.check({
      reply: { insufficient: true, citations: [] },
      issued: ['kb-1'],
      kbResultEmpty: false,
    })
    expect(outcome.kind).toBe('ask_slot')

    // slot-checker 가 질문을 만든다
    const slotChecker = createSlotChecker({
      questions: {
        formFor: (slotKey) =>
          slotKey === 'channel'
            ? {
                input: 'buttons',
                text: '어떤 방법으로 보내셨나요?',
                options: ['은행 계좌이체'],
              }
            : undefined,
      },
    })
    const slots = slotChecker.check({
      slots: [{ slotKey: 'transferred', tier: 'T1', state: 'confirmed' }],
    })

    expect(slots.nextQuestion?.slotKey).toBe('channel')
    // 「모름」이 자동으로 붙는다
    expect(slots.nextQuestion?.options).toContain('모름·기억 안 남')

    // **이음매: slot-checker 는 camelCase, 응답은 snake_case 다**
    const publisher = createChatPublisher({ residualPii: { scan: () => ({}) } })
    const question = slots.nextQuestion
    if (!question) throw new Error('질문이 있어야 합니다')

    const body = publisher.publish({
      kind: 'ask_slot',
      messageId: '01J8XKRG',
      nextQuestion: {
        slot_key: question.slotKey,
        text: question.text,
        input: question.input,
        options: question.options,
      },
    })

    expect(body.next_question?.slot_key).toBe('channel')
    expect(body.citations).toEqual([])
  })
})

describe('감사 로그가 각 자리에서 남는다', () => {
  it('프롬프트 조립 건수를 그대로 넘길 수 있다', async () => {
    const rows: AuditRecord[] = []
    const store: AuditStore = {
      async appendChained(build) {
        const record = build(rows.at(-1)?.hash ?? null)
        rows.push(record)
        return record
      },
    }

    const builder = createPromptBuilder()
    const prompt = builder.build({
      kbApplied: KB_APPLIED,
      kbReference: [],
      caseTalk: [{ speaker: 'A', text: '[이름-1] 고객님' }],
      caseState: [],
      history: [],
      currentDate: '2026년 8월 18일',
    })

    let seq = 0
    const audit = createAuditLogger({
      store,
      now: () => `2026-08-18T10:00:0${++seq}.000000+09:00`,
      newId: () => `01J8XKR${seq}`,
    })

    // **이음매: counts 를 그대로 넘겨도 토큰 검사에 안 걸린다** — 건수뿐이다
    const record = await audit.record({
      eventType: 'chat.context_built',
      actorType: 'system',
      caseId: '01J8XKQZ',
      detail: {
        applied: prompt.counts.applied,
        reference: prompt.counts.reference,
        transcript_lines: prompt.counts.talkLines,
      },
    })

    expect(record.detail).toEqual({
      applied: 1,
      reference: 0,
      transcript_lines: 1,
    })
    expect(rows).toHaveLength(1)
  })

  it('발급 목록을 통째로 넘기면 거부된다 — label 에 토큰이 섞일 수 있다', async () => {
    // 이 시험은 「하면 안 되는 것」을 못 박는다.
    // 사건 대화의 label 은 `사건 대화 t-1` 이지만, 사건 정보의 label 이
    // 개인정보를 담을 수 있어 발급 목록을 그대로 로그에 넣으면 안 된다
    const rows: AuditRecord[] = []
    const audit = createAuditLogger({
      store: {
        async appendChained(build) {
          const record = build(null)
          rows.push(record)
          return record
        },
      },
      now: () => '2026-08-18T10:00:00.000000+09:00',
      newId: () => '01J8XKR1',
    })

    await expect(
      audit.record({
        eventType: 'chat.context_built',
        actorType: 'system',
        detail: { sample: '[계좌-1]' },
      }),
    ).rejects.toThrow()
    expect(rows).toHaveLength(0)
  })
})

/**
 * **이음매: kb-finder 의 행을 프롬프트가 받는 모양으로 옮긴다.**
 *
 * 표는 `title` 과 JSONB 를 갖고, 프롬프트는 `label` 과 문자열을 받는다.
 * **누가 옮기는지 정본에 없어** 지금은 부르는 쪽이 한다.
 */
async function asPromptEntries(
  kbFinder: KbFinder,
  query: KbQuery,
): Promise<{ applied: KbEntry[]; reference: KbEntry[] }> {
  const groups = await kbFinder.find(query)
  const toEntry = (row: KbRow): KbEntry => ({
    kbEntryId: row.kbEntryId,
    kbVersion: row.kbVersion,
    label: row.title,
    body: String((row.body as { summary?: string }).summary ?? ''),
    ...(row.channelId ? { channelId: row.channelId } : {}),
  })
  return {
    applied: groups.applied.map(toEntry),
    reference: groups.reference.map(toEntry),
  }
}

describe('chat-receiver 가 순서를 부르면 끝까지 이어진다', () => {
  /** 매뉴얼 한 행. kb-finder 가 표에서 읽어 오는 모양 그대로 */
  const KB_ROW: KbRow = {
    kbEntryId: 'relief-application',
    kbVersion: '2026.08.1',
    stepKey: 'relief-apply',
    stepSeq: 30,
    channelId: 'CH-bank',
    orgId: null,
    track: 'victim',
    title: '피해구제 신청서 제출',
    body: { summary: '지급정지 뒤 3영업일 안에 신청서를 낸다.' },
    legalBasis: '통신사기피해환급법 시행령 제3조',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2026-07-01',
    effectiveUntil: null,
    verifiedAt: '2026-08-16',
  }

  it('토큰화 → 조회 → 조립 → 모델 → 검증 → 송출', async () => {
    const kbFinder = createKbFinder({
      store: {
        findApplied: async () => [KB_ROW],
        findReference: async () => [],
      },
    })

    const builder = createPromptBuilder()
    const citationChecker = createCitationChecker()

    const chat = createChatReceiver({
      // 아직 없는 자리. 1차 마스킹이 이미 지난 텍스트가 들어온다
      tokenizer: { tokenize: async (text) => ({ masked: text, counts: {} }) },
      orgTerms: { list: async (): Promise<readonly string[]> => [] },
      kb: { find: (query) => asPromptEntries(kbFinder, query) },
      prompts: builder,
      // 모델 대역 — 발급받은 ref 만 쓴다
      llm: {
        complete: async () => ({
          insufficient: false,
          citations: [{ ref: 'kb-1', why: '다음 단계를 안내하는 데 썼습니다' }],
          reply: '다음은 피해구제 신청서 제출입니다.',
        }),
      },
      citations: citationChecker,
      retry: { decide: () => ({ retry: false }) },
      clock: {
        today: () => '2026-08-20',
        todayLabel: () => '2026년 8월 20일',
        nowMs: () => 0,
      },
    })

    // 1. 브라우저에서 1차 마스킹을 마친 발화가 들어온다
    const masked = maskText('110-234-567890 으로 보냈어요. 이제 뭘 하죠')

    const turn = await chat.receive({
      caseContext: {
        caseId: '01J8XKQZ',
        track: 'victim',
        channelId: 'CH-bank',
        orgId: null,
        caseTalk: [],
        caseState: [{ label: '피해구제 신청 기한', value: '2026년 8월 25일' }],
        history: [],
      },
      utterance: masked.masked,
      kbVersion: '2026.08.1',
    })

    // 원문은 프롬프트 어디에도 없다
    expect(turn.promptMasked).toContain('[계좌-1]')
    expect(turn.promptMasked).not.toContain('110-234-567890')
    // 실제 citation-checker 가 통과시켰다
    expect(turn.outcome.kind).toBe('pass')
    // 저장할 재료가 함께 왔다 — 본문 없이 식별자만
    expect(turn.kbContextRefs).toEqual([
      { kbEntryId: 'relief-application', kbVersion: '2026.08.1', group: 'applied' },
    ])

    // 2. **이음매: chat-receiver 의 판정이 chat-publisher 의 kind 가 된다**
    //    citation-checker 의 'pass' 는 응답에서 'answer' 다
    const publisher = createChatPublisher({ residualPii: { scan: () => ({}) } })
    if (turn.outcome.kind !== 'pass') throw new Error('통과했어야 합니다')

    const body = publisher.publish({
      kind: 'answer',
      messageId: '01J8XKRE',
      reply: turn.reply.reply ?? '',
      // **이음매: 서버가 issued 로 인용의 나머지를 채운다**
      citations: turn.reply.citations.map((one) => {
        const source = turn.issued.find((issued) => issued.ref === one.ref)
        return {
          ref: one.ref,
          why: one.why,
          label: source?.label,
          kb_entry_id: source?.kbEntryId,
          kb_version: source?.kbVersion,
        }
      }),
    })

    expect(body.citations[0].kb_entry_id).toBe('relief-application')
    expect(body.citations[0].label).toBe('피해구제 신청서 제출')

    // 3. 브라우저에서 복원 — **전체**입니다 (ADR-034)
    const shown = restore(`${body.reply} [계좌-1]`, masked.mappings, {
      site: 'chat-answer',
    })
    expect(shown).toContain('110-234-567890')
  })

  it('조회가 0건이면 절차를 말하지 않고 1332 안내로 간다', async () => {
    const kbFinder = createKbFinder({
      store: { findApplied: async () => [], findReference: async () => [] },
    })

    const chat = createChatReceiver({
      tokenizer: { tokenize: async (text) => ({ masked: text, counts: {} }) },
      orgTerms: { list: async (): Promise<readonly string[]> => [] },
      kb: { find: (query) => asPromptEntries(kbFinder, query) },
      prompts: createPromptBuilder(),
      llm: {
        complete: async () => ({ insufficient: true, citations: [] }),
      },
      citations: createCitationChecker(),
      retry: { decide: () => ({ retry: false }) },
      clock: {
        today: () => '2026-08-20',
        todayLabel: () => '2026년 8월 20일',
        nowMs: () => 0,
      },
    })

    const turn = await chat.receive({
      caseContext: {
        caseId: '01J8XKQZ',
        track: 'victim',
        channelId: null,
        orgId: null,
        caseTalk: [],
        caseState: [],
        history: [],
      },
      utterance: '뭘 해야 하죠',
      kbVersion: '2026.08.1',
    })

    // 되물어도 안 나온다 — 에러가 아니라 안내다
    expect(turn.outcome.kind).toBe('guide_1332')
  })
})

describe('답이 가리킨 단계가 화면으로 나간다 — §3.9 `referenced_steps`', () => {
  /**
   * **여기가 오래 비어 있었습니다.** 계약이 이 칸을 정의했는데 서버가 빈 배열만
   * 냈고, 그래서 챗이 「지급정지부터 하세요」라고 답해도 그 작업 패널이 열리지
   * 않았습니다. 되짚는 열쇠는 `case_state` 에 실린 `stepId` 입니다.
   */
  const builder = createPromptBuilder()

  const promptWith = (steps: readonly { title: string; state: string; stepId: string }[]) =>
    builder.build({
      kbApplied: KB_APPLIED,
      kbReference: [],
      caseTalk: [],
      caseState: steps.map((one) => ({
        label: `단계: ${one.title}`,
        value: one.state,
        stepId: one.stepId,
      })),
      history: [{ speaker: 'user', text: '뭐부터 하죠' }],
      currentDate: '2026년 8월 18일',
    })

  it('발급 기록이 단계 식별자를 들고 다닌다', () => {
    const prompt = promptWith([
      { title: '지급정지를 요청합니다', state: 'not_started', stepId: '01JFREEZE' },
    ])
    const issued = prompt.issued.find((one) => one.ref === 'case-1')

    expect(issued?.stepId).toBe('01JFREEZE')
  })

  it('**프롬프트에는 안 들어간다** — 모델에게 ULID 를 보여줄 이유가 없습니다', () => {
    const prompt = promptWith([
      { title: '지급정지를 요청합니다', state: 'not_started', stepId: '01JFREEZE' },
    ])

    expect(prompt.user).toContain('지급정지를 요청합니다')
    expect(prompt.user).not.toContain('01JFREEZE')
  })

  it('KB 인용에는 단계가 안 붙는다 — 절차 지식이지 이 사건의 단계가 아닙니다', () => {
    const prompt = promptWith([
      { title: '지급정지를 요청합니다', state: 'not_started', stepId: '01JFREEZE' },
    ])
    const kb = prompt.issued.find((one) => one.ref === 'kb-1')

    expect(kb).toBeDefined()
    expect(kb?.stepId).toBeUndefined()
  })

  it('단계가 여럿이면 발급 번호도 여럿이고 각각 제 단계를 가리킨다', () => {
    const prompt = promptWith([
      { title: '지급정지를 요청합니다', state: 'done_verified', stepId: '01JFREEZE' },
      { title: '피해구제를 신청합니다', state: 'not_started', stepId: '01JRELIEF' },
    ])

    expect(prompt.issued.find((one) => one.ref === 'case-1')?.stepId).toBe('01JFREEZE')
    expect(prompt.issued.find((one) => one.ref === 'case-2')?.stepId).toBe('01JRELIEF')
  })

  it('단계가 아닌 사건 정보에는 안 붙는다 — 슬롯은 단계가 아닙니다', () => {
    const prompt = builder.build({
      kbApplied: KB_APPLIED,
      kbReference: [],
      caseTalk: [],
      caseState: [{ label: 'org_name', value: '[기관-1]' }],
      history: [{ speaker: 'user', text: '뭐부터 하죠' }],
      currentDate: '2026년 8월 18일',
    })

    expect(prompt.issued.find((one) => one.ref === 'case-1')?.stepId).toBeUndefined()
  })
})

describe('인용을 단계로 되짚는 규칙', () => {
  const cited = (
    citations: readonly { ref: string }[],
    issued: readonly { ref: string; stepId?: string }[],
  ) => stepsCited({ reply: { citations }, issued })

  it('`case-` 가 가리킨 단계를 낸다', () => {
    expect(
      cited([{ ref: 'case-2' }], [
        { ref: 'case-1', stepId: '01JA' },
        { ref: 'case-2', stepId: '01JB' },
      ]),
    ).toEqual(['01JB'])
  })

  it('**`kb-` 는 안 온다** — 절차 지식이지 이 사건의 단계가 아닙니다', () => {
    expect(cited([{ ref: 'kb-1' }], [{ ref: 'kb-1', kbEntryId: 'x' } as never])).toEqual([])
  })

  it('단계가 아닌 `case-` 는 안 온다 — 슬롯이 그 경우입니다', () => {
    expect(cited([{ ref: 'case-1' }], [{ ref: 'case-1' }])).toEqual([])
  })

  it('**같은 줄을 두 번 인용해도 한 번만** 낸다', () => {
    expect(
      cited([{ ref: 'case-1' }, { ref: 'case-1' }], [{ ref: 'case-1', stepId: '01JA' }]),
    ).toEqual(['01JA'])
  })

  it('인용한 순서를 지킨다 — 화면이 앞의 것을 먼저 봅니다', () => {
    expect(
      cited([{ ref: 'case-2' }, { ref: 'case-1' }], [
        { ref: 'case-1', stepId: '01JA' },
        { ref: 'case-2', stepId: '01JB' },
      ]),
    ).toEqual(['01JB', '01JA'])
  })

  it('발급하지 않은 번호를 지어내도 조용히 버린다', () => {
    // 모델이 없는 `case-9` 를 쓸 수 있습니다 — 던지면 답 전체가 날아갑니다
    expect(cited([{ ref: 'case-9' }], [{ ref: 'case-1', stepId: '01JA' }])).toEqual([])
  })
})

describe('기한이 프롬프트에 실린다 — §3.3 · §3.4', () => {
  /**
   * **계약이 정한 것이 안 들어가고 있었습니다.** §3.4 는 *"`case-` 는 슬롯·단계·
   * **기한**·부산물을 가리킨다"* 이고 §3.3 은 넣을 모양까지 적어 뒀는데,
   * `case_state` 에는 슬롯과 단계만 들어갔습니다. 그래서 *"언제까지죠"* 에
   * 답할 근거가 없었고 `referenced_deadlines` 도 늘 빈 배열이었습니다.
   */
  const one = (over: Partial<ApiDeadline> = {}): ApiDeadline => ({
    deadline_id: '01JDL',
    step_id: '01JSTEP',
    title: '피해구제 신청 서류를 냅니다',
    kind: 'primary',
    due_at: '2026-08-20T23:59:59+09:00',
    status: 'open',
    estimated: false,
    ...over,
  })

  it('날짜가 **사람이 읽는 형태**로 들어간다 — 「현재 날짜」와 같은 표기', () => {
    expect(deadlineState([one()])[0].value).toContain('2026년 8월 20일')
  })

  it('종류가 라벨에 드러난다 — 본 기한과 추가 기간을 합치지 않습니다 (§8.1)', () => {
    expect(deadlineState([one()])[0].label).toBe('기한: 피해구제 신청 서류를 냅니다')
    expect(deadlineState([one({ kind: 'grace' })])[0].label).toContain('추가 기간')
  })

  it('**남은 날은 서버가 센 값을 그대로** 옮긴다 — 모델이 세지 않습니다 (불변 규칙 7)', () => {
    expect(deadlineState([one({ days_left: 3 })])[0].value).toContain('3일 남았습니다')
    expect(deadlineState([one({ days_left: 0 })])[0].value).toContain('오늘이 마지막 날')
  })

  it('지난 기한을 지났다고 말한다 — 안 그러면 아직 시간이 있다고 답합니다', () => {
    expect(deadlineState([one({ status: 'missed' })])[0].value).toContain('이미 지났습니다')
  })

  it('유예의 조건이 붙는다 — 없으면 추가 기간을 본 기한으로 말합니다 (§8.1)', () => {
    const value = deadlineState([
      one({ kind: 'grace', condition: '3영업일을 넘기면 금융회사가 14일의 추가 기간을 정해 통지합니다' }),
    ])[0].value

    expect(value).toContain('14일의 추가 기간')
  })

  it('**기관이 진행하는 기간에는 「까지」를 안 붙인다** — 사용자 기한으로 오인시킵니다 (§8.3)', () => {
    const value = deadlineState([
      one({ kind: 'info', note: '금융감독원이 진행하는 절차의 길이입니다' }),
    ])[0].value

    expect(value).not.toContain('까지')
    expect(value).toContain('금융감독원이 진행하는')
  })

  it('붙는 말이 없으면 안 붙는다 — **지어내지 않습니다** (불변 규칙 1)', () => {
    expect(deadlineState([one()])[0].value).toBe('2026년 8월 20일까지')
  })

  it('날짜를 못 읽으면 **줄을 안 만든다** — 날짜 없는 「기한이 있습니다」를 막습니다', () => {
    expect(deadlineState([one({ due_at: '언젠가' })])).toEqual([])
  })

  it('**식별자는 프롬프트에 안 들어간다** — 발급 기록에만 실립니다', () => {
    const prompt = createPromptBuilder().build({
      kbApplied: KB_APPLIED,
      kbReference: [],
      caseTalk: [],
      caseState: deadlineState([one()]),
      history: [{ speaker: 'user', text: '언제까지죠' }],
      currentDate: '2026년 8월 18일',
    })

    expect(prompt.user).toContain('2026년 8월 20일까지')
    expect(prompt.user).not.toContain('01JDL')
    expect(prompt.issued.find((i) => i.ref === 'case-1')?.deadlineId).toBe('01JDL')
  })
})

describe('인용을 기한으로 되짚는 규칙 — §3.9 `referenced_deadlines`', () => {
  const cited = (
    citations: readonly { ref: string }[],
    issued: readonly { ref: string; stepId?: string; deadlineId?: string }[],
  ) => deadlinesCited({ reply: { citations }, issued })

  it('`case-` 가 가리킨 기한을 낸다', () => {
    expect(cited([{ ref: 'case-2' }], [
      { ref: 'case-1', deadlineId: '01JA' },
      { ref: 'case-2', deadlineId: '01JB' },
    ])).toEqual(['01JB'])
  })

  it('**단계는 안 온다** — 한 단계에 기한이 둘 설 수 있어 번호가 다릅니다 (§8.1)', () => {
    expect(cited([{ ref: 'case-1' }], [{ ref: 'case-1', stepId: '01JSTEP' }])).toEqual([])
  })

  it('같은 기한을 두 번 인용해도 한 번만 낸다', () => {
    expect(
      cited([{ ref: 'case-1' }, { ref: 'case-1' }], [{ ref: 'case-1', deadlineId: '01JA' }]),
    ).toEqual(['01JA'])
  })

  it('발급하지 않은 번호를 지어내도 조용히 버린다', () => {
    expect(cited([{ ref: 'case-9' }], [{ ref: 'case-1', deadlineId: '01JA' }])).toEqual([])
  })
})

describe('추정 기한은 추정이라고 말한다 — 화면의 「미확인」과 같은 말', () => {
  const one = (over: Partial<ApiDeadline> = {}): ApiDeadline => ({
    deadline_id: '01JDL',
    step_id: '01JSTEP',
    title: '피해구제 신청 서류를 냅니다',
    kind: 'primary',
    due_at: '2026-08-20T23:59:59+09:00',
    status: 'open',
    estimated: false,
    ...over,
  })

  it('확인된 기한에는 아무 말도 안 붙는다', () => {
    expect(deadlineState([one()])[0].value).not.toContain('확정이 아닙니다')
  })

  it('**확인 안 된 기한은 확정이 아니라고 말한다** — 모델이 사실로 옮겨 적습니다', () => {
    const value = deadlineState([one({ estimated: true })])[0].value
    expect(value).toContain('2026년 8월 20일까지')
    expect(value).toContain('확정이 아닙니다')
  })

  it('**날짜 바로 뒤에 온다** — 뒤에 붙이면 모델이 날짜만 옮기고 흘립니다', () => {
    const value = deadlineState([
      one({ kind: 'grace', estimated: true, condition: '3영업일을 넘겼을 때 주어집니다' }),
    ])[0].value

    expect(value.indexOf('확정이 아닙니다')).toBeLessThan(value.indexOf('3영업일을 넘겼을 때'))
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * 흐름 한 턴 — `flows/chat-turn.ts`
 *
 * 위쪽이 모듈끼리 맞물리는지를 보는 자리라면, 아래는 **그 이음매를 실제로
 * 부르는 코드**가 계약대로 도는지 봅니다. 여기 있는 것 셋이 실제로 깨져
 * 있었습니다.
 * ──────────────────────────────────────────────────────────────────────────── */

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const KB_VERSION = '2026.08.1'

type MessageWrite = Parameters<MessageStore['write']>[0]

/** 모델이 답을 낸 턴 하나 — 아래 시험들의 기본값 */
function turnOf(over: Partial<TurnOutcome> = {}): TurnOutcome {
  return {
    outcome: { kind: 'pass' },
    reply: {
      insufficient: false,
      citations: [{ ref: 'kb-1', why: '다음 단계를 안내하는 데 썼습니다' }],
      reply: '다음은 피해구제 신청서 제출입니다.',
    },
    issued: [
      {
        ref: 'kb-1',
        label: '피해구제 신청서 제출',
        kbEntryId: 'relief-application',
        kbVersion: KB_VERSION,
      },
    ],
    kbContextRefs: [],
    promptMasked: '(프롬프트 전문)',
    utteranceMasked: '이제 뭘 하죠',
    counts: { applied: 5, reference: 7, transcriptLines: 42 },
    // 계측 헤더가 이 값으로 섭니다 → §1.1 · `X-Pii-Token-Count`
    piiCounts: { account: 1 },
    attempts: 1,
    ...over,
  }
}

interface ChatHarness {
  readonly container: Container
  /** `messages.write` 가 받은 것. **빈 배열이 「안 남겼다」입니다** */
  readonly written: readonly MessageWrite[]
  /** 감사 저장소에 쌓인 줄. **진짜 `audit-logger` 가 만든 것**입니다 */
  readonly audits: readonly AuditRecord[]
  /** `chat-receiver` 가 받은 것. 흐름이 무엇을 모아 넘겼는지 봅니다 */
  readonly received: { readonly issuedTokens?: readonly { token: string }[] }[]
}

/**
 * 사건 하나를 들고 있는 대역.
 *
 * **모델은 대역이지만 `chat-publisher`·`audit-logger`·`slot-checker` 는 진짜로
 * 태웁니다** — 이 파일이 보려는 것이 「부르는 자리가 있는가」라서, 그 셋을
 * 대역으로 바꾸면 안 부르고도 통과합니다.
 */
function chatHarness(
  over: {
    readonly turn?: TurnOutcome
    /** 맥락으로 되돌아온 대화 줄. **`history()` 는 20턴에서 자릅니다** */
    readonly history?: readonly { speaker: 'user' | 'assistant'; text: string }[]
    /** 물을 것이 남지 않은 사건 — 슬롯을 다 채운 자리입니다 */
    readonly noQuestion?: boolean
    /** 사건의 슬롯 — `caseState` 라벨 시험이 씁니다 */
    readonly slots?: readonly { slotKey: string; state: string; valueMasked: string }[]
    /** 브라우저가 볼트에 맡겨 둔 이름표 — **값이 아니라 번호만** 옵니다 */
    readonly vaultTokens?: readonly string[]
    /** 서버가 앞서 전사문에 붙인 이름표가 박혀 있는 줄 */
    readonly transcript?: readonly { speaker: string; text: string }[]
    /** `chat-receiver` 가 던지는 턴 — 모델을 부르다 걸린 자리를 세웁니다 */
    readonly throws?: unknown
  } = {},
): ChatHarness {
  const written: MessageWrite[] = []
  const audits: AuditRecord[] = []
  const received: { issuedTokens?: readonly { token: string }[] }[] = []

  const store: CasePlanStore = {
    async readCase() {
      return { track: 'victim' as const }
    },
    async readSlots() {
      return []
    },
    async readChannel() {
      return null
    },
    async readChannels() {
      return []
    },
    async readSteps() {
      return []
    },
    async applyPlan() {
      return []
    },
    async openCase() {
      return []
    },
  }

  const env = readEnv({})
  const ports = {
    ...unconfiguredPorts(env),
    casePlan: store,
    kbVersion: { current: async () => KB_VERSION },
    // **진짜 사슬이 여기 쌓입니다** — 앞 해시를 돌려줘야 이어집니다
    auditStore: {
      async appendChained(build: (prev: string | null) => AuditRecord) {
        const record = build(audits.at(-1)?.hash ?? null)
        audits.push(record)
        return record
      },
    },
  } as Ports

  const container: Container = {
    ...createContainer(env, ports),
    // 모델은 이 파일이 보는 것이 아닙니다 → 위 「chat-receiver 가 순서를 부르면」
    chatReceiver: {
      receive: async (input: { issuedTokens?: readonly { token: string }[] }) => {
        received.push(input)
        if (over.throws) throw over.throws
        return over.turn ?? turnOf()
      },
    },
    messages: {
      async write(input) {
        written.push(input)
      },
      async history() {
        return over.history ?? []
      },
      async transcript() {
        return over.transcript ?? []
      },
      async turns() {
        return { turns: [], truncated: false }
      },
    },
    // 시험은 필요한 세 칸만 적습니다 — 나머지는 이 흐름이 안 읽습니다
    slots: { read: async () => (over.slots ?? []) as never },
    deadlines: { read: async () => [] },
    deadlineWrite: { apply: async () => [], sweepOverdue: async () => 0 },
    // 이름표 장부 → 04-pii-boundary.md 「번호의 단위」. 이 파일이 보는 것은
    // 이음매라 비워 둡니다 — 이어받는지는 `chat-receiver` 시험이 봅니다
    vaultWrite: {
      put: async () => 0,
      list: async () => [],
      tokens: async () => over.vaultTokens ?? [],
    },
    // **장부는 여기서 읽습니다** — 전사문만이 아니라 챗·슬롯·부산물까지
    maskedTexts: { all: async () => (over.transcript ?? []).map((one) => one.text) },
    ...(over.noQuestion
      ? {
          slotChecker: {
            check: () => ({
              t1: 'satisfied' as const,
              t2: 'satisfied' as const,
              nextQuestion: null,
              needsSupersetPlan: false,
            }),
          },
        }
      : {}),
  }

  return { container, written, audits, received }
}

/** 한 턴을 돌리고 응답 본문을 계약의 모양으로 받는다 */
async function runTurn(one: ChatHarness): Promise<ChatResponseBody> {
  const got = await chatTurn({ caseId: CASE_ID, content: '이제 뭘 하죠' }, one.container)
  return got.body as unknown as ChatResponseBody
}

describe('근거가 없으면 되묻는다 — §3.9 · 11-chat-context.md §6.3', () => {
  /**
   * **여기가 배선돼 있지 않았습니다.** `guide_1332` 만 갈라 두고 나머지를 전부
   * 답변으로 씌워서, 모델이 「답할 근거가 없다」고 선언한 턴이 **빈 답**으로
   * 나갔습니다 — 그 턴에는 `reply` 가 아예 없습니다.
   */
  const ASK = turnOf({
    outcome: { kind: 'ask_slot' },
    reply: { insufficient: true, citations: [] },
  })

  it('`ask_slot` 이 답변으로 떨어지지 않는다 — **빈 답이 나가던 자리**', async () => {
    const body = await runTurn(chatHarness({ turn: ASK }))

    expect(body.reply).not.toBe('')
    // 문구의 정본은 §3.9 「근거가 없으면 되묻습니다」
    expect(body.reply).toContain('하나만 확인')
    expect(body.next_question).not.toBeNull()
    expect(body.citations).toEqual([])
  })

  it('되묻는 문항은 **슬롯 체커가 만든 그대로** — 챗이 따로 만들지 않습니다', async () => {
    const body = await runTurn(chatHarness({ turn: ASK }))

    // 화면의 문진과 같은 순서에서 나옵니다 (`slot-checker` 의 ASK_ORDER 첫 줄)
    expect(body.next_question?.slot_key).toBe('transferred')
    // 「모름」이 빠지면 사용자가 막힙니다 (불변 규칙 5)
    expect(body.next_question?.options).toContain('모름·기억 안 남')
  })

  it('**물을 것이 없으면 1332 로 간다** — 슬롯을 다 채웠는데 근거가 없는 자리', async () => {
    // §6.3 의 마지막 줄 · 10-errors.md §4.1. 빈 질문을 실어 보내면 화면이
    // 답할 수 없는 카드를 띄웁니다
    const body = await runTurn(chatHarness({ turn: ASK, noQuestion: true }))

    expect(body.kb_result).toBe('empty')
    expect(body.reply).toContain('1332')
    expect(body.next_question).toBeNull()
  })

  it('조회가 0건이면 문항을 안 싣는다 — 되물어도 안 나옵니다 (§4.1)', async () => {
    const body = await runTurn(
      chatHarness({
        turn: turnOf({
          outcome: { kind: 'guide_1332' },
          reply: { insufficient: true, citations: [] },
        }),
      }),
    )

    expect(body.kb_result).toBe('empty')
    expect(body.next_question).toBeNull()
  })
})

describe('답변에도 다음 문항이 실린다 — §3.9 `next_question`', () => {
  /**
   * **늘 `null` 이었습니다.** 화면은 그 빈 값을 받아 문진을 지웁니다
   * (`send.ts` 의 `setQuestion`) — 사용자가 말로 한 마디 하면 남은 질문이
   * 통째로 사라졌습니다.
   */
  it('답을 하면서도 남은 문항을 함께 낸다', async () => {
    const body = await runTurn(chatHarness())

    expect(body.reply).toContain('피해구제')
    expect(body.next_question?.slot_key).toBe('transferred')
  })

  it('물을 것이 없으면 `null` — 그때는 문진이 끝난 것입니다', async () => {
    const body = await runTurn(chatHarness({ noQuestion: true }))

    expect(body.next_question).toBeNull()
    // **답변은 그대로 나갑니다** — 문항이 없다고 답을 막지 않습니다
    expect(body.reply).toContain('피해구제')
  })

  it('`options` 를 빈 배열로라도 채운다 — 세 경로가 같은 모양이어야 합니다', async () => {
    const body = await runTurn(chatHarness())

    expect(Array.isArray(body.next_question?.options)).toBe(true)
  })
})

describe('나간 문장을 그대로 남긴다 — §3.12 이력', () => {
  it('되묻기 턴의 이력이 비지 않는다', async () => {
    const one = chatHarness({
      turn: turnOf({
        outcome: { kind: 'ask_slot' },
        reply: { insufficient: true, citations: [] },
      }),
    })
    const body = await runTurn(one)

    // 모델의 `reply` 를 남기면 **빈 말풍선**이 뜹니다 — 사용자가 읽은 것과 다릅니다
    expect(one.written[0]?.contentMasked).toBe(body.reply)
    expect(one.written[0]?.contentMasked).not.toBe('')
    // 「왜 이 질문이 나갔나」를 설명하는 값입니다 → 09-data-model.md §9
    expect(one.written[0]?.insufficient).toBe(true)
  })

  /**
   * ⚠️ **이력의 근거에 `label` 이 없어 재진입이 통째로 깨져 있었습니다** (2026-08-31).
   *
   * 남긴 것이 `outcome.reply.citations`(= 모델이 낸 `{ref, why}`)라 `label` 이
   * 없었습니다. `GET …/messages` 는 그것을 그대로 내리고(§3.12), 화면의
   * `sourceNote` 는 `citations.map((c) => c.label).filter((l) => l.length > 0)` 라
   * **`undefined.length` 로 던집니다.** 그 예외가 첫 로드 효과 밖으로 새어
   * `setLoading(false)` 까지 못 가서, 새로고침하면 챗이 「불러오는 중」에서
   * 영영 멈췄습니다 — 「못 읽었습니다」 안내조차 안 떴습니다 (ADR-050).
   *
   * 남기는 것은 **실제로 나간 것**이어야 합니다. 바로 위 `contentMasked` 가
   * 이미 그 규칙이고, 근거만 다른 값을 남기고 있었습니다.
   */
  it('**근거도 나간 그대로 남긴다** — `label` 이 빠지면 재진입이 깨집니다', async () => {
    const one = chatHarness()
    const body = await runTurn(one)

    expect(one.written[0]?.citations).toEqual(body.citations)

    const kept = one.written[0]?.citations as readonly { label?: string }[]
    expect(kept[0]?.label).toBe('피해구제 신청서 제출')
  })
})

describe('턴 번호를 표가 센다 — 22번째 턴부터 죽던 자리 (§9 `uk_case_turn`)', () => {
  it('흐름이 순번을 넘기지 않는다 — **잘린 맥락의 길이로 세던 자리**', async () => {
    // `history()` 는 20턴(40줄)에서 자릅니다. 그 길이로 세면 21번째 턴부터
    // 번호가 41 에 고정되고, 22번째 INSERT 가 중복으로 터져 **그 사건의 챗이
    // 영영 안 열립니다**
    const forty = Array.from({ length: 40 }, (_, index) => ({
      speaker: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `줄 ${index}`,
    }))
    const one = chatHarness({ history: forty })

    await runTurn(one)

    expect(one.written).toHaveLength(1)
    expect(Object.keys(one.written[0]!)).not.toContain('turnNo')
  })

  it('저장소가 **표에 물어** 다음 순번을 만든다', async () => {
    const seen: { text: string; params: readonly unknown[] }[] = []
    const fake = Object.assign(
      (strings: TemplateStringsArray, ...params: unknown[]) => {
        seen.push({ text: strings.join('?'), params })
        return Promise.resolve([])
      },
      { json: (value: unknown) => value },
    )

    await createMessageStore(fake as unknown as Sql, () => '01JUSERROW0000000000000000').write({
      messageId: '01JASSIST00000000000000000',
      caseId: CASE_ID,
      role: 'assistant',
      contentMasked: '답',
      promptMasked: '프롬프트',
      reasoningMasked: null,
      citations: [],
      kbContextRefs: [],
      insufficient: false,
      referencedSteps: [],
      referencedDeadlines: [],
      utteranceMasked: '발화',
    })

    expect(seen).toHaveLength(1)
    // **두 줄이 같은 셈을 씁니다** — 사용자와 비서가 한 턴입니다
    expect(seen[0]!.text.match(/MAX\(turn_no\)/g)).toHaveLength(2)
    // 번호가 밖에서 들어오지 않습니다 — 숫자로 실려 오는 값이 하나도 없습니다
    expect(seen[0]!.params.some((param) => typeof param === 'number')).toBe(false)
  })
})

describe('모델 호출이 감사에 남는다 — 11-chat-context.md §7.2 · 09 §10.2', () => {
  /**
   * **한 줄도 안 남고 있었습니다.** `audit-logger` 는 다 서 있고 컨테이너에도
   * 붙어 있는데, 이 제품의 유일한 외부 모델 호출 경로가 감사 없이 지나갔습니다
   * — 04-pii-boundary.md 「감사」가 *"모든 LLM 호출을 기록"* 한다고 정했습니다.
   */
  it('맥락 조립과 모델 호출이 각각 한 줄씩', async () => {
    const one = chatHarness()
    await runTurn(one)

    expect(one.audits.map((row) => row.eventType)).toEqual([
      'chat.context_built',
      'llm.called',
    ])
  })

  it('**모델이 스스로 밝힌 이름과 토큰 수**를 남긴다 — §10.2', async () => {
    // 정본이 `{"model":…,"token_in":…}` 로 정한 자리입니다. 값은 `lib/llm.ts` 가
    // 응답 본문의 `model`·`usage` 를 읽어 `ModelReply.call` 로 실어 옵니다
    const one = chatHarness({
      turn: turnOf({
        reply: {
          insufficient: false,
          citations: [{ ref: 'kb-1', why: '다음 단계를 안내하는 데 썼습니다' }],
          reply: '다음은 피해구제 신청서 제출입니다.',
          call: { model: 'grok-4.5', tokenIn: 1200, tokenOut: 300 },
        },
      }),
    })
    await runTurn(one)

    const llm = one.audits.find((row) => row.eventType === 'llm.called')
    expect(llm?.detail).toEqual({
      attempts: 1,
      model: 'grok-4.5',
      token_in: 1200,
      token_out: 300,
    })
  })

  it('제공자가 안 밝히면 **그 칸을 비운다** — 지어내지 않습니다', async () => {
    // 환경변수의 모델 이름을 대신 쓰면 **실제로 답한 것과 다를 수 있어** 감사
    // 기록이 거짓이 됩니다. 후보를 차례로 시도하는 구조라 특히 그렇습니다
    const one = chatHarness()
    await runTurn(one)

    const llm = one.audits.find((row) => row.eventType === 'llm.called')
    expect(llm?.detail).toEqual({ attempts: 1 })
  })


  it('**건수와 릴리스만** 담는다 — 식별자도 본문도 안 넣습니다 (§10.1)', async () => {
    const one = chatHarness()
    await runTurn(one)

    expect(one.audits[0]?.detail).toEqual({
      applied: 5,
      reference: 7,
      kb_version: KB_VERSION,
      transcript_lines: 42,
    })
  })

  it('부른 횟수가 남는다 — 재시도한 턴과 한 번에 끝난 턴이 구별됩니다', async () => {
    const one = chatHarness({ turn: turnOf({ attempts: 2 }) })
    await runTurn(one)

    expect(one.audits[1]?.detail).toEqual({ attempts: 2 })
    // 모델이 답한 줄이라 행위자가 `model` 입니다 → §10 `actor_type`
    expect(one.audits[1]?.actorType).toBe('model')
  })

  /**
   * ⚠️ **챗 응답의 계측 헤더 넷이 전부 「없음」이었습니다** (2026-09-03).
   *
   * §1.1 이 그 넷을 두는 이유는 *"개인정보 보호가 작동한다는 것을 응답 자체가
   * 증명해야 한다"* 입니다. 그런데 **이 제품의 유일한 외부 모델 호출인 챗**만
   * 그 넷을 아무도 안 채워서, 가장 증명이 필요한 자리가 언제나 비어 있었습니다.
   *
   * 특히 `X-Pii-Egress-Residual` 은 안 채우면 기본값 `0` 이 나가는데, 그것은
   * **「검사했고 0 건」과 「검사를 안 했음」이 같은 값**이라는 뜻입니다.
   */
  it('계측 넷을 채워 돌려준다 — 헤더가 이 값으로 섭니다', async () => {
    const one = chatHarness()
    const got = await chatTurn({ caseId: CASE_ID, content: '이제 뭘 하죠' }, one.container)

    // 발화를 토큰화한 건수 — 「없음」이 아니라 실제 건수
    expect(got.telemetry.piiTokenCounts).toEqual({ account: 1 })
    // `publish` 를 지났다는 것이 곧 「검사했고 0 건」입니다
    expect(got.telemetry.piiEgressResidual).toBe(0)
    expect(got.telemetry.kbVersion).toBe(KB_VERSION)
    // 감사 기록이 실제로 남은 줄의 번호여야 합니다 — 지어낸 값이 아니라
    expect(got.telemetry.auditId).toBe(one.audits[0]?.auditId)
  })

  /**
   * ⚠️ **인용 검증에 걸린 턴이 감사에서 통째로 빠졌습니다** (2026-09-03).
   *
   * 모델이 발급하지 않은 ref 를 인용하면 한 번 더 물어보고, 그것도 어기면
   * `KbCitationMissingError` 가 나갑니다. 그 예외가 `llm.called` 를 건너뛰어
   * **모델을 한두 번 부른 사실이 어디에도 안 남았습니다** — 하필 모델이
   * 불변 규칙 1 을 어기려 한 턴, 즉 가장 세어야 할 턴입니다.
   */
  it('인용 검증에 걸려 터져도 부른 사실은 남는다', async () => {
    const one = chatHarness({
      throws: new KbCitationMissingError('인용 형식을 어겼습니다', {
        attempts: 2,
        violations: [{ ref: 'kb-9' }, { ref: 'kb-8' }],
      }),
    })

    await expect(runTurn(one)).rejects.toThrow(KbCitationMissingError)

    expect(one.audits.map((row) => row.eventType)).toEqual(['llm.called'])
    expect(one.audits[0]?.detail).toEqual({
      attempts: 2,
      failed: 'citation_invalid',
      // **건수만입니다** — 모델이 지어낸 ref 문자열은 안 담습니다
      violations: 2,
    })
  })

  it('**부르기 전에 터진 턴은 안 남는다** — 없는 호출을 세지 않습니다', async () => {
    const one = chatHarness({ throws: new KbUnavailableError('조회에 실패했습니다') })

    await expect(runTurn(one)).rejects.toThrow(KbUnavailableError)

    expect(one.audits).toHaveLength(0)
  })

  it('사슬로 이어진다 — 뒷줄의 앞 해시가 앞줄의 해시', async () => {
    const one = chatHarness()
    await runTurn(one)

    // **길이를 먼저 못 박습니다** — 아무것도 안 남았을 때 `undefined` 끼리
    // 같아져서, 이 시험만으로는 「기록이 없음」이 통과합니다
    expect(one.audits).toHaveLength(2)
    expect(one.audits[1]?.prevHash).toBe(one.audits[0]?.hash)
    expect(verifyChain([...one.audits]).intact).toBe(true)
  })

  it('되묻기 턴도 남는다 — 답이 안 나가도 **모델은 불렸습니다**', async () => {
    const one = chatHarness({
      turn: turnOf({
        outcome: { kind: 'ask_slot' },
        reply: { insufficient: true, citations: [] },
      }),
    })
    await runTurn(one)

    expect(one.audits.map((row) => row.eventType)).toContain('llm.called')
  })

  it('사건 식별자로 함께 찾힌다 — `idx_audit_case_time` 이 그 줄입니다', async () => {
    const one = chatHarness()
    await runTurn(one)

    expect(one.audits).toHaveLength(2)
    expect(one.audits.every((row) => row.caseId === CASE_ID)).toBe(true)
  })
})

/**
 * 이름표 번호는 **사건 하나**를 단위로 합니다 → 04-pii-boundary.md 「번호의 단위」.
 *
 * 모으는 것이 이 흐름의 일입니다 — `chat-receiver` 는 저장소를 안 봅니다(ADR-022).
 * 안 모으면 서버 2차가 발화마다 1번부터 붙여, 브라우저가 볼트에 맡긴
 * `[계좌-1]` 자리에 **다른 계좌가 겹쳐 앉습니다.**
 */
describe('쓰인 이름표를 모아 넘긴다 — 04-pii-boundary.md 「번호의 단위」', () => {
  it('볼트와 전사문의 이름표가 함께 간다', async () => {
    const one = chatHarness({
      vaultTokens: ['[계좌-1]'],
      // 서버가 앞서 붙인 이름표는 **볼트에 없습니다** — 봉할 키가 서버에 없어서
      transcript: [{ speaker: 'A', text: '[이름-1] 이라고 했어요' }],
    })

    await runTurn(one)

    expect(one.received[0].issuedTokens?.map((token) => token.token)).toEqual([
      '[계좌-1]',
      '[이름-1]',
    ])
  })

  /** **회귀** — 새 사건은 장부가 비어 있고, 그때가 1번부터입니다 */
  it('아무것도 없으면 빈 장부가 간다 — 던지지 않는다', async () => {
    const one = chatHarness()

    await runTurn(one)

    expect(one.received[0].issuedTokens).toEqual([])
  })
})

/**
 * ⚠️ **프롬프트의 슬롯 라벨이 내부 키 그대로였습니다** (2026-09-03).
 *
 * 시스템 지시문이 「`org_name`·`freeze_requested_at` … 을 `reply` 에 한 글자도
 * 쓰지 말라」고 하면서, 같은 프롬프트의 `case_state` 가 그 낱말을 라벨로 먹이고
 * 있었습니다. 슬롯 열다섯 전부 **사람 말**로 나가는지 하나씩 봅니다 —
 * 정본은 데이터 모델 §5.1 의 「뜻」 칸입니다.
 */
describe('프롬프트의 슬롯 라벨은 사람 말이다', () => {
  const KEYS = [
    'transferred', 'channel', 'org_name', 'amount', 'amount_hint',
    'occurred_at', 'elapsed_hint', 'contact_method', 'counterpart_account',
    'impersonated_org', 'freeze_requested_at', 'relief_applied_at',
    'report_filed_at', 'objection_submitted_at', 'notice_started_at',
  ]

  it('내부 키가 라벨로 새지 않는다 — 열다섯 전부', async () => {
    const one = chatHarness({
      slots: KEYS.map((slotKey) => ({ slotKey, state: 'confirmed', valueMasked: '값' })),
    })
    await runTurn(one)

    const got = one.received[0] as unknown as {
      caseContext?: { caseState?: readonly { label: string }[] }
    }
    const labels = (got.caseContext?.caseState ?? []).map((s) => s.label)
    for (const key of KEYS) {
      expect(labels).not.toContain(key)
    }
    expect(labels).toContain('기관명')
    expect(labels).toContain('지급정지 요청 시각')
  })
})

describe('답이 가리킨 단계·기한을 이력에도 남긴다 — §3.12 · 09 §9.4 · ADR-065 (GitHub #41)', () => {
  /**
   * §3.9 는 `referenced_steps` 를 내보내는데 이력(§3.12)에는 그 칸이 없어서,
   * 화면이 `referencedSteps: []` 를 하드코딩했고 **새로고침 뒤에는 같은 대화인데
   * 챗↔단계 연결이 사라졌습니다.** 내릴 값이 저장되지 않아서였습니다.
   *
   * `citations` 에서 되짚을 수 없습니다 — `case-N` 은 이 턴에서만 유효한 번호입니다.
   */
  const POINTING = turnOf({
    reply: {
      insufficient: false,
      citations: [
        { ref: 'kb-1', why: '다음 단계를 안내하는 데 썼습니다' },
        { ref: 'case-1', why: '지급정지 단계를 가리키는 데 썼습니다' },
        { ref: 'case-2', why: '8월 20일을 문장에 옮기는 데 썼습니다' },
      ],
      reply: '다음은 피해구제 신청서 제출입니다. 8월 20일까지입니다.',
    },
    issued: [
      {
        ref: 'kb-1',
        label: '피해구제 신청서 제출',
        kbEntryId: 'relief-application',
        kbVersion: KB_VERSION,
      },
      { ref: 'case-1', label: '지급정지를 요청합니다', stepId: '01JFREEZE' },
      { ref: 'case-2', label: '피해구제 신청 기한', deadlineId: '01JDUE' },
    ],
  })

  it('라우트가 내보내는 것과 **같은 값**이 저장된다', async () => {
    const one = chatHarness({ turn: POINTING })
    const got = await chatTurn({ caseId: CASE_ID, content: '이제 뭘 하죠' }, one.container)

    expect(got.referencedSteps).toEqual(['01JFREEZE'])
    expect(got.referencedDeadlines).toEqual(['01JDUE'])
    // 한 번 세서 둘에 씁니다 — 따로 세면 라이브와 새로고침 뒤가 갈립니다
    expect(one.written[0]?.referencedSteps).toEqual(got.referencedSteps)
    expect(one.written[0]?.referencedDeadlines).toEqual(got.referencedDeadlines)
  })

  it('가리킨 것이 없으면 **빈 배열**을 남긴다 — `undefined` 가 아니다', async () => {
    const one = chatHarness()
    await runTurn(one)

    expect(one.written[0]?.referencedSteps).toEqual([])
    expect(one.written[0]?.referencedDeadlines).toEqual([])
  })

  it('저장소가 두 배열을 **비서 줄에만** 싣는다 — §9.4', async () => {
    const seen: { text: string; params: readonly unknown[] }[] = []
    const fake = Object.assign(
      (strings: TemplateStringsArray, ...params: unknown[]) => {
        seen.push({ text: strings.join('?'), params })
        return Promise.resolve([])
      },
      { json: (value: unknown) => value },
    )

    await createMessageStore(fake as unknown as Sql, () => '01JUSERROW0000000000000000').write({
      messageId: '01JASSIST00000000000000000',
      caseId: CASE_ID,
      role: 'assistant',
      contentMasked: '답',
      promptMasked: '프롬프트',
      reasoningMasked: null,
      citations: [],
      kbContextRefs: [],
      insufficient: false,
      referencedSteps: ['01JFREEZE'],
      referencedDeadlines: ['01JDUE'],
      utteranceMasked: '발화',
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.text).toContain('referenced_steps')
    expect(seen[0]!.text).toContain('referenced_deadlines')
    // 각 배열이 **한 번만** 실립니다 — 사용자 줄은 NULL 이라 값이 안 갑니다
    const arrays = seen[0]!.params.filter((param): param is string[] => Array.isArray(param))
    expect(arrays.filter((one) => one.includes('01JFREEZE'))).toHaveLength(1)
    expect(arrays.filter((one) => one.includes('01JDUE'))).toHaveLength(1)
  })
})
