/**
 * 계측 헤더 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §1.1 — **「모든 응답에 붙습니다」**
 *
 * 여기서 못 박는 것: **넷은 언제나 넷 다 나간다.** 값이 없을 때 헤더를 빼면
 * 「없음」과 「안 달았음」이 구분되지 않고, 그 순간 §1.1 이 뒤집힙니다.
 */

import { describe, expect, it } from 'vitest'

import {
  TELEMETRY_HEADER_NAMES,
  createTelemetry,
  telemetryHeaders,
} from './telemetry'

describe('넷은 언제나 함께 나간다 — §1.1', () => {
  it('아무것도 안 담아도 네 이름이 다 있다', () => {
    const headers = telemetryHeaders({})

    for (const name of TELEMETRY_HEADER_NAMES) {
      expect(Object.keys(headers), name).toContain(name)
    }
  })

  it('담을 것이 없으면 없다는 뜻의 값이 나간다', () => {
    const headers = telemetryHeaders({})

    // 유형 목록이 비었다는 뜻입니다. `0` 은 유형 이름이 없어 쓸 수 없습니다
    expect(headers['X-Pii-Token-Count']).toBe('')
    // 나간 것이 없으면 나간 것 중 남은 것도 0 건입니다
    expect(headers['X-Pii-Egress-Residual']).toBe('0')
    expect(headers['X-Kb-Version']).toBe('')
    expect(headers['X-Audit-Id']).toBe('')
  })

  it('건수만 담는다 — 값을 담지 않는다', () => {
    const headers = telemetryHeaders({ piiTokenCounts: { account: 1, name: 2 } })

    expect(headers['X-Pii-Token-Count']).toBe('account=1;name=2')
    expect(headers['X-Pii-Token-Count']).not.toMatch(/\d{3}-\d{2,}/)
  })

  it('건수가 0 인 유형은 적지 않는다', () => {
    // 「없는 유형」을 나열하면 무엇이 실제로 토큰화됐는지가 묻힙니다
    expect(telemetryHeaders({ piiTokenCounts: { account: 0 } })['X-Pii-Token-Count'])
      .toBe('')
  })
})

describe('한 요청이 도는 동안 모은다', () => {
  it('토큰화가 두 번이면 합친다', () => {
    // 챗 발화 한 번 + 슬롯 값 한 번처럼 한 요청에서 두 번 지날 수 있습니다
    const telemetry = createTelemetry()

    telemetry.addTokenCounts({ account: 1, name: 1 })
    telemetry.addTokenCounts({ account: 2 })

    expect(telemetry.snapshot().piiTokenCounts).toEqual({ account: 3, name: 1 })
  })

  it('송출이 두 번이면 잔여도 합친다 — 덮어쓰지 않는다', () => {
    const telemetry = createTelemetry()

    telemetry.setEgressResidual(0)
    telemetry.setEgressResidual(2)

    expect(telemetry.snapshot().piiEgressResidual).toBe(2)
  })

  it('KB 버전은 처음 것을 지킨다', () => {
    // 헤더가 하나뿐이라 뒤엣것으로 덮으면 앞 절차의 근거 버전이 조용히 사라집니다
    const telemetry = createTelemetry()

    telemetry.useKbVersion('2026.08.1')
    telemetry.useKbVersion('2026.09.1')

    expect(telemetry.snapshot().kbVersion).toBe('2026.08.1')
  })

  it('빈 값은 무시한다', () => {
    const telemetry = createTelemetry()

    telemetry.useKbVersion(null)
    telemetry.useAuditId(undefined)
    telemetry.addTokenCounts(undefined)

    expect(telemetry.snapshot().kbVersion).toBeUndefined()
    expect(telemetry.snapshot().auditId).toBeUndefined()
  })

  it('감사 식별자를 싣는다', () => {
    const telemetry = createTelemetry()
    telemetry.useAuditId('01J8XKR2')

    expect(telemetryHeaders(telemetry.snapshot())['X-Audit-Id']).toBe('01J8XKR2')
  })
})
