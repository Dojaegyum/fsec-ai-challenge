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

function wiredContainer(over: { tokenizer?: PiiTokenizer } = {}) {
  const ports = {
    ...unconfiguredPorts(readEnv({})),
    casePlan,
    kbStore: { async findApplied() { return [] }, async findReference() { return [] } },
    auditStore: { lastHash: async () => null, append: async () => {} },
    kbVersion: { current: async () => '2026.08.1' },
  } as Ports

  return {
    ...createContainer(readEnv({}), ports),
    caseTokens: { toCaseId: async () => CASE_ID },
    slots: { read: async () => [] },
    slotWrite: { write: async () => {} },
    channelWrite: { write: async () => {}, candidates: async () => [] },
    deadlineWrite: { apply: async () => [], sweepOverdue: async () => 0 },
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
