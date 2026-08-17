/**
 * pii-masker 시험.
 *
 * 검증 대상은 spec/common/08-14-pii-boundary.md 「2중 스크러빙」과
 * 「토큰화 제외 목록」입니다.
 *
 * 두 방향으로 틀릴 수 있고 **둘 다 제품을 망칩니다.**
 *   못 잡으면  → 원문이 네트워크를 탑니다
 *   과하게 잡으면 → 금액·날짜가 가려져 슬롯이 안 채워지고 8유형 분기가 무너집니다
 */

import { describe, expect, it } from 'vitest'

import { createPiiMasker } from './index'

const masker = createPiiMasker()

describe('주민번호를 가린다', () => {
  it('하이픈이 있는 형태', () => {
    const result = masker.mask('제 번호는 900101-1234567 입니다')
    expect(result.text).toBe('제 번호는 [주민번호-1] 입니다')
    expect(result.mappings).toEqual([
      { token: '[주민번호-1]', kind: 'resident_id', value: '900101-1234567' },
    ])
  })

  it('하이픈이 없어도 잡는다', () => {
    // 13자리이고 뒷자리 첫 숫자가 1~4 인 형태는 다른 것과 헷갈리지 않는다
    const result = masker.mask('9001011234567')
    expect(result.text).toBe('[주민번호-1]')
  })
})

describe('카드번호를 가린다', () => {
  it('네 덩이로 끊긴 형태', () => {
    const result = masker.mask('1234-5678-9012-3456 으로 결제')
    expect(result.text).toBe('[카드-1] 으로 결제')
  })

  it('붙여 쓴 16자리도 잡는다', () => {
    // 16자리 금액은 1000조 단위라 현실에 없다
    const result = masker.mask('1234567890123456')
    expect(result.text).toBe('[카드-1]')
  })
})

describe('전화번호를 가린다', () => {
  it('휴대폰', () => {
    expect(masker.mask('010-1234-5678').text).toBe('[전화-1]')
  })

  it('붙여 쓴 휴대폰', () => {
    expect(masker.mask('01012345678').text).toBe('[전화-1]')
  })

  it('지역번호', () => {
    expect(masker.mask('02-1234-5678 로 전화가 왔어요').text).toBe(
      '[전화-1] 로 전화가 왔어요',
    )
  })
})

describe('계좌번호를 가린다', () => {
  it('세 덩이로 끊긴 형태', () => {
    const result = masker.mask('110-234-567890 으로 보냈어요')
    expect(result.text).toBe('[계좌-1] 으로 보냈어요')
    expect(result.mappings[0].kind).toBe('account')
  })

  it('덩이 길이가 달라도 잡는다', () => {
    expect(masker.mask('1002-123-456789').text).toBe('[계좌-1]')
  })
})

describe('가리면 안 되는 것은 건드리지 않는다', () => {
  it('금액', () => {
    // 토큰화 제외 목록 — 슬롯 T2 이자 서류 필수 기재사항이다
    expect(masker.mask('3000000원을 보냈어요').text).toBe('3000000원을 보냈어요')
    expect(masker.mask('30,000,000원').text).toBe('30,000,000원')
    expect(masker.mask('300만원').text).toBe('300만원')
  })

  it('날짜', () => {
    // 기한 계산의 기산점이다. 가려지면 날짜를 세지 못한다
    expect(masker.mask('2026-08-16 에 보냈어요').text).toBe('2026-08-16 에 보냈어요')
    expect(masker.mask('2026-08-16T14:30:00+09:00').text).toBe(
      '2026-08-16T14:30:00+09:00',
    )
  })

  it('기관명', () => {
    // 8유형 분기의 직접 입력이다. 가려지면 경유 서비스를 특정할 수 없다
    expect(masker.mask('국민은행 앱에서 카카오페이로 보냈어요').text).toBe(
      '국민은행 앱에서 카카오페이로 보냈어요',
    )
  })

  it('짧은 숫자', () => {
    expect(masker.mask('3영업일 안에 112 로 신고').text).toBe(
      '3영업일 안에 112 로 신고',
    )
  })

  it('개인정보가 없으면 원문 그대로 돌려준다', () => {
    const result = masker.mask('지급정지는 어떻게 하나요')
    expect(result.text).toBe('지급정지는 어떻게 하나요')
    expect(result.mappings).toEqual([])
  })
})

describe('같은 값은 같은 토큰을 쓴다', () => {
  it('한 문장에 두 번 나와도 번호가 같다', () => {
    const result = masker.mask('110-234-567890 에 보내고 110-234-567890 확인')
    expect(result.text).toBe('[계좌-1] 에 보내고 [계좌-1] 확인')
    expect(result.mappings).toHaveLength(1)
  })

  it('값이 다르면 번호가 올라간다', () => {
    const result = masker.mask('110-234-567890 과 220-345-678901')
    expect(result.text).toBe('[계좌-1] 과 [계좌-2]')
    expect(result.mappings).toHaveLength(2)
  })

  it('종류마다 번호를 따로 센다', () => {
    const result = masker.mask('110-234-567890 · 010-1234-5678 · 900101-1234567')
    expect(result.text).toBe('[계좌-1] · [전화-1] · [주민번호-1]')
  })
})

describe('앞선 매핑을 이어받는다', () => {
  it('이미 있는 값은 그 토큰을 그대로 쓴다', () => {
    // 챗은 매 턴 마스킹하는데 [계좌-1] 이 턴마다 달라지면 복원이 어긋난다
    const first = masker.mask('110-234-567890 에 보냈어요')
    const second = masker.mask('110-234-567890 맞나요', first.mappings)

    expect(second.text).toBe('[계좌-1] 맞나요')
    expect(second.mappings).toHaveLength(1)
  })

  it('새 값은 이어지는 번호를 받는다', () => {
    const first = masker.mask('110-234-567890')
    const second = masker.mask('220-345-678901', first.mappings)

    expect(second.text).toBe('[계좌-2]')
    expect(second.mappings).toHaveLength(2)
    expect(second.mappings[0].token).toBe('[계좌-1]')
  })

  it('이어받은 매핑은 앞에 그대로 남는다', () => {
    const first = masker.mask('010-1234-5678')
    const second = masker.mask('110-234-567890', first.mappings)

    expect(second.mappings.map((one) => one.token)).toEqual([
      '[전화-1]',
      '[계좌-1]',
    ])
  })
})

describe('종류가 겹치는 값은 더 좁은 쪽으로 가린다', () => {
  it('휴대폰 11자리를 계좌로 보지 않는다', () => {
    expect(masker.mask('01012345678').mappings[0].kind).toBe('phone')
  })

  it('카드 16자리를 계좌로 보지 않는다', () => {
    expect(masker.mask('1234-5678-9012-3456').mappings[0].kind).toBe('card')
  })

  it('주민번호를 계좌로 보지 않는다', () => {
    expect(masker.mask('900101-1234567').mappings[0].kind).toBe('resident_id')
  })
})
