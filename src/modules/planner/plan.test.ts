/**
 * planner 시험.
 *
 * 검증 대상은 spec/backend/08-16-data-model.md §6 §6.1 §11.4 와
 * spec/backend/08-14-slot-tiering.md 입니다.
 */

import { describe, expect, it } from 'vitest'

import { KbError } from '@/lib/errors'

import { createPlanner } from './plan'
import type { KbStep, KbStepBody, PlanInput } from './types'

const NOW = '2026-08-20T14:30:00+09:00'

function planner() {
  return createPlanner({ clock: { now: () => NOW } })
}

/** 근거 네 칸과 actor 가 채워진 항목. 시험에서 보는 칸만 인자로 받습니다 */
function step(
  stepKey: string,
  body: Partial<KbStepBody> = {},
  over: Partial<KbStep> = {},
): KbStep {
  return {
    kbEntryId: `kb-${stepKey}`,
    kbVersion: '2026.08.1',
    stepKey,
    stepSeq: 10,
    channelId: 'CH-bank',
    title: `${stepKey} 제목`,
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2026-07-01',
    body: { actor: 'victim', ...body },
    ...over,
  }
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return { caseId: 'CASE01', applied: [], slots: [], ...over }
}

describe('활성 조건', () => {
  it('조건이 없으면 바로 활성이다', async () => {
    // 사건을 만든 직후의 T0 공통 안전 절차가 이 자리입니다
    const { upsert } = planner().build(
      input({ applied: [step('report-112')] }),
    )

    expect(upsert.map((one) => one.stepKey)).toEqual(['report-112'])
  })

  it('필요한 슬롯이 confirmed 여야 켜진다', async () => {
    const applied = [step('relief-apply', { requires_slots: ['freeze_requested_at'] })]

    const off = planner().build(input({ applied }))
    const on = planner().build(
      input({
        applied,
        slots: [{ slotKey: 'freeze_requested_at', state: 'confirmed' }],
      }),
    )

    expect(off.upsert).toHaveLength(0)
    expect(on.upsert).toHaveLength(1)
  })

  it('**KB 본문의 표기(`requires_slots`)를 읽는다** — 이름이 어긋나면 문이 통째로 열린다', async () => {
    // `src/kb/*.json` 스무 자리와 적재기(`lib/kb-load.ts`)와 `plan_step.body` 가
    // 전부 snake_case 입니다 → 09-data-model.md §11.4. **옮겨 적는 자리가 없습니다** —
    // `lib/adapters.ts` 의 `kbRowToPlanStep` 은 본문을 그대로 넘깁니다.
    //
    // 2026-08-27 까지 이 모듈이 `requiresSlots` 를 읽어 조건이 언제나 「없음」이었고,
    // **값을 모르는 상태에서도 그 단계가 그대로 나갔습니다**
    const fromKb: KbStepBody = { actor: 'victim', requires_slots: ['freeze_requested_at'] }

    const { upsert } = planner().build(
      input({ applied: [step('relief-apply', fromKb)] }),
    )

    expect(upsert).toHaveLength(0)
  })

  it('extracted 로는 켜지지 않는다', async () => {
    // 모델이 뽑았을 뿐 확인 전입니다. 잘못 읽은 값으로 엉뚱한 절차가 뜨면 안 됩니다
    const { upsert } = planner().build(
      input({
        applied: [step('relief-apply', { requires_slots: ['freeze_requested_at'] })],
        slots: [{ slotKey: 'freeze_requested_at', state: 'extracted' }],
      }),
    )

    expect(upsert).toHaveLength(0)
  })

  it('「모름」으로도 켜지지 않는다', async () => {
    const { upsert } = planner().build(
      input({
        applied: [step('relief-apply', { requires_slots: ['freeze_requested_at'] })],
        slots: [{ slotKey: 'freeze_requested_at', state: 'unknown' }],
      }),
    )

    expect(upsert).toHaveLength(0)
  })

  it('선행 단계가 끝나야 켜진다', async () => {
    const applied = [step('relief-apply', { after: ['bank-freeze-request'] })]

    const off = planner().build(input({ applied }))
    const on = planner().build(
      input({
        applied,
        existing: [{ stepKey: 'bank-freeze-request', state: 'done_verified' }],
      }),
    )

    expect(off.upsert).toHaveLength(0)
    expect(on.upsert.map((one) => one.stepKey)).toEqual(['relief-apply'])
  })

  it('선행 단계가 진행 중이기만 하면 안 켜진다', async () => {
    // 부산물로 확인된 것만 「끝났다」입니다
    const { upsert } = planner().build(
      input({
        applied: [step('relief-apply', { after: ['bank-freeze-request'] })],
        existing: [{ stepKey: 'bank-freeze-request', state: 'in_progress' }],
      }),
    )

    expect(upsert).toHaveLength(0)
  })

  it('조건을 못 넘겨도 멈추지 않는다 — 빈 플랜도 정상이다', async () => {
    const result = planner().build(
      input({ applied: [step('a', { requires_slots: ['org_name'] })] }),
    )

    expect(result).toEqual({ upsert: [], preserved: [], skipped: [] })
  })
})

