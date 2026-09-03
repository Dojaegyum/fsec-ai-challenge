/**
 * `GET /api/cases/{case_token}/messages` 시험 — 대화 이력.
 *
 * 검증 대상: spec/common/08-14-api.md §3.12 · spec/backend/08-16-data-model.md §9.4 ·
 *            ADR-050 · ADR-065
 *
 * **여기서 못 박는 것 둘:**
 * 1. 비서 줄에 `referenced_steps`·`referenced_deadlines` 가 **§3.9 와 같은 모양**으로
 *    실린다 — 없으면 빈 배열이고 **칸을 빼지 않는다.** 이 칸이 없어 새로고침 뒤에
 *    챗↔단계 연결이 사라지고 있었습니다(GitHub #41)
 * 2. 사용자 줄에는 안 붙는다 — `citations` 와 같은 규칙
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import type { MessageStore } from '@/lib/db'
import { readEnv } from '@/lib/env'

import { GET } from './route'

const CASE_ID = '01J8CASE000000000000000000'
const TOKEN = '01J8TKN0000000000000000000'

type Turn = Awaited<ReturnType<MessageStore['turns']>>['turns'][number]

/** 비서 줄 하나. 시험마다 가리킨 것만 갈아끼웁니다 */
function said(over: Partial<Turn> = {}): Turn {
  return {
    messageId: '01J8XKRE000000000000000000',
    role: 'assistant',
    contentMasked: '지급정지를 거셨으면 다음은 피해구제 신청서 제출입니다.',
    citations: [{ ref: 'kb-2', label: '피해구제 신청서 제출' }],
    insufficient: false,
    referencedSteps: [],
    referencedDeadlines: [],
    createdAt: '2026-08-24T05:31:09.000Z',
    ...over,
  }
}

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

function wiredContainer(turns: readonly Turn[], truncated = false) {
  const ports = {
    ...unconfiguredPorts(readEnv({})),
    auditStore: { lastHash: async () => null, append: async () => {} },
  } as Ports

  const messages: MessageStore = {
    async write() {},
    async history() {
      return []
    },
    async transcript() {
      return []
    },
    async turns() {
      return { turns, truncated }
    },
  }

  return {
    ...createContainer(readEnv({}), ports),
    caseTokens: { toCaseId: async () => CASE_ID },
    messages,
  }
}

interface Row {
  readonly message_id: string
  readonly role: string
  readonly content: string
  readonly citations?: unknown
  readonly referenced_steps?: unknown
  readonly referenced_deadlines?: unknown
}

async function bodyOf(turns: readonly Turn[], truncated = false) {
  holder.container = wiredContainer(turns, truncated)

  const res = await GET(new Request(`http://x/api/cases/${TOKEN}/messages`), {
    params: Promise.resolve({ case_token: TOKEN }),
  })

  expect(res.status).toBe(200)
  return (await res.json()) as { messages: Row[]; truncated: boolean }
}

beforeEach(() => {
  holder.container = undefined
})

describe('답이 가리킨 단계·기한이 이력에 실린다 — §3.12 · ADR-065', () => {
  it('비서 줄에 §3.9 와 같은 모양으로 나간다', async () => {
    const body = await bodyOf([
      said({ referencedSteps: ['01JFREEZE'], referencedDeadlines: ['01JDUE', '01JGRACE'] }),
    ])

    expect(body.messages[0]).toMatchObject({
      role: 'assistant',
      referenced_steps: ['01JFREEZE'],
      referenced_deadlines: ['01JDUE', '01JGRACE'],
    })
  })

  it('가리킨 것이 없으면 **빈 배열** — 칸을 빼지 않는다', async () => {
    // 「모른다」와 「없다」가 갈립니다(§3.6 `after` 와 같은 이유). 화면은 이 값을
    // `?? []` 없이 그대로 받을 수 있어야 합니다
    const body = await bodyOf([said()])

    expect(body.messages[0]).toHaveProperty('referenced_steps', [])
    expect(body.messages[0]).toHaveProperty('referenced_deadlines', [])
  })

  it('사용자 줄에는 안 붙는다 — `citations` 와 같은 규칙', async () => {
    const body = await bodyOf([
      said({ messageId: '01J8XKRC000000000000000000', role: 'user', contentMasked: '이제 뭘 하죠', citations: [] }),
      said({ referencedSteps: ['01JFREEZE'] }),
    ])

    const [user, assistant] = body.messages
    expect(user?.role).toBe('user')
    expect(user).not.toHaveProperty('citations')
    expect(user).not.toHaveProperty('referenced_steps')
    expect(user).not.toHaveProperty('referenced_deadlines')
    expect(assistant?.referenced_steps).toEqual(['01JFREEZE'])
  })

  it('저장된 값을 **그대로** 내린다 — 지금 플랜에 없는 id 도 거르지 않는다', async () => {
    // 이력은 「그때 무엇을 가리켰나」입니다. 서버가 지금 플랜과 대조해 걸러 내면
    // 이력이 사실과 달라집니다 — 모르는 id 는 화면(`pickStep`)이 무시합니다
    const body = await bodyOf([said({ referencedSteps: ['01JGONE', '01JFREEZE'] })])

    expect(body.messages[0]?.referenced_steps).toEqual(['01JGONE', '01JFREEZE'])
  })

  it('`truncated` 는 저장소가 말한 대로', async () => {
    const body = await bodyOf([said()], true)
    expect(body.truncated).toBe(true)
  })
})
