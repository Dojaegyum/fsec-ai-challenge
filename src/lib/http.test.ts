/**
 * 예외 → HTTP 변환 시험.
 *
 * 검증 대상은 spec/backend/08-16-errors.md §3 §3.1 과
 * spec/common/08-14-api.md §1.1 입니다.
 */

import { describe, expect, it } from 'vitest'

import {
  EgressBlockedError,
  KbCitationMissingError,
  KbUnavailableError,
  RateLimitedError,
  SlotNotConfirmedError,
} from './errors'
import { BadRequestError, fail, ok, readJson } from './http'

describe('계측 헤더 — 08-14-api.md §1.1', () => {
  it('토큰 건수를 유형별로 적는다', async () => {
    const res = ok({}, { telemetry: { piiTokenCounts: { account: 1, name: 2 } } })

    expect(res.headers.get('X-Pii-Token-Count')).toBe('account=1;name=2')
  })

  it('잔여 0 도 헤더로 나간다 — 정상임을 응답이 증명한다', async () => {
    const res = ok({}, { telemetry: { piiEgressResidual: 0 } })

    expect(res.headers.get('X-Pii-Egress-Residual')).toBe('0')
  })

  it('KB 버전과 감사 식별자를 싣는다', async () => {
    const res = ok({}, { telemetry: { kbVersion: '2026.08.1', auditId: '01J8XKR2' } })

    expect(res.headers.get('X-Kb-Version')).toBe('2026.08.1')
    expect(res.headers.get('X-Audit-Id')).toBe('01J8XKR2')
  })

  it('값을 담지 않는다 — 건수뿐이다', async () => {
    const res = ok({}, { telemetry: { piiTokenCounts: { account: 1 } } })

    expect(res.headers.get('X-Pii-Token-Count')).not.toContain('110-234')
  })
})

describe('에러 봉투 — 08-16-errors.md §3', () => {
  it('code 와 사용자 문구를 싣는다', async () => {
    const res = fail(new EgressBlockedError('잔여 발견', { counts: { name: 1 } }))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error.code).toBe('EGRESS_BLOCKED')
    expect(body.error.message).toBe(
      '개인정보가 남아 있어 요청을 중단했습니다. 다시 시도해 주세요.',
    )
  })

  it('detail 을 응답에 넣지 않는다 — 감사 로그에만 들어간다', async () => {
    const res = fail(new EgressBlockedError('잔여 발견', { caseId: '01J8XKQZ' }))
    const body = await res.json()

    expect(JSON.stringify(body)).not.toContain('01J8XKQZ')
    expect(body.error).not.toHaveProperty('detail')
  })

  it('감사 식별자를 함께 싣는다', async () => {
    const res = fail(new EgressBlockedError('잔여'), { auditId: '01J8XKR2' })
    const body = await res.json()

    expect(body.error.audit_id).toBe('01J8XKR2')
  })

  it('우리 예외가 아니면 INTERNAL 로 덮는다', async () => {
    // 라이브러리 예외 메시지에 접속 문자열이 섞여 나가면 안 됩니다
    const res = fail(new Error('connect ECONNREFUSED postgres://user:pw@host'))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error.code).toBe('INTERNAL')
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })
})

describe('Retry-After — 08-16-errors.md §3.1', () => {
  it('503 에는 붙인다', async () => {
    const res = fail(new KbUnavailableError('조회 실패'))

    expect(res.status).toBe(503)
    expect(res.headers.get('Retry-After')).toBe('10')
  })

  it('429 에는 남은 창 시간을 그대로 넣는다', async () => {
    const res = fail(new RateLimitedError('상한 초과'), { retryAfterSeconds: 42 })

    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('42')
  })

  it('502 에는 안 붙인다 — 기다린다고 달라지지 않는다', async () => {
    // 서버가 두 번 시도해 같은 결과였습니다
    const res = fail(new KbCitationMissingError('인용 형식 위반'))

    expect(res.status).toBe(502)
    expect(res.headers.get('Retry-After')).toBeNull()
  })

  it('4xx 에는 안 붙인다 — 시간이 안 고친다', async () => {
    const res = fail(new SlotNotConfirmedError('확인 필요'))

    expect(res.status).toBe(409)
    expect(res.headers.get('Retry-After')).toBeNull()
  })
})

describe('요청 본문 읽기', () => {
  it('JSON 을 읽는다', async () => {
    const req = new Request('http://x/', { method: 'POST', body: '{"track":"victim"}' })

    await expect(readJson<{ track: string }>(req)).resolves.toEqual({
      track: 'victim',
    })
  })

  it('깨진 본문은 400 이다 — 500 이 아니다', async () => {
    // 라이브러리 예외를 그대로 올리면 INTERNAL 로 떨어져
    // 「처리 중 문제가 발생했습니다」가 나가는데, 실제로는 요청이 잘못된 것입니다
    const req = new Request('http://x/', { method: 'POST', body: '{ 깨짐' })

    await expect(readJson(req)).rejects.toBeInstanceOf(BadRequestError)
    expect(fail(new BadRequestError('x')).status).toBe(400)
  })
})