describe('재생성 시 병합 — 09-data-model.md §6.1', () => {
  const applied = [step('a'), step('b')]

  it('시작 전이면 새 내용으로 교체한다', async () => {
    const { upsert } = planner().build(
      input({ applied, existing: [{ stepKey: 'a', state: 'not_started' }] }),
    )

    expect(upsert.find((one) => one.stepKey === 'a')?.state).toBe('not_started')
  })

  it('진행 중이면 내용만 교체하고 상태는 유지한다', async () => {
    const { upsert } = planner().build(
      input({ applied, existing: [{ stepKey: 'a', state: 'in_progress' }] }),
    )

    expect(upsert.find((one) => one.stepKey === 'a')?.state).toBe('in_progress')
  })

  it('완료된 단계는 교체하지 않는다 — 부산물이 끊긴다', async () => {
    const { upsert, preserved } = planner().build(
      input({ applied, existing: [{ stepKey: 'a', state: 'done_verified' }] }),
    )

    expect(upsert.map((one) => one.stepKey)).toEqual(['b'])
    expect(preserved.map((one) => one.stepKey)).toEqual(['a'])
  })

  it('미확인 단계도 교체하지 않는다 — 리마인더 추적이 끊긴다', async () => {
    const { upsert, preserved } = planner().build(
      input({ applied, existing: [{ stepKey: 'a', state: 'unconfirmed' }] }),
    )

    expect(upsert.map((one) => one.stepKey)).toEqual(['b'])
    expect(preserved.map((one) => one.stepKey)).toEqual(['a'])
  })

  it('보존해도 표시 순서는 새 플랜을 따른다', async () => {
    // 건너뛰고 매기면 단계를 하나 완료할 때마다 화면 순서가 어긋납니다
    const { upsert, preserved } = planner().build(
      input({ applied, existing: [{ stepKey: 'a', state: 'done_verified' }] }),
    )

    expect(preserved[0]).toEqual({ stepKey: 'a', seq: 1 })
    expect(upsert[0].seq).toBe(2)
  })

  it('새 플랜에 없는 단계는 지우지 않고 표시만 바꾼다', async () => {
    const { skipped } = planner().build(
      input({
        applied: [step('a')],
        existing: [
          { stepKey: 'a', state: 'not_started' },
          { stepKey: 'gone', state: 'not_started' },
        ],
      }),
    )

    expect(skipped).toEqual(['gone'])
  })

  it('이미 건너뛴 것을 다시 세지 않는다', async () => {
    const { skipped } = planner().build(
      input({
        applied: [step('a')],
        existing: [{ stepKey: 'gone', state: 'skipped' }],
      }),
    )

    expect(skipped).toEqual([])
  })

  it('**건너뛴 단계가 다시 들어오면 `not_started` 로 되살린다** → §6.1', async () => {
    // 지우지 않고 `skipped` 로 두는 이유가 되살아나기 위해서입니다.
    // 대면편취의 지급정지가 실제로 이 길을 지납니다 — 경유 서비스가 정해지며
    // 한 번 꺼졌다가, 112 를 끝내면 「수사기관이 계좌를 특정한 뒤」로 다시 켜집니다
    const { upsert } = planner().build(
      input({
        applied: [step('a')],
        existing: [{ stepKey: 'a', state: 'skipped' }],
      }),
    )

    expect(upsert[0].stepKey).toBe('a')
    expect(upsert[0].state).toBe('not_started')
  })
})

