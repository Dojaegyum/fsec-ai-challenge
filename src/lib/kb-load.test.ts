/**
 * KB 적재 검증 시험 — §11.4.5 의 열 가지를 하나씩 겨눕니다.
 *
 * **맨 아래가 제일 중요합니다** — 실제로 배포될 `src/kb/*.json` 이 통과하는지.
 * 규칙만 시험하면 규칙은 맞는데 파일이 안 실리는 상태를 못 봅니다.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { planLoad, planOrgLoad, type KbFile, type OrgFile } from './kb-load'

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
    // 그 단계에서 사용자가 하는 일 하나 → §3.6 `body.action` · ADR-024
    action: 'call',
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

  it('단위가 셋 밖이면 거부한다', () => {
    // 세는 방법이 각각 다릅니다 — 영업일·달력일·달(민법 제160조).
    // 여기 없는 단위가 통과하면 `date-checker` 가 달력일로 세어 **조용히 틀립니다**
    expect(withDeadline({ kind: 'weeks' })).toContain('DEADLINE')
    expect(withDeadline({ kind: 'years' })).toContain('DEADLINE')
  })

  it('채권소멸공고의 `months` 는 받는다 — 민법 제160조', () => {
    expect(withDeadline({ kind: 'months' })).toEqual([])
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

  it('일곱 밖이면 거부', () => {
    expect(rulesOf([good({}, { actor: 'user' })])).toContain('ACTOR')
  })

  it('**기본값을 두지 않는다** — 기관이 할 일이 사용자 할 일로 뜨면 안 된다', () => {
    expect(rulesOf([good({}, { actor: 'bank' })])).toEqual([])
    expect(rulesOf([good({}, { actor: 'victim' })])).toEqual([])
  })

  it('**`agency` 를 받는다** — 채권소멸공고를 내는 것은 금융감독원이다 (0006)', () => {
    // `deadline.owner` 에는 처음부터 있었는데 `actor` 에만 없어 `bank` 로
    // 대신 적고 있었습니다. 거부하면 그 항목이 다시 `bank` 로 내려갑니다
    expect(rulesOf([good({}, { actor: 'agency' })])).toEqual([])
  })
})

describe('어떤 패널을 여나 — `body.action` (§3.6 · ADR-024)', () => {
  it('없으면 거부한다 — **화면이 패널을 못 엽니다**', () => {
    // `panelFor` 가 `null` 을 내면 그 단계는 워크스페이스에 아무것도 안 그리고,
    // 사용자가 부산물을 낼 자리가 사라집니다 → 완료 판정도 사슬도 멈춥니다
    expect(rulesOf([good({}, { action: undefined })])).toContain('ACTION')
  })

  it('일곱 밖이면 거부한다', () => {
    expect(rulesOf([good({}, { action: 'sign' })])).toContain('ACTION')
    expect(rulesOf([good({}, { action: 'submit' })])).toContain('ACTION')
  })

  it('일곱은 전부 받는다', () => {
    for (const one of ['call', 'visit', 'write', 'upload', 'download', 'wait', 'read']) {
      expect(rulesOf([good({}, { action: one })]), one).toEqual([])
    }
  })

  it('`steps[].action` 과 다른 값이어도 된다 — 첫 줄이 대표가 아닙니다', () => {
    // 서류 제출은 `download` 로 시작해 `visit` 로 끝나고, 핵심은 제출입니다
    expect(rulesOf([good({}, { action: 'visit' })])).toEqual([])
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

  it('여섯 항목이 전부 행이 된다', () => {
    expect(plan.rows).toHaveLength(6)
    expect(plan.rows.map((r) => r.step_key)).toEqual([
      'report-112',
      'freeze-request',
      'relief-apply',
      'relief-documents',
      'debt-extinction-notice',
      // 2026-08-27 추가 — 골자가 「할 수 있는 일」의 예로 든 F-10 이 그동안
      // KB 에 한 줄도 없었습니다 → 05 U-36
      'identity-check',
    ])
  })

  it('**채권소멸공고 2개월이 실제로 실린다** — 민법 제160조로 셉니다', () => {
    const notice = plan.rows.find((r) => r.step_key === 'debt-extinction-notice')
    const deadline = notice?.body.deadline as Record<string, unknown>
    expect(deadline).toMatchObject({
      kind: 'months',
      amount: 2,
      from: 'notice_started_at',
      // 주인이 기관이라 `kind: "info"` 가 됩니다 — **사용자가 지킬 기한이 아닙니다**
      owner: 'agency',
    })
  })

  it('**공고 단계의 주체는 `agency` 다** — 기한의 주인과 같아야 합니다 (0006)', () => {
    // `bank` 로 적혀 있었습니다. 그러면 같은 절차를 두고 단계는 「은행이 함」,
    // 기한은 「기관이 함」이라고 말하게 됩니다 — 화면이 둘을 나란히 그립니다
    const notice = plan.rows.find((r) => r.step_key === 'debt-extinction-notice')
    expect(notice?.body.actor).toBe('agency')
    expect((notice?.body.deadline as Record<string, unknown>).owner).toBe('agency')
  })

  it('공고 단계는 슬롯을 요구하지 않는다 — 안내는 늘 나갑니다', () => {
    // 슬롯을 요구하면 그것이 확정되기 전에 **단계 자체가 안 뜹니다**(planner).
    // 공고는 사용자의 답과 무관하게 진행되므로 절차 안내는 늘 나가야 하고,
    // 날짜(기한)만 슬롯이 채워질 때 붙습니다 → ADR-054
    const notice = plan.rows.find((r) => r.step_key === 'debt-extinction-notice')
    expect(notice?.body.requires_slots).toEqual([])
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

/**
 * 유형 파일 — **적재기는 파일 하나가 아니라 폴더 전부를 봅니다.**
 *
 * `after` 가 파일을 넘어 가리키고(§11.2 우선순위 병합), 하나라도 어기면 통째로
 * 거부되므로 **함께 실어야 의미가 있습니다.**
 */
