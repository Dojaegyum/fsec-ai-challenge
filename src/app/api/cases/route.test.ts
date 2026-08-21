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
  body: { actor: 'victim', summary: '112로 신고합니다' },
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

const casePlan: CasePlanStore = {
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
        kbEntryId: one.kbEntryId,
        kbVersion: one.kbVersion,
        sourceUrl: one.sourceUrl,
        effectiveFrom: one.effectiveFrom,
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
    // §3.6 전용 칸(body·artifacts·required_artifact)이 섞여 들어가는 것도
    // 여기서 걸려야 합니다
    const res = await POST(ask({ track: 'victim' }))
    const body = (await res.json()) as {
      plan: Record<string, unknown> & {
        steps: (Record<string, unknown> & { citation: Record<string, unknown> })[]
      }
    }

    expect(Object.keys(body.plan).sort()).toEqual(['is_superset', 'steps'].sort())

    for (const step of body.plan.steps) {
      expect(Object.keys(step).sort()).toEqual(
        ['actor', 'citation', 'conditional', 'seq', 'state', 'step_id', 'title'].sort(),
      )
      expect(Object.keys(step.citation).sort()).toEqual(
        ['effective_from', 'kb_entry_id', 'kb_version', 'source_url'].sort(),
      )
    }
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