describe('슈퍼셋 플랜 — 02-slot-tiering.md', () => {
  const reference = [
    step('easypay-freeze', { conditional: '간편송금으로 보냈다면' }, {
      channelId: 'CH-easypay',
    }),
  ]

  it('슈퍼셋이 아니면 참고 묶음을 넣지 않는다', async () => {
    const { upsert } = planner().build(
      input({ applied: [step('a')], reference }),
    )

    expect(upsert.map((one) => one.stepKey)).toEqual(['a'])
  })

  it('슈퍼셋이면 조건 라벨과 함께 넣는다', async () => {
    const { upsert } = planner().build(
      input({ applied: [step('a')], reference, superset: true }),
    )

    expect(upsert.map((one) => one.stepKey)).toEqual(['a', 'easypay-freeze'])
    expect(upsert[1].conditional).toBe('간편송금으로 보냈다면')
  })

  it('라벨 없는 참고 단계는 넣지 않는다', async () => {
    // 라벨 없이 넣으면 은행 이체 사건에 간편송금 절차가 조건 없이 뜹니다.
    // 그건 슈퍼셋이 아니라 틀린 안내입니다
    const { upsert } = planner().build(
      input({
        applied: [step('a')],
        reference: [step('crypto-freeze', {}, { channelId: 'CH-crypto' })],
        superset: true,
      }),
    )

    expect(upsert.map((one) => one.stepKey)).toEqual(['a'])
  })

  it('적용 묶음의 단계에는 라벨이 안 붙는다', async () => {
    const { upsert } = planner().build(input({ applied: [step('a')] }))

    expect(upsert[0].conditional).toBeNull()
  })
})

describe('근거 없는 단계는 만들지 않는다', () => {
  const blanks = ['kbEntryId', 'kbVersion', 'sourceUrl', 'effectiveFrom'] as const

  for (const field of blanks) {
    it(`${field} 가 비면 던진다`, async () => {
      // 조용히 빼면 사용자는 절차 하나가 없어진 것을 모릅니다
      expect(() =>
        planner().build(input({ applied: [step('a', {}, { [field]: '' })] })),
      ).toThrow(KbError)
    })
  }

  it('공백만 있어도 빈 것으로 본다', async () => {
    expect(() =>
      planner().build(input({ applied: [step('a', {}, { sourceUrl: '   ' })] })),
    ).toThrow(KbError)
  })

  it('actor 가 없으면 던진다', async () => {
    // 기본값을 두면 금감원이 하는 일이 사용자 할 일로 뜹니다
    expect(() =>
      planner().build(input({ applied: [step('a', { actor: undefined })] })),
    ).toThrow(/actor/)
  })

  it('actor 가 목록 밖이면 던진다', async () => {
    expect(() =>
      planner().build(
        // @ts-expect-error 목록 밖 값이 들어오는 경우를 본다
        input({ applied: [step('a', { actor: 'fsi' })] }),
      ),
    ).toThrow(/actor/)
  })
})

describe('이 모듈이 하지 않는 것', () => {
  it('절차 본문을 고치지 않는다', async () => {
    const body = {
      actor: 'victim' as const,
      summary: '지급정지를 걸었어도 이 신청을 해야 효력이 유지됩니다.',
      steps: [{ text: '은행 앱에서 신청서를 작성해 제출합니다', action: 'visit' }],
    }

    const { upsert } = planner().build(
      input({ applied: [step('a', body)] }),
    )

    expect(upsert[0].body).toEqual(body)
  })

  it('날짜를 계산하지 않는다', async () => {
    const { upsert } = planner().build(input({ applied: [step('a')] }))

    expect(upsert[0]).not.toHaveProperty('dueAt')
    expect(upsert[0]).not.toHaveProperty('dueDate')
    // 만든 시각만 서버 시계에서 받아 적습니다
    expect(upsert[0].generatedAt).toBe(NOW)
  })

  it('근거를 그대로 옮긴다', async () => {
    const { upsert } = planner().build(input({ applied: [step('a')] }))

    expect(upsert[0]).toMatchObject({
      kbEntryId: 'kb-a',
      kbVersion: '2026.08.1',
      sourceUrl: 'https://www.law.go.kr/...',
      effectiveFrom: '2026-07-01',
    })
  })
})
