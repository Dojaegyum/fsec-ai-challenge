/**
 * completion-checker 시험.
 *
 * 검증 대상은 spec/backend/08-14-completion-hook.md 의 검증 3단계와
 * spec/backend/08-16-data-model.md §7 의 레벨 대응입니다.
 *
 * 가장 중요한 것: **L3 만으로 done_verified 가 되는 경로가 없어야 합니다.**
 * 그 경로가 생기면 이 기능의 존재 이유가 사라집니다.
 */

import { describe, expect, it } from 'vitest'

import type { ReceiptNumberFormat } from './types'
import { createCompletionChecker } from './verify'

/** 형식을 아는 기관 — 2026-1234567 꼴만 받는다 */
const knownFormat: ReceiptNumberFormat = {
  matches: (value) => /^\d{4}-\d{7}$/.test(value),
}

/** 형식을 모르는 기관 */
const unknownFormat: ReceiptNumberFormat = { matches: () => undefined }

const checker = createCompletionChecker({ receiptFormat: knownFormat })

describe('L1 — 접수번호를 직접 입력', () => {
  it('형식이 맞으면 완료로 판정한다', () => {
    expect(
      checker.verify({ submission: { kind: 'receipt_no', value: '2026-1234567' } }),
    ).toEqual({
      verifyLevel: 'L1',
      verifyResult: 'passed',
      stepState: 'done_verified',
    })
  })

  it('형식이 다르면 실패지만 길을 막지 않는다', () => {
    // L1 이 실패했다고 사용자를 막지 마세요. L2 → L3 경로가 항상 열려 있어야 합니다
    const verdict = checker.verify({
      submission: { kind: 'receipt_no', value: '12345' },
    })

    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.verifyDetail).toEqual({ reason: 'format_mismatch' })
    // 완료가 아니라 진행중이다. 되돌아가지 않는다
    expect(verdict.stepState).toBe('in_progress')
    expect(verdict.nextOptions).toEqual([
      { level: 'L2', label: '접수 문자 캡처를 올려주세요' },
      { level: 'L3', label: '번호 없이 접수했다고 표시' },
    ])
  })

  it('그 기관의 형식을 모르면 통과시키지 않는다', () => {
    // 모르는 것과 틀린 것을 구분한다. 모른다고 통과시키면
    // 아무 숫자나 넣어도 완료가 된다
    const noFormat = createCompletionChecker({ receiptFormat: unknownFormat })
    const verdict = noFormat.verify({
      submission: { kind: 'receipt_no', value: '무엇이든' },
    })

    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.verifyDetail).toEqual({ reason: 'format_unknown' })
    expect(verdict.nextOptions).toHaveLength(2)
  })

  it('빈 값도 실패다', () => {
    const verdict = checker.verify({
      submission: { kind: 'receipt_no', value: '   ' },
    })
    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.stepState).toBe('in_progress')
  })
})

describe('L2 — 캡처·서류를 올림', () => {
  it('접수 문자 캡처는 완료로 판정한다', () => {
    expect(
      checker.verify({
        submission: { kind: 'sms_capture', evidenceId: '01J8XKRB' },
      }),
    ).toEqual({
      verifyLevel: 'L2',
      verifyResult: 'passed',
      stepState: 'done_verified',
    })
  })

  it('접수증 서류도 같다', () => {
    const verdict = checker.verify({
      submission: { kind: 'receipt_doc', evidenceId: '01J8XKRC' },
    })
    expect(verdict.verifyLevel).toBe('L2')
    expect(verdict.stepState).toBe('done_verified')
  })
})

describe('L3 — 했다고만 말함', () => {
  it('완료가 아니라 미확인으로 남는다', () => {
    // L3 만으로 done_verified 가 되는 경로를 만들지 않는다.
    // 이 기능의 존재 이유가 사라진다
    expect(
      checker.verify({ submission: { kind: 'other', selfReported: true } }),
    ).toEqual({
      verifyLevel: 'L3',
      verifyResult: 'not_applicable',
      stepState: 'unconfirmed',
    })
  })

  it('실패가 아니므로 다음 선택지를 주지 않는다', () => {
    // 사용자는 할 수 있는 것을 다 했다. 더 내밀 길이 없다
    const verdict = checker.verify({
      submission: { kind: 'other', selfReported: true },
    })
    expect(verdict.verifyResult).not.toBe('failed')
    expect(verdict.nextOptions).toBeUndefined()
  })
})

describe('어떤 입력으로도 L3 가 완료가 되지 않는다', () => {
  it('자기 신고는 언제나 미확인이다', () => {
    // 이 시험이 깨지면 완수 검증이 무너진 것이다
    const cases = [
      createCompletionChecker({ receiptFormat: knownFormat }),
      createCompletionChecker({ receiptFormat: unknownFormat }),
      createCompletionChecker({ receiptFormat: { matches: () => true } }),
    ]

    for (const one of cases) {
      const verdict = one.verify({
        submission: { kind: 'other', selfReported: true },
      })
      expect(verdict.stepState).toBe('unconfirmed')
      expect(verdict.stepState).not.toBe('done_verified')
    }
  })
})

describe('검증 상세에 개인정보를 담지 않는다', () => {
  it('실패해도 입력한 값을 담지 않는다', () => {
    // verify_detail 은 PII 금지다 → 08-16-data-model.md §7
    const verdict = checker.verify({
      submission: { kind: 'receipt_no', value: '900101-1234567' },
    })
    expect(JSON.stringify(verdict)).not.toContain('900101')
  })

  it('업로드 식별자도 결과에 담지 않는다', () => {
    const verdict = checker.verify({
      submission: { kind: 'sms_capture', evidenceId: '01J8XKRB' },
    })
    expect(JSON.stringify(verdict)).not.toContain('01J8XKRB')
  })
})
