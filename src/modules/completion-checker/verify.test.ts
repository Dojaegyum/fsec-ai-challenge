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

import { L2_NOTES } from './notes'
import type { EvidenceReading, ReceiptNumberFormat } from './types'
import { createCompletionChecker, findReceiptMarks, looksLikeReceiptNumber } from './verify'

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
    // 모양은 맞는데(영숫자 12자) 그 기관 형식(4-7)과 다른 값입니다
    const verdict = checker.verify({
      submission: { kind: 'receipt_no', value: '2026-12345678' },
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

  // → ADR-057. 정본이 없는데 막아 세우면 **제대로 받아 적은 피해자가 실패 화면을
  //   봅니다.** 그 사람은 할 일을 다 한 사람입니다
  it('그 기관의 형식을 모르면 모양만 보고 통과시킨다', () => {
    const noFormat = createCompletionChecker({ receiptFormat: unknownFormat })
    const verdict = noFormat.verify({
      submission: { kind: 'receipt_no', value: '2026-004821' },
    })

    expect(verdict.verifyResult).toBe('passed')
    expect(verdict.stepState).toBe('done_verified')
    // **통과에도 이유를 남긴다** — 형식 정본이 생기는 날 재검증할 것을 여기서 센다
    expect(verdict.verifyDetail).toEqual({ reason: 'format_unchecked' })
  })

  it('형식을 대조해 통과한 것에는 이유를 안 붙인다', () => {
    // 「모양만 봤다」와 「형식을 봤다」가 구분돼야 셀 수 있다
    const verdict = checker.verify({
      submission: { kind: 'receipt_no', value: '2026-1234567' },
    })
    expect(verdict.verifyDetail).toBeUndefined()
  })

  it('모양이 아니면 형식을 몰라도 실패다', () => {
    // 모른다고 **아무 글자나** 통과시키지는 않는다
    const noFormat = createCompletionChecker({ receiptFormat: unknownFormat })

    for (const value of ['   ', 'ㅇㅇ', '9', '했음', '-----']) {
      const verdict = noFormat.verify({ submission: { kind: 'receipt_no', value } })
      expect(verdict.verifyResult, value).toBe('failed')
      expect(verdict.verifyDetail, value).toEqual({ reason: 'not_identifier' })
      expect(verdict.stepState, value).toBe('in_progress')
      expect(verdict.nextOptions, value).toHaveLength(2)
    }
  })
})

describe('looksLikeReceiptNumber — 형식 규격이 아니라 오타 거르개', () => {
  it('구분자를 뗀 영숫자 6자 이상에 숫자가 있으면 통과', () => {
    for (const value of ['2026-004821', 'KB-20260826-0001', '2026 004 821', 'A12345']) {
      expect(looksLikeReceiptNumber(value), value).toBe(true)
    }
  })

  it('짧거나 · 숫자가 없거나 · 영숫자가 아니면 거른다', () => {
    for (const value of ['', '   ', '9', '12345', 'ㅇㅇ', '접수했어요', 'ABCDEFG', '2026-08-26 접수']) {
      expect(looksLikeReceiptNumber(value), value).toBe(false)
    }
  })

  // 어느 기관의 형식도 주장하지 않는다 → CLAUDE.md 「모르는 수치를 지어내지 마세요」
  it('자릿수나 접두어를 특정하지 않는다', () => {
    expect(looksLikeReceiptNumber('000000')).toBe(true)
    expect(looksLikeReceiptNumber('ZZZZ99')).toBe(true)
    expect(looksLikeReceiptNumber('1'.repeat(60))).toBe(true)
  })
})

/**
 * ⚠️ **2026-09-06 까지 「올린 것 자체가 증빙」이었습니다** → ADR-077.
 *
 * 사기범과의 통화 녹음을 올려도 「신청서류 제출」이 끝났고, 이체 캡처가 112 접수증으로
 * 인정됐습니다. 부산물 원리(불변 규칙 6)는 「절차가 남긴 것이 존재한다」이지
 * 「무엇이든 올렸다」가 아닙니다. 그래서 L2 는 **판독 결과**를 봅니다 —
 * 접수번호 자리와 번호가 있어야 통과하고, 없으면 「올렸지만 확인 못 함」입니다.
 *
 * ⚠️ **2026-09-06 QA 에서 다시 뚫렸습니다** → ADR-083. 「본 건은 수사기밀이므로 경찰에
 * 신고하거나…」가 적힌 합성 사기 문자가 공공기관 이름(「경찰」) 하나로 통과했습니다.
 * 사기 문자에는 수사기관 이름이 거의 늘 들어 있어 **기관 이름만으로는 더 이상 통과시키지
 * 않습니다.** 접수번호가 있어야만 완료입니다.
 */
