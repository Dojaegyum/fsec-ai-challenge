/**
 * slot-checker 시험.
 *
 * 검증 대상은 spec/backend/08-14-slot-tiering.md 와
 * spec/common/08-14-api.md §3.4 입니다.
 *
 * 가장 중요한 것: **어떤 입력에도 예외를 던지지 않고, 사용자를 막지 않습니다.**
 */

import { describe, expect, it } from 'vitest'

import type { QuestionSource, SlotKey, SlotSnapshot } from './types'
import { createSlotChecker } from './check'

/** 문진 대상 다섯에만 문구를 주는 최소 구현 */
const questions: QuestionSource = {
  formFor(slotKey: SlotKey) {
    switch (slotKey) {
      case 'transferred':
        return { input: 'buttons', text: '돈을 보내셨나요?', options: ['보냈어요', '아니요'] }
      case 'channel':
        return {
          input: 'buttons',
          text: '어떤 방법으로 보내셨나요?',
          options: ['은행 계좌이체', '간편송금'],
        }
      case 'org_name':
        return { input: 'text', text: '어느 기관인가요?' }
      case 'amount':
        return { input: 'amount', text: '얼마를 보내셨나요?' }
      case 'amount_hint':
        return { input: 'buttons', text: '대략 어느 정도였나요?', options: ['100만원 미만'] }
      case 'occurred_at':
        return { input: 'date', text: '언제 보내셨나요?' }
      default:
        return undefined
    }
  },
}

const checker = createSlotChecker({ questions })

function slot(slotKey: SlotKey, state: SlotSnapshot['state'], tier: 'T1' | 'T2' = 'T1'): SlotSnapshot {
  return { slotKey, tier, state }
}

describe('T1 충족 판정', () => {
  it('둘 다 확인됐으면 satisfied 이고 슈퍼셋이 필요 없다', () => {
    const result = checker.check({
      slots: [slot('transferred', 'confirmed'), slot('channel', 'confirmed')],
    })
    expect(result.t1).toBe('satisfied')
    expect(result.needsSupersetPlan).toBe(false)
  })

  it('자동 추출된 값도 채워진 것으로 센다', () => {
    // 흐름이 「자동 추출 → T1 충족?」 순서다 → 08-14-slot-tiering.md
    const result = checker.check({
      slots: [slot('transferred', 'extracted'), slot('channel', 'extracted')],
    })
    expect(result.t1).toBe('satisfied')
  })

  it('하나만 채워졌으면 partial 이다', () => {
    const result = checker.check({
      slots: [slot('transferred', 'confirmed'), slot('channel', 'empty')],
    })
    expect(result.t1).toBe('partial')
    expect(result.needsSupersetPlan).toBe(true)
  })

  it('슬롯 목록이 비어 있으면 unsatisfied 다', () => {
    // 사건을 막 만든 직후가 이 상태다. 목록에 없는 슬롯은 empty 로 본다
    const result = checker.check({ slots: [] })
    expect(result.t1).toBe('unsatisfied')
    expect(result.needsSupersetPlan).toBe(true)
  })

  it('「모름」은 채워진 것이 아니다 — 슈퍼셋으로 간다', () => {
    // 실패가 아니라 정상 상태다. 다만 유형별 플랜을 고를 수는 없다
    const result = checker.check({
      slots: [slot('transferred', 'confirmed'), slot('channel', 'unknown')],
    })
    expect(result.t1).toBe('partial')
    expect(result.needsSupersetPlan).toBe(true)
  })
})

