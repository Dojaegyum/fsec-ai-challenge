/**
 * `kbRowToPromptEntry` — KB 행의 어느 칸이 모델에게 가나.
 *
 * 정본: spec/backend/08-16-chat-context.md §2.5
 *
 * 2026-09-06 까지는 `summary` 한 칸만 갔습니다. 그래서 서류·수수료·완료 증거·
 * 자율배상 수치처럼 `steps`·`caveat`·`legal_basis` 에 사람이 잘 써 둔 지식을
 * 챗이 「자료에 없다」고 답했습니다 — 작업 패널에는 그대로 그려지는데 챗만 몰랐습니다.
 */

import { describe, expect, it } from 'vitest'

import type { KbRow } from '@/modules/kb-finder'

import { asKbSource, kbRowToPromptEntry } from './adapters'

const SUMMARY =
  '전화로 신청했으면 신청한 날부터 3영업일 안에 서류를 따로 내야 신청이 유지됩니다.'
const STEPS = [
  { text: '별지 제1호서식 피해구제신청서를 작성합니다.', action: 'download', channel: [], contact_ref: null, url: null },
  { text: '신분증 사본 1부를 챙깁니다. 수수료는 없습니다.', action: 'read', channel: [], contact_ref: null, url: null },
  { text: '지급정지를 신청한 금융회사에 제출합니다.', action: 'visit', channel: ['visit'], contact_ref: 'org.contact.submit', url: null },
]
const CAVEAT = '거짓으로 신청하면 법 제16조제1호에 따라 처벌될 수 있습니다.'
const BASIS = '시행령 제3조제1항(별지 제1호서식) · 제2항 후단(신청한 날부터 3영업일 이내 제출)'

const row = (body: Record<string, unknown>, over: Partial<KbRow> = {}): KbRow => ({
  kbEntryId: 'common-relief-documents',
  kbVersion: '2026.09.4',
  stepKey: 'relief-documents',
  stepSeq: 40,
  channelId: null,
  orgId: null,
  track: 'victim',
  title: '신청서류를 금융회사에 제출합니다',
  body,
  legalBasis: BASIS,
  sourceUrl: 'https://www.law.go.kr/법령/…/제3조',
  effectiveFrom: '2016-07-28',
  effectiveUntil: null,
  verifiedAt: '2026-08-24',
  ...over,
})

const FULL = {
  summary: SUMMARY,
  steps: STEPS,
  caveat: CAVEAT,
  required_artifact: { kind: 'receipt_doc', label: '접수증' },
  deadline: { kind: 'business_days', amount: 3, from: 'relief_applied_at', owner: 'user' },
}

describe('적용 절차 — 사람이 KB 에 써 둔 것을 모델도 본다 (§2.5)', () => {
  const entry = kbRowToPromptEntry(row(FULL), 'applied')

  it('summary 로 시작한다 — 한 문장 요약이 맨 앞', () => {
    expect(entry.body.startsWith(SUMMARY)).toBe(true)
  })

  it('할 일은 steps 의 문장을 순서대로 번호를 붙여 한 줄에', () => {
    // 「서류는 뭘 내야 하나요? 수수료 있어요?」의 답이 여기 있습니다
    expect(entry.body).toContain(
      '할 일: 1) 별지 제1호서식 피해구제신청서를 작성합니다. 2) 신분증 사본 1부를 챙깁니다. 수수료는 없습니다. 3) 지급정지를 신청한 금융회사에 제출합니다.',
    )
  })

  it('남기는 것 — 지시문 3)「OO이 오면 올려주세요」의 근거', () => {
    expect(entry.body).toContain('남기는 것: 접수증')
  })

  it('주의 — 기대치를 낮추는 말이 모델에게 간다 (불변 규칙 8)', () => {
    expect(entry.body).toContain(`주의: ${CAVEAT}`)
  })

  it('근거 — 「무슨 법이에요」에 답할 조문', () => {
    expect(entry.body).toContain(`근거: ${BASIS}`)
  })

  it('줄 순서가 고정이다 — summary · 할 일 · 남기는 것 · 주의 · 근거', () => {
    const at = (needle: string) => entry.body.indexOf(needle)
    expect(at(SUMMARY)).toBeLessThan(at('할 일:'))
    expect(at('할 일:')).toBeLessThan(at('남기는 것:'))
    expect(at('남기는 것:')).toBeLessThan(at('주의:'))
    expect(at('주의:')).toBeLessThan(at('근거:'))
    expect(entry.body.split('\n')).toHaveLength(5)
  })

  it('label 은 title, 식별자·버전은 그대로 — 인용을 되짚는 데 쓴다', () => {
    expect(entry.label).toBe('신청서류를 금융회사에 제출합니다')
    expect(entry.kbEntryId).toBe('common-relief-documents')
    expect(entry.kbVersion).toBe('2026.09.4')
    expect(entry.channelId).toBeUndefined()
  })

  it('연락처 참조(contact_ref)·주소·구조화된 deadline 은 글자로 나가지 않는다', () => {
    // 번호는 §11.4.4 가 일부러 뺀 것이고, deadline 은 계산기의 것입니다 — 문장은 summary 가 맡습니다
    expect(entry.body).not.toContain('contact_ref')
    expect(entry.body).not.toContain('org.contact')
    expect(entry.body).not.toContain('business_days')
    expect(entry.body).not.toContain('relief_applied_at')
  })
})

