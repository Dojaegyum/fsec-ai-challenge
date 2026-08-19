/**
 * audit-logger 시험.
 *
 * 검증 대상은 spec/backend/08-16-data-model.md §10 · §10.1 · §10.2 입니다.
 *
 * 가장 중요한 것: **중간을 고치거나 지우면 드러나야 합니다.**
 * 그것이 해시 사슬을 두는 이유입니다.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { PiiBoundaryError } from '@/lib/errors'

import type { AuditRecord, AuditStore } from './types'
import { createAuditLogger, hashOf, verifyChain } from './audit'

/** 메모리에 쌓는 시험용 저장소 */
function memoryStore(): AuditStore & { rows: AuditRecord[] } {
  const rows: AuditRecord[] = []
  return {
    rows,
    async lastHash() {
      return rows.length > 0 ? rows[rows.length - 1].hash : null
    },
    async append(record) {
      rows.push(record)
    },
  }
}

let store: ReturnType<typeof memoryStore>
let tick: number

/** 시각과 식별자를 고정해 같은 입력에 같은 결과가 나오게 한다 */
function newLogger() {
  tick = 0
  store = memoryStore()
  return createAuditLogger({
    store,
    now: () => {
      tick += 1
      return `2026-08-18T10:00:0${tick}.000000+09:00`
    },
    newId: () => `01J8XKR${tick}`,
  })
}

beforeEach(() => {
  tick = 0
})

