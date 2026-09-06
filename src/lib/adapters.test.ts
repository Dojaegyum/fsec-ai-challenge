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

import { asKbSource, asSelectorSource, kbRowToPromptEntry, selectedEntryOf } from './adapters'
import type { PoolEntry } from './db-selector'
import type { SelectorCandidate } from '@/modules/kb-selector'

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

describe('선별기가 고른 것 → 프롬프트 항목 (§2.6 · ADR-089 ⑤)', () => {
  const LAW: PoolEntry = {
    kind: 'law',
    law: {
      snapshotId: 'S1',
      sourceKey: 'law:011359:3',
      fetchedAt: '2026-09-06',
      content: '  피해자는 금융회사에 지급정지를 신청할 수 있다.  ',
      meta: { 법령명: '통신사기피해환급법', 조문제목: '지급정지' },
    },
  }
  const ORG: PoolEntry = {
    kind: 'org',
    org: {
      orgId: 'kb-bank',
      channelId: 'CH-bank',
      name: 'KB국민은행',
      contact: {
        report_tel: '1588-9999',
        report_hours: '24시간',
        submit: [{ how: 'branch', text: '가까운 영업점에 서면으로 제출합니다' }],
        caution: '앱의 「사고신고」는 피해구제 신청이 아닙니다',
      },
    },
  }

  it('절차는 적용 절차와 같은 다섯 줄이고 식별자·버전이 실린다', () => {
    const one = selectedEntryOf({ kind: 'kb', row: row({ summary: SUMMARY, steps: STEPS, caveat: CAVEAT }) })
    expect(one.kind).toBe('kb')
    expect(one.kbEntryId).toBe('common-relief-documents')
    expect(one.kbVersion).toBe('2026.09.4')
    expect(one.body).toBe(kbRowToPromptEntry(row({ summary: SUMMARY, steps: STEPS, caveat: CAVEAT }), 'applied').body)
  })

  it('기관은 연락처 넷 — 신고 전화 · 운영 시간 · 제출 · 주의', () => {
    const one = selectedEntryOf(ORG)
    expect(one).toEqual({
      kind: 'org',
      label: 'KB국민은행 연락처',
      body: [
        '신고 전화: 1588-9999',
        '운영 시간: 24시간',
        '제출: 1) 가까운 영업점에 서면으로 제출합니다',
        '주의: 앱의 「사고신고」는 피해구제 신청이 아닙니다',
      ].join('\n'),
    })
  })

  it('조문은 원문 그대로에 가져온 날 한 줄 — 라벨은 법령명 제n조(제목)', () => {
    const one = selectedEntryOf(LAW)
    expect(one).toEqual({
      kind: 'law',
      label: '통신사기피해환급법 제3조(지급정지)',
      body: '피해자는 금융회사에 지급정지를 신청할 수 있다.\n가져온 날: 2026-09-06',
    })
  })

  it('긴 조문은 1,500자에서 자르고 잘렸다고 적는다', () => {
    const one = selectedEntryOf({ ...LAW, law: { ...LAW.law, content: '가'.repeat(2_000) } })
    expect(one.body.startsWith('가'.repeat(1_500))).toBe(true)
    expect(one.body).toContain('(이하 생략)')
    expect(one.body).not.toContain('가'.repeat(1_501))
  })

  it('가지번호가 있으면 제n조의m', () => {
    const one = selectedEntryOf({ ...LAW, law: { ...LAW.law, sourceKey: 'law:011359:13:4', meta: {} } })
    expect(one.label).toBe('제13조의4')
  })
})

