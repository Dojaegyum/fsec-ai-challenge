/**
 * org-repair 시험.
 *
 * 검증 대상은 ADR-056 과 spec/backend/08-16-data-model.md §11.4.4 ① 입니다.
 *
 * 가장 중요한 것: **모델이 낸 것을 그대로 믿지 않습니다.** 지어낸 자리도,
 * 사전에 없는 이름도 버립니다.
 */

import { describe, expect, it } from 'vitest'

import type { OrgCandidate } from './org-match'
import {
  ORG_REPAIR_PROMPT,
  buildOrgRepairInput,
  parseOrgRepair,
  verifyOrgRepair,
} from './org-repair'

const BANKS: OrgCandidate[] = [
  { orgId: 'kb-bank', name: 'KB국민은행', aliases: ['국민은행', '국민', 'KB'] },
  { orgId: 'shinhan-bank', name: '신한은행', aliases: ['신한'] },
  { orgId: 'toss-bank', name: '토스뱅크', aliases: ['토스'] },
]

const TRANSCRIPT = '어제 국민은행에서 시나는행 [계좌-1] 계좌로 850만원 보냈어요. 서울중앙지검이라면서 전화가 왔고요.'

describe('지시문', () => {
  it('사칭 기관을 찾지 않는다고 못 박는다 — 가장 위험한 오분류다', () => {
    expect(ORG_REPAIR_PROMPT).toContain('사칭 기관')
    expect(ORG_REPAIR_PROMPT).toContain('서울중앙지검은 찾지 않는다')
  })

  it('개인정보 토큰을 건드리지 말라고 못 박는다', () => {
    expect(ORG_REPAIR_PROMPT).toContain('건드리지 마라')
    expect(ORG_REPAIR_PROMPT).toContain('[계좌-1]')
  })

  it('모를 때 비우라고 못 박는다 — 억지로 고르면 엉뚱한 기관이 확정된다', () => {
    expect(ORG_REPAIR_PROMPT).toContain('억지로 고르지 마라')
    expect(ORG_REPAIR_PROMPT).toContain('없는 이름을 만들지 마라')
  })
})

describe('입력 조립', () => {
  it('줄을 태그로 감싼다 — 경계가 사라지면 두 줄에 걸친 글자가 한 이름이 된다', () => {
    const built = buildOrgRepairInput(['첫 줄이에요', '둘째 줄이에요'])

    expect(built).toContain('<line>첫 줄이에요</line>')
    expect(built).toContain('<line>둘째 줄이에요</line>')
    expect(built).toContain('<transcript>')
  })

  it('출력 형식을 맨 끝에 다시 붙인다', () => {
    expect(buildOrgRepairInput(['한 줄'])).toMatch(/\[출력 형식\][\s\S]*$/)
  })
})

describe('응답 읽기', () => {
  it('정상 JSON 을 읽는다', () => {
    const got = parseOrgRepair('{"orgs":[{"heard":"시나는행","candidates":["신한은행"]}]}')

    expect(got).toEqual([{ heard: '시나는행', candidates: ['신한은행'] }])
  })

  it('```json 울타리를 벗긴다 — 그것 때문에 답을 통째로 버리지 않는다', () => {
    const got = parseOrgRepair('```json\n{"orgs":[{"heard":"포스","candidates":["토스"]}]}\n```')

    expect(got).toEqual([{ heard: '포스', candidates: ['토스'] }])
  })

  it('형식을 못 지킨 답은 빈 배열이다 — 교정만 건너뛰고 전사는 살린다', () => {
    expect(parseOrgRepair('죄송합니다. 찾지 못했습니다.')).toEqual([])
    expect(parseOrgRepair('')).toEqual([])
    expect(parseOrgRepair('{"orgs":"목록이 아님"}')).toEqual([])
  })

  it('빈 후보를 그대로 읽는다 — 「모른다」는 정상 답이다', () => {
    const got = parseOrgRepair('{"orgs":[{"heard":"뭐시기","candidates":[]}]}')

    expect(got).toEqual([{ heard: '뭐시기', candidates: [] }])
  })
})

describe('검증 — 모델이 낸 것을 그대로 믿지 않는다', () => {
  it('하나로 좁혀지면 확정한다', () => {
    const got = verifyOrgRepair(
      [{ heard: '시나는행', candidates: ['신한은행'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([{ heard: '시나는행', orgId: 'shinhan-bank', options: ['신한은행'] }])
  })

  it('전사문에 없는 자리를 버린다 — 모델이 지어낸 것이다', () => {
    const got = verifyOrgRepair(
      [{ heard: '하나은행', candidates: ['KB국민은행'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([])
  })

  it('사전에 없는 이름을 버린다 — 그럴듯해도 확정하지 않는다', () => {
    const got = verifyOrgRepair(
      [{ heard: '시나는행', candidates: ['신한증권'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([])
  })

  it('여럿이 걸리면 확정하지 않고 되묻기 선택지로 남긴다', () => {
    const got = verifyOrgRepair(
      [{ heard: '시나는행', candidates: ['신한은행', '토스뱅크'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([
      { heard: '시나는행', orgId: null, options: ['신한은행', '토스뱅크'] },
    ])
  })

  it('사전에 있는 것만 선택지에 남긴다', () => {
    const got = verifyOrgRepair(
      [{ heard: '시나는행', candidates: ['신한은행', '없는은행'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([{ heard: '시나는행', orgId: 'shinhan-bank', options: ['신한은행'] }])
  })

  it('별칭으로 내도 확정한다', () => {
    const got = verifyOrgRepair(
      [{ heard: '국민은행', candidates: ['국민'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got[0]?.orgId).toBe('kb-bank')
  })

  it('같은 표기를 여러 번 내도 한 번만 센다', () => {
    const got = verifyOrgRepair(
      [
        { heard: '국민은행', candidates: ['KB국민은행'] },
        { heard: '국민은행', candidates: ['KB국민은행'] },
      ],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toHaveLength(1)
  })

  it('후보가 없으면 빈 배열이다 — 그 유형에 사전이 없다는 뜻이다', () => {
    const got = verifyOrgRepair(
      [{ heard: '시나는행', candidates: ['신한은행'] }],
      TRANSCRIPT,
      [],
    )

    expect(got).toEqual([])
  })

  it('모델이 빈 후보를 내면 버린다 — 「모른다」는 확정이 아니다', () => {
    const got = verifyOrgRepair([{ heard: '국민은행', candidates: [] }], TRANSCRIPT, BANKS)

    expect(got).toEqual([])
  })
})

describe('배선이 지켜야 할 것', () => {
  it('전사문 한 줄에 여러 기관이 있어도 각각 잡는다', () => {
    const got = verifyOrgRepair(
      [
        { heard: '국민은행', candidates: ['KB국민은행'] },
        { heard: '시나는행', candidates: ['신한은행'] },
      ],
      TRANSCRIPT,
      BANKS,
    )

    expect(got.map((one) => one.orgId)).toEqual(['kb-bank', 'shinhan-bank'])
  })

  it('사칭 기관을 모델이 내도 사전에 없어 버려진다 — 프롬프트가 뚫려도 코드가 막는다', () => {
    const got = verifyOrgRepair(
      [{ heard: '서울중앙지검', candidates: ['서울중앙지검'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([])
  })

  it('개인정보 토큰을 기관으로 내도 버려진다', () => {
    const got = verifyOrgRepair(
      [{ heard: '[계좌-1]', candidates: ['[계좌-1]'] }],
      TRANSCRIPT,
      BANKS,
    )

    expect(got).toEqual([])
  })
})
