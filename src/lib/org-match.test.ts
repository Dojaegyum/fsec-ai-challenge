/**
 * 기관 이름 정규화 — **엉뚱한 은행에 전화하면 골든타임을 통째로 잃습니다.**
 *
 * 계약: spec/backend/08-16-data-model.md §4.1 · §11.4.4 ①
 */

import { describe, expect, it } from 'vitest'

import { matchOrg, type OrgCandidate } from './org-match'

const BANKS: readonly OrgCandidate[] = [
  { orgId: 'kb-bank', name: 'KB국민은행', aliases: ['국민은행', '국민', 'KB', 'KB국민'] },
  { orgId: 'shinhan-bank', name: '신한은행', aliases: ['신한'] },
  { orgId: 'im-bank', name: 'iM뱅크', aliases: ['대구은행', '대구', 'DGB', 'iM'] },
  { orgId: 'jeju-bank', name: '제주은행', aliases: ['제주'] },
]

describe('정확 일치가 먼저다', () => {
  it('정식 표기로 찾는다', () => {
    expect(matchOrg('KB국민은행', BANKS)).toBe('kb-bank')
  })

  it('별칭으로 찾는다', () => {
    expect(matchOrg('국민은행', BANKS)).toBe('kb-bank')
    expect(matchOrg('신한', BANKS)).toBe('shinhan-bank')
  })

  it('옛 이름도 별칭에 있으면 찾는다 — 사용자는 「대구은행」이라고 말합니다', () => {
    expect(matchOrg('대구은행', BANKS)).toBe('im-bank')
  })
})

describe('정규화 후 재시도 — §11.4.4 ①', () => {
  it('공백을 지우고 다시 본다', () => {
    expect(matchOrg('KB 국민은행', BANKS)).toBe('kb-bank')
    expect(matchOrg(' 신한 ', BANKS)).toBe('shinhan-bank')
  })

  it('대소문자를 안 가린다', () => {
    expect(matchOrg('kb국민은행', BANKS)).toBe('kb-bank')
    expect(matchOrg('im뱅크', BANKS)).toBe('im-bank')
  })

  it('법인 표기를 지운다', () => {
    expect(matchOrg('(주)신한은행', BANKS)).toBe('shinhan-bank')
  })
})

describe('⛔ 못 찾으면 못 찾았다고 한다', () => {
  it('오타를 억지로 맞추지 않는다 — 틀린 기관을 고르느니 못 찾는 편이 낫다', () => {
    expect(matchOrg('국믄은행', BANKS)).toBeNull()
    expect(matchOrg('신한으행', BANKS)).toBeNull()
  })

  it('목록에 없는 기관은 `null`', () => {
    expect(matchOrg('토스뱅크', BANKS)).toBeNull()
  })

  it('빈 값은 `null`', () => {
    expect(matchOrg('', BANKS)).toBeNull()
    expect(matchOrg('   ', BANKS)).toBeNull()
  })

  it('**여럿이 걸리면 안 고른다** — 하나를 임의로 고르면 엉뚱한 기관이 나갑니다', () => {
    const 겹침: readonly OrgCandidate[] = [
      { orgId: 'a-bank', name: 'A은행', aliases: ['제주'] },
      { orgId: 'jeju-bank', name: '제주은행', aliases: ['제주'] },
    ]
    expect(matchOrg('제주', 겹침)).toBeNull()
  })

  it('후보가 없으면 `null`', () => {
    expect(matchOrg('국민은행', [])).toBeNull()
  })
})
