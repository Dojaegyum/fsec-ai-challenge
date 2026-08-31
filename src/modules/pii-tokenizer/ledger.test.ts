/**
 * 이름표 장부 시험 — **번호가 겹치면 엉뚱한 값이 복원됩니다.**
 *
 * 검증 대상: spec/common/08-14-pii-boundary.md 「번호의 단위」
 * 근거: ADR-009(매핑은 암호문으로 서버에) · ADR-027(키는 브라우저에만)
 *
 * **여기서 못 박는 것 넷:**
 * 1. 이름표를 뜯어 종류와 번호를 읽는다 — 모르는 종류는 안 받는다
 * 2. 장부 항목에 **원문이 없다** — 있으면 서버가 값을 아는 셈이 됩니다
 * 3. 볼트와 전사문을 **함께** 긁는다 — 서버가 만든 이름표는 볼트에 없습니다
 * 4. 볼트가 비면 장부도 빈다 — 그때가 1번부터입니다
 */

import { describe, expect, it } from 'vitest'

import { issuedMappings, parseToken, readIssuedLedger, tokensInText } from './ledger'

describe('이름표를 뜯는다', () => {
  it('종류와 번호가 나온다', () => {
    expect(parseToken('[계좌-12]')).toEqual({ kind: '계좌', seq: 12 })
    expect(parseToken('[이름-1]')).toEqual({ kind: '이름', seq: 1 })
  })

  it('모양이 아니면 null', () => {
    expect(parseToken('계좌-1')).toBeNull()
    expect(parseToken('[계좌]')).toBeNull()
    expect(parseToken('[계좌-]')).toBeNull()
  })

  /**
   * **모르는 종류를 받아 두면 그 종류의 번호를 우리가 세게 됩니다.**
   * `pii-restorer` 쪽 `parseToken` 은 화면에 그리기만 하므로 넓게 받는데,
   * 이쪽은 읽어 낸 종류로 **다음 번호를 발급**합니다
   */
  it('아는 다섯 종류만 받는다', () => {
    expect(parseToken('[기관-1]')).toBeNull()
    expect(parseToken('[account-1]')).toBeNull()
  })

  it('글 안에 박힌 것을 전부 긁는다', () => {
    const got = tokensInText('[계좌-1] 에서 [계좌-2] 로, [이름-3] 씨가')

    expect(got).toEqual(['[계좌-1]', '[계좌-2]', '[이름-3]'])
  })

  /** 정규식을 매번 새로 만듭니다 — `lastIndex` 가 남으면 두 번째 호출이 반만 셉니다 */
  it('두 번 불러도 같은 답이 나온다', () => {
    const text = '[계좌-1] 과 [계좌-2]'

    expect(tokensInText(text)).toEqual(tokensInText(text))
  })
})

describe('장부 항목에는 원문이 없다 — 그게 요점입니다', () => {
  it('`original` 칸이 아예 안 생긴다', () => {
    const got = issuedMappings(['[계좌-1]', '[이름-2]'])

    expect(got).toEqual([
      { token: '[계좌-1]', kind: '계좌', seq: 1 },
      { token: '[이름-2]', kind: '이름', seq: 2 },
    ])
    // 빈 문자열로도 채우지 않습니다 — 채우면 **서로 다른 값이 같은 이름표**를
    // 받습니다 (`tokenize.test.ts` 의 「원문 없는 항목은 값 매칭에 안 걸린다」)
    for (const one of got) expect('original' in one).toBe(false)
  })

  it('같은 이름표가 두 번 와도 한 번만 센다', () => {
    expect(issuedMappings(['[계좌-1]', '[계좌-1]'])).toHaveLength(1)
  })

  it('모양이 아닌 것은 버린다', () => {
    expect(issuedMappings(['[계좌-1]', '그냥 글자', '[기관-1]'])).toEqual([
      { token: '[계좌-1]', kind: '계좌', seq: 1 },
    ])
  })
})

describe('볼트와 토큰화된 글을 함께 긁는다', () => {
  const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

  /**
   * ⚠️ **서버가 만든 이름표는 볼트에 없습니다** — 짝을 봉할 키가 서버에
   * 없기 때문입니다(ADR-027). 볼트만 보면 증거 1 이 쓴 번호를 증거 2 가
   * 다시 쓰고, 그 둘이 매 턴 한 목록으로 모델에 함께 들어갑니다
   */
  it('토큰화된 글에 박힌 이름표까지 장부에 들어온다', async () => {
    const got = await readIssuedLedger(CASE_ID, {
      vault: { tokens: async () => ['[계좌-1]'] },
      masked: { all: async () => ['[계좌-2] 로 보내라고 했어요'] },
    })

    expect(got.map((one) => one.token)).toEqual(['[계좌-1]', '[계좌-2]'])
  })

  it('두 곳에 같은 이름표가 있어도 한 줄이다', async () => {
    const got = await readIssuedLedger(CASE_ID, {
      vault: { tokens: async () => ['[계좌-1]'] },
      masked: { all: async () => ['[계좌-1] 이라고 했어요'] },
    })

    expect(got).toHaveLength(1)
  })

  it('글 자리를 안 넘겨도 볼트만으로 선다', async () => {
    const got = await readIssuedLedger(CASE_ID, {
      vault: { tokens: async () => ['[전화-1]'] },
    })

    expect(got).toEqual([{ token: '[전화-1]', kind: '전화', seq: 1 }])
  })

  /** **회귀** — 새 사건은 장부가 비어 있고, 그때가 1번부터입니다 */
  it('아무것도 없으면 빈 장부', async () => {
    const got = await readIssuedLedger(CASE_ID, {
      vault: { tokens: async () => [] },
      masked: { all: async () => [] },
    })

    expect(got).toEqual([])
  })

  /**
   * **삼키지 않습니다** → 08-16-errors.md 원칙 1. 장부 없이 토큰화하면
   * 1번부터 다시 세어 **엉뚱한 값이 복원되는 상태**로 돌아갑니다
   */
  it('볼트를 못 읽으면 던진다 — 조용히 빈 장부로 떨어지지 않는다', async () => {
    await expect(
      readIssuedLedger(CASE_ID, {
        vault: {
          tokens: async () => {
            throw new Error('볼트를 못 읽었습니다')
          },
        },
      }),
    ).rejects.toThrow('볼트를 못 읽었습니다')
  })
})
