/**
 * 토큰화된 대화를 보고 두 묶음 밖의 자료를 고른다 — 답은 쓰지 않고 번호만.
 *
 * 계약: spec/backend/08-16-chat-context.md §2.6 · 근거: ADR-089
 * 원형: 사내 `global_information` 검색기의 2단계 선별(`information_search.py`)
 *
 * ## 두 단계
 *
 * 1단계  후보를 묶음으로 나눠 **병렬로** 부른다. 번호만 내게 하고 추론은 없앤다 —
 *        묶음 수만큼 동시에 부르므로 호출당 지연이 전체를 지배한다.
 * 2단계  1단계가 건진 후보가 `topK` 를 넘으면, 다시 묶어 **이유를 적게 하며** 줄인다.
 *        줄지 않으면(묶음마다 `topK` 씩 뽑아 합이 정체) 한 프롬프트에 모아 마지막 한 번.
 *
 * ## 실패는 빈 선택입니다
 *
 * 어느 호출이 던져도 이 모듈은 던지지 않는다. 시간이 다 되면 그때까지 건진 것 중
 * 앞 `topK` 로 끝낸다. 선별은 있으면 좋은 것이고 없어도 답변은 나간다(ADR-089 ④).
 *
 * ## 글자 수로 묶습니다
 *
 * 원형은 tiktoken 으로 3,000 토큰씩 묶는다. 여기서는 토크나이저를 들이지 않고
 * 글자 6,000 자로 어림한다 — 한글이 섞인 글은 글자 둘에 토큰 하나 안팎이다.
 * 묶음 크기가 조금 어긋나도 정확도에는 영향이 없고, 지연만 조금 달라진다.
 */

import 'server-only'

import type {
  CandidateKind,
  HistoryLine,
  KbSelector,
  SelectInput,
  SelectResult,
  SelectorCall,
  SelectorCandidate,
  SelectorClock,
  SelectorLlm,
  SelectorOptions,
  SkipReason,
} from './types'

const DEFAULTS = {
  topK: 5,
  timeoutMs: 10_000,
  maxGroupChars: 6_000,
  maxRounds: 6,
  historyTurns: 6,
} as const

/** 이보다 적게 남았으면 부르지 않는다 — 부르자마자 끊긴다 */
const MIN_CALL_MS = 1_000

const PREVIEW_CHARS = 200

const KIND_LABEL: Readonly<Record<CandidateKind, string>> = {
  kb: '절차',
  org: '연락처',
  law: '조문',
}

export const SELECTOR_SYSTEM = `# 역할
당신은 보이스피싱 사후 대응 안내 비서의 자료 선별기입니다.
사용자에게 보낼 답변은 작성하지 않습니다. 주어진 자료 목록에서 이번 답변에 쓸 항목의 번호만 골라냅니다.`

function rulesOf(topK: number): string {
  return `# 선별 규칙
- 사용자의 마지막 말에 답하는 데 쓸 수 있는 항목을 고른다. 답변에 쓰이지 않을 항목은 고르지 않는다.
- 최대 ${topK}개까지 고른다. 관련 있는 항목이 ${topK}개보다 적으면 있는 만큼만 고른다.
- 고를 항목이 없으면 {"selected": []} 를 반환한다. 인사말·감사·잡담처럼 자료가 필요 없는 말에도 {"selected": []} 를 반환한다.
- 「연락처」 항목은 사용자가 전화가 안 된다거나 진행이 막혔다고 말할 때만 고른다. 그때는 「(이 사건의 기관)」 표시가 붙은 것을 고르고, 사용자가 다른 기관을 말하지 않는 한 다른 기관은 고르지 않는다.
- 「조문」 항목은 사용자가 법·근거·규정이 무엇인지 물을 때만 고른다.
- 「절차」 항목은 사용자가 그 방법·기관·상황을 직접 말할 때만 고른다. 지금 사건과 다른 절차를 미리 챙기지 않는다.`

}

const LIST_HEADER = `# 자료 목록
각 줄은 \`[번호] 종류 · 이름: 내용\` 형식이다. 내용은 앞부분만 발췌한 것이라 문장 중간에서 끊길 수 있다.`

const HISTORY_HEADER = `# 대화 내역
아래는 사용자와 안내 비서가 주고받은 기록이다. \`사용자\`로 시작하는 줄이 사용자 발화, \`비서\`로 시작하는 줄이 안내 비서 발화다. 마지막 줄이 이번에 답할 말이다.`

