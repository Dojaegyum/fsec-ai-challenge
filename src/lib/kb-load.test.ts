/**
 * KB 적재 검증 시험 — §11.4.5 의 열 가지를 하나씩 겨눕니다.
 *
 * **맨 아래가 제일 중요합니다** — 실제로 배포될 `src/kb/*.json` 이 통과하는지.
 * 규칙만 시험하면 규칙은 맞는데 파일이 안 실리는 상태를 못 봅니다.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { planLoad, type KbFile } from './kb-load'

const OPTS = { kbVersion: '2026.08.1', releasedAt: '2026-08-24T00:00:00.000Z' }

/** 통과하는 최소 항목 하나. 시험마다 여기서 한 칸씩 망가뜨립니다 */
const good = (over: Record<string, unknown> = {}, bodyOver: Record<string, unknown> = {}) => ({
  kb_entry_id: 'x-1',
  step_key: 'step-one',
  step_seq: 10,
  org_id: null,
  title: '무언가를 합니다',
  legal_basis: '어느 조문',
  source_url: 'https://www.law.go.kr/법령/어떤법/제1조',
  effective_from: '2016-07-28',
  effective_until: null,
  verified_at: '2026-08-24',
  body: {
    actor: 'victim',
    requires_slots: [],
    after: [],
    conditional: null,
    summary: '요약',
    steps: [{ text: '전화합니다', action: 'call', channel: ['phone'], contact_ref: null, url: null }],
    deadline: null,
    required_artifact: null,
    caveat: null,
    ...bodyOver,
  },
  ...over,
})

const file = (entries: unknown[]): KbFile => ({
  name: 'test.json',
  channel_id: null,
  track: 'victim',
  entries,
})

const run = (entries: unknown[]) => planLoad([file(entries)], OPTS)
const rulesOf = (entries: unknown[]) => run(entries).problems.map((p) => p.rule)

/** 시행령 제3조제2항 — 신청한 날부터 3영업일, 넘기면 14일 추가 */
const DEADLINE = {
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

/**
 * 기한 — **여기서 안 잡으면 조용히 사라집니다.**
 *
 * 계산기가 못 읽는 규칙은 그 기한을 안 만들고 지나가므로, 피해자는 3영업일
 * 기한을 한 번도 못 보고 권리를 잃습니다. 터지지도 않습니다.
 */
describe('기한 규칙 — §11.4.2', () => {
  const withDeadline = (over: Record<string, unknown>) =>
    rulesOf([good({}, { deadline: { ...DEADLINE, ...over } })])

  it('멀쩡한 기한은 통과한다', () => {
    expect(rulesOf([good({}, { deadline: DEADLINE })])).toEqual([])
  })

  it('기한이 없는 단계가 정상이다', () => {
    expect(rulesOf([good({}, { deadline: null })])).toEqual([])
  })

  it('주인이 없으면 거부한다 — 사용자 기한인지 아닌지를 못 정한다', () => {
    expect(withDeadline({ owner: undefined })).toContain('DEADLINE')
    expect(withDeadline({ owner: 'victim' })).toContain('DEADLINE')
  })

  it('단위가 둘 밖이면 거부한다', () => {
    // ⬜ `months`(채권소멸공고 2개월)는 계산기에 아직 없습니다
    expect(withDeadline({ kind: 'months' })).toContain('DEADLINE')
  })

  it('일수가 1 이상의 정수가 아니면 거부한다', () => {
    expect(withDeadline({ amount: 0 })).toContain('DEADLINE')
    expect(withDeadline({ amount: '3' })).toContain('DEADLINE')
  })

  it('기산점이 §5.1 목록 밖이면 거부한다 — 그 슬롯은 영영 안 채워진다', () => {
    expect(withDeadline({ from: 'relief_date' })).toContain('DEADLINE')
    expect(withDeadline({ from: undefined })).toContain('DEADLINE')
  })

  it('부산물을 기산점으로 쓰는 것은 통과한다 — §11.4', () => {
    expect(withDeadline({ from: 'artifact:receipt_no' })).toEqual([])
  })

  it('유예에 조건이 없으면 거부한다 — 본 기한으로 착각한다 (§8.1)', () => {
    const grace = { kind: 'calendar_days', amount: 14 }
    expect(withDeadline({ grace })).toContain('DEADLINE')
  })

  it('유예의 단위도 본다', () => {
    const grace = { ...DEADLINE.grace, kind: 'weeks' }
    expect(withDeadline({ grace })).toContain('DEADLINE')
  })
})

describe('통과하는 것은 통과한다', () => {
  it('멀쩡한 항목 하나는 행 하나가 된다', () => {
    const { rows, problems } = run([good()])
    expect(problems).toEqual([])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kb_entry_id).toBe('x-1')
  })

  it('버전과 릴리스 시각은 **적재기가 찍는다** — 파일에 없다', () => {
    const { rows } = run([good()])
    expect(rows[0]?.kb_version).toBe('2026.08.1')
    expect(rows[0]?.released_at).toBe('2026-08-24T00:00:00.000Z')
  })

  it('`_todo` 같은 메모는 DB 로 안 옮긴다', () => {
    const { rows } = run([good({}, { _todo: ['사람이 볼 메모'] })])
    expect(Object.keys(rows[0]!.body)).not.toContain('_todo')
    expect(rows[0]?.body.summary).toBe('요약')
  })
})

