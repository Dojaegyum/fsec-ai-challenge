/**
 * 토큰화 엔진 — **격리 경계**.
 *
 * 계약: spec/common/08-14-pii-boundary.md
 *   · 2중 스크러빙 — 1차는 브라우저 정규식, 2차는 여기 NER
 *   · 토큰 형식 `[계좌-1]` — 종류별 일련번호. 같은 값은 같은 번호
 *   · 토큰화 제외 목록을 **NER 결과보다 우선** 적용
 *
 * ## 정규식을 여기서 다시 돌립니다
 *
 * 1차가 브라우저에서 이미 돌았는데 왜 또 도느냐면, **브라우저를 안 거치는 경로가
 * 있기 때문**입니다 — `transcriber` 가 낸 전사·OCR 결과는 서버에서 만들어져
 * 1차를 지나지 않았습니다 → 12-module-names.md 층 1 흐름도.
 *
 * **패턴을 여기 옮겨 적지 않습니다.** 정본은 `pii-masker/patterns.ts` 하나이고,
 * 04-pii-boundary.md 가 *"두 곳에 두면 반드시 어긋나고, 어긋난 쪽이 조용히 새는
 * 쪽이 됩니다"* 라고 못 박았습니다. 그래서 층 C 모듈의 공개 API 를 가져다 씁니다 —
 * **층을 넘는 import 이지만, 패턴을 복제하는 것보다 이쪽이 정본의 요구입니다.**
 * 그 파일에는 브라우저 전용 API 가 없습니다(순수 함수만).
 */

import { findHits } from '@/modules/pii-masker'
import { PiiBoundaryError, PiiTokenizerUnavailableError } from '@/lib/errors'

import { WIRE_NAME } from './types'
import type {
  NerModel,
  NerSpan,
  PiiTokenizer,
  TokenKind,
  TokenMapping,
  TokenizeContext,
  TokenizeResult,
} from './types'

/**
 * 2차에서 **토큰으로 바꾸는** 이름표.
 *
 * 이 목록에 없는 것은 전부 그대로 둡니다. 04-pii-boundary.md 의 「토큰화 제외
 * 목록」이 기관명·금액·시각을 빼라고 정했는데, **빼는 쪽을 나열하는 대신 넣는
 * 쪽을 나열합니다** — 모델이 새 이름표를 들고 와도 그것이 조용히 토큰화되지
 * 않습니다. 제외 목록에 없는 낱말이 새 이름표로 들어오는 것이 더 흔합니다.
 *
 * **1차가 잡는 넷은 여기 없습니다.** 정규식이 이미 잡았고, 모델이 같은 자리를
 * 다시 집으면 겹칩니다.
 */
const NER_LABELS_TO_TOKENIZE: Readonly<Record<string, TokenKind>> = {
  PERSON: '이름',
  PS: '이름',
  PS_NAME: '이름',
  '이름': '이름',
}

/** 같은 원문은 같은 토큰. 값 기준으로 찾습니다 */
function findExisting(
  mappings: readonly TokenMapping[],
  kind: TokenKind,
  original: string,
): TokenMapping | undefined {
  return mappings.find((one) => one.kind === kind && one.original === original)
}

function nextSeq(mappings: readonly TokenMapping[], kind: TokenKind): number {
  let max = 0
  for (const one of mappings) {
    if (one.kind === kind && one.seq > max) max = one.seq
  }
  return max + 1
}

/** 가릴 자리 하나 */
interface Span {
  readonly kind: TokenKind
  readonly start: number
  readonly end: number
  /** 그 자리의 **원문 그대로**. 복원할 때 되살아나야 하는 값입니다 */
  readonly value: string
  /** 자를 때 다시 읽으려고 들고 다닙니다 */
  readonly text: string
}

/**
 * 뒤에 조사만 남았는가.
 *
 * NER 이 `"카카오페이로"` 를 한 덩어리로 집는 일이 흔합니다. 정확히 같은지만
 * 보면 그때 못 막습니다.
 */
const PARTICLE_ONLY = /^[는은이가을를와과의도만로에서부터까지\s.,!?)\]]*$/