describe('L2 — 캡처·서류를 올림. 판독 결과에 접수번호 자리와 번호가 있어야 한다 (ADR-083)', () => {
  const ORGS = ['경찰청', '경찰', '112', '금융감독원', '금감원', '1332']
  const doc = (text: string | null, over: Partial<EvidenceReading> = {}): EvidenceReading => ({
    kind: 'image',
    ingestStatus: 'done',
    text,
    ...over,
  })
  const upload = (evidence: EvidenceReading | null, orgNames = ORGS) =>
    checker.verify({
      submission: { kind: 'receipt_doc', evidenceId: '01J8XKRC' },
      evidence,
      orgNames,
    })

  it('접수번호 모양이 있으면 완료다', () => {
    expect(upload(doc('피해구제 신청 접수증\n접수번호: 2026-004821\n국민은행'))).toEqual({
      verifyLevel: 'L2',
      verifyResult: 'passed',
      stepState: 'done_verified',
      verifyDetail: { reason: 'receipt_number_found' },
    })
  })

  it('공공기관 이름만 있으면 완료가 아니다 — 접수번호를 적는 길을 낸다 (ADR-083)', () => {
    const verdict = upload(doc('[경찰청] 문의는 182 로 연락해 주세요'))
    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.stepState).toBe('unconfirmed')
    expect(verdict.verifyDetail).toEqual({ reason: 'org_only' })
    expect(verdict.note).toBe(L2_NOTES.org_only)
    // 막다른 길이 아니다 — 번호를 적거나(L1) 했다고 표시(L3)할 수 있다
    expect(verdict.nextOptions).toEqual([
      { level: 'L1', label: '접수번호를 적어 주세요' },
      { level: 'L3', label: '번호 없이 접수했다고 표시' },
    ])
  })

  it('사기 문자에 든 「경찰」은 근거가 아니다 (ADR-083 · 2026-09-06 QA)', () => {
    const verdict = upload(
      doc('본 건은 수사기밀이므로 경찰에 신고하거나 타인에게 알리지 마십시오'),
    )
    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.verifyDetail).toEqual({ reason: 'org_only' })
  })

  it('접수번호가 있으면 기관 이름 없이도 완료다', () => {
    const verdict = upload(doc('112 신고가 접수되었습니다. 접수번호 2026-0906-00417'))
    expect(verdict.verifyResult).toBe('passed')
    expect(verdict.verifyDetail).toEqual({ reason: 'receipt_number_found' })
  })

  it('접수번호가 이름표로 가려져 있어도 자리를 본다 — 「접수번호 [계좌-1]」', () => {
    // 전사문은 토큰화된 상태입니다. 번호가 계좌로 잡혀 가려질 수 있는데,
    // 「접수번호」라는 자리 뒤에 이름표가 있으면 그 번호가 거기 있었다는 뜻입니다
    const verdict = upload(doc('접수번호 [계좌-1] 로 접수되었습니다'))
    expect(verdict.verifyResult).toBe('passed')
    expect(verdict.verifyDetail).toEqual({ reason: 'receipt_number_found' })
  })

  it('이체 캡처는 은행 이름이 있어도 접수증이 아니다 — 올렸지만 확인 못 함', () => {
    // 1차 점검에서 이체 캡처가 112 접수증으로 인정됐습니다. 경유 서비스(은행)
    // 이름은 이체 내역에도 있으니 근거가 못 됩니다 — 공공기관 이름만 봅니다
    const verdict = upload(
      doc('KB국민은행 이체 완료\n받는 분 [이름-1]\n[계좌-1]\n1,000,000원\n2026-09-05 14:22'),
    )
    expect(verdict.verifyLevel).toBe('L2')
    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.stepState).toBe('unconfirmed')
    expect(verdict.verifyDetail).toEqual({ reason: 'no_receipt_marks' })
    expect(verdict.note).toBe(L2_NOTES.no_receipt_marks)
    // 막다른 길이 아닙니다 — 번호를 적거나(L1) 했다고 표시(L3)할 수 있습니다
    expect(verdict.nextOptions).toEqual([
      { level: 'L1', label: '접수번호를 적어 주세요' },
      { level: 'L3', label: '번호 없이 접수했다고 표시' },
    ])
  })

  it('날짜·금액은 접수번호 모양이 아니다', () => {
    // 「2026-09-05」를 구분자를 떼면 여덟 자리 숫자라 `looksLikeReceiptNumber` 는
    // 통과시킵니다. 자리(「접수번호」) 없이 숫자만 있는 것은 근거가 아닙니다
    expect(upload(doc('2026-09-05 14:22\n1,000,000원\n승인번호 없음')).verifyResult).toBe('failed')
  })

  it('숫자로만 된 별칭(112 · 1332)은 기관명으로 안 센다 — 금액·시각에 흔히 섞인다', () => {
    expect(upload(doc('1,120,000원\n13:32 이체')).verifyResult).toBe('failed')
  })

  it('통화 녹음은 접수증이 아니다', () => {
    const verdict = upload(
      doc('접수번호 2026-004821 이라고 하셨죠', { kind: 'audio' }),
    )
    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.stepState).toBe('unconfirmed')
    expect(verdict.verifyDetail).toEqual({ reason: 'not_a_document' })
    expect(verdict.note).toBe(
      '통화 녹음은 접수증이 아닙니다. 접수증이나 접수 문자 캡처를 올리거나 접수번호를 적어 주세요',
    )
    expect(verdict.nextOptions).toHaveLength(2)
  })

  it('아직 읽는 중이면 판정을 미룬다 — 실패도 완료도 아니다', () => {
    const verdict = upload(doc(null, { ingestStatus: 'processing' }))
    expect(verdict.verifyResult).toBe('not_applicable')
    expect(verdict.stepState).toBe('unconfirmed')
    expect(verdict.verifyDetail).toEqual({ reason: 'reading_pending' })
    expect(verdict.note).toBe(L2_NOTES.reading_pending)
    // 기다리면 되는 자리라 다른 길을 내밀지 않습니다
    expect(verdict.nextOptions).toBeUndefined()
  })

  it('올린 직후(pending)도 같다', () => {
    expect(upload(doc(null, { ingestStatus: 'pending' })).verifyDetail).toEqual({
      reason: 'reading_pending',
    })
  })

  it('읽기가 실패했거나 자료를 못 찾으면 확인 못 함이다', () => {
    for (const evidence of [doc(null, { ingestStatus: 'failed' }), null]) {
      const verdict = upload(evidence)
      expect(verdict.verifyResult).toBe('failed')
      expect(verdict.stepState).toBe('unconfirmed')
      expect(verdict.verifyDetail).toEqual({ reason: 'unreadable' })
      expect(verdict.note).toBe('올렸지만 읽지 못했습니다. 접수번호를 적어 주시면 확인합니다')
    }
  })

  it('글로 올린 것(대화 내보내기)도 서류다 — 사진과 같은 규칙', () => {
    expect(upload(doc('[국민은행] 지급정지 접수번호 KB-20260906-0001', { kind: 'text' })).verifyResult).toBe(
      'passed',
    )
  })

  it('기관 목록이 비어도 접수번호 모양은 본다', () => {
    expect(upload(doc('사건접수번호 2026-004821'), []).verifyResult).toBe('passed')
  })

  it('접수 문자 캡처(sms_capture)도 같은 규칙이다', () => {
    const verdict = checker.verify({
      submission: { kind: 'sms_capture', evidenceId: '01J8XKRB' },
      evidence: doc('[국민은행] 지급정지 요청이 접수되었습니다'),
      orgNames: ORGS,
    })
    expect(verdict.verifyResult).toBe('failed')
    expect(verdict.verifyDetail).toEqual({ reason: 'no_receipt_marks' })
  })
})

