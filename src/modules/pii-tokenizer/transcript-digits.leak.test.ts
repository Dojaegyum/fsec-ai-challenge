/**
 * 전사문 숫자 규칙이 **실제 전사 결과에서** 새지 않는지 지킨다.
 *
 * 근거: docs/research/15-STT-GPU-실측.md §6 · docs/research/09 §5.4
 *
 * ## 왜 단위 테스트로 안 되나
 *
 * `tokenize.test.ts` 는 손으로 고른 문장을 씁니다. 그건 규칙의 뜻을 지키지만,
 * **whisper 가 실제로 뭘 뱉는지**는 못 지킵니다. 이 파일은 저장된 전사문 40발화를
 * 통째로 넣어 **가리고 남은 글에 정체불명 숫자가 있나**를 봅니다.
 *
 * ## 판정 기준이 함정입니다
 *
 * 「가려진 숫자가 원래 값과 같은가」로 세면 안 됩니다 — 자리표기가 깨졌으니 애초에
 * 다릅니다(`3333-01-2345678` -> `"3333년 1월 23일 45678"`). **남은 글에 뭐가 보이나**로
 * 세야 합니다. 그게 실제로 경계를 넘는 것이니까요.
 *
 * 그래서 「남아 있어야 맞는 숫자」를 따로 셉니다 — 제외 목록입니다
 * (spec/common/08-14-pii-boundary.md): 금액·일시·기업 대표번호·짧은 특수번호·
 * 사원번호 같은 업무 번호.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { findTranscriptDigits, DEFAULT_DIGIT_RULE } from './transcript-digits'

const DATASETS = join(process.cwd(), '..', 'assets', 'datasets')

interface EvalItem {
  id: string
  keep: { kind: string; text: string }[]
}
interface RunItem {
  id: string
  text: string
}
interface Run {
  key: string
  model?: string
  items: RunItem[]
}

function read<T>(...parts: string[]): T {
  return JSON.parse(readFileSync(join(DATASETS, ...parts), 'utf8')) as T
}

const evalItems = new Map(
  read<{ items: EvalItem[] }>('08-21-local-llm-pii', 'eval-set.json').items.map((i) => [i.id, i]),
)
const gpu = read<{ runs: Run[] }>('08-25-stt-gpu', 'results-gpu.json')
const cpu = read<{ runs: Run[]; model?: string }>('08-25-stt-preprocess', 'results-nogap.json')

/** 가린 뒤 남는 글. 가린 자리는 공백으로 둡니다 */
function maskOut(text: string, spans: readonly { start: number; end: number }[]): string {
  const out = [...text]
  for (const s of spans) for (let i = s.start; i < s.end; i += 1) out[i] = ' '
  return out.join('')
}

// ── 남아 있어야 맞는 것들 (제외 목록) ────────────────────────────────
const MONEY_OR_DATE = /^\s*(?:[만천백억]\s*)*(?:원|년|월|일|시|분|초|영업일)/
const HOTLINE_PAIR = /(?:15|16|18)\d{2}[-.\s]?\d{4}/
const SHORT_HOTLINE = new Set(['112', '114', '119', '182', '1332', '1394'])
/** 업무 번호는 개인정보가 아닙니다 → 10-PII인식-실측-방법론.md 「절대 뽑으면 안 되는 것」 */
const CLERICAL = /(?:사원번호|접수번호|주문번호)/

/** 가리고 남은 글에서 **설명되지 않는** 숫자를 모은다 = 실제로 새어 나간 것 */
function leaks(visible: string): string[] {
  const found: string[] = []
  for (const m of visible.matchAll(/\d+/g)) {
    const value = m[0]
    const at = m.index ?? 0
    if (value.length < 4) continue // 조각만으로는 식별이 안 됩니다
    if (MONEY_OR_DATE.test(visible.slice(at + value.length, at + value.length + 6))) continue
    if (SHORT_HOTLINE.has(value)) continue
    // ⚠️ 앞뒤를 **함께** 봐야 합니다. `1588-5000` 은 앞 조각으로도 뒤 조각으로도
    //    걸리는데, 한쪽만 보면 반대쪽 조각을 놓칩니다
    if (HOTLINE_PAIR.test(visible.slice(Math.max(0, at - 6), at + value.length + 6))) continue
    if (CLERICAL.test(visible.slice(Math.max(0, at - 12), at))) continue
    found.push(value)
  }
  return found
}