/**
 * 제외 목록에 걸리는가.
 *
 * **NER 결과보다 우선입니다** → 04-pii-boundary.md. 모델이 `"카카오페이"` 를
 * 사람 이름으로 잘못 집어도 여기서 걸립니다.
 *
 * 이게 없으면 `"카카오페이로 300만원"` 이 `"[이름-1]로 300만원"` 이 되어
 * 경유 서비스를 특정할 수 없고, **에러 없이 슈퍼셋 플랜이 나갑니다** —
 * 사용자는 정보를 다 줬는데 「모름」 취급을 받습니다.
 *
 * ## 「포함하면 허용」이 아닙니다 — 반대로 새어 나갑니다
 *
 * 처음에는 `값.includes(허용어)` 로 봤습니다. 그런데 기관 별칭에는 **두 글자짜리**가
 * 자연스럽게 들어갑니다 — 정본의 `org` 예시가 `aliases: ["국민", "KB국민은행", …]`
 * 입니다. 그러면 **「김하나」·「이신한」·「박국민」 같은 실명이 통째로 통과합니다.**
 * 실측으로 확인했습니다.
 *
 * 정본이 뺀 것은 **「기관명」이지 「기관명을 포함한 문자열」이 아닙니다.**
 * 그래서 **허용어로 시작하고 뒤에 조사만 남은 경우**까지만 봅니다.
 */
function isAllowed(value: string, allowedTerms: readonly string[]): boolean {
  const trimmed = value.trim()

  return allowedTerms.some((term) => {
    if (term.length === 0) return false
    if (trimmed === term) return true
    if (!trimmed.startsWith(term)) return false
    return PARTICLE_ONLY.test(trimmed.slice(term.length))
  })
}

/**
 * 두 자리가 겹치는가
 */
function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * **정규식이 이깁니다.** 다만 진 쪽을 통째로 버리지 않습니다.
 *
 * 처음에는 시작 위치가 이른 쪽을 남겼습니다. 그러면 모델이 `"김민수 010"` 을 한
 * 덩어리로 집었을 때 **전화번호 뒷자리 `-1234-5678` 이 평문으로 남습니다** —
 * 겹치지 않은 조각이 아무에게도 안 잡히기 때문입니다. 실측으로 확인했습니다.
 *
 * 그래서 겹친 부분을 **잘라내고 남은 조각**을 살립니다. 위 예에서는 `"김민수"` 가
 * 이름으로, 전화번호는 전화로 각각 잡힙니다 — 둘 다 가려집니다.
 *
 * 정규식이 이기는 이유는 **종류를 더 정확히 알기 때문**입니다. 전화번호가
 * `[이름-1]` 로 기록되면 계측 헤더의 종류별 건수가 틀리고, 1차가 만든 매핑과
 * 종류가 어긋나 복원 규칙도 갈립니다.
 */
function mergeSpans(strong: readonly Span[], weak: readonly Span[]): Span[] {
  const kept: Span[] = [...strong]

  for (const span of weak) {
    // 이긴 자리에 걸리는 부분을 잘라냅니다
    let pieces: Span[] = [span]

    for (const hard of strong) {
      const next: Span[] = []
      for (const piece of pieces) {
        if (!overlaps(piece, hard)) {
          next.push(piece)
          continue
        }
        if (piece.start < hard.start) {
          next.push({ ...piece, start: piece.start, end: hard.start })
        }
        if (hard.end < piece.end) {
          next.push({ ...piece, start: hard.end, end: piece.end })
        }
      }
      pieces = next
    }

    for (const piece of pieces) {
      // 잘리고 남은 것이 공백뿐이면 버립니다
      const value = piece.text.slice(piece.start, piece.end).trim()
      if (value.length === 0) continue
      // 자른 뒤 앞뒤 공백을 떼어 자리를 다시 잡습니다
      const offset = piece.text.slice(piece.start, piece.end).indexOf(value)
      const trimmed: Span = {
        kind: piece.kind,
        start: piece.start + offset,
        end: piece.start + offset + value.length,
        value,
        text: piece.text,
      }
      // 약한 것끼리도 겹치면 앞엣것만 남깁니다
      if (kept.some((one) => overlaps(one, trimmed))) continue
      kept.push(trimmed)
    }
  }

  return kept.sort((a, b) => a.start - b.start)
}

