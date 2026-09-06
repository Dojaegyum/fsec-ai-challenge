/**
 * kb-selector 시험.
 *
 * 검증 대상은 spec/backend/08-16-chat-context.md §2.6 과 ADR-089 의
 * 「답은 쓰지 않는다 · 실패는 빈 선택 · 두 단계」입니다.
 */

import { describe, expect, it, vi } from 'vitest'

import { createKbSelector, numberCandidates, packGroups, parseSelected } from './select'
import type { SelectorCall, SelectorCandidate, SelectorLlm } from './types'

const CALL: SelectorCall = { model: 'fast-model', tokenIn: 120, tokenOut: 12 }

const POOL: SelectorCandidate[] = [
  { key: 'kb:card-freeze', kind: 'kb', tag: '카드사 지급정지 신청', preview: '카드사 콜센터에 지급정지를 요청합니다.' },
  { key: 'kb:crypto-freeze', kind: 'kb', tag: '거래소 출금정지 요청', preview: '가상자산 거래소에 출금정지를 요청합니다.' },
  { key: 'kb:carrier-block', kind: 'kb', tag: '소액결제 차단', preview: '통신사에 소액결제 차단을 신청합니다.' },
  { key: 'kb:giftcard-report', kind: 'kb', tag: '상품권 사용 정지', preview: '상품권 발행사에 사용 정지를 요청합니다.' },
  { key: 'kb:common-relief-documents', kind: 'kb', tag: '신청서류를 금융회사에 제출합니다', preview: '전화로 신청했으면 3영업일 안에 서류를 냅니다.' },
  { key: 'org:kb-bank', kind: 'org', tag: 'KB국민은행', preview: '1588-9999 · 24시간 · 영업점 서면 제출' },
  { key: 'org:shinhan', kind: 'org', tag: '신한은행', preview: '1599-8000 · 24시간' },
  { key: 'law:011359:3', kind: 'law', tag: '통신사기피해환급법 제3조', preview: '피해자는 금융회사에 지급정지를 신청할 수 있다.' },
]

const HISTORY = [
  { speaker: 'user' as const, text: '[계좌-1] 로 300만원을 보냈어요' },
  { speaker: 'assistant' as const, text: '검찰 사칭에 300만원을 보내셨군요. 다음은 지급정지 요청입니다.' },
  { speaker: 'user' as const, text: '은행에 전화했는데 안 받아요' },
]

/** 시계 — 호출마다 흐르게 할 수 있다 */
function clockOf(start = 1_000) {
  let now = start
  return {
    nowMs: () => now,
    advance: (ms: number) => {
      now += ms
    },
  }
}

/** 프롬프트를 받아 답을 정하는 가짜 모델. 받은 프롬프트를 남긴다 */
function llmOf(
  answer: (user: string, index: number) => string | Promise<string>,
  onCall?: () => void,
): SelectorLlm & { seen: string[]; timeouts: number[] } {
  const seen: string[] = []
  const timeouts: number[] = []
  return {
    seen,
    timeouts,
    async completeText(prompt, opts) {
      seen.push(prompt.user)
      timeouts.push(opts.timeoutMs)
      onCall?.()
      const text = await answer(prompt.user, seen.length - 1)
      return { text, call: CALL }
    },
  }
}

const idsOf = (user: string): number[] =>
  [...user.matchAll(/^\[(\d+)\]/gm)].map((m) => Number(m[1]))

describe('모델 답에서 번호를 읽는다', () => {
  it('JSON 한 줄', () => {
    expect(parseSelected('{"selected": [3, 1]}', 5)).toEqual([3, 1])
  })

  it('이유 여러 줄 뒤의 마지막 JSON — 2단계 답', () => {
    const raw = '[1] 지급정지라 관련 있음\n[2] 카드가 아니라 제외\n{"selected": [1]}'
    expect(parseSelected(raw, 5)).toEqual([1])
  })

  it('설명 안에 JSON 이 하나 더 있어도 마지막 것을 본다', () => {
    const raw = '{"selected": [1, 2]} 를 생각했지만\n{"selected": [2]}'
    expect(parseSelected(raw, 5)).toEqual([2])
  })

  it('정수가 아닌 것과 중복은 버리고 topK 까지만', () => {
    expect(parseSelected('{"selected": [2, "3", 2.5, 2, "x", 7, 9]}', 3)).toEqual([2, 3, 7])
  })

  it('못 읽으면 빈 배열', () => {
    expect(parseSelected('', 5)).toEqual([])
    expect(parseSelected('죄송합니다, 고를 것이 없습니다', 5)).toEqual([])
    expect(parseSelected('{"selected": "1"}', 5)).toEqual([])
  })
})

