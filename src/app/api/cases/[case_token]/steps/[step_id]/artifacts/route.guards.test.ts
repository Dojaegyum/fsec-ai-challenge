/**
 * `POST …/artifacts` — **요청을 거르는 자리**의 시험.
 *
 * 짝인 [`route.test.ts`](./route.test.ts) 는 **완료가 기산점을 남기는가**를 봅니다.
 * 파일을 가른 것은 취향이 아니라 `vi.mock` 이 **모듈 단위**여서입니다 — 그쪽은
 * `@/flows/regenerate-plan` 을 통째로 대역으로 바꾸고, 이 파일은 그 흐름이 실제로
 * 도는 것을 전제합니다. 한 파일에 두면 한쪽이 다른 쪽을 덮습니다.
 *
 * 검증 대상: spec/common/08-14-api.md §3.8 §1.1 · spec/backend/08-16-errors.md §3 ·
 *            spec/backend/08-16-data-model.md §7
 *
 * **여기서 못 박는 것 셋:**
 * 1. 남의 단계·없는 단계에 부산물을 붙이지 않는다 (§7 의 외래키는 사건을 안 봅니다)
 * 2. 요청이 잘못된 것을 서버 잘못(500)으로 말하지 않는다 (§3)
 * 3. 토큰화와 감사 기록이 돌았으면 계측 헤더가 그것을 증명한다 (§1.1)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CasePlanStore, StoredStep } from '@/flows/regenerate-plan'
import type { KbRow } from '@/modules/kb-finder'
import type { PiiTokenizer, TokenizeResult } from '@/modules/pii-tokenizer'

import { POST } from './route'

const CASE_ID = '01J8CASE000000000000000000'
const TOKEN = '01J8TKN0000000000000000000'
/** 이 사건의 단계 */
const STEP_ID = '01J8STEP000000000000000000'
/** 모양은 맞는데 이 사건의 것이 아닌 단계 */
const OTHER_STEP = '01J8XSTEP00000000000000000'

const KB_ROW: KbRow = {
  kbEntryId: 'report-112',
  kbVersion: '2026.08.1',
  stepKey: 'report-112',
  stepSeq: 1,
  channelId: null,
  orgId: null,
  track: 'victim',
  title: '112에 신고하기',
  body: { actor: 'victim', summary: '112로 신고합니다', action: 'call' },
  legalBasis: '통신사기피해환급법 제3조',
  sourceUrl: 'https://www.law.go.kr/report',
  effectiveFrom: '2020-01-01',
  effectiveUntil: null,
  verifiedAt: '2026-08-01',
}

const STORED: StoredStep = {
  planStepId: STEP_ID,
  stepKey: 'report-112',
  seq: 1,
  title: '112에 신고하기',
  actor: 'victim',
  conditional: null,
  state: 'not_started',
  body: { actor: 'victim', summary: '112로 신고합니다', action: 'call' },
  kbEntryId: 'report-112',
  kbVersion: '2026.08.1',
  legalBasis: '통신사기피해환급법 제3조',
  sourceUrl: 'https://www.law.go.kr/report',
  effectiveFrom: '2020-01-01',
  artifacts: [],
  requiredArtifact: null,
}