describe('asSelectorSource — 풀을 읽고 고르게 하고 본문을 옮긴다', () => {
  const pool = {
    load: async () => ({
      candidates: [
        { key: 'kb:card', kind: 'kb' as const, tag: '카드', preview: '…' },
        { key: 'org:kb-bank', kind: 'org' as const, tag: 'KB국민은행', preview: '…' },
      ],
      entries: new Map<string, PoolEntry>([
        ['kb:card', { kind: 'kb', row: row({ summary: '카드사에 지급정지를 요청합니다.' }, { kbEntryId: 'card', title: '카드 지급정지' }) }],
        ['org:kb-bank', { kind: 'org', org: { orgId: 'kb-bank', channelId: 'CH-bank', name: 'KB국민은행', contact: { report_tel: '1588-9999' } } }],
      ]),
    }),
  }

  it('고른 순서대로 본문을 옮기고 통계에 열쇠를 남긴다', async () => {
    const source = asSelectorSource(
      {
        select: async (input) => ({
          picked: [input.candidates[1]!, input.candidates[0]!],
          stats: { pool: 2, groups: 1, rounds: 0, ms: 300, calls: [{ model: 'fast', tokenIn: 10, tokenOut: 2 }] },
        }),
      },
      pool,
    )
    const out = await source.select({ history: [], kbVersion: '2026.09.4', asOf: '2026-09-06', exclude: new Set(), orgId: null, channelId: null })

    expect(out.entries.map((one) => one.label)).toEqual(['KB국민은행 연락처', '카드 지급정지'])
    expect(out.entries[1]).toMatchObject({ kind: 'kb', kbEntryId: 'card', kbVersion: '2026.09.4' })
    expect(out.stats).toEqual({
      pool: 2,
      groups: 1,
      rounds: 0,
      ms: 300,
      picked: ['org:kb-bank', 'kb:card'],
      calls: [{ model: 'fast', tokenIn: 10, tokenOut: 2 }],
    })
  })

  it('풀 읽기가 실패하면 빈 선택 · skipped=error — 던지지 않는다', async () => {
    const source = asSelectorSource(
      { select: async () => { throw new Error('불려서는 안 됩니다') } },
      { load: async () => { throw new Error('DB 다운') } },
    )
    const out = await source.select({ history: [], kbVersion: '2026.09.4', asOf: '2026-09-06', exclude: new Set(), orgId: null, channelId: null })
    expect(out.entries).toEqual([])
    expect(out.stats.skipped).toBe('error')
  })
  it('이 사건의 기관·유형에는 후보 이름 뒤에 표시를 붙인다 — 선별기가 그것을 우선하게', async () => {
    let seen: readonly { key: string; tag: string }[] = []
    const source = asSelectorSource(
      {
        select: async (input) => {
          seen = input.candidates
          return { picked: [], stats: { pool: 2, groups: 1, rounds: 0, ms: 1, calls: [] } }
        },
      },
      pool,
    )
    await source.select({ history: [], kbVersion: '2026.09.4', asOf: '2026-09-06', exclude: new Set(), orgId: 'kb-bank', channelId: 'CH-card' })

    expect(seen.find((one) => one.key === 'org:kb-bank')?.tag).toBe('KB국민은행 (이 사건의 기관)')
    // 카드 절차 행은 channelId 가 없어(공통) 유형 표시가 안 붙는다
    expect(seen.find((one) => one.key === 'kb:card')?.tag).toBe('카드')
  })

  describe('사건에 기관이 붙어 있으면 다른 기관의 연락처는 버린다 — 배포본 점검 2026-09-06', () => {
    const twoBanks = {
      load: async () => ({
        candidates: [
          { key: 'org:kb-bank', kind: 'org' as const, tag: 'KB국민은행', preview: '…' },
          { key: 'org:shinhan-bank', kind: 'org' as const, tag: '신한은행', preview: '…' },
          { key: 'kb:card', kind: 'kb' as const, tag: '카드', preview: '…' },
        ],
        entries: new Map<string, PoolEntry>([
          ['org:kb-bank', { kind: 'org', org: { orgId: 'kb-bank', channelId: 'CH-bank', name: 'KB국민은행', contact: { report_tel: '1588-9999' } } }],
          ['org:shinhan-bank', { kind: 'org', org: { orgId: 'shinhan-bank', channelId: 'CH-bank', name: '신한은행', contact: { report_tel: '1599-8000' } } }],
          ['kb:card', { kind: 'kb', row: row({ summary: '카드사에 지급정지를 요청합니다.' }, { kbEntryId: 'card', title: '카드 지급정지' }) }],
        ]),
      }),
    }
    const pickAll = {
      select: async (input: { candidates: readonly SelectorCandidate[] }) => ({
        picked: [...input.candidates],
        stats: { pool: 3, groups: 1, rounds: 0, ms: 1, calls: [] },
      }),
    }

    it('이 사건의 기관과 절차는 남고 남의 은행은 빠진다 — 통계의 picked 도 같이', async () => {
      const out = await asSelectorSource(pickAll, twoBanks).select({
        history: [{ speaker: 'user', text: '은행에 전화했는데 안 받아요' }],
        kbVersion: '2026.09.4', asOf: '2026-09-06', exclude: new Set(), orgId: 'kb-bank', channelId: 'CH-bank',
      })
      expect(out.entries.map((one) => one.label)).toEqual(['KB국민은행 연락처', '카드 지급정지'])
      expect(out.stats.picked).toEqual(['org:kb-bank', 'kb:card'])
    })

    it('사용자가 다른 은행 이름을 직접 적으면 그 은행은 남는다', async () => {
      const out = await asSelectorSource(pickAll, twoBanks).select({
        history: [{ speaker: 'user', text: '신한은행에도 전화해야 하나요?' }],
        kbVersion: '2026.09.4', asOf: '2026-09-06', exclude: new Set(), orgId: 'kb-bank', channelId: 'CH-bank',
      })
      expect(out.stats.picked).toEqual(['org:kb-bank', 'org:shinhan-bank', 'kb:card'])
    })

    it('기관이 안 정해진 사건은 걸러 낼 근거가 없어 그대로 둔다', async () => {
      const out = await asSelectorSource(pickAll, twoBanks).select({
        history: [{ speaker: 'user', text: '은행에 전화했는데 안 받아요' }],
        kbVersion: '2026.09.4', asOf: '2026-09-06', exclude: new Set(), orgId: null, channelId: null,
      })
      expect(out.stats.picked).toEqual(['org:kb-bank', 'org:shinhan-bank', 'kb:card'])
    })
  })
})
