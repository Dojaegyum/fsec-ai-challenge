/**
 * 업로드 자리 발급 시험 — §3.2.
 *
 * 검증 대상: spec/common/08-14-api.md §3.2 · §1.3 ·
 *            decisions/039-link-token.md (주소는 링크 토큰)
 *
 * **여기서 못 박는 것 넷:**
 * 1. 파일이 이 함수를 통과하지 않는다 — 주소만 내준다
 * 2. **주소의 값을 그대로 사건 식별자로 쓰지 않는다** — 조회가 신분 확인이다
 * 3. 없는 사건은 404 이고, 모양이 틀린 것은 400 이다
 * 4. 상한 판단은 라우트가 하지 않는다 — 모듈의 몫이다
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { CaseStore, UploadSlotSource } from '@/modules/case-intake'

import { POST } from './route'

const TOKEN = 'TKN00000000000000000000ABC'.slice(0, 26)
const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** 사건이 지금까지 받은 것 — 상한 판단의 재료 */
function caseStoreOf(totals = { count: 0, bytes: 0 }) {
  const added: unknown[] = []
  const store: CaseStore = {
    async createCase() {},
    async evidenceTotals() {
      return totals
    },
    async addEvidence(row) {
      added.push(row)
    },
    async markUploaded() {
      return 'processing'
    },
    async touchPurgeAfter() {},
  }
  return { store, added }
}

const uploads: UploadSlotSource = {
  async issue(req) {
    return {
      objectKey: `${req.caseId}/${req.evidenceId}`,
      url: 'https://storage.example/upload?token=x',
      expiresAt: '2026-08-23T00:05:00+09:00',
    }
  },
}

/**
 * 라우트는 조립본을 `getContainer()` 로 가져갑니다 — 프로세스에 하나여야
 * 하는 물건이라 인자로 안 받습니다. 시험에서는 그 자리를 바꿔 끼웁니다.
 */
const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

/**
 * 링크 토큰을 사건으로 바꾸는 자리를 갈아 끼운다.
 * `null` 이면 「그 주소로 열리는 사건이 없다」입니다.
 */
function build(caseId: string | null, totals?: { count: number; bytes: number }) {
  const env = readEnv({})
  const made = createContainer(env, {
    ...unconfiguredPorts(env),
    caseStore: caseStoreOf(totals).store,
    uploads,
  } satisfies Ports)

  holder.container = {
    ...made,
    caseTokens: { async toCaseId() { return caseId } },
  }
}

const route = (case_token = TOKEN) => ({ params: Promise.resolve({ case_token }) })

function ask(body: unknown) {
  return new Request(`http://x/api/cases/${TOKEN}/evidence`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const good = { kind: 'audio', mime_type: 'audio/m4a', byte_size: 4_210_553 }

beforeEach(() => {
  build(CASE_ID)
})

describe('업로드 자리를 낸다 — §3.2', () => {
  it('계약의 칸을 그대로 낸다', async () => {
    const res = await POST(ask(good), route())
    const body = (await res.json()) as Record<string, unknown>

    expect(res.status).toBe(201)
    expect(Object.keys(body).sort()).toEqual(
      ['evidence_id', 'expires_at', 'upload_method', 'upload_url'].sort(),
    )
    // 브라우저가 저장소로 직행합니다 — 파일이 이 함수를 통과하지 않습니다
    expect(body.upload_method).toBe('PUT')
    expect(String(body.upload_url)).toMatch(/^https:\/\//)
  })

  it('**주소의 값을 그대로 사건 식별자로 쓰지 않는다** — ADR-039', async () => {
    // 토큰과 사건 식별자는 규격이 같아 형식으로 못 가릅니다. 조회가 돌려준
    // 값으로 사건을 찾아야 하고, 토큰을 그대로 쓰면 기본키 조회가 언제나 빕니다
    let asked: string | null = null
    const totals = { count: 0, bytes: 0 }
    const env = readEnv({})
    const made = createContainer(env, {
      ...unconfiguredPorts(env),
      caseStore: {
        async createCase() {},
        async evidenceTotals(caseId: string) {
          asked = caseId
          return totals
        },
        async addEvidence() {},
        async markUploaded() { return 'processing' as const },
        async touchPurgeAfter() {},
      },
      uploads,
    } satisfies Ports)
    holder.container = {
      ...made,
      caseTokens: { async toCaseId() { return CASE_ID } },
    }

    await POST(ask(good), route())

    expect(asked).toBe(CASE_ID)
    expect(asked).not.toBe(TOKEN)
  })
})

describe('주소가 잘못됐을 때', () => {
  it('모양이 틀리면 400 이다', async () => {
    const res = await POST(ask(good), route('../etc/passwd'))
    expect(res.status).toBe(400)
  })

  it('그 주소로 열리는 사건이 없으면 404 다', async () => {
    build(null)
    const res = await POST(ask(good), route())
    expect(res.status).toBe(404)
  })
})

describe('요청 모양을 본다 — 판단은 모듈이 한다', () => {
  it('kind 가 목록 밖이면 400 이다', async () => {
    const res = await POST(ask({ ...good, kind: 'video' }), route())
    expect(res.status).toBe(400)
  })

  it('mime_type 이 없으면 400 이다', async () => {
    const res = await POST(ask({ kind: 'audio', byte_size: 100 }), route())
    expect(res.status).toBe(400)
  })

  it('**byte_size 가 음수면 400 이다** — 더하면 합계가 줄어 상한을 영영 안 넘는다', async () => {
    const res = await POST(ask({ ...good, byte_size: -1 }), route())
    expect(res.status).toBe(400)
  })

  it('byte_size 가 실수면 400 이다', async () => {
    const res = await POST(ask({ ...good, byte_size: 1.5 }), route())
    expect(res.status).toBe(400)
  })

  it('받은 값을 detail 에 담지 않는다', async () => {
    const res = await POST(ask({ ...good, kind: '010-1234-5678' }), route())
    const body = await res.text()

    // 감사 기록으로 가는 자리입니다 → 09-data-model.md §10.1
    expect(body).not.toContain('010-1234')
  })
})
