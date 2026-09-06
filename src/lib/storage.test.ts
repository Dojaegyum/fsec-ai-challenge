/**
 * 저장소 어댑터 시험 — 서명 주소 요청이 닿지 못한 것은 일시적이다 (ADR-091 §1 · Task 9b).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readEnv } from './env'
import { isTransient } from './errors'
import { createMediaReader } from './storage'

const ENV = readEnv({
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
})

const asResponse = (status: number, body: unknown = {}) =>
  ({ ok: status < 400, status, json: async () => body }) as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readUrl — 닿지 못함은 일시적', () => {
  it('fetch 가 던지면 TransientError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET')
      }),
    )
    const reader = createMediaReader(ENV)
    expect(reader).not.toBeNull()

    const thrown = await reader!.readUrl('case/evidence').catch((e: unknown) => e)

    expect(isTransient(thrown)).toBe(true)
    expect(String((thrown as Error).message)).not.toContain('service-role-key')
  })

  it('5xx 도 TransientError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => asResponse(503)))
    const reader = createMediaReader(ENV)

    expect(isTransient(await reader!.readUrl('case/evidence').catch((e: unknown) => e))).toBe(
      true,
    )
  })

  it('4xx 는 그대로 보통 Error — 잘못된 경로·권한은 기다려도 안 낫는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => asResponse(404)))
    const reader = createMediaReader(ENV)

    const thrown = await reader!.readUrl('case/evidence').catch((e: unknown) => e)
    expect(thrown).toBeInstanceOf(Error)
    expect(isTransient(thrown)).toBe(false)
  })
})
