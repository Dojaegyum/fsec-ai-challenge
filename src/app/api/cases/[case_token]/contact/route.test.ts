/**
 * `PUT /api/cases/{case_token}/contact` 시험 — **값이 어디에도 다시 안 나타나는가.**
 *
 * 검증 대상: spec/common/08-14-api.md §3.13 · spec/backend/08-16-data-model.md §2 `notify_email`
 * 근거: ADR-021(이메일은 선택·미검증) · ADR-016(활동이 있으면 파기일을 민다)
 *
 * **여기서 못 박는 것 넷:**
 * 1. 검증하지 않는다 — 형식이 이상해도 저장된다 (ADR-021: 형식 검사가 곧 관문)
 * 2. `null`·빈 문자열은 지우기다
 * 3. 틀린 요청의 응답에 **보낸 값이 실리지 않는다** — 이메일은 평문 연락처입니다
 * 4. 저장은 활동이다 — 파기일이 밀린다
 */

import { describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CaseStore } from '@/modules/case-intake'

import { PUT } from './route'

const CASE_ID = '01J8CASE000000000000000000'
const TOKEN = '01J8TKN0000000000000000000'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

function put(body: unknown) {
  return new Request(`http://x/api/cases/${TOKEN}/contact`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** 저장된 것과 밀린 파기일을 들여다볼 수 있게 조립합니다 */
function wire(known = true) {
  const saved: (string | null)[] = []
  const touched: string[] = []

  const caseStore: CaseStore = {
    async createCase() {},
    async evidenceTotals() {
      return { count: 0, bytes: 0 }
    },
    async addEvidence() {},
    async markUploaded() {
      return 'processing'
    },
    async touchPurgeAfter(_caseId, purgeAfter) {
      touched.push(purgeAfter)
    },
  }

  holder.container = {
    ...createContainer(readEnv({}), {
      ...unconfiguredPorts(readEnv({})),
      caseStore,
    } as Ports),
    caseTokens: { toCaseId: async () => (known ? CASE_ID : null) },
    contactWrite: {
      saveNotifyEmail: async (_caseId: string, email: string | null) => {
        saved.push(email)
      },
    },
  }

  return { saved, touched }
}

describe('저장한다 — 검증 없이 (ADR-021)', () => {
  it('보낸 값이 그대로 저장되고 { saved: true } 가 나간다', async () => {
    const { saved } = wire()

    const res = await PUT(put({ email: 'name@example.com' }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: true })
    expect(saved).toEqual(['name@example.com'])
  })

  it('형식이 이상해도 저장된다 — 형식 검사가 곧 관문입니다', async () => {
    // 오타면 알림이 안 갈 뿐, 사용자가 막히지 않습니다 → ADR-021
    const { saved } = wire()

    const res = await PUT(put({ email: '오타@@어딘가' }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(res.status).toBe(200)
    expect(saved).toEqual(['오타@@어딘가'])
  })

  it('앞뒤 공백은 잘라 저장한다 — 공백 하나로 발송이 조용히 실패합니다', async () => {
    const { saved } = wire()

    await PUT(put({ email: '  name@example.com ' }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(saved).toEqual(['name@example.com'])
  })

  it('저장은 활동이다 — 파기일이 밀린다 (ADR-016)', async () => {
    const { touched } = wire()

    await PUT(put({ email: 'name@example.com' }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    // 값 자체는 날짜 셈(date-checker)의 몫입니다 — 여기서는 밀렸다는 사실만 봅니다
    expect(touched).toHaveLength(1)
    expect(touched[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('null 과 빈 문자열은 지우기다', () => {
  it('null 이면 지운다', async () => {
    const { saved } = wire()

    const res = await PUT(put({ email: null }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(res.status).toBe(200)
    expect(saved).toEqual([null])
  })

  it('빈 문자열도 지우기다 — 안 준 것과 빈 칸은 같은 뜻입니다', async () => {
    const { saved } = wire()

    await PUT(put({ email: '   ' }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(saved).toEqual([null])
  })
})

describe('틀린 요청 — 그리고 값이 안 새는가', () => {
  it('문자열도 null 도 아니면 400 이다', async () => {
    const { saved } = wire()

    const res = await PUT(put({ email: 7 }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(res.status).toBe(400)
    expect(saved).toEqual([])
  })

  it('254자를 넘으면 400 — 형식이 아니라 칸의 크기입니다', async () => {
    const { saved } = wire()
    const long = `${'a'.repeat(250)}@x.com` // 256자

    const res = await PUT(put({ email: long }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(res.status).toBe(400)
    expect(saved).toEqual([])
    // **경계 시험.** 이메일은 평문 연락처라 오류 응답에 값이 실리면 안 됩니다
    expect(JSON.stringify(await res.json())).not.toContain('a@x.com')
  })

  it('없는 사건은 404 — 값은 저장되지 않는다', async () => {
    const { saved } = wire(false)

    const res = await PUT(put({ email: 'name@example.com' }), {
      params: Promise.resolve({ case_token: TOKEN }),
    })

    expect(res.status).toBe(404)
    expect(saved).toEqual([])
    // 응답 어디에도 보낸 값이 없습니다
    expect(JSON.stringify(await res.json())).not.toContain('name@example.com')
  })
})
