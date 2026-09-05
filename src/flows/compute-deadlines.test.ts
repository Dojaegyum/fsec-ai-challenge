/**
 * 기한을 만드는 규칙 — **날짜가 하루 틀리면 권리가 사라집니다.**
 *
 * 계약: spec/common/08-16-deadline-rules.md · spec/backend/08-16-data-model.md §8 §11.4.2 ·
 *       spec/common/08-14-api.md §3.7
 *
 * `date-checker` 는 **진짜를 씁니다.** 가짜로 바꾸면 이 파일이 확인하는 것이
 * 「우리가 부르긴 했다」로 줄어듭니다 — 정작 틀리는 자리는 KB 의 규칙을
 * 그 모듈이 받는 모양으로 옮기는 이 이음매입니다.
 */

import { describe, expect, it } from 'vitest'

import { planDeadlines, type AnchorSlot } from './compute-deadlines'
import type { StoredStep } from './regenerate-plan'

import { createDateChecker } from '@/modules/date-checker'

/** 공휴일 없는 달력. 필요한 시험만 따로 넣습니다 */
function dates(holidays: readonly string[] = []) {
  return createDateChecker({
    holidays: { isPublicHoliday: (date) => holidays.includes(date) },
    // 이 파일이 보는 것은 `compute` 뿐이라 오늘은 안 씁니다
    clock: { today: () => '2026-08-18' },
  })
}

/** 시행령 제3조제2항 — 신청한 날부터 **3영업일**, 넘기면 14일 추가 */
const RELIEF_DEADLINE = {
  kind: 'business_days',
  amount: 3,
  from: 'relief_applied_at',
  owner: 'user',
  grace: {
    kind: 'calendar_days',
    amount: 14,
    condition: '3영업일을 넘기면 금융회사가 14일의 추가 기간을 정해 통지합니다',
  },
  on_miss: '추가 기간까지 제출하지 않으면 신청이 없었던 것으로 봅니다',
}

function step(over: Partial<StoredStep> = {}): StoredStep {
  return {
    planStepId: '01J8STEP0000000000000000AA',
    stepKey: 'relief-documents',
    seq: 40,
    title: '신청서류를 금융회사에 제출합니다',
    actor: 'victim',
    conditional: null,
    state: 'not_started',
    body: { deadline: RELIEF_DEADLINE },
    kbEntryId: 'common-relief-documents',
    kbVersion: '2026.08.1',
    legalBasis: '시행령 제3조제1항·제2항 후단·제3항',
    sourceUrl: 'https://www.law.go.kr/법령/…시행령/제3조',
    effectiveFrom: '2016-07-28',
    artifacts: [],
    requiredArtifact: { kind: 'receipt_doc', label: '접수증' },
    ...over,
  }
}

/** 2026-08-17 은 월요일입니다 → 초일 불산입으로 18·19·20 이 세 영업일 */
function slot(over: Partial<AnchorSlot> = {}): AnchorSlot {
  return {
    slotKey: 'relief_applied_at',
    state: 'confirmed',
    source: 'system',
    valueMasked: '2026-08-17',
    ...over,
  }
}

function plan(steps: readonly StoredStep[], slots: readonly AnchorSlot[], holidays?: string[]) {
  return planDeadlines({
    steps,
    slots,
    kbVersion: '2026.08.1',
    dates: dates(holidays),
  })
}

describe('기산점이 없으면 기한도 없다', () => {
  it('슬롯이 하나도 없으면 줄을 안 만든다', () => {
    expect(plan([step()], [])).toEqual([])
  })

  it('「모름」으로 답한 슬롯은 기산점이 아니다', () => {
    expect(plan([step()], [slot({ state: 'unknown', valueMasked: null })])).toEqual([])
  })

  it('확인 전(`pii_pending`)은 없는 값과 같다 — 0003 마이그레이션', () => {
    expect(plan([step()], [slot({ state: 'pii_pending' })])).toEqual([])
  })

  it('뽑히기만 한 값(`extracted`)도 아직 기산점이 아니다', () => {
    expect(plan([step()], [slot({ state: 'extracted' })])).toEqual([])
  })

  it('날짜로 못 읽는 글은 기산점이 아니다 — 지어내지 않는다', () => {
    expect(plan([step()], [slot({ valueMasked: '어제쯤이요' })])).toEqual([])
    expect(plan([step()], [slot({ valueMasked: '8월 17일' })])).toEqual([])
  })

  it('기한이 없는 단계는 지나간다', () => {
    expect(plan([step({ body: { deadline: null } })], [slot()])).toEqual([])
  })
})