function nerToSpans(
  found: readonly NerSpan[],
  text: string,
  allowedTerms: readonly string[],
): Span[] {
  const spans: Span[] = []

  for (const one of found) {
    const kind = NER_LABELS_TO_TOKENIZE[one.label]
    if (!kind) continue
    if (isAllowed(one.value, allowedTerms)) continue

    // 모델이 준 자리가 실제 글자와 안 맞으면 버립니다 — 엉뚱한 자리를 가리면
    // 지워야 할 것을 놔두고 멀쩡한 글자를 지웁니다
    if (text.slice(one.start, one.end) !== one.value) continue

    spans.push({
      kind,
      start: one.start,
      end: one.end,
      value: one.value,
      text,
    })
  }
  return spans
}

/**
 * 이미 아는 원문이 이 텍스트에 그대로 있으면 **같은 토큰으로** 가립니다.
 *
 * 두 가지를 한꺼번에 해결합니다.
 *
 * **하나 — 탐지가 한 번 놓쳐도 안 샙니다.** 모델의 재현율은 100%가 아니라
 * 같은 이름을 다음 턴에 놓칠 수 있습니다. 이미 아는 값이면 여기서 잡습니다.
 *
 * **둘 — 같은 값에 같은 번호가 유지됩니다** → 04-pii-boundary.md.
 * 번호가 어긋나면 복원이 엉뚱한 값을 되살립니다.
 *
 * 이게 없으면 「아는 값이 텍스트에 남아 있다」를 **오류로 던지는** 수밖에 없는데,
 * 그러면 그 이름이 나오는 모든 턴이 영영 실패합니다 — 고칠 수 있는 상황을
 * 영구 장애로 바꾸는 셈입니다.
 */
function knownSpans(text: string, mappings: readonly TokenMapping[]): Span[] {
  const spans: Span[] = []

  for (const one of mappings) {
    if (!one.original || one.original.length === 0) continue

    let from = 0
    for (;;) {
      const start = text.indexOf(one.original, from)
      if (start < 0) break
      spans.push({
        kind: one.kind,
        start,
        end: start + one.original.length,
        value: one.original,
        text,
      })
      from = start + one.original.length
    }
  }
  return spans
}

/**
 * 우리가 만들지 않은 **토큰 모양 문자열**을 센다.
 *
 * ⬜ **어떻게 다룰지 정본에 없어 세기만 합니다.** 사기범이 보낸 캡처에
 * `[계좌-1]` 이라는 글자가 있고 OCR 이 그대로 읽으면, 그 자리가 나중에
 * **피해자 본인의 계좌번호로 복원돼 보입니다** — 불변 규칙 4가 겨냥한 종류의
 * 우회인데, *"모델이 지어낸 토큰은 매핑에 없어 복원되지 않습니다"* 라는 방어는
 * 이 모양에 안 통합니다(우리 매핑에 **있는** 토큰이라서).
 *
 * 지우거나 바꾸지 않는 이유는 **사용자가 쓴 글자를 우리가 고치는 것**이라
 * 규칙이 필요하기 때문입니다.
 */
const TOKEN_SHAPE = /\[(주민번호|카드|전화|계좌|이름)-\d+\]/g

function countForeignTokens(text: string): number {
  return text.match(TOKEN_SHAPE)?.length ?? 0
}