describe('⚠️ 유형 파일도 함께 실린다', () => {
  const read = (name: string) => ({
    name,
    ...(JSON.parse(
      readFileSync(new URL(`../kb/${name}`, import.meta.url), 'utf8'),
    ) as Record<string, unknown>),
  })

  const plan = planLoad(
    [
      read('common.json'),
      read('ch-facetoface.json'),
      read('ch-crypto.json'),
      read('ch-card.json'),
      read('ch-easypay.json'),
      read('ch-carrier.json'),
      read('ch-giftcard.json'),
    ] as KbFile[],
    OPTS,
  )

  it('폴더 전부가 검증을 통과한다', () => {
    expect(plan.problems).toEqual([])
  })

  /**
   * 카드는 **근거법이 다른 유형**입니다 → ADR-055.
   *
   * 유형 파일이 없으면 공통(환급법 절차)이 그대로 붙습니다. 그러면 카드
   * 피해자에게 지급정지·피해구제 신청·**3영업일 서류**·채권소멸공고가
   * 나갑니다 — 여신전문금융업법으로 다루는 사안에 다른 법의 기한이 붙는 것이라,
   * 조용히 틀린 안내가 됩니다.
   */
  describe('카드가 환급법 네 단계를 덮는다', () => {
    const mine = plan.rows.filter((r) => r.channel_id === 'CH-card')

    it('덮는 자리가 공통의 그 네 자리다', () => {
      expect(mine.map((r) => r.step_key)).toEqual([
        'freeze-request',
        'relief-apply',
        'relief-documents',
        'debt-extinction-notice',
      ])
    })

    it('**기한을 하나도 싣지 않는다** — 3영업일도 2개월도 이 유형엔 없다', () => {
      // 소급 60일은 date-checker 가 셀 수 없습니다(앞으로만 셉니다 → 06 §2.2).
      // 못 세는 것을 억지로 넣느니 caveat 로 말합니다
      expect(mine.map((r) => r.body.deadline)).toEqual([null, null, null, null])
    })

    it('14일을 기한으로 싣지 않는다 — 표준약관이지 법정 기한이 아니다', () => {
      // 06 §1.4 — 법정 기한처럼 안내하면 14일이 지난 피해자가 다툴 권리를
      // 잃었다고 오해하고 포기합니다
      const documents = mine.find((r) => r.step_key === 'relief-documents')
      expect(documents?.body.deadline).toBeNull()
      expect(documents?.legal_basis).toContain('신청 기한을 두지 않습니다')
    })

    it('공고 항목은 사용자 할 일로 그려지지 않는다', () => {
      // victim 으로 두면 화면이 「당신이 해야 할 것」으로 그립니다. 이 항목은
      // 공통을 덮으려고 있는 것이지 사용자가 할 일이 아닙니다
      const notice = mine.find((r) => r.step_key === 'debt-extinction-notice')
      expect(notice?.body.actor).toBe('issuer')
    })
  })

  /**
   * **상품권과 소액결제도 환급법 밖입니다** → 18-남은유형-근거보강.md §2 §3.
   *
   * 카드와 같은 이유로 공통 넷을 덮습니다. 덮지 않으면 지급정지·피해구제 신청·
   * **3영업일 서류**·채권소멸공고가 그대로 나가는데, 이 두 경로에는 정지할
   * 계좌가 없습니다.
   */
  describe('상품권·소액결제도 환급법 네 단계를 덮는다', () => {
    const FOUR = ['freeze-request', 'relief-apply', 'relief-documents', 'debt-extinction-notice']

    it.each(['CH-giftcard', 'CH-carrier'])('%s 가 그 네 자리를 덮는다', (channel) => {
      const mine = plan.rows.filter((r) => r.channel_id === channel)
      expect(mine.map((r) => r.step_key)).toEqual(FOUR)
    })

    it.each(['CH-giftcard', 'CH-carrier'])('%s 는 기한을 하나도 싣지 않는다', (channel) => {
      // 3영업일도 2개월도 이 경로엔 없습니다. 소액결제의 2주는 **사업자가**
      // 지킬 기한이고 기산점(정정요구일)을 담을 슬롯이 없어 못 셉니다
      const mine = plan.rows.filter((r) => r.channel_id === channel)
      expect(mine.map((r) => r.body.deadline)).toEqual([null, null, null, null])
    })

    it('**「환급 대상이 아닙니다」라고 단정하지 않는다** — 그 문헌을 못 찾았습니다', () => {
      // 조문 해석이지 정부의 판단이 아닙니다 → 18 §3.2.
      // 단정해 포기하게 만드는 것도, 환급된다고 부풀리는 것도 하지 않습니다
      const said = plan.rows
        .filter((r) => r.channel_id === 'CH-giftcard' || r.channel_id === 'CH-carrier')
        .flatMap((r) => [r.title, r.body.summary, r.body.caveat])
        .filter((one): one is string => typeof one === 'string')

      for (const line of said) {
        expect(line).not.toMatch(/환급\s*대상이\s*아[닙니]/)
        expect(line).not.toMatch(/받으실\s*수\s*있습니다/)
      }
    })

    it('소액결제의 2주는 **사업자의 기한**이라고 말한다', () => {
      const wait = plan.rows.find(
        (r) => r.channel_id === 'CH-carrier' && r.step_key === 'relief-documents',
      )
      expect(wait?.legal_basis).toContain('2주 이내')
      expect(wait?.body.caveat).toContain('사용자가 지켜야 하는 기한이 아니라')
    })

    it('간편송금은 **덮지 않습니다** — 환급법 안이라 공통이 그대로 맞습니다', () => {
      const mine = plan.rows.filter((r) => r.channel_id === 'CH-easypay')
      expect(mine.map((r) => r.step_key)).toEqual(['freeze-request'])
    })
  })

  /**
   * **가상자산은 시행일로 갈립니다** → ADR-058 · U-34.
   *
   * 2026-09-30 까지는 환급법 절차가 이 경로를 타지 않습니다. 덮지 않았을 때
   * 한 화면이 이렇게 됐습니다 — 실제로 그랬고, 빗썸 번호를 넣어 보다 드러났습니다.
   *
   *     crypto-status    「지금은 가상자산이 피해금 환급 대상이 아닙니다」
   *     relief-apply     「피해구제도 함께 신청합니다라고 분명히 말합니다」
   *     relief-documents 「별지 제1호서식」 + **3영업일 기한**
   *
   * **그리고 두 줄에 거래소 번호가 붙었습니다** — `contact_ref` 가 매칭된 org 를
   * 그대로 풀기 때문입니다. 거래소는 그 문장이 가리키는 금융회사가 아닙니다.
   */
  describe('가상자산은 시행일로 갈린다', () => {
    const FOUR = ['freeze-request', 'relief-apply', 'relief-documents', 'debt-extinction-notice']

    /** `body` 가 `Record<string, unknown>` 이라 단계를 꺼낼 때 모양을 한 번 좁힙니다 */
    const stepsOf = (row: (typeof plan.rows)[number]) =>
      (row.body.steps ?? []) as readonly { text: string; contact_ref: string | null }[]

    /** §11.2 의 조회를 그대로 흉내 냅니다 — 시행일로 거르고, 유형이 공통을 이깁니다 */
    const screen = (date: string, channel: string) => {
      const best = new Map<string, (typeof plan.rows)[number]>()
      for (const row of plan.rows) {
        if (row.effective_from > date) continue
        if (row.effective_until !== null && row.effective_until < date) continue
        if (row.channel_id !== null && row.channel_id !== channel) continue
        const found = best.get(row.step_key)
        if (!found || (row.channel_id !== null && found.channel_id === null)) {
          best.set(row.step_key, row)
        }
      }
      return [...best.values()].sort((a, b) => a.step_seq - b.step_seq)
    }

    it('9월 30일에는 네 자리가 유형 파일에서 온다', () => {
      const mine = screen('2026-09-30', 'CH-crypto')
      for (const key of FOUR) {
        expect(mine.find((r) => r.step_key === key)?.channel_id).toBe('CH-crypto')
      }
    })

    it('**「피해구제도 함께 신청합니다」가 안 나간다** — 대상이 아니라고 말하는 화면에서', () => {
      // 이것이 U-34 였습니다. 한 화면이 「대상 아님」과 「신청하세요」를 함께 했습니다
      const said = screen('2026-09-30', 'CH-crypto')
        .flatMap((r) => [r.title, r.body.summary, ...stepsOf(r).map((one) => one.text)])
      for (const line of said) {
        expect(line).not.toMatch(/피해구제도\s*함께\s*신청/)
        expect(line).not.toMatch(/별지\s*제1호서식 피해구제신청서를 작성/)
      }
    })

    it('**넷에 연락처를 달지 않는다** — 거래소는 그 문장의 금융회사가 아니다', () => {
      const mine = screen('2026-09-30', 'CH-crypto').filter((r) => FOUR.includes(r.step_key))
      const refs = mine.flatMap((r) => stepsOf(r).map((one) => one.contact_ref))
      expect(refs.filter((one) => one !== null)).toEqual([])
    })

    it('**기한을 하나도 싣지 않는다** — 못 지킬 3영업일이 붙지 않게', () => {
      const mine = screen('2026-09-30', 'CH-crypto').filter((r) => FOUR.includes(r.step_key))
      expect(mine.map((r) => r.body.deadline)).toEqual([null, null, null, null])
    })

    it('10월 1일에는 셋이 공통으로 돌아간다 — 일부러 비워 둔 자리다', () => {
      // 법 제3조·제4조가 그날 「계좌등」·「금융회사등」으로 넓어져 거래소가 들어옵니다.
      // 확인 안 된 것을 덮으면 지금보다 나쁜 안내가 됩니다 → common.json `_todo`
      const mine = screen('2026-10-01', 'CH-crypto')
      for (const key of ['freeze-request', 'relief-apply', 'debt-extinction-notice']) {
        expect(mine.find((r) => r.step_key === key)?.channel_id).toBeNull()
      }
    })

    it('**10월 1일에도 3영업일이 되살아나지 않는다** — 걸리는지 확인 안 됐다', () => {
      // 넷째만 10/1 이후로 이어집니다. 공통에 맡기면 별지 제1호서식과 3영업일이
      // 붙는데, `crypto-status` 는 같은 화면에서 「서식은 시행령이 확정되면」이라고
      // 말합니다 — 서로 어긋나고, **근거 없는 기한**이 붙습니다 (rfc/002 자기점검)
      const documents = screen('2026-10-01', 'CH-crypto').find(
        (r) => r.step_key === 'relief-documents',
      )
      expect(documents?.channel_id).toBe('CH-crypto')
      expect(documents?.body.deadline).toBeNull()
      expect(documents?.legal_basis).toContain('확인되지 않았습니다')
    })

    it('어느 날짜에도 한 자리에 항목이 둘 겹치지 않는다', () => {
      // 겹치면 mergeByPriority 가 순위 동률을 **먼저 온 것**으로 조용히 정합니다
      for (const date of ['2026-08-27', '2026-09-30', '2026-10-01', '2027-01-01']) {
        const live = plan.rows.filter(
          (r) =>
            r.channel_id === 'CH-crypto' &&
            r.effective_from <= date &&
            (r.effective_until === null || date <= r.effective_until),
        )
        const keys = live.map((r) => r.step_key)
        expect(new Set(keys).size).toBe(keys.length)
      }
    })
  })

  /**
   * **`org.json` 은 여기까지 아무도 안 봤습니다.**
   *
   * 유형 파일은 위에서 실어 보는데 기관 파일은 시험이 없었고, 그 사이 사전이
   * 19곳에서 28곳으로 늘었습니다. `planOrgLoad` 가 *"하나라도 어기면 통째로
   * 거부합니다"* 라 **한 곳이 틀리면 열아홉 곳도 같이 안 실립니다.**
   */
  describe('⚠️ 기관 사전도 실린다', () => {
    const plan = planOrgLoad([read('org.json')] as OrgFile[], { kbVersion: OPTS.kbVersion })

    it('`src/kb/org.json` 이 검증을 통과한다', () => {
      expect(plan.problems).toEqual([])
    })

    it('카드사가 실제로 실려 있다', () => {
      // 위아래 시험이 행을 훑기만 해서, 사전이 비어도 통과합니다.
      // ADR-055 로 들어온 아홉을 여기서 못 박습니다 — 여신금융협회 회원사
      // 정회원 8 + 준회원 1(NH농협카드)
      const card = plan.rows.filter((r) => r.channel_id === 'CH-card')
      expect(card).toHaveLength(9)
      expect(card.map((r) => r.name)).toContain('비씨카드')
    })

    it('근거 없는 기관이 없다 — 출처와 확인일이 전부 붙어 있다', () => {
      // TODO(근거 필요) 인 채로 초안이 딸려 들어오는 것을 막습니다
      for (const row of plan.rows) {
        expect(row.source_url, row.org_id).toMatch(/^https:\/\//)
        expect(row.verified_at, row.org_id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    })

    it('사전의 유형이 전부 9유형 안이다', () => {
      // 목록 밖 유형이 붙으면 그 기관은 어느 분기에도 안 걸립니다.
      // 08-14-channel-matrix.md 의 ID 칸 그대로 — 손으로 옮겨 어긋남을 잡습니다
      const known = new Set([
        'CH-bank', 'CH-neobank', 'CH-securities', 'CH-easypay', 'CH-crypto',
        'CH-facetoface', 'CH-giftcard', 'CH-carrier', 'CH-card',
      ])
      for (const row of plan.rows) {
        expect(known.has(row.channel_id), `${row.org_id} — ${row.channel_id}`).toBe(true)
      }
    })
  })

  it('대면편취가 공통의 두 단계를 덮는다 — 순서가 뒤집히는 유형이다', () => {
    const mine = plan.rows.filter((r) => r.channel_id === 'CH-facetoface')
    expect(mine.map((r) => r.step_key)).toEqual(['report-112', 'freeze-request'])
    // **지급정지를 하는 것이 피해자가 아닙니다.** victim 으로 두면 화면이
    // 「당신이 해야 할 것」으로 그립니다
    const freeze = mine.find((r) => r.step_key === 'freeze-request')
    expect(freeze?.body.actor).toBe('police')
  })

  it('**가상자산은 같은 step_key 가 시행일로 갈린다** — 배포 없이 10월 1일에 바뀐다', () => {
    const mine = plan.rows.filter((r) => r.step_key === 'crypto-status')
    expect(mine).toHaveLength(2)

    const before = mine.find((r) => r.effective_until !== null)
    const after = mine.find((r) => r.effective_until === null)

    expect(before?.effective_until).toBe('2026-09-30')
    expect(after?.effective_from).toBe('2026-10-01')
    // 구간이 안 겹칩니다 — 겹치면 같은 날 두 답이 나갑니다
    expect(before!.effective_until! < after!.effective_from).toBe(true)
  })

  it('확인 못 한 기한을 지어내지 않았다 — 가상자산에는 기한이 없다', () => {
    for (const row of plan.rows.filter((r) => r.channel_id === 'CH-crypto')) {
      expect(row.body.deadline).toBeNull()
    }
  })

  it('유형 파일도 근거 네 칸이 차 있다', () => {
    for (const row of plan.rows.filter((r) => r.channel_id !== null)) {
      expect(row.effective_from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(row.source_url).toContain('http')
      expect(row.legal_basis.length).toBeGreaterThan(10)
      expect(row.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

describe('기관 사전의 제출 경로는 모양이 맞아야 실린다 — §11.1 ④ · 08-14-api.md §3.6', () => {
  /**
   * `submit` 은 서버가 정렬·가공 없이 §3.6 `channels[].submit` 으로 **그대로 복사**합니다.
   * 그래서 모양은 적재에서 잡아야 합니다 — 여기서 새면 화면이 `how` 로 아이콘도
   * 문구도 못 고릅니다.
   */
  const org = (contact: Record<string, unknown>) => ({
    org_id: 'kb-bank',
    channel_id: 'CH-bank',
    name: 'KB국민은행',
    aliases: ['국민'],
    contact,
    source_url: 'https://portal.kfb.or.kr/voice/vphishing_report.php',
    verified_at: '2026-08-25',
  })
  const load = (contact: Record<string, unknown>) =>
    planOrgLoad([{ name: 'org.json', orgs: [org(contact)] }], { kbVersion: OPTS.kbVersion })
  const orgRules = (contact: Record<string, unknown>) => load(contact).problems.map((p) => p.rule)

  it('앱과 영업점이 함께 있어도 통과한다 — 순서는 KB 가 정한다 (ADR-042 ②)', () => {
    const plan = load({
      submit: [
        { how: 'app', text: '앱 → 고객센터 → 피해구제 신청', url: 'https://example.bank/app' },
        { how: 'branch', text: '가까운 영업점에 서면 제출' },
      ],
      caution: '앱의 「사고신고」는 피해구제 신청이 아닙니다',
    })
    expect(plan.problems).toEqual([])
    expect(plan.rows[0]!.contact.submit).toHaveLength(2)
  })

  it('`how` 가 branch·app 밖이면 거부한다', () => {
    expect(orgRules({ submit: [{ how: 'fax', text: '팩스로 제출' }] })).toContain('CONTACT')
  })

  it('`text` 가 없으면 거부한다 — 화면에 보일 한 줄이 없다', () => {
    expect(orgRules({ submit: [{ how: 'branch' }] })).toContain('CONTACT')
  })

  it('`url` 이 주소가 아니면 거부한다 — 없으면 칸을 빼야 한다', () => {
    expect(orgRules({ submit: [{ how: 'branch', text: '영업점', url: 'TODO(근거 필요)' }] })).toContain(
      'CONTACT',
    )
  })

  it('배열이 아니면 거부한다 — 옛 `submit_place` 문자열 모양', () => {
    expect(orgRules({ submit: '가까운 영업점에 서면 제출' })).toContain('CONTACT')
  })

  it('`caution` 은 문자열이어야 한다', () => {
    expect(orgRules({ caution: ['둘', '셋'] })).toContain('CONTACT')
  })
})
