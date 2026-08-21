/**
 * `POST /api/cases` 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §3.1 §1.1 §1.3 · spec/backend/08-16-errors.md §3
 *
 * **여기서 못 박는 것 넷:**
 * 1. 계약의 응답 모양대로 나간다 (§3.1)
 * 2. 갈래가 목록 밖이면 파일 문구가 아니라 잘못된 요청으로 나간다
 * 3. 안 붙은 자원을 부르면 조용히 빈 사건이 생기지 않는다
 * 4. 계측 헤더 넷이 붙는다 (§1.1)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { TELEMETRY_HEADER_NAMES } from '@/lib/telemetry'

import type { CaseStore, OpenedCase } from '@/modules/case-intake'
import type { KbRow, KbStore } from '@/modules/kb-finder'

import type { CasePlanStore, StoredStep } from '@/flows/regenerate-plan'

import { POST } from './route'

const KB_ROW: KbRow = {
  kbEntryId: 'report-112',
  kbVersion: '2026.08.1',
  stepKey: 'report-112',
  stepSeq: 1,
  channelId: null,
  orgId: null,
  track: 'victim',
  title: '112에 신고하기',
  // action 이 화면의 작업 패널을 정합니다 → ADR-024
  body: { actor: 'victim', summary: '112로 신고합니다', action: 'call' },
  legalBasis: '통신사기피해환급법 제3조',
  sourceUrl: 'https://www.law.go.kr/report',
  effectiveFrom: '2020-01-01',
  effectiveUntil: null,
  verifiedAt: '2026-08-01',
}

const kbStore: KbStore = {
  async findApplied() {
    return [KB_ROW]
  },
  async findReference() {
    return []
  },
}

/** 만든 사건을 들고 있는 자리 */
function caseStoreOf() {
  const rows: OpenedCase[] = []
  const store: CaseStore = {
    async createCase(row) {
      rows.push(row)
    },
    async evidenceTotals() {
      return { count: 0, bytes: 0 }
    },
    async addEvidence() {},
    async markUploaded() {
      return 'processing'
    },
    async touchPurgeAfter() {},
  }
  return { store, rows }
}

/** 사건과 플랜이 함께 저장됐는지 보려고 들여다봅니다 → ADR-041 */
const opened: { caseId: string; steps: number }[] = []

const casePlan: CasePlanStore = {
  async openCase(row, result) {
    opened.push({ caseId: row.caseId, steps: result.upsert.length })
    return casePlan.applyPlan(row.caseId, result)
  },
  async readCase() {
    return { track: 'victim' as const }
  },
  async readSlots() {
    return []
  },
  async readChannel() {
    return null
  },
  async readSteps() {
    return []
  },
  /** 포트 계약대로 「반영 뒤의 플랜 전부」. 여기는 기존 단계가 없어 upsert 뿐입니다 */
  async applyPlan(_caseId, result) {
    return result.upsert.map(
      (one, index): StoredStep => ({
        planStepId: `01J8STEP${String(index).padStart(17, '0')}`,
        stepKey: one.stepKey,
        seq: one.seq,
        title: one.title,
        actor: one.actor,
        conditional: one.conditional,
        state: one.state,
        body: one.body,
        kbEntryId: one.kbEntryId,
        kbVersion: one.kbVersion,
        // kb_entry 를 함께 읽어야 나오는 값입니다 → ADR-042
        legalBasis: `${one.kbEntryId} 근거 조항`,
        sourceUrl: one.sourceUrl,
        effectiveFrom: one.effectiveFrom,
        // 이미 낸 접수 문자가 붙어 있는 상태 → 09-data-model.md §7
        artifacts: [
          {
            artifactId: '01J8ART0000000000000000AA',
            kind: 'sms_capture',
            verifyLevel: 'L2',
            verifyResult: 'passed',
          },
        ],
        requiredArtifact: { kind: 'sms_capture', label: '은행 접수 문자 캡처' },
      }),
    )
  },
}

function wiredPorts(): Ports {
  const env = readEnv({})
  return {
    ...unconfiguredPorts(env),
    caseStore: caseStoreOf().store,
    kbStore,
    auditStore: { lastHash: async () => null, append: async () => {} },
    casePlan,
    kbVersion: { current: async () => '2026.08.1' },
  } as Ports
}

/**
 * 라우트는 조립본을 `getContainer()` 로 가져갑니다 — 프로세스에 하나여야
 * 속도 제한 카운터가 요청 사이에 이어지기 때문입니다. 시험에서는 그 자리를
 * 갈아 끼워, 안 붙은 자원 대신 들여다볼 수 있는 것을 넣습니다.
 */
const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

beforeEach(() => {
  holder.container = createContainer(readEnv({}), wiredPorts())
})