export function createPiiTokenizer(deps: { ner?: NerModel } = {}): PiiTokenizer {
  const { ner } = deps

  /** 정규식 1차와 같은 패턴. 정본은 pii-masker/patterns.ts */
  const regexSpans = (text: string): Span[] =>
    findHits(text).map((hit) => ({
      kind: hit.kind as TokenKind,
      start: hit.start,
      end: hit.end,
      value: hit.value,
      text,
    }))

  return {
    async tokenize(text, ctx: TokenizeContext = {}): Promise<TokenizeResult> {
      const allowedTerms = ctx.allowedTerms ?? []
      const mappings: TokenMapping[] = [...(ctx.mappings ?? [])]
      const added: TokenMapping[] = []

      // 입력에 이미 있던 토큰 모양은 우리가 만든 것이 아닙니다 → ⬜ 위 참고
      const foreignTokens = countForeignTokens(text)

      let nerSpans: Span[] = []
      let nerApplied = false

      if (ner) {
        try {
          nerSpans = nerToSpans(await ner.find(text), text, allowedTerms)
          nerApplied = true
        } catch (error) {
          // 통과시키고 로그만 남기는 경로를 만들지 않습니다 → 10-errors.md 원칙 1
          throw new PiiTokenizerUnavailableError(
            '개인정보 탐지 모델을 쓸 수 없습니다',
            { cause: error instanceof Error ? error.name : 'unknown' },
          )
        }
      }

      // 확실한 것부터 — 정규식과 **이미 아는 원문**이 이깁니다.
      // 모델이 집은 것은 겹치는 부분을 잘라내고 남은 조각만 씁니다
      const strong = mergeSpans(regexSpans(text), knownSpans(text, mappings))
      const spans = mergeSpans(strong, nerSpans)

      let out = ''
      let cursor = 0
      /** 이번에 실제로 가린 횟수. 같은 값을 두 번 가리면 두 번 셉니다 */
      const counts: Record<string, number> = {}

      for (const span of spans) {
        let mapping = findExisting(mappings, span.kind, span.value)

        if (!mapping) {
          const seq = nextSeq(mappings, span.kind)
          mapping = {
            token: `[${span.kind}-${seq}]`,
            kind: span.kind,
            seq,
            original: span.value,
          }
          mappings.push(mapping)
          added.push(mapping)
        }

        // **가린 횟수를 셉니다.** 새 매핑만 세면, 앞서 말한 계좌를 다시 말한 턴의
        // 응답에 `X-Pii-Token-Count` 가 0 으로 나갑니다 — 가렸는데 안 가린 것처럼
        // 보이는 그림입니다 → 08-14-api.md §1.1
        const name = WIRE_NAME[span.kind]
        counts[name] = (counts[name] ?? 0) + 1

        out += text.slice(cursor, span.start) + mapping.token
        cursor = span.end
      }

      out += text.slice(cursor)

      assertNoLeak(out, added)

      return { masked: out, added, mappings, counts, nerApplied, foreignTokens }
    },

    /**
     * ⚠️ **`tokenize` 와 같은 규칙이 아닙니다.** 이 자리는 동기 함수라
     * (`chat-publisher` 의 `ResidualPiiScanner` 계약) 모델을 부를 수 없어
     * **정규식만 돕니다.**
     *
     * 그래서 **모델이 답변에 남긴 이름은 여기서 안 걸립니다.** 송출 직전 검사가
     * 구조적으로 못 보는 자리이고, `X-Pii-Egress-Residual` 은 그때도 0 을
     * 보고합니다. ⬜ 계약을 비동기로 넓히든 별도 검사를 두든 정해야 하는 자리입니다.
     */
    scan(text) {
      // 값이 아니라 건수만. 종류별로 셉니다 → 10-errors.md 원칙 2
      const counts: Record<string, number> = {}
      for (const span of regexSpans(text)) {
        const name = WIRE_NAME[span.kind]
        counts[name] = (counts[name] ?? 0) + 1
      }
      return counts
    },
  }
}

/**
 * 이번에 가린 값이 출력에 그대로 남아 있으면 멈춘다.
 *
 * **이 검사가 무엇을 잡고 무엇을 못 잡는지 분명히 해 둡니다.**
 *
 * | | |
 * | --- | --- |
 * | 잡는 것 | 탐지는 됐는데 **치환이 잘못돼** 원문이 남은 경우 |
 * | **못 잡는 것** | **패턴이 애초에 못 찾은 값** — 매핑이 없어 비교할 대상이 없습니다 |
 *
 * 처음 주석은 *"패턴을 늘리다 실수하면 이 검사가 그 자리에서 멈춥니다"* 였는데,
 * **그건 줄 수 없는 보증입니다.** 못 찾은 값은 여기서도 못 찾습니다.
 * 탐지의 폭은 `pii-masker/patterns.ts` 와 2차 모델이 정하고, 이 검사는
 * 치환 단계의 실수만 봅니다.
 *
 * **이번에 만든 매핑만 봅니다.** 넘겨받은 옛 매핑까지 보면, 그 원문을 부분
 * 문자열로 품은 낱말이 나중에 나올 때마다 실패합니다 — 이미 아는 값은
 * `knownSpans` 가 가리므로 여기까지 오지 않습니다.
 */
function assertNoLeak(masked: string, added: readonly TokenMapping[]): void {
  for (const one of added) {
    if (one.original && masked.includes(one.original)) {
      // detail 에 원문을 넣지 않습니다 — 감사 로그로 흘러가는 자리입니다
      throw new PiiBoundaryError('토큰화 후에도 원문이 남아 있습니다', {
        kind: WIRE_NAME[one.kind],
        seq: one.seq,
      })
    }
  }
}

