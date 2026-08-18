/**
 * 층 2 한 턴을 실제로 이어 보는 시험 — 모듈끼리 맞물리는지 확인한다.
 *
 * 각 모듈은 자기 시험을 따로 갖고 있다. 이 파일은 **그 사이의 이음매**만 본다 —
 * 한쪽이 내놓는 것을 다른 쪽이 받을 수 있는지, 변환이 필요한 자리가 어디인지.
 *
 * 정본 흐름: spec/backend/08-16-chat-context.md §1 · ARCHITECTURE.md §4 층 2
 *
 *   pii-masker → prompt-builder → [ 모델 ] → citation-checker
 *     → chat-publisher → pii-restorer
 *
 * 아직 없는 자리(pii-tokenizer · kb-finder · chat-receiver)는 이 시험에서 건너뛴다.
 */

import { describe, expect, it } from 'vitest'

import { createAuditLogger } from '@/modules/audit-logger'
import type { AuditRecord, AuditStore } from '@/modules/audit-logger'
import { createChatPublisher } from '@/modules/chat-publisher'
import { createCitationChecker } from '@/modules/citation-checker'
import { createPiiMasker } from '@/modules/pii-masker'
import { createPiiRestorer } from '@/modules/pii-restorer'
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
    const masker = createPiiMasker()
    const masked = masker.mask('110-234-567890 으로 보냈어요. 이제 뭘 하죠')

    expect(masked.text).toContain('[계좌-1]')
    expect(masked.mappings).toHaveLength(1)

    // 2. 서버: 프롬프트 조립
    const builder = createPromptBuilder()
    const prompt = builder.build({
      kbApplied: KB_APPLIED,
      kbReference: [],
      caseTalk: [],
      caseState: [{ label: '피해구제 신청 기한', value: '2026년 8월 20일' }],
      history: [{ speaker: 'user', text: masked.text }],
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
    const restorer = createPiiRestorer({
      mappings: {
        lookup: (token) => masked.mappings.find((one) => one.token === token),
      },
      audit: { denied: () => {} },
    })

    const shown = restorer.restore(`${body.reply} [계좌-1]`, 'chat_reply')
    expect(shown).toContain('****7890')
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
