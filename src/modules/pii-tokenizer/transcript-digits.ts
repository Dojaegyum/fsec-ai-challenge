/**
 * 전사문 전용 숫자 규칙 — **가리는 것을 기본값으로 뒤집습니다.**
 *
 * 정본: spec/common/08-14-pii-boundary.md 「토큰화 제외 목록」 · 「2중 스크러빙」
 * 근거: ADR-011(제외 목록이 탐지 결과보다 우선) · docs/research/09-로컬모델-PII인식-실측.md
 *
 * ## 왜 따로 두나 — 전사문은 타이핑한 글과 성질이 다릅니다
 *
 * 실측이 이것을 보여줬습니다(§5.4). **깨끗한 텍스트에서 숫자 20건을 전부 잡던
 * 정규식이 전사문에서는 6~10건만 잡습니다.**
 *
 * 값이 사라져서가 아닙니다. **숫자는 다 남아 있고 구분자만 깨집니다.**
 *
 * ```
 * 110-234-567890   →  "110에 234-56만 7,890개자로"   숫자 12개 전부 살아 있음
 * 302-0987-6543-21 →  "302-0987-6 543-21"           하이픈 하나가 공백이 됨
 * ```
 *
 * `pii-masker` 의 패턴은 하이픈이 붙어 있는 모양을 전제하므로 둘 다 못 잡습니다.
 * **그 패턴이 틀린 게 아니라 대상이 다릅니다** — 그쪽은 사용자가 타이핑한 글용입니다
 * → 실측 권고 R-4 *"전사문 경로에서 정규식 1차를 신뢰하지 않는다"*.
 *
 * ## 기본값을 뒤집습니다
 *
 * | | 지금까지 | 여기 |
 * | --- | --- | --- |
 * | 기본 | **안 가림.** 개인정보로 보이면 가림 | **가림.** 안전한 형태로 확인되면 통과 |
 * | 못 알아본 값 | 그대로 나감 | **안 나감** |
 *
 * 뒤집는 근거는 [제외 목록](../../../spec/common/08-14-pii-boundary.md)이 **닫혀 있기**
 * 때문입니다 — 가리면 안 되는 숫자는 금액·일시·대표번호 셋뿐이고 셋 다 형태가 있습니다.
 * 그래서 「안전한 것」을 세는 편이 「위험한 것」을 세는 것보다 짧고 안전합니다.
 *
 * **덤으로 둘이 잡힙니다.** 실측 §7.1 이 *"패턴 목록에 없는 값 둘"* 로 남긴
 * 가상자산 지갑주소(지금은 아무도 안 잡음)와 상품권 핀번호가 여기 걸립니다.
 *
 * ## 실측 (docs/research/09 의 전사문 40발화 · 전사 조건 7개)
 *
 * | | 지금 규칙 | 이 규칙 |
 * | --- | --- | --- |
 * | 숫자류 개인정보 누출 | 조건당 0~3건 | **모든 조건 0건** |
 * | 과차단(금액·일시·대표번호) | 0건 | **0건** |
 *
 * ⚠️ **합성 음성 기준의 낙관적 하한값입니다.** 실제 통화는 이보다 나쁩니다 —
 * 실측 문서 §2.4. 그리고 표본이 40발화(계좌 8건)라 「0」이 「앞으로 0」은 아닙니다.
 *
 * **이름은 여기서 안 잡습니다.** 형태가 없어 규칙으로 못 잡고, 실측에서 로컬 모델이
 * 붙었을 때 이미 누출 0 이었습니다 → `NerModel`.
 */

import { passesLuhn } from '@/modules/pii-masker'

import type { TokenKind } from './types'

/**
 * 규칙의 값들.
 *
 * ⬜ **정본에 임계값이 없습니다.** 아래 기본값은 실측 40발화에서 고른 것이고,
 * 8도 10도 같은 결과였습니다 — 여유가 있다는 뜻이지 이 값이 옳다는 뜻은 아닙니다.
 * 실제 통화로 다시 재야 합니다.
 */
export interface DigitRule {
  /** 이어 붙인 자릿수가 이보다 적으면 가리지 않는다 */
  readonly minDigits: number
  /** 안전 표를 거둘 때 보는 거리. 뒤에 이만큼 안에 정체불명 숫자가 있으면 의심한다 */
  readonly gapJoin: number
}