describe('후보를 묶는다', () => {
  it('전체 글자 수를 상한으로 나눈 만큼 묶고, 빠지는 항목이 없다', () => {
    const numbered = numberCandidates(POOL)
    const total = numbered.reduce((sum, one) => sum + one.line.length, 0)
    const groups = packGroups(numbered, 120)

    expect(groups).toHaveLength(Math.ceil(total / 120))
    expect(groups.flat().map((one) => one.id).sort((a, b) => a - b)).toEqual(
      numbered.map((one) => one.id),
    )
  })

  it('상한이 넉넉하면 묶음 하나', () => {
    expect(packGroups(numberCandidates(POOL), 100_000)).toHaveLength(1)
  })

  it('한 줄의 모양 — [번호] 종류 · 이름: 내용', () => {
    const [first] = numberCandidates(POOL)
    expect(first!.line).toBe('[1] 절차 · 카드사 지급정지 신청: 카드사 콜센터에 지급정지를 요청합니다.')
    expect(numberCandidates(POOL)[5]!.line).toMatch(/^\[6\] 연락처 · KB국민은행: /)
    expect(numberCandidates(POOL)[7]!.line).toMatch(/^\[8\] 조문 · 통신사기피해환급법 제3조: /)
  })

  it('내용은 200자에서 자르고 줄바꿈은 공백으로', () => {
    const long = { key: 'law:x', kind: 'law' as const, tag: '긴 조문', preview: `앞\n${'가'.repeat(400)}` }
    const [one] = numberCandidates([long])
    expect(one!.line).not.toContain('\n')
    expect(one!.line.length).toBeLessThan(230)
  })
})

describe('빈 풀과 인사말', () => {
  it('제외를 빼고 남은 후보가 없으면 모델을 부르지 않는다', async () => {
    const llm = llmOf(() => '{"selected": [1]}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    const result = await selector.select({
      history: HISTORY,
      candidates: POOL.slice(0, 2),
      exclude: new Set(['kb:card-freeze', 'kb:crypto-freeze']),
    })

    expect(llm.seen).toHaveLength(0)
    expect(result.picked).toEqual([])
    expect(result.stats).toMatchObject({ pool: 0, groups: 0, rounds: 0, skipped: 'empty_pool' })
  })

  it('제외 목록의 항목은 모델에게 보이지 않는다', async () => {
    const llm = llmOf(() => '{"selected": []}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    await selector.select({
      history: HISTORY,
      candidates: POOL,
      exclude: new Set(['kb:common-relief-documents']),
    })

    expect(llm.seen[0]).not.toContain('신청서류를 금융회사에 제출합니다')
    expect(llm.seen[0]).toContain('KB국민은행')
  })

  it('모델이 빈 배열을 내면 고른 것이 없고 실패도 아니다', async () => {
    const llm = llmOf(() => '{"selected": []}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    const result = await selector.select({
      history: [{ speaker: 'user', text: '감사합니다' }],
      candidates: POOL,
    })

    expect(result.picked).toEqual([])
    expect(result.stats.skipped).toBeUndefined()
    expect(result.stats.calls).toHaveLength(1)
  })
})

