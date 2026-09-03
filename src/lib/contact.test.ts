/**
 * `contact_ref` 를 푸는 규칙 — **틀린 번호는 없는 번호보다 나쁩니다.**
 *
 * 계약: spec/backend/08-16-data-model.md §11.1 §11.4.1 §11.4.3 ·
 *       spec/common/08-14-api.md §3.6
 */

import { describe, expect, it } from 'vitest'

import { cautionOf, resolveContact, submitPathsOf, withContacts } from './contact'

const CONTACT = {
  report_tel: '1588-9999',
  report_hours: '24시간',
  submit: [{ how: 'branch', text: '영업점에 냅니다' }],
}

describe('가리키는 값 하나를 푼다', () => {
  it('`org.contact.report_tel` 을 번호로 바꾼다', () => {
    expect(resolveContact('org.contact.report_tel', CONTACT)).toBe('1588-9999')
  })

  it('없는 칸은 `null` — **확인 못 한 것은 칸이 아예 없습니다** (§11.1 ①)', () => {
    expect(resolveContact('org.contact.call_center', CONTACT)).toBeNull()
  })

  it('기관을 특정 못 했으면 `null` — 그래도 절차는 나갑니다 (§11.4.3)', () => {
    expect(resolveContact('org.contact.report_tel', null)).toBeNull()
  })

  it('`org.contact.` 로 시작하지 않는 것은 안 푼다', () => {
    expect(resolveContact('report_tel', CONTACT)).toBeNull()
    expect(resolveContact('org.name', CONTACT)).toBeNull()
  })

  it('가리키지 않으면 `null`', () => {
    expect(resolveContact(null, CONTACT)).toBeNull()
    expect(resolveContact(undefined, CONTACT)).toBeNull()
  })

  it('**배열은 안 푼다** — `submit` 은 기재 안내가 통째로 받습니다 (ADR-042)', () => {
    expect(resolveContact('org.contact.submit', CONTACT)).toBeNull()
  })

  it('빈 문자열은 없는 것으로 본다 — 화면이 빈 칸을 그립니다', () => {
    expect(resolveContact('org.contact.report_tel', { report_tel: '  ' })).toBeNull()
  })
})

describe('단계 본문에 푼 값을 얹는다', () => {
  const body = {
    actor: 'victim',
    steps: [
      { text: '전화합니다', action: 'call', contact_ref: 'org.contact.report_tel' },
      { text: '받아적습니다', action: 'write', contact_ref: null },
      { text: '냅니다', action: 'visit', contact_ref: 'org.contact.submit_place' },
    ],
  }

  it('가리키는 줄에만 번호가 붙는다', () => {
    const out = withContacts(body, CONTACT)
    const steps = out.steps as Record<string, unknown>[]
    expect(steps[0]!.contact).toBe('1588-9999')
    // **「받아적기」에 번호가 붙으면 화면이 열 패널을 잘못 고릅니다**
    expect(steps[1]).not.toHaveProperty('contact')
    // 가리키긴 했는데 그 칸이 없으면 `null` — 「모른다」를 그대로 말합니다
    expect(steps[2]!.contact).toBeNull()
  })

  it('**원본을 안 고친다** — KB 사본과 서버가 얹은 것이 섞이면 안 됩니다', () => {
    withContacts(body, CONTACT)
    const first = body.steps[0] as Record<string, unknown>
    expect(first).not.toHaveProperty('contact')
  })

  it('기관이 없으면 가리킨 줄이 `null` 이 된다 — 단계는 그대로', () => {
    const out = withContacts(body, null)
    const steps = out.steps as Record<string, unknown>[]
    expect(steps).toHaveLength(3)
    expect(steps[0]!.contact).toBeNull()
    expect(steps[0]!.text).toBe('전화합니다')
  })

  it('`steps` 가 없는 본문은 그대로 지나간다', () => {
    expect(withContacts({ actor: 'victim' }, CONTACT)).toEqual({ actor: 'victim' })
  })
})