export const DEFAULT_DIGIT_RULE: DigitRule = { minDigits: 9, gapJoin: 5 }

/** 가릴 자리 하나. `tokenize` 의 `Span` 으로 옮겨집니다 */
export interface DigitSpan {
  readonly kind: TokenKind
  readonly start: number
  readonly end: number
}

/**
 * 금액인가 — **`원` 으로 끝나야 인정합니다.**
 *
 * 이 한 조건이 실측에서 샜던 두 건 중 하나를 막았습니다. `"56만 7,890"` 은
 * 「만」이 붙었지만 「원」이 없습니다. 지금 규칙은 이걸 금액으로 보고 넘겨
 * 계좌번호를 통과시켰습니다 → `pii-masker/patterns.ts` 의 `looksLikeMoney`.
 */
const MONEY_TAIL = /^\s*(?:[만천백억]\s*)*원/

/** 일시 단위는 단독으로 인정합니다. 「8월」「15일」「2시」「10분」 */
const DATE_TAIL = /^\s*(?:년|월|일|시|분|초)/

/** 기관 대표번호 → 제외 목록 (ADR-011). 어느 기관에 전화했는지가 절차 분기의 입력입니다 */
const HOTLINE_HEAD = /^(?:15|16|18)\d{2}$/

/**
 * 자릿수가 짧아 애초에 패턴에 안 걸리는 번호들 → 04-pii-boundary.md.
 *
 * ⬜ **정본이 예로 든 것은 `112`·`1332`·`1394` 셋입니다.** `114`·`119`·`182` 는
 * 같은 성격이라 넣었지만 정본에 적힌 적은 없습니다.
 */
const SHORT_HOTLINE = new Set(['112', '114', '119', '182', '1332', '1394'])

/** 문장 경계. 이어 붙이기는 문장을 넘지 않습니다 */
const SENTENCE_END = /[.!?\n]/

interface Run {
  readonly start: number
  readonly end: number
  readonly value: string
}

/**
 * 이어 붙인 숫자가 무슨 종류인가.
 *
 * ⬜ **이 판정의 정본이 없습니다.** 토큰 종류가 다섯으로 닫혀 있어
 * (`TokenKind`) 새 종류를 만들지 않고 그중 하나로 떨어뜨립니다.
 * **어디에도 안 맞으면 `계좌` 입니다** — 정본이 계좌를 *"은행마다 자릿수와
 * 구분자가 달라 단일 형태가 없다"* 고 적어 가장 넓은 범주입니다.
 *
 * ⚠️ 그래서 **접수번호·지갑주소·핀번호가 `계좌` 로 기록됩니다.** 가려지는 것은
 * 맞지만 계측 헤더의 종류별 건수가 부풀려집니다 → 08-14-api.md §1.1.
 * 종류를 늘리려면 정본(토큰 형식·`WIRE_NAME`)을 함께 고쳐야 합니다.
 */
function kindOf(digits: string): TokenKind {
  if (digits.length === 13 && /^\d{6}[1-8]\d{6}$/.test(digits)) return '주민번호'
  if (passesLuhn(digits)) return '카드'
  if (/^(?:01[016789]|0(?:2|[3-6][1-5]))\d{7,8}$/.test(digits)) return '전화'
  return '계좌'
}

/** 안전한 형태인 덩어리에 표를 단다. 표가 달리면 이어 붙이기에 참여하지 않는다 */
function tagSafe(text: string, runs: readonly Run[]): boolean[] {
  const safe = runs.map(() => false)

  runs.forEach((run, i) => {
    const tail = text.slice(run.end, run.end + 6)
    if (MONEY_TAIL.test(tail) || DATE_TAIL.test(tail)) {
      safe[i] = true
      return
    }
    if (SHORT_HOTLINE.has(run.value)) {
      safe[i] = true
      return
    }
    const next = runs[i + 1]
    if (
      HOTLINE_HEAD.test(run.value) &&
      next !== undefined &&
      next.value.length === 4 &&
      /^[-.\s]?$/.test(text.slice(run.end, next.start))
    ) {
      safe[i] = true
      safe[i + 1] = true
    }
  })

  return safe
}