describe('질문은 한 번에 하나, T1 부터', () => {
  it('아무것도 없으면 송금 여부부터 묻는다', () => {
    const result = checker.check({ slots: [] })
    expect(result.nextQuestion?.slotKey).toBe('transferred')
  })

  it('송금 여부가 채워졌으면 송금 수단을 묻는다', () => {
    const result = checker.check({ slots: [slot('transferred', 'confirmed')] })
    expect(result.nextQuestion?.slotKey).toBe('channel')
  })

  it('T1 이 다 차야 T2 를 묻는다', () => {
    // 플랜을 가장 크게 바꾸는 슬롯부터다 → 최소 질문 원칙
    const result = checker.check({
      slots: [slot('transferred', 'confirmed'), slot('channel', 'confirmed')],
    })
    expect(result.nextQuestion?.slotKey).toBe('org_name')
  })

  it('T2 안에서는 기관명 · 금액 · 시각 순이다', () => {
    const base = [slot('transferred', 'confirmed'), slot('channel', 'confirmed')]

    expect(
      checker.check({ slots: [...base, slot('org_name', 'confirmed', 'T2')] })
        .nextQuestion?.slotKey,
    ).toBe('amount')

    expect(
      checker.check({
        slots: [
          ...base,
          slot('org_name', 'confirmed', 'T2'),
          slot('amount', 'confirmed', 'T2'),
        ],
      }).nextQuestion?.slotKey,
    ).toBe('occurred_at')
  })

  it('금액 구간은 정확한 액수를 「모름」으로 답했을 때만 묻는다', () => {
    // 짝을 이루는 슬롯입니다 → 08-16-data-model.md §5.1.
    // **아는 것을 두 번 묻지 않습니다** — 숫자를 받았거나 이체내역에서 뽑았으면
    // 구간은 물을 이유가 없습니다
    const base = [
      slot('transferred', 'confirmed'),
      slot('channel', 'confirmed'),
      slot('org_name', 'confirmed', 'T2'),
    ]

    expect(
      checker.check({ slots: [...base, slot('amount', 'unknown', 'T2')] })
        .nextQuestion?.slotKey,
    ).toBe('amount_hint')

    expect(
      checker.check({ slots: [...base, slot('amount', 'confirmed', 'T2')] })
        .nextQuestion?.slotKey,
    ).toBe('occurred_at')

    expect(
      checker.check({ slots: [...base, slot('amount', 'extracted', 'T2')] })
        .nextQuestion?.slotKey,
    ).toBe('occurred_at')
  })

  it('정확한 액수를 아직 묻지도 않았으면 구간이 먼저 나오지 않는다', () => {
    const result = checker.check({
      slots: [
        slot('transferred', 'confirmed'),
        slot('channel', 'confirmed'),
        slot('org_name', 'confirmed', 'T2'),
      ],
    })

    expect(result.nextQuestion?.slotKey).toBe('amount')
  })

  it('「모름」으로 답한 슬롯은 다시 묻지 않는다', () => {
    const result = checker.check({
      slots: [slot('transferred', 'unknown'), slot('channel', 'confirmed')],
    })
    expect(result.nextQuestion?.slotKey).not.toBe('transferred')
  })

  it('자동 추출된 슬롯도 다시 묻지 않는다', () => {
    // 질문 대상은 empty 뿐이다 → 08-14-api.md §3.4 예시
    const result = checker.check({
      slots: [slot('transferred', 'extracted'), slot('channel', 'extracted')],
    })
    expect(result.nextQuestion?.slotKey).toBe('org_name')
  })

  it('문구가 없는 슬롯은 건너뛴다', () => {
    // QuestionSource 가 문구를 주지 않으면 물을 수 없다.
    // elapsed_hint · contact_method 에는 문구가 없으므로 여기서 멈춘다
    const result = checker.check({
      slots: [
        slot('transferred', 'confirmed'),
        slot('channel', 'confirmed'),
        slot('org_name', 'confirmed', 'T2'),
        slot('amount', 'confirmed', 'T2'),
        slot('occurred_at', 'confirmed', 'T2'),
      ],
    })
    expect(result.nextQuestion).toBeNull()
  })

  it('물을 것이 없어도 예외를 던지지 않는다', () => {
    // 실행 보드는 next_question 이 null 이어도 열린다
    expect(() => checker.check({ slots: [] })).not.toThrow()
    const result = checker.check({
      slots: [
        slot('transferred', 'unknown'),
        slot('channel', 'unknown'),
        slot('org_name', 'unknown', 'T2'),
        slot('amount', 'unknown', 'T2'),
        // 금액을 「모름」으로 답하면 구간이 대신 나오므로, 그것까지 「모름」이어야
        // 비로소 물을 것이 없습니다 → 08-16-data-model.md §5.1
        slot('amount_hint', 'unknown', 'T2'),
        slot('occurred_at', 'unknown', 'T2'),
      ],
    })
    expect(result.nextQuestion).toBeNull()
    expect(result.needsSupersetPlan).toBe(true)
  })
})

describe('「모름」 선택지는 항상 들어간다', () => {
  it('버튼 질문에 「모름」이 없으면 붙여 준다', () => {
    // 없으면 스펙 위반이다 → 08-14-api.md §3.4.
    // 문구를 주는 쪽이 빠뜨려도 여기서 채워 구조적으로 위반이 안 되게 한다
    const result = checker.check({ slots: [] })
    expect(result.nextQuestion?.options).toEqual([
      '보냈어요',
      '아니요',
      '모름·기억 안 남',
    ])
  })

  it('이미 있으면 중복해 붙이지 않는다', () => {
    const withUnknown: QuestionSource = {
      formFor: () => ({
        input: 'buttons',
        text: '돈을 보내셨나요?',
        options: ['보냈어요', '모름·기억 안 남'],
      }),
    }
    const result = createSlotChecker({ questions: withUnknown }).check({ slots: [] })
    expect(result.nextQuestion?.options).toEqual(['보냈어요', '모름·기억 안 남'])
  })

  it('버튼이 아닌 질문에는 선택지를 만들지 않는다', () => {
    const result = checker.check({
      slots: [slot('transferred', 'confirmed'), slot('channel', 'confirmed')],
    })
    expect(result.nextQuestion?.input).toBe('text')
    expect(result.nextQuestion?.options).toBeUndefined()
  })
})

describe('T2 상태도 함께 알려준다', () => {
  it('아무것도 없으면 unsatisfied', () => {
    expect(checker.check({ slots: [] }).t2).toBe('unsatisfied')
  })

  it('일부만 채워졌으면 partial', () => {
    const result = checker.check({
      slots: [slot('org_name', 'confirmed', 'T2')],
    })
    expect(result.t2).toBe('partial')
  })
})