function ask(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://x/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

describe('사건을 만든다 — §3.1', () => {
  it('201 로 낸다', async () => {
    const res = await POST(ask({ track: 'victim' }))

    expect(res.status).toBe(201)
  })

  it('계약의 칸을 그대로 낸다', async () => {
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as Record<string, unknown>

    expect(Object.keys(body).sort()).toEqual(
      ['case_id', 'opened_at', 'plan', 'status', 'track'].sort(),
    )
    expect(body.track).toBe('victim')
    // 09-data-model.md §2 — 사건은 접수 상태로 시작합니다
    expect(body.status).toBe('intake')
    // 시간대를 포함합니다 → §1. 기한이 날짜 경계에 걸리면 하루가 어긋납니다
    expect(body.opened_at).toMatch(/\+09:00$/)
  })

  it('단계와 근거의 칸도 계약 그대로다', async () => {
    // 최상위만 못 박으면 알맹이(steps[])가 달라져도 초록으로 남습니다.
    // **모양이 §3.6 과 같아야 합니다** → ADR-042. 하나라도 빠지면 화면이 사건을
    // 만든 직후에 작업 패널을 못 그립니다 — 그 패널을 정하는 action 이 body 안에
    // 있기 때문입니다(ADR-024)
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as {
      plan: Record<string, unknown> & {
        steps: (Record<string, unknown> & { citation: Record<string, unknown> })[]
      }
    }

    expect(Object.keys(body.plan).sort()).toEqual(['is_superset', 'steps'].sort())

    for (const step of body.plan.steps) {
      expect(Object.keys(step).sort()).toEqual(
        [
          'actor',
          'artifacts',
          'body',
          'citation',
          'conditional',
          'required_artifact',
          'seq',
          'state',
          'step_id',
          'title',
        ].sort(),
      )
      expect(Object.keys(step.citation).sort()).toEqual(
        [
          'effective_from',
          'kb_entry_id',
          'kb_version',
          'legal_basis',
          'source_url',
        ].sort(),
      )
    }
  })

  it('부산물과 필요 서류가 그대로 실려 나간다 — ADR-042', async () => {
    // 칸 이름만 보면 빈 배열로 고정해도 안 걸립니다.
    // 화면이 「무엇을 이미 냈고 무엇이 더 필요한가」를 여기서 읽습니다
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as {
      plan: {
        steps: {
          artifacts: Record<string, string>[]
          required_artifact: Record<string, string> | null
        }[]
      }
    }

    expect(body.plan.steps[0].artifacts).toEqual([
      {
        artifact_id: '01J8ART0000000000000000AA',
        kind: 'sms_capture',
        verify_level: 'L2',
        verify_result: 'passed',
      },
    ])
    expect(body.plan.steps[0].required_artifact).toEqual({
      kind: 'sms_capture',
      label: '은행 접수 문자 캡처',
    })
  })

  it('작업 패널을 정하는 값이 응답 안에 있다 — ADR-024 · ADR-042', async () => {
    // 화면이 사건을 만든 직후에 곧장 작업 패널을 띄울 수 있어야 합니다.
    // 없으면 플랜 조회를 한 번 더 불러야 하고, 그만큼 늦습니다
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as {
      plan: { steps: { body: Record<string, unknown> }[] }
    }

    expect(body.plan.steps[0].body).toMatchObject({ action: 'call' })
  })

  it('사건 행을 따로 쓰는 경로가 없다 — ADR-041', async () => {
    // openCase 말고 다른 자리에서 사건을 저장하면 원자성이 깨집니다.
    // caseIntake.open() 으로 되돌아가는 회귀가 여기서 걸립니다
    const cases = caseStoreOf()
    holder.container = createContainer(readEnv({}), {
      ...wiredPorts(),
      caseStore: cases.store,
    } as Ports)

    await POST(ask({ track: 'victim' }))

    expect(cases.rows).toHaveLength(0)
  })

  it('사건과 플랜을 한 번에 저장한다 — ADR-041', async () => {
    // 사건을 먼저 저장하면 플랜 실패 시 되돌아갈 수 없는 빈 사건이 남습니다.
    // 에러 봉투에 case_id 를 담을 칸이 없어 사용자가 자기 사건을 찾을 수 없습니다
    opened.length = 0

    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as { case_id: string }

    expect(opened).toHaveLength(1)
    expect(opened[0].caseId).toBe(body.case_id)
    expect(opened[0].steps).toBeGreaterThan(0)
  })

  it('플랜이 실패하면 사건도 안 남는다 — ADR-041', async () => {
    // 플랜 저장이 실패하는 순간까지 사건 행은 만들어지지 않아야 합니다
    opened.length = 0
    const broken = {
      ...casePlan,
      async openCase() {
        throw new Error('저장 실패')
      },
    }
    holder.container = createContainer(readEnv({}), {
      ...wiredPorts(),
      casePlan: broken,
    } as Ports)

    const res = await POST(ask({ track: 'victim' }))

    expect(res.status).toBe(500)
    expect(opened).toHaveLength(0)
  })

  it('사건을 만드는 즉시 T0 가 붙는다', async () => {
    // 슬롯이 하나도 없어도 그렇습니다 → 08-14-slot-tiering.md
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as {
      plan: { is_superset: boolean; steps: { title: string; citation: unknown }[] }
    }

    expect(body.plan.is_superset).toBe(true)
    expect(body.plan.steps).toHaveLength(1)
    expect(body.plan.steps[0].title).toBe('112에 신고하기')
  })

  it('모든 단계에 근거가 붙는다 — 불변 규칙 1', async () => {
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as {
      plan: { steps: { citation: Record<string, string> }[] }
    }

    for (const step of body.plan.steps) {
      expect(step.citation.kb_entry_id).toBeTruthy()
      expect(step.citation.kb_version).toBeTruthy()
      expect(step.citation.source_url).toBeTruthy()
      // 시행일이 붙습니다 — 제도가 바뀌므로
      expect(step.citation.effective_from).toBeTruthy()
    }
  })

  it('통장묶기 갈래도 받는다', async () => {
    const res = await POST(ask({ track: 'frozen_account' }))
    const body = (await res.json()) as { track: string }

    expect(res.status).toBe(201)
    expect(body.track).toBe('frozen_account')
  })
})

describe('요청이 잘못됐을 때', () => {
  it('갈래가 목록 밖이면 400 이다', async () => {
    const res = await POST(ask({ track: 'nope' }))

    expect(res.status).toBe(400)
  })

  it('갈래가 없으면 400 이다', async () => {
    const res = await POST(ask({}))

    expect(res.status).toBe(400)
  })

  it('파일 문구가 나가지 않는다', async () => {
    // case-intake 도 같은 검사를 하지만 거기서는 「파일을 읽지 못했습니다」가
    // 나갑니다 — 파일 얘기가 아닌데 그 문구가 나가면 무엇을 고칠지 모릅니다
    const res = await POST(ask({ track: 'nope' }))
    const body = (await res.json()) as { error: { message: string } }

    expect(body.error.message).not.toContain('파일')
  })

  it('본문이 깨져 있으면 400 이다 — 500 이 아니다', async () => {
    const res = await POST(
      new Request('http://x/api/cases', { method: 'POST', body: '{ 깨짐' }),
    )

    expect(res.status).toBe(400)
  })

  it('JSON 으로는 유효하지만 객체가 아닌 본문도 400 이다', async () => {
    // `null` 은 JSON 으로 유효해서 파싱을 통과합니다. 그걸 객체로 알고 칸을
    // 읽으면 터지고, 잘못된 요청인데 500 이 나가 서버 잘못으로 보입니다.
    // 그 500 이 운영자 로그에도 쌓여, 밖에서 본문 한 글자로 로그를 채울 수 있습니다
    for (const body of ['null', '7', '"victim"', '[]', 'true']) {
      const res = await POST(
        new Request('http://x/api/cases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
      )
      expect(res.status, body).toBe(400)
    }
  })

  it('그 요청들이 서버 로그를 채우지 않는다', async () => {
    const seen: unknown[][] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      seen.push(args)
    })

    for (const body of ['null', '7', '[]']) {
      await POST(
        new Request('http://x/api/cases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        }),
      )
    }
    spy.mockRestore()

    expect(seen).toHaveLength(0)
  })

  it('받은 값을 응답에 되돌려주지 않는다', async () => {
    const res = await POST(ask({ track: '<script>alert(1)</script>' }))

    expect(JSON.stringify(await res.json())).not.toContain('<script>')
  })
})

describe('계측 헤더 — §1.1', () => {
  it('넷이 붙는다', async () => {
    const res = await POST(ask({ track: 'victim' }))

    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(res.headers.has(name), name).toBe(true)
    }
  })

  it('인용한 KB 버전을 싣는다', async () => {
    const res = await POST(ask({ track: 'victim' }))

    expect(res.headers.get('X-Kb-Version')).toBe('2026.08.1')
  })

  it('감사 식별자를 싣는다', async () => {
    const res = await POST(ask({ track: 'victim' }))

    expect(res.headers.get('X-Audit-Id')).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })
})

describe('안 붙은 자원은 조용히 넘어가지 않는다', () => {
  it('저장소가 없으면 사건이 안 생긴다', async () => {
    // 조용히 빈 사건이 생기면 며칠 뒤에야 누가 알아챕니다
    holder.container = createContainer(readEnv({}))

    const res = await POST(ask({ track: 'victim' }))

    expect(res.status).toBe(500)
    // 「있는데 지금 안 된다」가 아니라 「아직 없다」입니다 — 다시 눌러도 같습니다
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('속도 제한 — §1.3', () => {
  it('IP당 시간당 20건을 넘으면 429 다', async () => {
    for (let i = 0; i < 20; i += 1) {
      const res = await POST(ask({ track: 'victim' }, { 'X-Forwarded-For': '203.0.113.9' }))
      expect(res.status).toBe(201)
    }

    const over = await POST(ask({ track: 'victim' }, { 'X-Forwarded-For': '203.0.113.9' }))
    const body = (await over.json()) as { error: { code: string } }

    expect(over.status).toBe(429)
    expect(body.error.code).toBe('RATE_LIMITED')
    // 남은 창 시간이 붙습니다 → 08-16-errors.md §3.1
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0)
  })
})