/**
 * 단위가 붙었어도 **바로 뒤에 정체불명 숫자가 이어지면** 안전을 거둡니다.
 *
 * 실측에 이 사례가 있었습니다 — 계좌번호 `3333-05-1122334` 가
 * `"3333년 5월 11일 임한 2334로"` 로 읽혔습니다. 날짜 표시를 믿으면
 * **계좌번호가 통째로 빠져나갑니다.**
 *
 * 뒤에서부터 훑는 것은 연쇄로 거두기 위해서입니다 — `11일` 의 안전이 거둬지면
 * 그 앞 `5월` 도 같은 값의 조각일 수 있습니다.
 */
function withdrawSafe(
  text: string,
  runs: readonly Run[],
  safe: boolean[],
  gapJoin: number,
): void {
  for (let i = runs.length - 2; i >= 0; i -= 1) {
    if (!safe[i]) continue
    const next = runs[i + 1]
    const between = text.slice(runs[i].end, next.start)
    if (!safe[i + 1] && between.length <= gapJoin && !SENTENCE_END.test(between)) {
      safe[i] = false
    }
  }
}

/**
 * 문장 안에서 안전하지 않은 덩어리를 모은다.
 *
 * **문장이 경계인 이유** — 사람이 계좌번호를 문장 두 개에 나눠 말하지 않습니다.
 * 처음에는 「숫자 사이 거리」로 끊었는데, 전사가 `"352, 0123, 다시 4567-89"` 처럼
 * 긴 말을 끼워 넣으면 끊겨서 놓쳤습니다.
 */
function groupBySentence(
  text: string,
  runs: readonly Run[],
  safe: readonly boolean[],
): number[][] {
  const groups: number[][] = []
  let current: number[] = []
  let cursor = 0

  runs.forEach((run, i) => {
    // 이 덩어리 앞에 문장 끝이 있었으면 묶음을 닫는다
    if (SENTENCE_END.test(text.slice(cursor, run.start))) {
      if (current.length > 0) groups.push(current)
      current = []
    }
    cursor = run.end
    if (safe[i]) return
    current.push(i)
  })

  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * 묶음을 **실제로 가릴 자리**로 나눈다.
 *
 * 자릿수를 세는 것은 묶음 단위이지만, **가리는 것은 붙어 있는 조각 단위**입니다.
 * 묶음의 처음부터 끝까지를 통째로 가리면 사이의 글자까지 지워집니다 —
 * `"850만원 그리고 카카오페이로 120만원 보냈고"` 가 통째로 사라지는 것을
 * 만드는 중에 확인했습니다.
 *
 * 사이에 글자나 한글이 있으면 다른 조각으로 봅니다. 구분자·공백뿐이면 한 조각입니다.
 */
function toSpans(
  text: string,
  runs: readonly Run[],
  group: readonly number[],
  kind: TokenKind,
): DigitSpan[] {
  const spans: DigitSpan[] = []
  let start = runs[group[0]].start
  let end = runs[group[0]].end

  for (let k = 1; k < group.length; k += 1) {
    const run = runs[group[k]]
    const between = text.slice(end, run.start)
    if (/^[^0-9A-Za-z가-힣]*$/.test(between)) {
      end = run.end
      continue
    }
    spans.push({ kind, start, end })
    start = run.start
    end = run.end
  }
  spans.push({ kind, start, end })
  return spans
}

/**
 * 전사문에서 가릴 숫자 자리를 찾는다.
 *
 * **못 알아본 숫자는 가리는 쪽으로 떨어집니다.** 그것이 이 규칙의 전부입니다.
 */
export function findTranscriptDigits(
  text: string,
  rule: DigitRule = DEFAULT_DIGIT_RULE,
): DigitSpan[] {
  const runs: Run[] = []
  for (const m of text.matchAll(/\d+/g)) {
    if (m.index === undefined) continue
    runs.push({ start: m.index, end: m.index + m[0].length, value: m[0] })
  }
  if (runs.length === 0) return []

  const safe = tagSafe(text, runs)
  withdrawSafe(text, runs, safe, rule.gapJoin)

  const out: DigitSpan[] = []
  for (const group of groupBySentence(text, runs, safe)) {
    const joined = group.map((i) => runs[i].value).join('')
    if (joined.length < rule.minDigits) continue
    out.push(...toSpans(text, runs, group, kindOf(joined)))
  }

  return out.sort((a, b) => a.start - b.start)
}