/** 1단계 — 번호만. 추론을 없애 호출당 수십 토큰으로 */
const OUTPUT_IDS_ONLY = `# 출력 형식
추론 과정이나 설명을 쓰지 않는다. 아래 형식의 JSON 한 줄만 출력한다. 번호는 위 자료 목록에 적힌 숫자를 그대로 쓴다.
{"selected": [숫자, 숫자]}`

/** 2단계 — 항목마다 이유를 적게 해 정확도를 잡는다. 규칙은 1단계와 같다 */
const OUTPUT_WITH_REASONS = `# 출력 형식
1) 항목마다 한 줄로, 고르는 이유 또는 고르지 않는 이유를 적는다.
2) 마지막 줄에 최종 JSON을 한 개만 출력한다. 1)의 설명 안에는 JSON을 쓰지 않는다.
{"selected": [숫자, 숫자]}`

interface Numbered {
  readonly id: number
  readonly candidate: SelectorCandidate
  readonly line: string
}

/** 후보에 번호를 붙이고 한 줄로 만든다. 번호는 풀 안의 위치라 한 턴 안에서 고정이다 */
export function numberCandidates(pool: readonly SelectorCandidate[]): readonly Numbered[] {
  return pool.map((candidate, index) => {
    const id = index + 1
    const preview = candidate.preview.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS)
    return {
      id,
      candidate,
      line: `[${id}] ${KIND_LABEL[candidate.kind]} · ${candidate.tag}: ${preview}`,
    }
  })
}

/**
 * 균등 묶기 — 원형의 bin-packing 그대로.
 *
 * 묶음 수를 먼저 정하고(전체 ÷ 상한), 큰 것부터 가장 여유 있는 묶음에 넣는다.
 * 그래서 묶음끼리 크기가 비슷하고, 병렬 호출의 끝나는 시각도 비슷해진다.
 */
export function packGroups(
  items: readonly Numbered[],
  maxChars: number,
): readonly (readonly Numbered[])[] {
  if (items.length === 0) return []
  const total = items.reduce((sum, one) => sum + one.line.length, 0)
  const bins = Math.max(1, Math.ceil(total / maxChars))
  const cap = Math.ceil(total / bins)

  const sorted = [...items].sort((a, b) => b.line.length - a.line.length)
  const groups: Numbered[][] = Array.from({ length: bins }, () => [])
  const sizes: number[] = new Array<number>(bins).fill(0)

  for (const one of sorted) {
    let best = -1
    let bestTotal = Number.POSITIVE_INFINITY
    sizes.forEach((size, index) => {
      const next = size + one.line.length
      if (next <= cap && next < bestTotal) {
        best = index
        bestTotal = next
      }
    })
    if (best < 0) {
      best = sizes.indexOf(Math.min(...sizes))
    }
    groups[best]!.push(one)
    sizes[best] = sizes[best]! + one.line.length
  }

  // 묶음 안에서는 번호 순으로 — 모델이 읽기 쉽고, 시험에서 재현된다
  return groups
    .filter((group) => group.length > 0)
    .map((group) => [...group].sort((a, b) => a.id - b.id))
}

/**
 * 모델 답에서 `{"selected": [...]}` 를 읽는다.
 *
 * 2단계 답은 이유 여러 줄 뒤에 JSON 이 오므로 **마지막** 것을 본다.
 * 정수가 아닌 것과 중복은 버리고, `topK` 개까지만 남긴다. 못 읽으면 빈 배열이다.
 */
export function parseSelected(raw: string, topK: number): readonly number[] {
  if (!raw) return []
  const matches = raw.match(/\{[^{}]*"selected"\s*:\s*\[[^\]]*\][^{}]*\}/g)
  if (!matches || matches.length === 0) return []
  try {
    const parsed = JSON.parse(matches[matches.length - 1]!) as { selected?: unknown }
    if (!Array.isArray(parsed.selected)) return []
    const out: number[] = []
    for (const one of parsed.selected) {
      const id = typeof one === 'number' ? one : Number(one)
      if (!Number.isInteger(id) || out.includes(id)) continue
      out.push(id)
      if (out.length >= topK) break
    }
    return out
  } catch {
    return []
  }
}

function historyText(history: readonly HistoryLine[], turns: number): string {
  const tail = history.slice(-turns * 2)
  if (tail.length === 0) return '(없음)'
  return tail
    .map((one) => `${one.speaker === 'user' ? '사용자' : '비서'}: ${one.text}`)
    .join('\n')
}