describe('신청서를 내는 길을 통째로 옮긴다 — §3.6 `channels[].submit` · ADR-042', () => {
  const BOTH = {
    report_tel: '1588-9999',
    submit: [
      { how: 'app', text: '앱 → 고객센터 → 피해구제 신청', url: 'https://app.example/relief' },
      { how: 'branch', text: '가까운 영업점에 서면 제출' },
    ],
    caution: '앱의 「사고신고」는 보안매체 분실 신고이고 피해구제 신청이 아닙니다',
  }

  it('**순서를 그대로 둔다** — 앱이 앞이면 앱이 앞', () => {
    // 「앱이 먼저」를 코드에 박으면 KB·NH 사용자가 앱을 뒤지다 3영업일을 씁니다.
    // 반대로 「영업점이 먼저」를 박으면 인터넷은행에는 갈 곳이 없습니다 (ADR-042 ②)
    expect(submitPathsOf(BOTH).map((one) => one.how)).toEqual(['app', 'branch'])
  })

  it('`url` 은 있을 때만 칸이 생긴다 — 없으면 링크 없이 글자만', () => {
    const [app, branch] = submitPathsOf(BOTH)
    expect(app).toEqual({
      how: 'app',
      text: '앱 → 고객센터 → 피해구제 신청',
      url: 'https://app.example/relief',
    })
    expect(branch).toEqual({ how: 'branch', text: '가까운 영업점에 서면 제출' })
    expect(branch).not.toHaveProperty('url')
  })

  it('기관이 없으면 **빈 배열** — `null` 이 아니다', () => {
    // 화면은 빈 배열이면 카드를 아예 안 그립니다(ADR-042 ③). `null` 을 주면
    // 「칸이 없다」와 「길이 없다」를 화면이 따로 다뤄야 합니다
    expect(submitPathsOf(null)).toEqual([])
  })

  it('확인 못 한 기관은 칸이 없고, 그때도 빈 배열이다 (§11.1 ①)', () => {
    expect(submitPathsOf({ report_tel: '1577-8000' })).toEqual([])
  })

  it('배열이 아니면 빈 배열 — 문자열이던 옛 `submit_place` 모양을 안 받는다', () => {
    expect(submitPathsOf({ submit: '가까운 영업점에 서면 제출' })).toEqual([])
  })

  it('모양이 안 맞는 줄은 버린다 — 적재가 이미 막는 것이라 여기서는 타입만 좁힌다', () => {
    const got = submitPathsOf({
      submit: [
        { how: 'fax', text: '팩스로' },
        { how: 'branch' },
        { how: 'branch', text: '  ' },
        null,
        { how: 'app', text: '앱에서', url: '' },
      ],
    })
    // `url: ''` 은 「없음」입니다 — 빈 링크를 그리면 눌러도 아무 데도 안 갑니다
    expect(got).toEqual([{ how: 'app', text: '앱에서' }])
  })

  it('**원본을 안 고친다** — 새 배열을 만든다', () => {
    const got = submitPathsOf(BOTH)
    expect(got).not.toBe(BOTH.submit)
    expect(got[0]).not.toBe(BOTH.submit[0])
  })
})

describe('그 기관에서 헷갈리기 쉬운 것 — `caution`', () => {
  it('있으면 그대로', () => {
    expect(cautionOf({ caution: '앱의 「사고신고」는 피해구제 신청이 아닙니다' })).toBe(
      '앱의 「사고신고」는 피해구제 신청이 아닙니다',
    )
  })

  it('없으면 `null` — 확인 못 한 칸은 아예 없다 (§11.1 ①)', () => {
    expect(cautionOf({ report_tel: '1588-9999' })).toBeNull()
    expect(cautionOf(null)).toBeNull()
  })

  it('빈 문자열은 없는 것으로 본다', () => {
    expect(cautionOf({ caution: '   ' })).toBeNull()
  })
})