describe('근거가 없으면 거부한다 — 이 서비스의 뿌리', () => {
  it.each(['legal_basis', 'source_url', 'effective_from'] as const)('`%s` 가 비면 거부', (key) => {
    expect(rulesOf([good({ [key]: '' })])).toContain('EVIDENCE')
  })

  it('**`TODO(근거 필요)` 도 빈 것으로 본다**', () => {
    // 이 문자열이 그대로 실려 나가면 「근거가 있다」로 읽힙니다
    expect(rulesOf([good({ effective_from: 'TODO(근거 필요)' })])).toContain('EVIDENCE')
  })

  it('어긴 항목은 **행으로 안 나간다** — 반쯤 맞는 절차가 더 나쁘다', () => {
    const { rows } = run([good({ legal_basis: '' })])
    expect(rows).toEqual([])
  })

  it('시행일이 날짜 모양이 아니면 거부', () => {
    expect(rulesOf([good({ effective_from: '2016년 7월 28일' })])).toContain('EVIDENCE')
  })
})

describe('누가 하는 단계인가 — **없으면 사건 생성이 500 으로 터진다**', () => {
  it('없으면 거부', () => {
    // 2026-08-24: 이걸 안 보고 적재해서 `POST /api/cases` 가 통째로 죽었습니다.
    // 적재 때 잡으면 사건을 만들기 전에 압니다
    expect(rulesOf([good({}, { actor: undefined })])).toContain('ACTOR')
  })

  it('여섯 밖이면 거부', () => {
    expect(rulesOf([good({}, { actor: 'user' })])).toContain('ACTOR')
  })

  it('**기본값을 두지 않는다** — 기관이 할 일이 사용자 할 일로 뜨면 안 된다', () => {
    expect(rulesOf([good({}, { actor: 'bank' })])).toEqual([])
    expect(rulesOf([good({}, { actor: 'victim' })])).toEqual([])
  })
})

describe('슬롯 이름 — 없는 이름은 영영 안 채워진다', () => {
  it('목록 밖 이름이면 거부', () => {
    expect(rulesOf([good({}, { requires_slots: ['relief_applied'] })])).toContain('SLOT')
  })

  it('목록 안 이름은 통과', () => {
    expect(rulesOf([good({}, { requires_slots: ['relief_applied_at'] })])).toEqual([])
  })
})

describe('선행 참조와 고리', () => {
  it('없는 단계를 가리키면 거부', () => {
    expect(rulesOf([good({}, { after: ['없는-단계'] })])).toContain('AFTER')
  })

  it('**파일이 달라도 가리킬 수 있다** — §11.2 우선순위 병합', () => {
    const common = { ...file([good()]), name: 'common.json' }
    const bank = {
      ...file([good({ kb_entry_id: 'x-2', step_key: 'step-two' }, { after: ['step-one'] })]),
      name: 'ch-bank.json',
    }
    expect(planLoad([common, bank], OPTS).problems).toEqual([])
  })

  it('서로를 가리키면 거부 — 순서를 정할 수 없다', () => {
    const a = good({ kb_entry_id: 'a', step_key: 'a' }, { after: ['b'] })
    const b = good({ kb_entry_id: 'b', step_key: 'b' }, { after: ['a'] })
    expect(rulesOf([a, b])).toContain('CYCLE')
  })
})