const casePlan: CasePlanStore = {
  async openCase() {
    return [STORED]
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
  async readChannels() {
    return []
  },
  async readSteps() {
    return [STORED]
  },
  async applyPlan() {
    return [STORED]
  },
}

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

/** 표에 실제로 들어간 줄. 남의 단계에 붙지 않았는지 여기서 봅니다 */
const written: { caseId: string; planStepId: string; valueMasked: string | null }[] = []

/** 가린 값이 원문보다 **길어지는** 토큰화기 — `[이름-1]` 이 일곱 자입니다 */
function lengtheningTokenizer(maskedLength: number): PiiTokenizer {
  return {
    async tokenize(): Promise<TokenizeResult> {
      return {
        masked: '[이름-1]'.repeat(Math.ceil(maskedLength / 7)).slice(0, maskedLength),
        added: [],
        mappings: [],
        counts: { name: 1 },
        nerApplied: true,
        foreignTokens: 0,
        // 제외 목록을 넘겼는지 — 대역은 안 넘깁니다 (origin/main 에서 넓어진 칸)
        allowedTermsApplied: false,
      }
    },
    scan() {
      return {}
    },
  }
}

function wiredContainer(
  over: {
    tokenizer?: PiiTokenizer
    /** 브라우저가 볼트에 맡겨 둔 이름표 — **값이 아니라 번호만** 옵니다 */
    vaultTokens?: readonly string[]
    /** 서버가 앞서 써 둔 토큰화된 글 — 여기 박힌 이름표도 장부에 들어옵니다 */
    maskedTexts?: readonly string[]
  } = {},
) {
  const ports = {
    ...unconfiguredPorts(readEnv({})),
    casePlan,
    kbStore: {
      async findApplied() {
        return [KB_ROW]
      },
      async findReference() {
        return []
      },
    },
    auditStore: { lastHash: async () => null, append: async () => {} },
    kbVersion: { current: async () => '2026.08.1' },
  } as Ports

  return {
    ...createContainer(readEnv({}), ports),
    caseTokens: { toCaseId: async () => CASE_ID },
    slots: { read: async () => [] },
    deadlineWrite: { apply: async () => [], sweepOverdue: async () => 0 },
    orgs: { read: async () => null, list: async () => [] },
    // ── 이름표 장부 → 04-pii-boundary.md 「번호의 단위」 ──────────────
    // 서버 토큰화가 **이미 쓰인 번호를 이어받는** 자리입니다. 대역이 없으면
    // 미설정 포트를 불러 그 자리에서 터집니다 — 비어 있으면 1번부터입니다
    vaultWrite: {
      put: async () => 0,
      list: async () => [],
      tokens: async () => over.vaultTokens ?? [],
    },
    messages: {
      write: async () => {},
      history: async () => [],
      transcript: async () => [],
      turns: async () => ({ turns: [], truncated: false }),
    },
    // 장부가 읽는 자리 → `pii-tokenizer/ledger.ts`. 번호는 볼트에서만 옵니다
    maskedTexts: { all: async () => over.maskedTexts ?? [] },
    artifacts: {
      async write(row: { caseId: string; planStepId: string; valueMasked: string | null }) {
        written.push({
          caseId: row.caseId,
          planStepId: row.planStepId,
          valueMasked: row.valueMasked,
        })
      },
      async markStep() {},
    },
    ...(over.tokenizer ? { piiTokenizer: over.tokenizer } : {}),
  }
}

beforeEach(() => {
  written.length = 0
  holder.container = wiredContainer()
})

function ask(stepId: string, body: unknown) {
  return {
    request: new Request(`http://x/api/cases/${TOKEN}/steps/${stepId}/artifacts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    route: { params: Promise.resolve({ case_token: TOKEN, step_id: stepId }) },
  }
}

const errorOf = async (res: Response) =>
  ((await res.json()) as { error: { code: string; message: string } }).error

describe('그 사건의 단계인가 — §7 의 외래키는 사건을 안 봅니다', () => {
  it('남의 단계·없는 단계면 400 이다 — 500 이 아니다', async () => {
    // 외래키는 plan_step_id 만 보므로 다른 사건의 번호도 **제약을 통과합니다**.
    // 아예 없는 번호면 거기서 터져 INTERNAL(500)이 나갔는데, 그건 요청이 잘못된
    // 것을 서버 잘못으로 말하는 것이고 5xx 라 서버 로그에도 쌓입니다
    const one = ask(OTHER_STEP, { kind: 'other', self_reported: true })
    const res = await POST(one.request, one.route)

    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('BAD_REQUEST')
  })

  it('붙이지 않는다 — 표에 줄이 안 남는다', async () => {
    const one = ask(OTHER_STEP, { kind: 'other', self_reported: true })
    await POST(one.request, one.route)

    expect(written).toEqual([])
  })

  it('이 사건의 단계면 그대로 붙는다', async () => {
    const one = ask(STEP_ID, { kind: 'other', self_reported: true })
    const res = await POST(one.request, one.route)

    expect(res.status).toBe(200)
    expect(written).toHaveLength(1)
    expect(written[0].planStepId).toBe(STEP_ID)
  })

  it('모양이 틀린 번호는 그 전에 걸린다', async () => {
    const one = ask('not-a-ulid', { kind: 'other', self_reported: true })

    expect((await POST(one.request, one.route)).status).toBe(400)
  })
})

describe('값 길이 — 09-data-model.md §7 `VARCHAR(255)`', () => {
  it('칸 너비를 넘으면 400 이다 — 드라이버가 터지기 전에', async () => {
    const one = ask(STEP_ID, { kind: 'receipt_no', value: '2'.repeat(256) })
    const res = await POST(one.request, one.route)

    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('BAD_REQUEST')
  })

  it('255자까지는 받는다 — 지어낸 상한으로 막지 않는다', async () => {
    const one = ask(STEP_ID, { kind: 'receipt_no', value: '2'.repeat(255) })

    expect((await POST(one.request, one.route)).status).toBe(200)
  })

  it('**가린 값이 길어져도 본다** — 원문이 255자 안이어도', async () => {
    // `[이름-1]` 은 일곱 자라 두세 자짜리 이름을 치환하면 늘어납니다.
    // 원문만 보면 통과시켜 놓고 표에 넣다가 터집니다
    holder.container = wiredContainer({ tokenizer: lengtheningTokenizer(300) })

    const one = ask(STEP_ID, { kind: 'receipt_no', value: '홍길동 김철수' })
    const res = await POST(one.request, one.route)

    expect(res.status).toBe(400)
    expect((await errorOf(res)).code).toBe('BAD_REQUEST')
    // 표에 안 들어갑니다
    expect(written).toEqual([])
  })

  it('가린 값이 칸 안이면 그대로 들어간다', async () => {
    holder.container = wiredContainer({ tokenizer: lengtheningTokenizer(255) })

    const one = ask(STEP_ID, { kind: 'receipt_no', value: '홍길동' })

    expect((await POST(one.request, one.route)).status).toBe(200)
    expect(written).toHaveLength(1)
  })

  it('받은 값을 응답에 담지 않는다', async () => {
    const one = ask(STEP_ID, { kind: 'receipt_no', value: '9'.repeat(300) })
    const res = await POST(one.request, one.route)

    expect(JSON.stringify(await res.json())).not.toContain('999')
  })
})

describe('계측 헤더 — 08-14-api.md §1.1', () => {
  it('접수번호에 섞여 온 개인정보를 유형별 건수로 적는다', async () => {
    // 접수번호는 개인정보가 아니지만 사용자가 다른 것을 붙여 넣을 수 있습니다
    // → ADR-040. 경계가 돌았다는 것을 응답이 증명해야 합니다
    const one = ask(STEP_ID, { kind: 'receipt_no', value: '주민번호 900101-1234567' })
    const res = await POST(one.request, one.route)

    expect(res.headers.get('X-Pii-Token-Count')).toBe('resident_id=1')
    // **값은 안 담습니다. 건수뿐입니다**
    expect(res.headers.get('X-Pii-Token-Count')).not.toContain('900101')
  })

  it('가릴 것이 없으면 none 이다 — 없는 것과 안 본 것은 다르다', async () => {
    const one = ask(STEP_ID, { kind: 'receipt_no', value: '2026-004821' })
    const res = await POST(one.request, one.route)

    expect(res.headers.get('X-Pii-Token-Count')).toBe('none')
  })

  it('플랜을 다시 만들었으면 감사 식별자를 싣는다', async () => {
    // `regeneratePlan` 이 `plan.generated` 한 줄을 이미 남기고 그 번호를 돌려주는데,
    // 라우트가 버려서 헤더가 언제나 `none` 이었습니다 — **동작해도 응답이 그것을
    // 증명하지 못했습니다**
    const one = ask(STEP_ID, { kind: 'receipt_doc', evidence_id: '01J8EVID000000000000000000' })
    const res = await POST(one.request, one.route)

    expect(res.status).toBe(200)
    expect(res.headers.get('X-Audit-Id')).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('다시 안 만들었으면 none 이다 — 남은 기록이 없다', async () => {
    // L3 자기신고는 `done_verified` 가 아니라 플랜을 다시 만들지 않습니다
    const one = ask(STEP_ID, { kind: 'other', self_reported: true })
    const res = await POST(one.request, one.route)

    expect(res.headers.get('X-Audit-Id')).toBe('none')
  })
})

/**
 * 서버가 붙이는 이름표의 번호는 **사건 하나**를 단위로 합니다
 * → 04-pii-boundary.md 「번호의 단위」.
 *
 * ⚠️ **2026-08-30 까지 이 자리가 요청마다 1번부터였습니다.** 챗에서 본인 계좌에
 * 붙은 `[계좌-1]` 이 볼트에 있는데 여기서도 `[계좌-1]` 을 붙여, 접수번호 자리가
 * **본인 계좌번호로 복원돼 보였습니다.**
 */
describe('이름표 번호가 사건 안에서 안 겹친다 — 04-pii-boundary.md 「번호의 단위」', () => {
  it('볼트가 쓴 번호 다음부터 붙인다', async () => {
    holder.container = wiredContainer({ vaultTokens: ['[주민번호-1]'] })

    const one = ask(STEP_ID, { kind: 'receipt_no', value: '900101-1234567 접수' })
    const res = await POST(one.request, one.route)

    expect(res.status).toBe(200)
    expect(written[0].valueMasked).toBe('[주민번호-2] 접수')
  })

  /** **회귀** — 장부가 비면 지금까지처럼 1번부터입니다 */
  it('장부가 비면 1번부터', async () => {
    const one = ask(STEP_ID, { kind: 'receipt_no', value: '900101-1234567 접수' })

    expect((await POST(one.request, one.route)).status).toBe(200)
    expect(written[0].valueMasked).toBe('[주민번호-1] 접수')
  })
})
