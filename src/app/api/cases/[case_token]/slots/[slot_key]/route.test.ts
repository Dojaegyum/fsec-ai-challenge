/**
 * `PATCH /api/cases/{case_token}/slots/{slot_key}` 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §3.5 §1.1 · spec/backend/08-16-errors.md §3
 *
 * **여기서 못 박는 것 둘:**
 * 1. 목록 밖 슬롯 이름을 받아 놓고 아무 일도 안 하지 않는다 (§5.1 · §3)
 * 2. 토큰화가 돌았으면 계측 헤더가 그것을 증명한다 (§1.1)
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CasePlanStore } from '@/flows/regenerate-plan'
import type { CaseStore } from '@/modules/case-intake'
import type { PiiTokenizer, TokenizeResult } from '@/modules/pii-tokenizer'

import { PATCH } from './route'

const CASE_ID = '01J8CASE000000000000000000'
const TOKEN = '01J8TKN0000000000000000000'

/** 빈 플랜 하나. 이 시험은 플랜 내용을 안 봅니다 */
const casePlan: CasePlanStore = {
  async openCase() {
    return []
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
    return []
  },
  async applyPlan() {
    return []
  },
}

/**
 * 개인정보 후보를 **하나 찾은 것으로** 둔 토큰화기.
 *
 * 진짜 정규식을 쓰면 이 시험이 「그 패턴이 아직 그 값을 잡나」까지 함께 보게 되어,
 * 헤더가 안 붙는 것과 패턴이 바뀐 것이 구분되지 않습니다.
 */
