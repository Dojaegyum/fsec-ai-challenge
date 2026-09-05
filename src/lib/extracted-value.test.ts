/**
 * 증거에서 뽑힌 값 다듬기 시험 — ADR-069.
 *
 * 가장 중요한 것: **셈이 필요한 표현은 받지 않는다.** 여기가 「어제」를 날짜로 바꾸면
 * 시계가 둘이 됩니다(불변 규칙 7).
 */

import { describe, expect, it } from 'vitest'

import {
  normalizeAccountToken,
  normalizeAmount,
  normalizeDateTime,
  normalizeExtracted,
  normalizeMention,
  normalizeNameToken,
} from './extracted-value'

describe('금액 — 원 단위 정수만', () => {
  it.each([
    ['32,000,000원', '32000000'],
    ['32000000', '32000000'],
    ['3,200만원', '32000000'],
    ['3200만 원', '32000000'],
    ['1.5억', '150000000'],
    ['500만', '5000000'],
  ])('%s → %s', (raw, want) => {
    expect(normalizeAmount(raw)).toBe(want)
  })

  it.each(['삼천이백만 원', '300만원쯤', '0원', '', '많이', '32.5원'])('%s 는 null', (raw) => {
    expect(normalizeAmount(raw)).toBeNull()
  })
})

describe('시각 — 절대 표기만', () => {
  it.each([
    ['2026.09.01 14:22:41', '2026-09-01T14:22:41+09:00'],
    ['2026.09.01 14:22.41', '2026-09-01T14:22:41+09:00'],
    ['2026.09.01 14.22.41', '2026-09-01T14:22:41+09:00'],
    ['2026-09-01', '2026-09-01'],
    ['2026/9/1', '2026-09-01'],
    ['2026년 9월 1일 14:22', '2026-09-01T14:22:00+09:00'],
    ['2026년 9월 1일', '2026-09-01'],
  ])('%s → %s', (raw, want) => {
    expect(normalizeDateTime(raw)).toBe(want)
  })

  it.each(['9월 1일', '어제 오후', '2026.02.30', '2026.13.01', '14:22', '오늘'])(
    '%s 는 null',
    (raw) => {
      expect(normalizeDateTime(raw)).toBeNull()
    },
  )
})

describe('상대 계좌 — 이 전사문에 있는 토큰만', () => {
  const text = '받는 계좌 국민은행 [계좌-1]\n보낸 계좌 [계좌-2]'
  it('전사문에 있는 토큰은 그대로', () => {
    expect(normalizeAccountToken('[계좌-1]', text)).toBe('[계좌-1]')
  })
  it('앞뒤에 말이 붙어도 토큰 하나면 그 토큰 — 「국민은행 [계좌-1]」', () => {
    expect(normalizeAccountToken('국민은행 [계좌-1]', text)).toBe('[계좌-1]')
  })
  it('토큰이 둘이면 null — 어느 쪽이 상대인지 모른다', () => {
    expect(normalizeAccountToken('[계좌-1] 또는 [계좌-2]', text)).toBeNull()
  })
  it('전사문에 없는 토큰은 null — 지어낸 번호가 슬롯에 못 들어간다', () => {
    expect(normalizeAccountToken('[계좌-7]', text)).toBeNull()
  })
  it('토큰이 아닌 번호는 null — 원문이 여기 올 수 없다', () => {
    expect(normalizeAccountToken('110-234-567890', text)).toBeNull()
  })
})

describe('글 값 — 전사문에 그대로 있는 짧은 글만', () => {
  const text = '서울중앙지방검찰청 첨단범죄수사부 [이름-1] 수사관입니다'
  it('부분 문자열이면 받는다', () => {
    expect(normalizeMention('서울중앙지방검찰청', text)).toBe('서울중앙지방검찰청')
  })
  it('전사문에 없는 말은 null — 바꿔 쓴 것은 받지 않는다', () => {
    expect(normalizeMention('경찰청', text)).toBeNull()
  })
  it('토큰은 값이 아니다', () => {
    expect(normalizeMention('[이름-1]', text)).toBeNull()
  })
})

describe('이름으로 고른다', () => {
  it('표 밖 이름은 null — 슬롯에 들어가지 않는다', () => {
    expect(normalizeExtracted('org_name', '국민은행', '국민은행')).toBeNull()
    expect(normalizeExtracted('transferred', 'true', 'true')).toBeNull()
  })
  it('표 안 이름은 그 다듬기로', () => {
    expect(normalizeExtracted('amount', '3,200만원', '')).toBe('32000000')
    expect(normalizeExtracted('occurred_at', '2026.09.01', '')).toBe('2026-09-01')
  })
})

describe('본인 이름 — 이름 토큰이 있을 때만 (ADR-070)', () => {
  const text = '여보세요, [이름-1] 씨 되십니까?'
  it('토큰이면 그대로', () => {
    expect(normalizeNameToken('[이름-1]', text)).toBe('[이름-1]')
    expect(normalizeExtracted('victim_name', '[이름-1] 씨', text)).toBe('[이름-1]')
  })
  it('원문 이름은 null — 2차 탐지가 꺼져 있으면 서버에 이름을 두지 않는다', () => {
    expect(normalizeNameToken('김민수', '여보세요, 김민수 씨 되십니까?')).toBeNull()
  })
  it('전사문에 없는 토큰은 null', () => {
    expect(normalizeNameToken('[이름-3]', text)).toBeNull()
  })
  it('본인 계좌도 계좌 토큰 규칙 그대로', () => {
    expect(normalizeExtracted('victim_account', '국민은행 [계좌-2]', '보낸 계좌 국민은행 [계좌-2]')).toBe('[계좌-2]')
  })
})