describe('행동과 창구 — 화면이 열 패널을 정하는 값', () => {
  it('여덟 밖이면 거부', () => {
    const steps = [{ text: '무언가', action: 'submit', channel: [] }]
    expect(rulesOf([good({}, { steps })])).toContain('ACTION')
  })

  it('비어 있어도 거부', () => {
    const steps = [{ text: '무언가', action: '', channel: [] }]
    expect(rulesOf([good({}, { steps })])).toContain('ACTION')
  })

  it('목록 밖 창구면 거부', () => {
    const steps = [{ text: '전화', action: 'call', channel: ['sms'] }]
    expect(rulesOf([good({}, { steps })])).toContain('CHANNEL')
  })

  it('**`call`·`visit` 이 아닌데 창구가 붙어 있으면 거부**', () => {
    const steps = [{ text: '받아적으세요', action: 'write', channel: ['phone'] }]
    expect(rulesOf([good({}, { steps })])).toContain('CHANNEL')
  })

  it('`write` 에 빈 창구는 통과', () => {
    const steps = [{ text: '받아적으세요', action: 'write', channel: [] }]
    expect(rulesOf([good({}, { steps })])).toEqual([])
  })
})

describe('본문에 번호·주소를 박지 않는다', () => {
  it('전화번호가 있으면 거부', () => {
    const steps = [{ text: '국민은행 1588-9999 로 전화합니다', action: 'call', channel: ['phone'] }]
    expect(rulesOf([good({}, { steps })])).toContain('CONTACT')
  })

  it('주소가 있으면 거부', () => {
    const steps = [{ text: 'https://example.com 에서 받습니다', action: 'download', channel: [] }]
    expect(rulesOf([good({}, { steps })])).toContain('URL')
  })

  it('⬜ **하이픈 없는 대표번호는 못 잡는다** — 「112에 신고합니다」와 구분이 안 된다', () => {
    const steps = [{ text: '1394로 전화하세요', action: 'call', channel: ['phone'] }]
    // 잡히지 않는 것이 지금의 한계입니다. §11.4.1 은 그대로 유효합니다
    expect(rulesOf([good({}, { steps })])).toEqual([])
  })

  it('112 안내는 통과해야 한다', () => {
    const steps = [{ text: '112로 전화해 신고합니다', action: 'call', channel: ['phone'] }]
    expect(rulesOf([good({}, { steps })])).toEqual([])
  })
})

describe('기한 — 주인이 없으면 거부', () => {
  const withDeadline = (over: Record<string, unknown>) =>
    good({}, { deadline: { kind: 'business_days', amount: 3, from: 'relief_applied_at', owner: 'user', ...over } })

  it('멀쩡한 기한은 통과', () => {
    expect(rulesOf([withDeadline({})])).toEqual([])
  })

  it('`owner` 가 없으면 거부 — 기관 기한을 사용자 기한으로 보이면 불필요한 불안', () => {
    expect(rulesOf([withDeadline({ owner: undefined })])).toContain('DEADLINE')
  })

  it('`from` 이 슬롯 이름이 아니면 거부', () => {
    expect(rulesOf([withDeadline({ from: '신청한날' })])).toContain('DEADLINE')
  })

  it('`artifact:{kind}` 는 통과', () => {
    expect(rulesOf([withDeadline({ from: 'artifact:receipt_no' })])).toEqual([])
  })
})

describe('⚠️ 실제로 배포될 파일이 실리는가', () => {
  const raw = JSON.parse(
    readFileSync(new URL('../kb/common.json', import.meta.url), 'utf8'),
  ) as Record<string, unknown>

  const plan = planLoad([{ name: 'common.json', ...raw }], OPTS)

  it('`src/kb/common.json` 이 검증을 통과한다', () => {
    // 여기서 깨지면 **KB 를 못 싣습니다** — 사건 생성이 첫 관문에서 막힙니다
    expect(plan.problems).toEqual([])
  })

  it('네 항목이 전부 행이 된다', () => {
    expect(plan.rows).toHaveLength(4)
    expect(plan.rows.map((r) => r.step_key)).toEqual([
      'report-112',
      'freeze-request',
      'relief-apply',
      'relief-documents',
    ])
  })

  it('**3영업일 기한이 실제로 실린다**', () => {
    const documents = plan.rows.find((r) => r.step_key === 'relief-documents')
    const deadline = documents?.body.deadline as Record<string, unknown>
    expect(deadline).toMatchObject({
      kind: 'business_days',
      amount: 3,
      from: 'relief_applied_at',
      owner: 'user',
    })
    expect(deadline.grace).toMatchObject({ kind: 'calendar_days', amount: 14 })
  })

  it('시행일이 전부 채워져 있다 — `TODO` 가 남아 있지 않다', () => {
    for (const row of plan.rows) {
      expect(row.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.source_url).toContain('http')
    }
  })
})
