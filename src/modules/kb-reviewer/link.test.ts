/**
 * 조문 ↔ 매뉴얼 규칙 시험 — API §7.4.
 *
 * 뒤쪽 「실제 KB 로」 절은 `src/kb/*.json` 의 `legal_basis` 를 그대로 읽습니다 — 파일이 바뀌면
 * 기대도 바뀝니다. 기대는 파일을 읽고 세운 것입니다(2026-09-06):
 * - `common-relief-documents` 는 시행령 제3조만 인용해 **법 제3조엔 안 닿습니다**
 * - `common-procedure-stopped` 는 「제7조제2항」을 함께 인용해 **법 제7조에 닿습니다**
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { articleRefsOf, linkEntries, parseSourceKey, sourceLabelOf } from './link'

type KbFile = { entries: { kb_entry_id: string; legal_basis: string }[] }
const load = (name: string): KbFile =>
  JSON.parse(readFileSync(new URL(`../../kb/${name}`, import.meta.url), 'utf8')) as KbFile
const FILES = { common: load('common.json'), frozen: load('frozen-account.json'), easypay: load('ch-easypay.json') }
const ENTRIES = [...FILES.common.entries, ...FILES.frozen.entries, ...FILES.easypay.entries].map((one) => ({
  kbEntryId: one.kb_entry_id,
  legalBasis: one.legal_basis,
}))
const basisOf = (id: string) => ENTRIES.find((one) => one.kbEntryId === id)!.legalBasis

describe('source_key 읽기', () => {
  it('법령 번호와 조를 뽑는다', () => {
    expect(parseSourceKey('law:011359:제3조')).toEqual({ lawId: '011359', article: '제3조' })
    expect(parseSourceKey('law:011448:제11조의3')).toEqual({ lawId: '011448', article: '제11조의3' })
  })
  it('다른 접두사는 모른다', () => {
    expect(parseSourceKey('page:kfb-vphishing')).toBeNull()
    expect(parseSourceKey('law:011359')).toBeNull()
  })
  it('라벨은 말로', () => {
    expect(sourceLabelOf('law:011359:제3조')).toBe('법 011359 · 통신사기피해환급법')
    expect(sourceLabelOf('law:011448:제3조')).toBe('시행령 011448 · 통신사기피해환급법 시행령')
    expect(sourceLabelOf('page:x')).toBe('page:x')
  })
})

describe('legal_basis 에서 조 번호를 뽑는다', () => {
  it('법 이름이 앞에 붙은 것은 「법」으로 읽고 항·호는 버린다', () => {
    const refs = articleRefsOf('통신사기피해환급법 제3조제1항(피해구제 신청) · 제4조제1항제1호')
    expect(refs).toEqual(new Set(['법 제3조', '법 제4조']))
  })
  it('시행령은 따로 센다', () => {
    const refs = articleRefsOf('시행령 제3조제1항 단서 · 법 제5조제2항')
    expect(refs).toEqual(new Set(['시행령 제3조', '법 제5조']))
  })
  it('「법 제N조」 없이 「제N조」만 이어지면 앞의 법령을 따른다', () => {
    const refs = articleRefsOf('법 제9조제1항 · 제9조제2항 · 제10조제1항 후단')
    expect(refs).toEqual(new Set(['법 제9조', '법 제10조']))
  })
  it('「같은 법 시행령 제7조」는 시행령이다', () => {
    const refs = articleRefsOf('통신사기피해환급법 제7조제1항 — … 같은 법 시행령 제7조 — 별지 제4호서식')
    expect(refs).toEqual(new Set(['법 제7조', '시행령 제7조']))
  })
  it('다른 법의 조는 세지 않는다 — 우리 조문에 잇는 것이 가장 나쁜 오답이다', () => {
    // common-identity-check 의 실제 글 — 전기통신사업법 제32조의6 은 우리 법이 아닙니다
    expect(articleRefsOf('… 전기통신사업법 제32조의6이 전기통신사업자에게 제공을 의무화한 서비스이고 …').size).toBe(0)
    // easypay-freeze-request 의 실제 글 — 「전자금융거래법」 제2조제4호 · 제28조제2항제3호 는 건너뛰고
    // 통신사기피해환급법 제15조제3항 · 같은 법 시행령 제11조의3 만 남습니다
    expect(articleRefsOf(basisOf('easypay-freeze-request'))).toEqual(new Set(['법 제15조', '시행령 제11조의3']))
  })
  it('법정 절차가 아닌 항목은 비어 있다', () => {
    expect(articleRefsOf('법정 절차가 아닙니다. 수사 개시와 …').size).toBe(0)
  })
})

describe('닿는 매뉴얼 — 실제 KB 로', () => {
  it('법 제3조는 지급정지 요청 · 피해구제 신청 둘에 닿는다 — 서류 제출은 시행령만 인용한다', () => {
    expect(linkEntries('law:011359:제3조', ENTRIES)).toEqual(['common-freeze-request', 'common-relief-apply'])
  })
  it('법 제7조는 절차 종료(제7조제2항 인용)와 통장묶기 둘, 셋에 닿는다', () => {
    expect(linkEntries('law:011359:제7조', ENTRIES)).toEqual([
      'common-procedure-stopped',
      'frozen-objection-file',
      'frozen-objection-result',
    ])
  })
  it('시행령 제3조는 서류 제출에 닿고 법 제3조만 인용한 지급정지 요청엔 안 닿는다', () => {
    const hit = linkEntries('law:011448:제3조', ENTRIES)
    expect(hit).toContain('common-relief-documents')
    expect(hit).toContain('common-relief-apply')
    expect(hit).not.toContain('common-freeze-request')
  })
  it('새 조문은 아무 데도 안 닿는다', () => {
    expect(linkEntries('law:011359:제13조의4', ENTRIES)).toEqual([])
  })
  it('기관 페이지는 이 규칙 밖이다', () => {
    expect(linkEntries('page:kfb-vphishing', ENTRIES)).toEqual([])
  })
})