function tokenizerOf(added: { kind: string; token: string }[]): PiiTokenizer {
  return {
    async tokenize(): Promise<TokenizeResult> {
      return {
        masked: '[계좌-1]',
        added: added.map((one, index) => ({ ...one, kind: one.kind as never, seq: index + 1 })),
        mappings: [],
        counts: {},
        nerApplied: false,
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

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

function wiredContainer(over: { tokenizer?: PiiTokenizer; caseStore?: CaseStore } = {}) {
  const ports = {
    ...unconfiguredPorts(readEnv({})),
    ...(over.caseStore ? { caseStore: over.caseStore } : {}),
    casePlan,
    kbStore: { async findApplied() { return [] }, async findReference() { return [] }, async listEntries() { return [] } },
    auditStore: { appendChained: async (build) => build(null) },
    kbVersion: { current: async () => '2026.08.1' },
  } as Ports

  return {
    ...createContainer(readEnv({}), ports),
    caseTokens: { toCaseId: async () => CASE_ID },
    slots: { read: async () => [] },
    slotWrite: { write: async () => {} },
    channelWrite: { write: async () => {}, candidates: async () => [] },
    deadlineWrite: { apply: async () => [], sweepOverdue: async () => 0, markMet: async () => 0 },
    orgs: { read: async () => null, list: async () => [] },
    // ── 이름표 장부 → 04-pii-boundary.md 「번호의 단위」 ──────────────
    // 서버 토큰화가 **이미 쓰인 번호를 이어받는** 자리입니다. 대역이 없으면
    // 미설정 포트를 불러 그 자리에서 터집니다 — 비어 있으면 1번부터입니다
    vaultWrite: { put: async () => 0, list: async () => [], tokens: async () => [] },
    messages: {
      write: async () => {},
      history: async () => [],
      transcript: async () => [],
      turns: async () => ({ turns: [], truncated: false }),
    },
    // 장부가 읽는 자리 → `pii-tokenizer/ledger.ts`. 이 시험은 빈 사건입니다
    maskedTexts: { all: async () => [] },
    ...(over.tokenizer ? { piiTokenizer: over.tokenizer } : {}),
  }
}

beforeEach(() => {
  holder.container = wiredContainer()
})

function ask(slotKey: string, body: unknown) {
  return {
    request: new Request(`http://x/api/cases/${TOKEN}/slots/${slotKey}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    route: { params: Promise.resolve({ case_token: TOKEN, slot_key: slotKey }) },
  }
}

describe('목록 밖 슬롯 이름 — §5.1 · 08-16-errors.md §3', () => {
  it('400 으로 거절한다', async () => {
    // 그대로 저장하면 아무도 안 읽는 죽은 줄이 표에 쌓이고, 슬롯 체커는 그 줄을
    // 어느 티어로도 안 셉니다 — **틀린 답을 받아 놓고 아무 일도 안 일어납니다**
    const one = ask('made_up_slot', { action: 'unknown' })
    const res = await PATCH(one.request, one.route)
    const body = (await res.json()) as { error: { code: string; message: string } }

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('BAD_REQUEST')
    expect(body.error.message).toBe('요청 형식이 올바르지 않습니다.')
  })

  it('받은 이름을 응답에도 감사 detail 에도 담지 않는다', async () => {
    const one = ask('made_up_slot', { action: 'unknown' })
    const res = await PATCH(one.request, one.route)

    expect(JSON.stringify(await res.json())).not.toContain('made_up_slot')
  })

  it('목록 안 이름은 그대로 지나간다', async () => {
    const one = ask('channel', { action: 'unknown' })

    expect((await PATCH(one.request, one.route)).status).toBe(200)
  })
})

/**
 * 되묻기의 답은 **뜻으로** 온다 — ADR-082 · §3.5.
 *
 * 2026-09-06 QA 에서 브라우저가 보내기 전에 버튼 글자의 「요」를 가려(ADR-081)
 * 「아니에[이름-5], 다시 적을게[이름-5]」가 도착했고 그 글자가 금액으로 저장됐습니다.
 * 라우트가 이 둘을 목록 밖으로 튕기면 새 화면의 답이 통째로 400 이 됩니다.
 */
describe('되묻기의 답 — action 목록에 confirm·reject 가 있다 (ADR-082)', () => {
  /** 자료에서 뽑혀 확인을 기다리는 금액 — `slots.read` 가 내주는 모양 그대로 */
  const EXTRACTED = [
    {
      slotKey: 'amount',
      tier: 'T2' as const,
      state: 'extracted',
      valueMasked: '32000000',
      valueType: 'decimal',
      source: 'auto',
      confidence: 0.9,
      sourceRef: '01J8XKQZ3M7N2P4R6T8V0W2Y4B',
    },
  ]

  beforeEach(() => {
    holder.container = { ...wiredContainer(), slots: { read: async () => EXTRACTED } }
  })

  it('confirm 은 뽑힌 값을 그대로 확정한다', async () => {
    const one = ask('amount', { action: 'confirm' })
    const res = await PATCH(one.request, one.route)
    const body = (await res.json()) as { slot: { state: string; value: string | null } }

    expect(res.status).toBe(200)
    expect(body.slot).toEqual({ slot_key: 'amount', state: 'confirmed', value: '32000000' })
  })

  it('reject 는 그 슬롯을 비운다 — 원래 형식으로 다시 묻게', async () => {
    const one = ask('amount', { action: 'reject' })
    const res = await PATCH(one.request, one.route)
    const body = (await res.json()) as { slot: { state: string; value: string | null } }

    expect(res.status).toBe(200)
    expect(body.slot).toEqual({ slot_key: 'amount', state: 'empty', value: null })
  })

  it('목록 밖 action 은 그대로 400 이다', async () => {
    const one = ask('amount', { action: 'confirmed' })

    expect((await PATCH(one.request, one.route)).status).toBe(400)
  })

  /**
   * ⚠️ **사용자가 못 본 값이 「맞아요」로 확정되던 자리** — ADR-082 × ADR-087.
   *
   * 답에 값이 안 실리므로 서버는 **지금** DB 값을 닫습니다. 그런데 슬롯 추출은 응답
   * 뒤로 미뤄져 있어(ADR-086), 되묻기가 떠 있는 동안 다른 자료의 추출이 그 칸을
   * 덮을 수 있습니다. 문항이 실어 준 출처를 답이 되돌려 주면 그 어긋남이 보입니다.
   */
  describe('held_ref — 화면이 물은 값과 지금 값이 같은가 (§3.5)', () => {
    /** 되묻기 문항을 낼 수 있는 플랜 — 앞 문항들이 이미 채워져 있습니다 */
    const heldPlan = (sourceRef: string, valueMasked: string): CasePlanStore => ({
      ...casePlan,
      async readSlots() {
        return [
          { slotKey: 'transferred' as const, tier: 'T1' as const, state: 'confirmed' as const },
          { slotKey: 'channel' as const, tier: 'T1' as const, state: 'confirmed' as const },
          { slotKey: 'org_name' as const, tier: 'T2' as const, state: 'confirmed' as const },
          {
            slotKey: 'amount' as const,
            tier: 'T2' as const,
            state: 'extracted' as const,
            valueMasked,
            sourceRef,
          },
        ]
      },
    })

    it('출처가 같으면 확정한다', async () => {
      const one = ask('amount', {
        action: 'confirm',
        held_ref: '01J8XKQZ3M7N2P4R6T8V0W2Y4B',
      })
      const res = await PATCH(one.request, one.route)
      const body = (await res.json()) as { slot: { state: string } }

      expect(res.status).toBe(200)
      expect(body.slot.state).toBe('confirmed')
    })

    it('**다르면 확정하지 않고 200 으로 새 문항을 낸다** — 에러가 아닙니다', async () => {
      const NEW_REF = '01J8XKQZ3M7N2P4R6T8V0W2Y4C'
      const writes: unknown[] = []
      holder.container = {
        ...wiredContainer(),
        ports: { ...wiredContainer().ports, casePlan: heldPlan(NEW_REF, '3000000') },
        slots: {
          read: async () => [{ ...EXTRACTED[0]!, valueMasked: '3000000', sourceRef: NEW_REF }],
        },
        slotWrite: { write: async (input: unknown) => void writes.push(input) },
      }

      const one = ask('amount', {
        action: 'confirm',
        held_ref: '01J8XKQZ3M7N2P4R6T8V0W2Y4B',
      })
      const res = await PATCH(one.request, one.route)
      const body = (await res.json()) as {
        slot: { state: string }
        next_question: { slot_key: string; input: string; held_ref?: string } | null
      }

      expect(res.status).toBe(200)
      // 아무것도 안 썼습니다 — 본 적 없는 값이 확정되지 않습니다
      expect(writes).toHaveLength(0)
      expect(body.slot.state).toBe('extracted')
      // 대신 **새 값의 확인 문항**이 나갑니다. 그 값의 출처가 실려 다음 답이 짝을 맞춥니다
      expect(body.next_question).toMatchObject({
        slot_key: 'amount',
        input: 'confirm',
        held_ref: NEW_REF,
      })
    })
  })
})

describe('계측 헤더 — 08-14-api.md §1.1', () => {
  it('되묻기로 나간 개인정보 후보를 유형별 건수로 적는다', async () => {
    // 안 채우면 헤더가 언제나 `none` 이라, 경계가 도는지 멈췄는지를 응답만
    // 봐서는 못 가립니다 — §1.1 이 이 헤더를 둔 이유가 그것을 증명하는 것입니다
    holder.container = wiredContainer({
      tokenizer: tokenizerOf([
        { kind: '계좌', token: '[계좌-1]' },
        { kind: '이름', token: '[이름-1]' },
        { kind: '이름', token: '[이름-2]' },
      ]),
    })

    const one = ask('counterpart_account', { action: 'answer', value: '352-0912-3456-73' })
    const res = await PATCH(one.request, one.route)

    // 이름은 영문입니다 — 토큰은 한국어인데 §1.1 이 `account=1;name=2` 로 못 박았습니다
    expect(res.headers.get('X-Pii-Token-Count')).toBe('account=1;name=2')
  })

  it('값을 담지 않는다 — 건수뿐이다', async () => {
    holder.container = wiredContainer({
      tokenizer: tokenizerOf([{ kind: '계좌', token: '[계좌-1]' }]),
    })

    const one = ask('counterpart_account', { action: 'answer', value: '352-0912-3456-73' })
    const res = await PATCH(one.request, one.route)

    expect(res.headers.get('X-Pii-Token-Count')).not.toContain('352')
  })
})

describe('문항에 답하면 파기일이 밀린다 — ADR-016', () => {
  it('답 하나가 그 사건의 touchPurgeAfter 를 부른다', async () => {
    // 2026-09-06 까지 업로드·이메일만 밀었습니다 — 문진으로만 몇 달을 관리한 사건이
    // 업로드 시점 + 180일에 지워질 수 있었습니다. 밀기는 껍데기(`ctx.activity`)가 합니다
    const touched: string[] = []
    holder.container = wiredContainer({
      caseStore: {
        async createCase() {},
        async evidenceTotals() {
          return { count: 0, bytes: 0 }
        },
        async addEvidence() {},
        async markUploaded() {
          return 'processing'
        },
        async touchPurgeAfter(caseId) {
          touched.push(caseId)
        },
      },
    })

    const one = ask('amount', { action: 'unknown' })
    const res = await PATCH(one.request, one.route)

    expect(res.status).toBe(200)
    expect(touched).toEqual([CASE_ID])
  })
})
