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

import { stepsCited } from '@/flows/chat-turn'

import { createAuditLogger } from '@/modules/audit-logger'
import type { AuditRecord, AuditStore } from '@/modules/audit-logger'
import { createChatPublisher } from '@/modules/chat-publisher'
import { createChatReceiver } from '@/modules/chat-receiver'
import type { KbEntry } from '@/modules/chat-receiver'
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

    // 6. 브라우저: 부분 복원
    //    **이음매: 마스킹이 만든 매핑을 복원이 그대로 받는다** — 필요한 칸이 같다
    const shown = restore(`${body.reply} [계좌-1]`, masked.mappings, {
      site: 'chat-answer',
    })
    expect(shown).toContain('7890')
    expect(shown).not.toContain('110-234-567890')
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
      async lastHash() {
        return rows.length > 0 ? rows[rows.length - 1].hash : null
      },
      async append(record) {
        rows.push(record)
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
        async lastHash() {
          return null
        },
        async append(record) {
          rows.push(record)
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
      tokenizer: { tokenize: async (text) => ({ masked: text }) },
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

    // 3. 브라우저에서 복원
    const shown = restore(`${body.reply} [계좌-1]`, masked.mappings, {
      site: 'chat-answer',
    })
    expect(shown).toContain('7890')
    expect(shown).not.toContain('110-234-567890')
  })

  it('조회가 0건이면 절차를 말하지 않고 1332 안내로 간다', async () => {
    const kbFinder = createKbFinder({
      store: { findApplied: async () => [], findReference: async () => [] },
    })

    const chat = createChatReceiver({
      tokenizer: { tokenize: async (text) => ({ masked: text }) },
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
