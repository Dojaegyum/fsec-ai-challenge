/**
 * 경유 서비스 접기 — **한 번 보낸 돈이 화면에 두 번 뜨면 안 됩니다.**
 *
 * 계약: spec/common/08-14-api.md §3.6 `channels[]` · 09-data-model.md §4
 */

import { describe, expect, it } from 'vitest'

import { foldChannels, type ChannelRow } from './channels'

const row = (over: Partial<ChannelRow> = {}): ChannelRow => ({
  channelId: 'CH-bank',
  orgId: null,
  orgNameRaw: null,
  amount: null,
  confidence: null,
  ...over,
})

describe('같은 건은 한 줄로 접는다', () => {
  it('유형만 답한 줄은 기관이 붙은 줄에 흡수된다 — 문진을 순서대로 답하면 늘 생깁니다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', orgNameRaw: '국민은행', confidence: 1 }),
      row({ confidence: 1 }),
    ])

    expect(folded).toEqual([
      row({ orgId: 'kb-bank', orgNameRaw: '국민은행', confidence: 1 }),
    ])
  })

  it('흡수는 유형이 같을 때만이다 — 다른 유형의 미특정은 그대로 남는다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', confidence: 1 }),
      row({ channelId: 'CH-giftcard', confidence: 1 }),
    ])

    expect(folded.map((one) => [one.channelId, one.orgId])).toEqual([
      ['CH-bank', 'kb-bank'],
      ['CH-giftcard', null],
    ])
  })

  it('기관을 끝내 못 찾았으면 미특정으로 남는다 — 그때도 유형 절차는 나갑니다', () => {
    const folded = foldChannels([row({ orgNameRaw: '거기 은행', confidence: 1 })])

    expect(folded).toEqual([row({ orgNameRaw: '거기 은행', confidence: 1 })])
  })

  it('같은 기관을 두 번 특정했으면 확신 높은 쪽만 남는다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', orgNameRaw: '국민은행', confidence: 1 }),
      row({ orgId: 'kb-bank', orgNameRaw: '국민', confidence: 0.6 }),
    ])

    expect(folded).toHaveLength(1)
    expect(folded[0]!.orgNameRaw).toBe('국민은행')
  })
})

describe('다른 건은 접지 않는다', () => {
  it('같은 유형이라도 기관이 다르면 두 줄이다 — 두 은행에 나눠 보낸 사건이 있습니다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', amount: 3_000_000, confidence: 1 }),
      row({ orgId: 'shinhan-bank', amount: 500_000, confidence: 1 }),
    ])

    expect(folded.map((one) => [one.orgId, one.amount])).toEqual([
      ['kb-bank', 3_000_000],
      ['shinhan-bank', 500_000],
    ])
  })

  it('유형이 여럿이면 여럿 그대로다 — 계좌이체 뒤 상품권을 산 사건이 있습니다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', confidence: 1 }),
      row({ channelId: 'CH-giftcard', orgId: 'happy-money', confidence: 1 }),
    ])

    expect(folded).toHaveLength(2)
  })
})

describe('접을 때 빈 칸만 채운다', () => {
  it('확신 높은 줄이 금액을 몰라도 앞서 적힌 금액은 살아남는다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', confidence: 1 }),
      row({ orgId: 'kb-bank', amount: 3_000_000, confidence: 0.6 }),
    ])

    expect(folded[0]!.amount).toBe(3_000_000)
  })

  it('확신 높은 줄의 값은 덮이지 않는다', () => {
    const folded = foldChannels([
      row({ orgId: 'kb-bank', amount: 3_000_000, confidence: 1 }),
      row({ orgId: 'kb-bank', amount: 999, confidence: 0.6 }),
    ])

    expect(folded[0]!.amount).toBe(3_000_000)
  })
})

describe('없으면 없는 대로', () => {
  it('한 줄도 없으면 빈 배열이다 — 유형을 아직 안 물은 사건이 정상입니다', () => {
    expect(foldChannels([])).toEqual([])
  })
})
