/**
 * 설정 현황 — 무엇이 붙었는지를 **이름으로만** 말한다.
 *
 * 2026-09-06 점검에서 둘이 걸렸습니다 — (1) 이 함수를 부르는 곳이 시험뿐이라 현황이
 * 어디에도 안 떴고(→ `scripts/config-report.ts`), (2) 언어모델 줄이 `XAI_API_KEY` 만 봐서
 * 일반 이름(`LLM_API_KEY`)으로 붙인 배포에서 「없음」이 떴습니다.
 */

import { describe, expect, it } from 'vitest'

import { configReport, formatConfigReport } from './config-report'
import { createContainer, unconfiguredPorts } from './container'
import { readEnv } from './env'

function reportOf(source: Record<string, string>) {
  const env = readEnv(source)
  return configReport(createContainer(env, unconfiguredPorts(env)))
}

const rowOf = (rows: ReturnType<typeof reportOf>, port: string) => {
  const found = rows.find((one) => one.port === port)
  if (!found) throw new Error(`줄이 없습니다: ${port}`)
  return found
}

describe('언어모델 열쇠는 둘 중 하나면 붙은 것이다', () => {
  it('XAI_API_KEY 만 있어도 붙었다', () => {
    expect(rowOf(reportOf({ XAI_API_KEY: 'k' }), '언어모델').configured).toBe(true)
  })

  it('LLM_API_KEY 만 있어도 붙었다 — 일반 이름으로 갈아끼운 배포', () => {
    expect(rowOf(reportOf({ LLM_API_KEY: 'k' }), '언어모델').configured).toBe(true)
  })

  it('둘 다 없으면 안 붙었고, 빠진 것의 이름만 말한다', () => {
    const row = rowOf(reportOf({}), '언어모델')
    expect(row.configured).toBe(false)
    expect(row.missing).toEqual(['XAI_API_KEY 또는 LLM_API_KEY'])
  })
})

describe('법령 수집도 현황에 드러난다 — ADR-072', () => {
  it('LAW_API_OC 가 없으면 「안 붙음」이되 사건 진행은 그대로라고 말한다', () => {
    const row = rowOf(reportOf({}), '법령 수집')
    expect(row.configured).toBe(false)
    expect(row.effect).toContain('사건 진행은 그대로')
  })

  it('있으면 붙었다', () => {
    expect(rowOf(reportOf({ LAW_API_OC: 'oc' }), '법령 수집').configured).toBe(true)
  })
})

describe('사람이 읽는 한 화면', () => {
  it('값은 한 글자도 찍지 않는다 — 이름과 여부만', () => {
    const text = formatConfigReport(reportOf({ XAI_API_KEY: 'sk-secret-value', LAW_API_OC: 'oc-secret' }))
    expect(text).not.toContain('sk-secret-value')
    expect(text).not.toContain('oc-secret')
    expect(text).toMatch(/붙음 \d+ \/ \d+/)
  })
})

describe('발화 자료 선별기는 모델 이름이 있어야 붙은 것이다 — ADR-089', () => {
  it('열쇠만 있고 모델이 없으면 안 붙었고, 챗은 그대로 돈다고 말한다', () => {
    const row = rowOf(reportOf({ XAI_API_KEY: 'k' }), '발화 자료 선별')
    expect(row.configured).toBe(false)
    expect(row.missing).toEqual(['LLM_SELECT_MODEL'])
  })

  it('모델 이름과 열쇠가 있으면 붙었다', () => {
    expect(
      rowOf(reportOf({ XAI_API_KEY: 'k', LLM_SELECT_MODEL: 'grok-fast' }), '발화 자료 선별').configured,
    ).toBe(true)
  })
})
