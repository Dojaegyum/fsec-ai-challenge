/**
 * 플랜 응답 모양 시험 — **화면이 번호를 붙일 수 있는가**.
 *
 * `plan-viewer` 의 `numberSteps` 가 `body.step_key` 로 `after` 사슬을 잇습니다.
 * 안 오면 전부 점으로 그리고 「번호가 붙은 것만 순서대로」 안내 줄도 안 뜹니다 —
 * **조용히 기능 하나가 사라집니다.**
 */

import { describe, expect, it } from 'vitest'

import { toApiPlan, toApiStep } from './api-plan'
import type { StoredStep } from './regenerate-plan'

const step = (over: Partial<StoredStep> = {}): StoredStep => ({
  planStepId: '01J8XKR7000000000000000000',
  stepKey: 'freeze-request',
  seq: 20,
  title: '돈이 빠져나간 금융회사에 지급정지를 요청합니다',
  actor: 'victim',
  conditional: null,
  state: 'not_started',
  body: { action: 'call', channel: ['phone'], after: ['report-112'] },
  kbEntryId: 'common-freeze-request',
  kbVersion: '2026.08.1',
  legalBasis: '통신사기피해환급법 제4조제1항제1호',
  sourceUrl: 'https://www.law.go.kr/법령/…/제4조',
  effectiveFrom: '2024-08-28',
  artifacts: [],
  requiredArtifact: null,
  ...over,
})

describe('사슬을 잇는 열쇠가 실린다 — §3.6', () => {
  it('`body.step_key` 가 나간다', () => {
    // 값은 `plan_step.step_key` 칼럼에서 옵니다. KB 파일에 같이 적어 두면
    // 칼럼과 둘이 되어 어긋납니다
    expect(toApiStep(step()).body.step_key).toBe('freeze-request')
  })

  it('`after` 는 KB 가 담은 것 그대로', () => {
    expect(toApiStep(step()).body.after).toEqual(['report-112'])
  })

  it('KB 가 담은 다른 칸을 지우지 않는다', () => {
    const body = toApiStep(step()).body
    expect(body.action).toBe('call')
    expect(body.channel).toEqual(['phone'])
  })

  it('KB 가 `step_key` 를 담고 있어도 **칼럼이 이깁니다**', () => {
    // 둘이 어긋나면 화면의 사슬이 끊어집니다. 정본은 칼럼입니다
    const got = toApiStep(step({ body: { step_key: '옛-이름' } }))
    expect(got.body.step_key).toBe('freeze-request')
  })
})

describe('근거 없는 단계를 만들지 않는다 — 불변 규칙 1', () => {
  it('네 칸이 그대로 실린다', () => {
    expect(toApiStep(step()).citation).toEqual({
      kb_entry_id: 'common-freeze-request',
      kb_version: '2026.08.1',
      legal_basis: '통신사기피해환급법 제4조제1항제1호',
      source_url: 'https://www.law.go.kr/법령/…/제4조',
      effective_from: '2024-08-28',
    })
  })
})

describe('§3.1 과 §3.6 이 같은 모양을 쓴다 — ADR-047', () => {
  it('플랜 전체도 같은 옮김을 지난다', () => {
    // 이 옮김이 보는 것은 둘뿐입니다 — 스냅샷의 나머지 칸은 §3.6 응답에 안 나갑니다
    const plan = toApiPlan({
      isSuperset: true,
      steps: [step(), step({ planStepId: 'b', stepKey: 'relief-apply', seq: 30 })],
    })
    expect(plan.is_superset).toBe(true)
    expect(plan.steps.map((one) => one.body.step_key)).toEqual([
      'freeze-request',
      'relief-apply',
    ])
  })
})
