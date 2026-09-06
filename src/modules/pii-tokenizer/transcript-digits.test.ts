/**
 * 전사문 숫자 규칙의 **단위 시험** — 손으로 고른 문장으로 규칙의 뜻을 지킵니다.
 *
 * 계약: spec/common/08-14-pii-boundary.md 「원문의 최소 길이」
 * 근거: ADR-081(한 글자 조각은 개인정보 원문이 아니다)
 *
 * 실제 전사문 40발화에서 새는지는 `transcript-digits.leak.test.ts` 가 봅니다 —
 * 그쪽은 저장된 전사 결과를 통째로 넣고, 여기는 규칙 하나를 짚습니다.
 */

import { describe, expect, it } from 'vitest'

import { findTranscriptDigits } from './transcript-digits'

/** 가리기로 한 자리의 글자들 */
function coveredBy(text: string): string[] {
  return findTranscriptDigits(text).map((one) => text.slice(one.start, one.end))
}

describe('숫자 덩어리의 최소 길이 (ADR-081)', () => {
  it('붙여 읽은 묶음 안의 한 자리 덩어리는 자기 토큰을 만들지 않는다', () => {
    // 2026-09-06 배포본 QA. 판독 줄에서 한 자리 「8」이 제 토큰을 얻어
    // `[주민번호-1]` 의 원문이 됐고, 그 뒤 그 기기에서는 「8」이 든 글이 전부
    // 누출 검산에 걸려 막혔습니다. 앞뒤에 한글이 있어 덩어리가 갈라진 모양입니다
    const text = '8 잠시만요 02-1234-5678 로 연락드릴게요'

    const values = coveredBy(text)

    expect(values).not.toContain('8')
    // 그 옆의 진짜 번호는 그대로 가립니다 — 한 자리를 뺀 것이 전부입니다
    expect(values.some((one) => one.includes('1234'))).toBe(true)
  })

  it('짧은 덩어리도 묶음의 자릿수 판정에는 그대로 참여한다', () => {
    // 이 묶음은 「8」까지 세야 9자리라 `minDigits` 를 겨우 넘습니다. 세는 데서까지
    // 빼면 8자리로 떨어져 **묶음이 통째로 안 가려집니다** — 판정에는 참여시키고
    // 자기 자리만 안 주는 것이 규칙입니다
    const text = '8 잠시만요 0212-3456 로 연락드릴게요'

    expect(coveredBy(text)).toEqual(['0212-3456'])
  })

  it('2026-09-06 QA 의 판독 줄 — 「8」은 제 토큰을 못 갖고 옆 번호는 그대로 가려진다', () => {
    // 앞뒤가 구분자로만 이어져 있으면 한 조각입니다 — 「8」도 그 조각 안에 들어갑니다
    const text = '로 문의 바랍니다: 8 02-1234-5678 13.47'

    const values = coveredBy(text)

    expect(values).not.toContain('8')
    expect(values.some((one) => one.includes('1234'))).toBe(true)
  })

  it('두 자리 덩어리는 여전히 가린다 — 「01」 같은 계좌 조각을 남기지 않는다', () => {
    // 「110에」 뒤의 한글이 덩어리를 가르므로 「110」과 「01 2345 678901」이 따로 잡힙니다
    const text = '계좌 110에 01 2345 678901 로 보냈어요'

    const covered = coveredBy(text).join('').replace(/\D/g, '')

    expect(covered).toBe('110012345678901')
  })
})

/**
 * ⚠️ **하한을 덩어리 단위로 걸었다가 통째로 안 가려진 자리** (2026-09-06 검토 지적).
 *
 * 한 자리씩 끊어 읽힌 번호는 덩어리로는 전부 한 자리라, 이어 붙이기 **전에** 거르면
 * 남는 덩어리가 없어 **아무것도 안 가려집니다.** 가운데만 한 자리인 경우도 조각이
 * 둘로 갈라져 **사이의 숫자가 평문으로 드러납니다.** 둘 다 불변 규칙 2 위반입니다.
 */
describe('덩어리가 전부 짧아도 묶음은 가린다', () => {
  it('한 자리씩 끊어 읽힌 상품권 핀번호를 통째로 가린다', () => {
    // `assets/datasets/08-25-stt-gpu/results-gpu.json` 조건 F 의 E34 그대로입니다
    const text =
      '부겟나이프 핀번호 16자리를 불러줬어요. 5-0-0-0 1-2-3-4 5-6-7-8 9-0-1-2 이런 형식이었습니다.'

    const values = coveredBy(text)

    expect(values).toHaveLength(1)
    expect(values[0]).toBe('5-0-0-0 1-2-3-4 5-6-7-8 9-0-1-2')
  })

  it('조각 가운데의 한 자리들이 자리를 가르지 않는다', () => {
    const text = '계좌번호 302 0 9 8 7 6 5 4 3 21 입니다'

    const values = coveredBy(text)

    expect(values).toHaveLength(1)
    expect(values[0]).toBe('302 0 9 8 7 6 5 4 3 21')
  })
})