describe('없는 칸은 줄을 만들지 않는다', () => {
  it('steps·caveat·required_artifact 가 없으면 summary 와 근거만', () => {
    const entry = kbRowToPromptEntry(row({ summary: SUMMARY, steps: [], caveat: null, required_artifact: null }), 'applied')
    expect(entry.body).toBe(`${SUMMARY}\n근거: ${BASIS}`)
  })

  it('빈 문장의 step 은 건너뛰고 번호도 건너뛰지 않는다', () => {
    const entry = kbRowToPromptEntry(
      row({ summary: SUMMARY, steps: [{ text: '' }, { text: '  ' }, { text: '하나만 있습니다' }] }),
      'applied',
    )
    expect(entry.body).toContain('할 일: 1) 하나만 있습니다')
    expect(entry.body).not.toContain('2)')
  })

  it('summary 가 없어도 다른 줄은 나간다 — 앞에 빈 줄을 두지 않는다', () => {
    const entry = kbRowToPromptEntry(row({ steps: STEPS }), 'applied')
    expect(entry.body.startsWith('할 일:')).toBe(true)
  })

  it('「null」「undefined」가 글자로 새지 않는다', () => {
    const entry = kbRowToPromptEntry(row({ summary: SUMMARY, caveat: undefined, required_artifact: { kind: 'receipt_no' } }), 'applied')
    expect(entry.body).not.toMatch(/null|undefined/)
    expect(entry.body).not.toContain('남기는 것:')
  })

  it('body 가 객체가 아니어도 던지지 않는다', () => {
    expect(kbRowToPromptEntry(row(null as unknown as Record<string, unknown>), 'applied').body).toBe(`근거: ${BASIS}`)
  })
})

describe('참고 절차 — summary 와 caveat 만 (§2.5 · ADR-084)', () => {
  it('할 일·남기는 것·근거는 안 가지만 caveat 은 간다 — 크기를 유형 수에 묶어 둔다', () => {
    const entry = kbRowToPromptEntry(row(FULL, { channelId: 'CH-easypay' }), 'reference')
    expect(entry.body).toBe(`${SUMMARY}\n주의: ${CAVEAT}`)
    expect(entry.body).not.toContain('할 일:')
    expect(entry.body).not.toContain('남기는 것:')
    expect(entry.body).not.toContain('근거:')
    expect(entry.channelId).toBe('CH-easypay')
  })

  it('참고 절차에도 caveat 이 붙는다 (ADR-084)', () => {
    const entry = kbRowToPromptEntry(
      row({ summary: '요약', caveat: '1년 4개월 41건 · 0.1% · 평균 116일' }),
      'reference',
    )
    expect(entry.body).toContain('주의: 1년 4개월 41건')
    expect(entry.body).not.toContain('할 일:')
  })

  it('caveat 이 없으면 summary 만 간다', () => {
    const entry = kbRowToPromptEntry(row({ summary: SUMMARY, caveat: null }), 'reference')
    expect(entry.body).toBe(SUMMARY)
  })
})

describe('asKbSource 는 묶음에 따라 다르게 옮긴다', () => {
  it('applied 는 넉넉히, reference 는 요약과 주의만', async () => {
    const source = asKbSource({
      async find() {
        return {
          applied: [row(FULL)],
          reference: [row(FULL, { kbEntryId: 'easypay-freeze-request', channelId: 'CH-easypay' })],
        }
      },
    })
    const groups = await source.find({ kbVersion: '2026.09.4', track: 'victim', channelId: 'CH-bank', orgId: null, asOf: '2026-09-06' })
    expect(groups.applied[0]!.body).toContain('할 일:')
    expect(groups.reference[0]!.body).toBe(`${SUMMARY}\n주의: ${CAVEAT}`)
    expect(groups.reference[0]!.channelId).toBe('CH-easypay')
  })
})