function promptOf(
  group: readonly Numbered[],
  history: string,
  topK: number,
  output: string,
): string {
  return [
    rulesOf(topK),
    '',
    LIST_HEADER,
    '',
    group.map((one) => one.line).join('\n'),
    '',
    HISTORY_HEADER,
    '',
    history,
    '',
    output,
  ].join('\n')
}

export function createKbSelector(deps: {
  llm: SelectorLlm
  clock: SelectorClock
  options?: SelectorOptions
}): KbSelector {
  const { llm, clock } = deps
  const options = { ...DEFAULTS, ...(deps.options ?? {}) }

  return {
    async select(input: SelectInput): Promise<SelectResult> {
      const topK = input.topK ?? options.topK
      const startedAt = clock.nowMs()
      const deadline = startedAt + options.timeoutMs
      const exclude = input.exclude ?? new Set<string>()
      const pool = input.candidates.filter((one) => !exclude.has(one.key))
      const calls: SelectorCall[] = []
      let groups = 0
      let rounds = 0
      let failures = 0
      let timedOut = false

      const done = (picked: readonly Numbered[], skipped?: SkipReason): SelectResult => ({
        picked: picked.map((one) => one.candidate),
        stats: {
          pool: pool.length,
          groups,
          rounds,
          ms: clock.nowMs() - startedAt,
          calls,
          ...(skipped ? { skipped } : {}),
        },
      })

      if (pool.length === 0) return done([], 'empty_pool')

      const numbered = numberCandidates(pool)
      const byId = new Map(numbered.map((one) => [one.id, one]))
      const history = historyText(input.history, options.historyTurns)
      const remaining = () => deadline - clock.nowMs()

      /** 한 번 부른다. 던지면 빈 답으로 — 묶음 하나가 죽어도 나머지는 간다 */
      const callOrEmpty = async (user: string): Promise<string> => {
        const left = remaining()
        if (left < MIN_CALL_MS) {
          timedOut = true
          return ''
        }
        try {
          const { text, call } = await llm.completeText(
            { system: SELECTOR_SYSTEM, user },
            { timeoutMs: left },
          )
          calls.push(call)
          return text
        } catch {
          failures += 1
          if (remaining() <= 0) timedOut = true
          return ''
        }
      }

      const pick = (
        raws: readonly string[],
        allowed: ReadonlyMap<number, Numbered>,
      ): Numbered[] => {
        const out: Numbered[] = []
        const seen = new Set<number>()
        for (const raw of raws) {
          for (const id of parseSelected(raw, topK)) {
            const one = allowed.get(id)
            if (!one || seen.has(id)) continue
            seen.add(id)
            out.push(one)
          }
        }
        return out
      }

      const skippedNow = (): SkipReason | undefined =>
        timedOut ? 'timeout' : failures > 0 ? 'error' : undefined

      // 1단계 — 묶음마다 병렬, 번호만
      const stage1 = packGroups(numbered, options.maxGroupChars)
      groups = stage1.length
      const raw1 = await Promise.all(
        stage1.map((group) => callOrEmpty(promptOf(group, history, topK, OUTPUT_IDS_ONLY))),
      )
      let current = pick(raw1, byId)
      if (current.length === 0) return done([], skippedNow())
      if (current.length <= topK) return done(current)

      // 마지막 한 번 — 후보 전부를 한 프롬프트에 모아 topK 로 자른다
      const finalRerank = async (candidates: readonly Numbered[]): Promise<SelectResult> => {
        if (remaining() < MIN_CALL_MS) return done(candidates.slice(0, topK), 'timeout')
        const raw = await callOrEmpty(promptOf(candidates, history, topK, OUTPUT_WITH_REASONS))
        const selected = pick([raw], new Map(candidates.map((one) => [one.id, one])))
        return selected.length > 0
          ? done(selected)
          : done(candidates.slice(0, topK), skippedNow())
      }

      // 2단계 — 이유를 적게 하며 줄인다
      while (rounds < options.maxRounds) {
        if (remaining() < MIN_CALL_MS) return done(current.slice(0, topK), 'timeout')
        const regrouped = packGroups(current, options.maxGroupChars)
        rounds += 1
        const raw2 = await Promise.all(
          regrouped.map((group) =>
            callOrEmpty(promptOf(group, history, topK, OUTPUT_WITH_REASONS)),
          ),
        )
        const next = pick(raw2, new Map(current.map((one) => [one.id, one])))
        if (next.length === 0) return done(current.slice(0, topK), skippedNow())
        if (next.length <= topK) return done(next)
        if (next.length >= current.length) return finalRerank(next)
        current = next
      }
      return finalRerank(current)
    },
  }
}