/** 금액·일시가 원문에는 단위와 함께 있었는데 가린 뒤 사라졌나 = 분기 입력 훼손 */
function overMasked(item: EvalItem, text: string, visible: string): string[] {
  const hit: string[] = []
  for (const k of item.keep) {
    if (!['금액', '일시', '대표번호'].includes(k.kind)) continue
    const digits = (k.text.match(/\d+/g) ?? []).join('')
    if (!digits) continue
    const re = new RegExp(`${digits}\\s*[만천백억]?\\s*(?:원|년|월|일|시|분)`)
    if (re.test(text) && !re.test(visible)) hit.push(`${k.kind}:${k.text}`)
  }
  return hit
}

function scan(run: Run) {
  const leaked: string[] = []
  const over: string[] = []
  for (const it of run.items) {
    const spec = evalItems.get(it.id)
    if (!spec) continue
    const visible = maskOut(it.text, findTranscriptDigits(it.text))
    for (const v of leaks(visible)) leaked.push(`${it.id}:${v}`)
    for (const v of overMasked(spec, it.text, visible)) over.push(`${it.id} ${v}`)
  }
  return { leaked, over }
}

describe('전사문 숫자 규칙 — 저장된 전사 결과에서 새지 않는다', () => {
  // large-v3 는 자리표기 변형이 medium 의 두 배인데도 누출이 0 입니다 → 실측 15 §6
  it.each([
    ['E', 'medium'],
    ['G', 'large-v3-turbo'],
    ['H', 'large-v3'],
  ])('GPU 조건 %s (%s) — 누출 0 · 과차단 0', (key) => {
    const run = gpu.runs.find((r) => r.key === key)
    expect(run, `조건 ${key} 가 results-gpu.json 에 없습니다`).toBeDefined()
    const { leaked, over } = scan(run!)
    expect(leaked, `새어 나간 숫자: ${leaked.join(', ')}`).toEqual([])
    expect(over, `과차단: ${over.join(', ')}`).toEqual([])
  })

  /**
   * CPU 의 `medium` 은 1건이 남습니다 — 값이 새로 생긴 게 아니라 **전사가 깨져**
   * `5501234567` 이 `"501-34567"`(8자리)로 읽혀 `minDigits` 아래로 떨어진 것입니다.
   * 전사를 좋게 하면 사라지고, 실제로 `large-v3` 에서는 사라집니다.
   * **여기를 0 으로 조이지 마세요** — 조이면 `minDigits` 를 낮춰야 하고 과차단이 옵니다.
   */
  it('CPU medium (조건 A) — 알려진 1건 말고는 안 샌다 · 과차단 0', () => {
    const run = cpu.runs.find((r) => r.key === 'A')
    expect(run).toBeDefined()
    const { leaked, over } = scan(run!)
    expect(leaked).toEqual(['E11:34567'])
    expect(over).toEqual([])
  })

  it('gapJoin 은 「마이너스」를 건널 만큼 넓다', () => {
    // 전사가 하이픈을 「마이너스」로 읽습니다. 5 였을 때 여기가 샜습니다
    const text = '업비트 원화 입금 계좌가 K뱅크 7777년 1월 마이너스 9988776이었고 거기로 550만원 넣었어요.'
    const visible = maskOut(text, findTranscriptDigits(text))
    expect(DEFAULT_DIGIT_RULE.gapJoin).toBeGreaterThanOrEqual(8)
    expect(leaks(visible)).toEqual([])
    expect(visible).toContain('550만원') // 금액은 살아 있어야 합니다
  })
})