describe('본 기한과 유예 — 별도 줄로 (§8.1)', () => {
  it('월요일 신청 + 3영업일이면 목요일이 만기다 — 초일 불산입', () => {
    const [primary] = plan([step()], [slot()])
    expect(primary.kind).toBe('primary')
    expect(primary.dueAt).toBe('2026-08-20T23:59:59+09:00')
    expect(primary.computedFrom).toBe('relief_applied_at')
  })

  it('유예는 **본 기한의 만기**에서 다시 센다 — 원래 기산점이 아니다', () => {
    const [, grace] = plan([step()], [slot()])
    expect(grace.kind).toBe('grace')
    // 08-20 + 14 달력일. 원래 기산점(08-17)에서 세면 08-31 이 되어 사흘 짧다
    expect(grace.dueAt).toBe('2026-09-03T23:59:59+09:00')
  })

  it('합치지 않는다 — 두 줄이고 같은 단계에 딸린다', () => {
    const rows = plan([step()], [slot()])
    expect(rows).toHaveLength(2)
    expect(rows.map((one) => one.kind)).toEqual(['primary', 'grace'])
    expect(new Set(rows.map((one) => one.planStepId)).size).toBe(1)
  })

  it('유예에 조건이 붙는다 — 없으면 추가 기간을 본 기한으로 착각한다', () => {
    const [, grace] = plan([step()], [slot()])
    expect(grace.ruleSnapshot.condition).toContain('14일의 추가 기간')
  })

  it('넘겼을 때 무슨 일이 생기나가 두 줄 모두에 남는다', () => {
    for (const row of plan([step()], [slot()])) {
      expect(row.ruleSnapshot.on_miss).toContain('신청이 없었던 것으로 봅니다')
    }
  })

  it('공휴일이 끼면 그만큼 밀리고, 무엇 때문인지 남는다', () => {
    // 2026-08-19(수)가 쉬는 날이면 18·20·21 이 세 영업일
    const [primary] = plan([step()], [slot()], ['2026-08-19'])
    expect(primary.dueAt).toBe('2026-08-21T23:59:59+09:00')
    expect(primary.ruleSnapshot.holidays_used).toEqual(['2026-08-19'])
  })
})

describe('기한의 주인이 종류를 정한다 — §11.4.2', () => {
  const info = { ...RELIEF_DEADLINE, owner: 'agency', grace: null }

  it('기관이 하는 일은 `info` 다 — 사용자 기한으로 오인시키지 않는다', () => {
    const rows = plan([step({ body: { deadline: info } })], [slot()])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('info')
  })

  it('`info` 에는 달력 앵커의 왼쪽 끝이 붙는다 — ADR-048', () => {
    const [one] = plan([step({ body: { deadline: info } })], [slot()])
    expect(one.ruleSnapshot.starts_at).toBe('2026-08-17T00:00:00+09:00')
  })

  it('사용자 기한에는 `starts_at` 을 안 단다 — D-day 로 충분하다', () => {
    const [primary] = plan([step()], [slot()])
    expect(primary.ruleSnapshot.starts_at).toBeUndefined()
  })

  it('주인이 없으면 만들지 않는다 — 사용자 기한인지 아닌지를 못 정한다', () => {
    const noOwner = { ...RELIEF_DEADLINE, owner: undefined }
    expect(plan([step({ body: { deadline: noOwner } })], [slot()])).toEqual([])
  })

  it('`info` 에는 유예를 안 붙인다 — 기관이 하는 일에 추가 기간이 없다', () => {
    const withGrace = { ...RELIEF_DEADLINE, owner: 'bank' }
    expect(plan([step({ body: { deadline: withGrace } })], [slot()])).toHaveLength(1)
  })
})

describe('부산물에서 온 값과 사용자가 말한 값을 가른다', () => {
  it('부산물이 채운 값은 확정이다', () => {
    const [primary] = plan([step()], [slot({ source: 'system' })])
    expect(primary.ruleSnapshot.estimated).toBe(false)
  })

  it('증거에서 뽑은 값도 확정이다', () => {
    const [primary] = plan([step()], [slot({ source: 'auto' })])
    expect(primary.ruleSnapshot.estimated).toBe(false)
  })

  it('사용자가 기억으로 댄 날짜는 **추정**이다 — 확정 기한처럼 보이면 안 된다', () => {
    const [primary, grace] = plan([step()], [slot({ source: 'user' })])
    expect(primary.ruleSnapshot.estimated).toBe(true)
    // 유예도 같은 기산점에서 나왔으므로 함께 추정입니다
    expect(grace.ruleSnapshot.estimated).toBe(true)
  })
})