describe('findReceiptMarks — 판독 글에서 접수번호 자리와 기관명을 찾는다', () => {
  it('자리 뒤의 번호를 찾는다 — 줄바꿈·콜론을 건너뛴다', () => {
    for (const text of [
      '접수번호: 2026-004821',
      '접수번호\n2026-004821',
      '사건접수번호 2026-004821',
      '신고번호 KB-20260906-0001',
      '접수 No. 2026004821',
    ]) {
      expect(findReceiptMarks(text, []).receiptNumber, text).toBe(true)
    }
  })

  it('자리는 있는데 번호 모양이 아니면 아니다', () => {
    for (const text of ['접수번호 없음', '접수번호: ㅇㅇ', '접수번호 9']) {
      expect(findReceiptMarks(text, []).receiptNumber, text).toBe(false)
    }
  })

  it('기관명은 이름·별칭 그대로 찾되, 숫자뿐인 별칭과 한 글자는 안 본다', () => {
    expect(findReceiptMarks('금감원에서 보낸 통지', ['금융감독원', '금감원', '1332']).orgName).toBe(true)
    expect(findReceiptMarks('13:32 에 1,332,000원', ['금융감독원', '금감원', '1332']).orgName).toBe(false)
    expect(findReceiptMarks('가나다', ['가']).orgName).toBe(false)
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
      note: '완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요',
    })
  })

  it('**왜 완료가 아닌지 말한다** — 안 그러면 버튼이 안 먹은 것처럼 보인다', () => {
    // 문구의 정본은 08-14-api.md §3.8 「응답 200 — L3 자기 신고」입니다.
    // 이 칸이 비면 화면은 「아직 완료로 기록하지 않았습니다」만 그립니다
    const verdict = checker.verify({
      submission: { kind: 'other', selfReported: true },
    })
    expect(verdict.note).toBe('완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요')
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