describe('한 줄을 남긴다', () => {
  it('정본이 정한 칸을 채운다', async () => {
    const logger = newLogger()
    const record = await logger.record({
      eventType: 'case.opened',
      actorType: 'user',
      caseId: '01J8XKQZ',
      detail: { track: 'victim' },
    })

    expect(record.eventType).toBe('case.opened')
    expect(record.actorType).toBe('user')
    expect(record.caseId).toBe('01J8XKQZ')
    expect(record.detail).toEqual({ track: 'victim' })
    // SHA-256 은 소문자 16진수 64자
    expect(record.hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('첫 줄의 앞 해시는 없다', async () => {
    const logger = newLogger()
    const record = await logger.record({
      eventType: 'case.opened',
      actorType: 'system',
      detail: {},
    })
    expect(record.prevHash).toBeNull()
  })

  it('사건과 무관한 기록도 남길 수 있다', async () => {
    const logger = newLogger()
    const record = await logger.record({
      eventType: 'llm.called',
      actorType: 'model',
      detail: { model: 'grok-4.5', token_in: 1200 },
    })
    expect(record.caseId).toBeNull()
  })
})

describe('사슬로 이어진다', () => {
  it('뒷줄의 앞 해시가 앞줄의 해시와 같다', async () => {
    const logger = newLogger()
    const first = await logger.record({
      eventType: 'case.opened',
      actorType: 'user',
      detail: { track: 'victim' },
    })
    const second = await logger.record({
      eventType: 'slot.confirmed',
      actorType: 'user',
      detail: { slot_key: 'channel' },
    })

    expect(second.prevHash).toBe(first.hash)
  })

  it('내용이 같아도 앞 해시가 다르면 해시가 다르다', async () => {
    // 같은 사건이 두 번 일어나도 사슬에서의 자리가 다르면 값이 다르다
    const logger = newLogger()
    const first = await logger.record({
      eventType: 'pii.scrubbed',
      actorType: 'system',
      detail: { counts: { account: 2 } },
    })
    const second = await logger.record({
      eventType: 'pii.scrubbed',
      actorType: 'system',
      detail: { counts: { account: 2 } },
    })

    expect(second.hash).not.toBe(first.hash)
  })
})

describe('중간을 건드리면 드러난다', () => {
  async function threeRows() {
    const logger = newLogger()
    await logger.record({
      eventType: 'case.opened',
      actorType: 'user',
      detail: { track: 'victim' },
    })
    await logger.record({
      eventType: 'plan.generated',
      actorType: 'system',
      detail: { kb_version: '2026.08.1', steps: 5 },
    })
    await logger.record({
      eventType: 'artifact.verified',
      actorType: 'user',
      detail: { level: 'L1', result: 'passed' },
    })
    return store.rows
  }

  it('손대지 않았으면 온전하다', async () => {
    const rows = await threeRows()
    expect(verifyChain(rows)).toEqual({ intact: true })
  })

  it('내용을 고치면 그 자리가 나온다', async () => {
    const rows = await threeRows()
    const tampered = [...rows]
    tampered[1] = { ...rows[1], detail: { kb_version: '2026.08.1', steps: 99 } }

    const verdict = verifyChain(tampered)
    expect(verdict.intact).toBe(false)
    expect(verdict.brokenAt?.index).toBe(1)
  })

  it('중간을 지우면 이어지지 않는다', async () => {
    const rows = await threeRows()
    const removed = [rows[0], rows[2]]

    const verdict = verifyChain(removed)
    expect(verdict.intact).toBe(false)
    // 지워진 다음 줄에서 앞 해시가 어긋난다
    expect(verdict.brokenAt?.index).toBe(1)
  })

  it('순서를 바꿔도 드러난다', async () => {
    const rows = await threeRows()
    const swapped = [rows[0], rows[2], rows[1]]
    expect(verifyChain(swapped).intact).toBe(false)
  })

  it('시각을 고쳐도 드러난다', async () => {
    const rows = await threeRows()
    const tampered = [...rows]
    tampered[0] = { ...rows[0], createdAt: '2026-01-01T00:00:00.000000+09:00' }
    expect(verifyChain(tampered).intact).toBe(false)
  })

  it('기록이 없으면 온전한 것으로 본다', () => {
    expect(verifyChain([])).toEqual({ intact: true })
  })
})

describe('개인정보 토큰을 담을 수 없다', () => {
  it('토큰이 있으면 거부한다', async () => {
    // 토큰이라도 넣지 않는다 — 볼트가 살아 있는 동안 원문을 얻을 수 있다 → §10.1
    const logger = newLogger()
    await expect(
      logger.record({
        eventType: 'pii.scrubbed',
        actorType: 'system',
        detail: { kind: 'account', token: '[계좌-1]' },
      }),
    ).rejects.toThrow(PiiBoundaryError)
  })

  it('중첩된 곳에 숨어 있어도 잡는다', async () => {
    const logger = newLogger()
    await expect(
      logger.record({
        eventType: 'chat.context_built',
        actorType: 'system',
        detail: { sample: { lines: ['[이름-1] 고객님'] } },
      }),
    ).rejects.toThrow(PiiBoundaryError)
  })

  it('거부되면 아무것도 쌓이지 않는다', async () => {
    const logger = newLogger()
    await expect(
      logger.record({
        eventType: 'pii.scrubbed',
        actorType: 'system',
        detail: { token: '[주민번호-1]' },
      }),
    ).rejects.toThrow()
    expect(store.rows).toHaveLength(0)
  })

  it('예외 메시지에 값이 담기지 않는다', async () => {
    const logger = newLogger()
    try {
      await logger.record({
        eventType: 'pii.scrubbed',
        actorType: 'system',
        detail: { token: '[계좌-7]' },
      })
      throw new Error('거부됐어야 합니다')
    } catch (error) {
      expect(String(error)).not.toContain('계좌-7')
    }
  })

  it('건수만 담은 것은 통과한다', async () => {
    // 정본 §10.1 의 「좋음」 예
    const logger = newLogger()
    const record = await logger.record({
      eventType: 'pii.scrubbed',
      actorType: 'system',
      detail: { kind: 'account', count: 2, layer: 2 },
    })
    expect(record.detail).toEqual({ kind: 'account', count: 2, layer: 2 })
  })
})

describe('해시는 키 순서에 흔들리지 않는다', () => {
  it('같은 내용이면 키를 어떤 순서로 넣어도 같다', () => {
    // 저장소가 JSONB 라 읽어올 때 키 순서가 달라질 수 있다.
    // 순서에 흔들리면 멀쩡한 사슬이 깨진 것처럼 보인다
    const base = {
      prevHash: null,
      auditId: '01J8XKR1',
      eventType: 'chat.context_built',
      createdAt: '2026-08-18T10:00:00.000000+09:00',
    }

    const a = hashOf({ ...base, detail: { applied: 5, reference: 7 } })
    const b = hashOf({ ...base, detail: { reference: 7, applied: 5 } })

    expect(a).toBe(b)
  })

  it('중첩된 객체의 키 순서도 흔들리지 않는다', () => {
    const base = {
      prevHash: null,
      auditId: '01J8XKR1',
      eventType: 'pii.scrubbed',
      createdAt: '2026-08-18T10:00:00.000000+09:00',
    }

    const a = hashOf({ ...base, detail: { counts: { account: 2, name: 1 } } })
    const b = hashOf({ ...base, detail: { counts: { name: 1, account: 2 } } })

    expect(a).toBe(b)
  })

  it('내용이 다르면 해시도 다르다', () => {
    const base = {
      prevHash: null,
      auditId: '01J8XKR1',
      eventType: 'pii.scrubbed',
      createdAt: '2026-08-18T10:00:00.000000+09:00',
    }

    const a = hashOf({ ...base, detail: { counts: { account: 2 } } })
    const b = hashOf({ ...base, detail: { counts: { account: 3 } } })

    expect(a).not.toBe(b)
  })
})