describe('1단계 — 병렬 · 번호만', () => {
  it('묶음마다 한 번씩 부르고, 프롬프트에 추론 금지와 규칙 셋이 있다', async () => {
    const llm = llmOf((user) => {
      // 이 묶음에 KB국민은행이 있으면 그것을 고른다
      const line = user.split('\n').find((one) => one.includes('KB국민은행'))
      return line ? `{"selected": [${/^\[(\d+)\]/.exec(line)![1]}]}` : '{"selected": []}'
    })
    const selector = createKbSelector({
      llm,
      clock: clockOf(),
      options: { maxGroupChars: 150 },
    })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(llm.seen.length).toBeGreaterThan(1)
    expect(result.stats.groups).toBe(llm.seen.length)
    expect(result.stats.rounds).toBe(0)
    expect(result.picked.map((one) => one.key)).toEqual(['org:kb-bank'])
    for (const prompt of llm.seen) {
      expect(prompt).toContain('추론 과정이나 설명을 쓰지 않는다')
      expect(prompt).toContain('「연락처」 항목은')
      expect(prompt).toContain('「(이 사건의 기관)」 표시가 붙은 것을 고르고')
      expect(prompt).toContain('「조문」 항목은')
      expect(prompt).toContain('최대 5개까지')
    }
  })

  it('대화 내역은 마지막 여섯 턴만 보인다 — 마지막 줄이 이번 발화', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({
      speaker: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `발화 ${i + 1}`,
    }))
    const llm = llmOf(() => '{"selected": []}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    await selector.select({ history, candidates: POOL })

    const [prompt] = llm.seen
    expect(prompt).not.toContain('발화 1\n')
    expect(prompt).not.toContain('발화 8')
    expect(prompt).toContain('사용자: 발화 9')
    expect(prompt).toContain('비서: 발화 20')
  })

  it('모델이 없는 번호를 내면 버린다', async () => {
    const llm = llmOf(() => '{"selected": [999, 1]}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(result.picked.map((one) => one.key)).toEqual(['kb:card-freeze'])
  })

  it('1단계 결과가 topK 이하면 2단계를 부르지 않는다', async () => {
    const llm = llmOf(() => '{"selected": [6, 8]}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(llm.seen).toHaveLength(1)
    expect(result.picked.map((one) => one.key)).toEqual(['org:kb-bank', 'law:011359:3'])
    expect(result.stats.rounds).toBe(0)
  })
})

describe('2단계 — 이유를 적게 하며 줄인다', () => {
  it('topK 를 넘는 후보는 다시 묶어 줄이고, 그 프롬프트에는 이유를 적으라는 지시가 있다', async () => {
    // 1단계: 묶음 둘이 각각 4개씩 → 8개로 topK 를 넘는다. 2단계: 묶음마다 앞 둘만 → 4개로 끝
    const llm = llmOf((user, index) => {
      const ids = idsOf(user)
      if (index < 2) return `{"selected": [${ids.slice(0, 5).join(', ')}]}`
      return `[${ids[0]}] 관련\n[${ids[1]}] 관련\n{"selected": [${ids.slice(0, 2).join(', ')}]}`
    })
    const selector = createKbSelector({
      llm,
      clock: clockOf(),
      options: { maxGroupChars: 300, topK: 5 },
    })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(result.stats.groups).toBe(2)
    expect(result.stats.rounds).toBe(1)
    expect(result.picked).toHaveLength(4)
    expect(llm.seen[2]).toContain('고르는 이유 또는 고르지 않는 이유')
    expect(llm.seen[2]).not.toContain('추론 과정이나 설명을 쓰지 않는다')
  })

  it('2단계가 그 라운드의 후보 밖 번호를 내면 버린다', async () => {
    const llm = llmOf((user, index) => {
      const ids = idsOf(user)
      if (index < 2) return `{"selected": [${ids.slice(0, 5).join(', ')}]}`
      return '{"selected": [999, 998]}'
    })
    const selector = createKbSelector({
      llm,
      clock: clockOf(),
      options: { maxGroupChars: 300, topK: 5 },
    })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    // 2단계가 아무것도 못 고르면 직전 후보의 앞 topK 로 끝난다
    expect(result.picked).toHaveLength(5)
    expect(result.stats.rounds).toBe(1)
  })

  it('줄지 않으면 한 프롬프트에 모아 마지막 한 번으로 자른다', async () => {
    // 1단계 두 묶음이 각각 4개 → 8개. 2단계 라운드도 묶음 둘이 각각 4개를 그대로 → 정체.
    // 마지막 한 번(후보 8개 한 프롬프트)이 5개로 자른다
    let finalPrompt = ''
    const llm = llmOf((user, index) => {
      const ids = idsOf(user)
      if (index < 2) return `{"selected": [${ids.slice(0, 4).join(', ')}]}`
      if (ids.length > 4) {
        finalPrompt = user
        return `{"selected": [${ids.slice(0, 5).join(', ')}]}`
      }
      return `{"selected": [${ids.slice(0, 4).join(', ')}]}`
    })
    const selector = createKbSelector({
      llm,
      clock: clockOf(),
      options: { maxGroupChars: 300, topK: 5 },
    })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(result.picked).toHaveLength(5)
    expect(idsOf(finalPrompt)).toHaveLength(8)
    expect(result.stats.calls.length).toBe(llm.seen.length)
  })
})

describe('실패는 빈 선택이고 던지지 않는다 — ADR-089 ④', () => {
  it('모델이 던지면 빈 선택 · skipped=error', async () => {
    const llm = llmOf(() => {
      throw new Error('모델이 거절했습니다 (503)')
    })
    const selector = createKbSelector({ llm, clock: clockOf() })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(result.picked).toEqual([])
    expect(result.stats.skipped).toBe('error')
    expect(result.stats.calls).toHaveLength(0)
  })

  it('묶음 하나가 죽어도 나머지 묶음의 결과는 살린다', async () => {
    const llm = llmOf((user, index) => {
      if (index === 0) throw new Error('닿지 못함')
      const line = user.split('\n').find((one) => one.includes('제3조'))
      return line ? `{"selected": [${/^\[(\d+)\]/.exec(line)![1]}]}` : '{"selected": []}'
    })
    const selector = createKbSelector({
      llm,
      clock: clockOf(),
      options: { maxGroupChars: 150 },
    })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(result.picked.map((one) => one.key)).toEqual(['law:011359:3'])
    expect(result.stats.skipped).toBeUndefined()
  })

  it('시간을 다 쓰면 그때까지 건진 것 중 앞 topK 로 끝낸다 · skipped=timeout', async () => {
    const clock = clockOf()
    const llm = llmOf(
      (user) => `{"selected": [${idsOf(user).slice(0, 5).join(', ')}]}`,
      () => clock.advance(6_000),
    )
    const selector = createKbSelector({
      llm,
      clock,
      options: { maxGroupChars: 300, topK: 5, timeoutMs: 10_000 },
    })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    // 1단계 두 묶음이 병렬로 각각 6초를 쓰면 예산 10초를 넘긴다 → 2단계 없이 끝
    expect(result.stats.rounds).toBe(0)
    expect(result.stats.skipped).toBe('timeout')
    expect(result.picked).toHaveLength(5)
  })

  it('남은 시간이 1초 아래면 아예 부르지 않는다', async () => {
    const clock = clockOf()
    const llm = llmOf(() => '{"selected": [1]}')
    const selector = createKbSelector({ llm, clock, options: { timeoutMs: 500 } })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(llm.seen).toHaveLength(0)
    expect(result.stats.skipped).toBe('timeout')
  })

  it('호출마다 남은 예산을 상한으로 넘긴다', async () => {
    const clock = clockOf()
    const llm = llmOf(() => '{"selected": []}', () => clock.advance(2_000))
    const selector = createKbSelector({ llm, clock, options: { timeoutMs: 10_000 } })
    await selector.select({ history: HISTORY, candidates: POOL })

    expect(llm.timeouts).toEqual([10_000])
  })
})

describe('통계는 감사로 갈 값만 담는다', () => {
  it('풀 크기 · 묶음 수 · 라운드 · 소요 · 호출 계측', async () => {
    const clock = clockOf()
    const llm = llmOf(() => '{"selected": [1]}', () => clock.advance(700))
    const selector = createKbSelector({ llm, clock })
    const result = await selector.select({
      history: HISTORY,
      candidates: POOL,
      exclude: new Set(['org:shinhan']),
    })

    expect(result.stats).toEqual({
      pool: 7,
      groups: 1,
      rounds: 0,
      ms: 700,
      calls: [CALL],
    })
  })

  it('후보의 본문은 결과에 그대로 — 고치지 않는다', async () => {
    const llm = llmOf(() => '{"selected": [8]}')
    const selector = createKbSelector({ llm, clock: clockOf() })
    const result = await selector.select({ history: HISTORY, candidates: POOL })

    expect(result.picked[0]).toBe(POOL[7])
    expect(vi.isMockFunction(llm.completeText)).toBe(false)
  })
})
