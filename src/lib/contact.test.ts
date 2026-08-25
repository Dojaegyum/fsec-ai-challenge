/**
 * `contact_ref` 를 푸는 규칙 — **틀린 번호는 없는 번호보다 나쁩니다.**
 *
 * 계약: spec/backend/08-16-data-model.md §11.1 §11.4.1 §11.4.3 ·
 *       spec/common/08-14-api.md §3.6
 */

import { describe, expect, it } from 'vitest'

import { resolveContact, withContacts } from './contact'

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