describe('`artifact:{kind}` 기산점 — §11.4', () => {
  const fromArtifact = { ...RELIEF_DEADLINE, from: 'artifact:receipt_no' }

  const withArtifact = (verifyResult: string) =>
    step({
      body: { deadline: fromArtifact },
      artifacts: [
        {
          artifactId: '01J8ART0000000000000000AA',
          kind: 'receipt_no',
          verifyLevel: 'L1',
          verifyResult,
          createdAt: '2026-08-17T14:30:00+09:00',
        },
      ],
    })

  it('검증을 통과한 부산물의 날짜에서 센다', () => {
    // ⚠️ **값은 `passed` 입니다** — 09-data-model.md §7 의 CHECK 제약이 정본이고
    // `completion-checker` 도 그 셋만 냅니다. 표 밖의 값을 찾으면 이 기한이
    // 영영 안 생기는데, 안 생기는 것은 조용해서 시험이 없으면 안 보입니다
    const [primary] = plan([withArtifact('passed')], [])
    expect(primary.dueAt).toBe('2026-08-20T23:59:59+09:00')
    expect(primary.computedFrom).toBe('artifact:receipt_no')
    expect(primary.ruleSnapshot.estimated).toBe(false)
  })

  it('L1 실패는 기산점이 아니다', () => {
    expect(plan([withArtifact('failed')], [])).toEqual([])
  })

  it('자기 신고(L3)는 기산점이 아니다 — 「했다」의 근거가 아니다', () => {
    // `completion-checker` 가 L3 에 내는 값입니다 — 「검증할 것이 없었다」이지
    // 「했다」가 아닙니다
    expect(plan([withArtifact('not_applicable')], [])).toEqual([])
  })

  it('부산물이 없으면 기한도 없다', () => {
    expect(plan([step({ body: { deadline: fromArtifact } })], [])).toEqual([])
  })
})

describe('계산 근거를 통째로 남긴다 — §8.2', () => {
  it('KB 가 개정돼도 「그때 무엇을 근거로 이 날짜가 나왔나」가 남는다', () => {
    const [primary] = plan([step()], [slot()])
    expect(primary.ruleSnapshot).toMatchObject({
      kb_entry_id: 'common-relief-documents',
      kb_version: '2026.08.1',
      legal_basis: '시행령 제3조제1항·제2항 후단·제3항',
      effective_from: '2016-07-28',
    })
    // 참조만 남기지 않습니다 — 규칙 자체가 들어 있어야 재현됩니다
    expect(primary.ruleSnapshot.rule).toMatchObject({ kind: 'business_days', amount: 3 })
  })

  it('유예 줄에는 유예 규칙과 중간값이 남는다', () => {
    const [, grace] = plan([step()], [slot()])
    expect(grace.ruleSnapshot.rule).toMatchObject({ kind: 'calendar_days', amount: 14 })
    expect(grace.ruleSnapshot.grace_from).toBe('2026-08-20')
  })
})

describe('KB 가 깨져 있어도 사건 전체를 멈추지 않는다', () => {
  it('단위가 목록 밖이면 그 기한만 건너뛴다', () => {
    const bad = { ...RELIEF_DEADLINE, kind: 'weeks' }
    expect(plan([step({ body: { deadline: bad } })], [slot()])).toEqual([])
  })

  it('일수가 숫자가 아니면 그 기한만 건너뛴다', () => {
    const bad = { ...RELIEF_DEADLINE, amount: '3' }
    expect(plan([step({ body: { deadline: bad } })], [slot()])).toEqual([])
  })

  it('깨진 단계 옆의 멀쩡한 단계는 그대로 선다', () => {
    const bad = step({ planStepId: 'x', body: { deadline: { ...RELIEF_DEADLINE, amount: 0 } } })
    const rows = plan([bad, step()], [slot()])
    expect(rows).toHaveLength(2)
    expect(rows.every((one) => one.planStepId === '01J8STEP0000000000000000AA')).toBe(true)
  })
})

/**
 * 파생 기산점 — ADR-073. 「채권이 소멸된 날부터 14일」의 기산점은 슬롯도 부산물도 아니라
 * 공고일 + 2개월(법 제9조제1항)이고, 규칙이 셉니다.
 */
describe('파생 기산점 `debt_extinct_at` — ADR-073', () => {
  const REFUND_DEADLINE = {
    kind: 'calendar_days',
    amount: 14,
    from: 'debt_extinct_at',
    owner: 'agency',
  }
  const refund = () =>
    step({
      planStepId: '01J8STEP0000000000000000RD',
      stepKey: 'refund-decision',
      seq: 51,
      actor: 'agency',
      body: { deadline: REFUND_DEADLINE },
      kbEntryId: 'common-refund-decision',
      requiredArtifact: { kind: 'receipt_doc', label: '피해환급금 결정 통지문' },
    })

  it('공고일 + 2개월 + 14일 — 달 셈은 date-checker 하나로', () => {
    const rows = plan(
      [refund()],
      [slot({ slotKey: 'notice_started_at', source: 'auto', valueMasked: '2026-09-03' })],
    )
    expect(rows).toHaveLength(1)
    // 2026-09-03 + 2개월 = 2026-11-03 (채권 소멸일) · + 14일 = 2026-11-17
    expect(rows[0]!.dueAt.startsWith('2026-11-17')).toBe(true)
    expect(rows[0]!.computedFrom).toBe('debt_extinct_at')
    expect(rows[0]!.kind).toBe('info')
  })

  it('공고일이 추정이면 파생 기한도 추정이다', () => {
    const rows = plan(
      [refund()],
      [slot({ slotKey: 'notice_started_at', source: 'user', valueMasked: '2026-09-03' })],
    )
    expect(rows[0]!.ruleSnapshot.estimated).toBe(true)
  })

  it('공고일이 없으면 파생 기한도 없다 — 지어내지 않는다', () => {
    expect(plan([refund()], [])).toEqual([])
  })
})
