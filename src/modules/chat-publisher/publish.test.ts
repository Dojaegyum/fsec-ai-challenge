/**
 * chat-publisher 시험.
 *
 * 검증 대상은 spec/common/08-14-api.md §3.9 · §5.4,
 * spec/backend/08-16-errors.md §4.1 · 원칙 1·2, ADR-022 결정 둘입니다.
 */

import { describe, expect, it } from 'vitest'

import { EgressBlockedError } from '@/lib/errors'

import type { NextQuestion, ResidualPiiScanner } from './types'
import { createChatPublisher } from './publish'

/** 아무것도 못 찾는 검사기 — 정상 경로용 */
const clean: ResidualPiiScanner = { scan: () => ({}) }

const publisher = createChatPublisher({ residualPii: clean })

const QUESTION: NextQuestion = {
  slot_key: 'channel',
  text: '어떤 방법으로 보내셨나요?',
  input: 'buttons',
  options: ['은행 계좌이체', '모름·기억 안 남'],
}

describe('세 갈래가 같은 껍데기로 나간다', () => {
  it('정상 답변', () => {
    const body = publisher.publish({
      kind: 'answer',
      messageId: '01J8XKRE',
      reply: '다음은 피해구제 신청서 제출입니다.',
      citations: [{ ref: 'kb-2', why: '다음 단계를 안내하는 데 썼습니다' }],
    })

    expect(body).toEqual({
      message_id: '01J8XKRE',
      reply: '다음은 피해구제 신청서 제출입니다.',
      citations: [{ ref: 'kb-2', why: '다음 단계를 안내하는 데 썼습니다' }],
      next_question: null,
    })
  })

  it('KB 조회 0건 — 절차를 말하지 않고 1332 를 안내한다', () => {
    const body = publisher.publish({ kind: 'guide_1332', messageId: '01J8XKRF' })

    expect(body.kb_result).toBe('empty')
    expect(body.citations).toEqual([])
    expect(body.next_question).toBeNull()
    // 문구의 정본은 08-16-errors.md §4.1
    expect(body.reply).toContain('1332')
  })

  it('근거를 못 찾음 — 질문 한 문항이 나간다', () => {
    const body = publisher.publish({
      kind: 'ask_slot',
      messageId: '01J8XKRG',
      nextQuestion: QUESTION,
    })

    expect(body.next_question).toEqual(QUESTION)
    expect(body.citations).toEqual([])
    expect(body.kb_result).toBeUndefined()
  })

  it('어느 갈래든 화면이 볼 키가 같다', () => {
    // 화면이 갈래를 분기하지 않게 하는 것이 이 모듈의 존재 이유다 → ADR-022
    const bodies = [
      publisher.publish({
        kind: 'answer',
        messageId: 'a',
        reply: '답변',
        citations: [],
      }),
      publisher.publish({ kind: 'guide_1332', messageId: 'b' }),
      publisher.publish({ kind: 'ask_slot', messageId: 'c', nextQuestion: QUESTION }),
    ]

    for (const body of bodies) {
      expect(body).toHaveProperty('message_id')
      expect(body).toHaveProperty('reply')
      expect(body).toHaveProperty('citations')
      expect(body).toHaveProperty('next_question')
    }
  })

  it('답변과 질문이 함께 나갈 수도 있다', () => {
    const body = publisher.publish({
      kind: 'answer',
      messageId: '01J8XKRE',
      reply: '지급정지부터 하세요.',
      citations: [{ ref: 'kb-1', why: '요청처를 안내하는 데 썼습니다' }],
      nextQuestion: QUESTION,
    })

    expect(body.next_question).toEqual(QUESTION)
  })
})

describe('판단 근거는 응답에 실릴 수 없다', () => {
  it('응답 본문에 reasoning 이 없다', () => {
    // §5.4 — 판단 근거에는 인용 강제가 걸리지 않아, 새면 검증받지 않은 문장이 화면에 뜬다
    const body = publisher.publish({
      kind: 'answer',
      messageId: '01J8XKRE',
      reply: '답변',
      citations: [],
    })

    expect(Object.keys(body)).toEqual([
      'message_id',
      'reply',
      'citations',
      'next_question',
    ])
  })

  it('입력에 없는 값은 응답에 옮겨지지 않는다', () => {
    // 화이트리스트가 아니라 아예 받는 자리가 없다. 담을 수 없으니 샐 수 없다
    const body = publisher.publish({
      kind: 'answer',
      messageId: '01J8XKRE',
      reply: '답변',
      citations: [],
      // @ts-expect-error 판단 근거를 받는 자리가 계약에 없다
      reasoning: '이 사용자는 아직 신고를 안 한 것으로 보임',
    })

    expect(body).not.toHaveProperty('reasoning')
  })
})

describe('잔여 개인정보가 있으면 내보내지 않는다', () => {
  const dirty: ResidualPiiScanner = {
    scan: (text): Record<string, number> =>
      text.includes('900101-1234567') ? { resident_id: 1 } : {},
  }
  const guarded = createChatPublisher({ residualPii: dirty })

  it('발견되면 EGRESS_BLOCKED 로 중단한다', () => {
    // 통과시키고 로그만 남기는 경로를 만들지 않는다 → 08-16-errors.md 원칙 1
    expect(() =>
      guarded.publish({
        kind: 'answer',
        messageId: '01J8XKRE',
        reply: '주민번호는 900101-1234567 입니다',
        citations: [],
      }),
    ).toThrow(EgressBlockedError)
  })

  it('422 로 나간다', () => {
    try {
      guarded.publish({
        kind: 'answer',
        messageId: '01J8XKRE',
        reply: '900101-1234567',
        citations: [],
      })
      throw new Error('중단됐어야 합니다')
    } catch (error) {
      expect(error).toBeInstanceOf(EgressBlockedError)
      expect((error as EgressBlockedError).httpStatus).toBe(422)
      expect((error as EgressBlockedError).retryable).toBe(false)
    }
  })

  it('건수만 담고 값은 담지 않는다', () => {
    // 무엇이 남았는지 값으로 알려주지 않는다 → 08-16-errors.md 원칙 2
    try {
      guarded.publish({
        kind: 'answer',
        messageId: '01J8XKRE',
        reply: '900101-1234567',
        citations: [],
      })
      throw new Error('중단됐어야 합니다')
    } catch (error) {
      const detail = (error as EgressBlockedError).detail
      expect(detail).toEqual({ counts: { resident_id: 1 } })
      expect(JSON.stringify(detail)).not.toContain('900101')
    }
  })

  it('인용의 why 에 남은 것도 잡는다', () => {
    // 화면에 나갈 수 있는 문자열은 전부 검사 대상이다
    expect(() =>
      guarded.publish({
        kind: 'answer',
        messageId: '01J8XKRE',
        reply: '괜찮은 답변',
        citations: [{ ref: 'case-1', why: '900101-1234567 을 옮기는 데 썼습니다' }],
      }),
    ).toThrow(EgressBlockedError)
  })

  it('질문 문구에 남은 것도 잡는다', () => {
    expect(() =>
      guarded.publish({
        kind: 'ask_slot',
        messageId: '01J8XKRG',
        nextQuestion: { ...QUESTION, text: '900101-1234567 맞나요?' },
      }),
    ).toThrow(EgressBlockedError)
  })

  it('깨끗하면 그대로 내보낸다', () => {
    expect(() =>
      guarded.publish({
        kind: 'answer',
        messageId: '01J8XKRE',
        reply: '[주민번호-1] 은 서류에서 확인하실 수 있습니다',
        citations: [],
      }),
    ).not.toThrow()
  })
})
