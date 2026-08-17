/**
 * pii-masker — 정규식으로 계좌·주민번호·카드·전화를 토큰으로 치환한다.
 *
 * 정본: spec/common/08-14-pii-boundary.md 「2중 스크러빙」·「토큰화 제외 목록」
 * 근거: ADR-011 · ADR-021
 *
 * 원문이 네트워크를 타기 전 브라우저에서 도는 1차 걸름이다. 잔여는 서버의
 * `pii-tokenizer` 가 NER 로 잡는다.
 */

import type {
  MaskResult,
  MaskedKind,
  PiiMasker,
  TokenMapping,
} from './contract'

export type {
  MaskResult,
  MaskedKind,
  PiiMasker,
  TokenMapping,
} from './contract'

interface MaskRule {
  readonly kind: MaskedKind
  /** 토큰 표기에 쓰는 한국어 이름 → `[계좌-1]` */
  readonly label: string
  readonly pattern: RegExp
  /** 매칭됐어도 버릴 조건. 과잉 마스킹을 막는 자리 */
  readonly reject?: (matched: string) => boolean
}

/**
 * 좁은 것부터 넓은 것 순서로 적용한다. **순서가 결과를 바꾼다** —
 * 휴대폰 11자리와 카드 16자리는 계좌 패턴에도 걸리므로 먼저 잡아야 한다.
 *
 * ⬜ TODO(미정): 패턴 목록의 정본 위치 → 08-14-pii-boundary.md TODO.
 * 지금은 정본이 종류 넷(계좌·주민번호·카드·전화)만 정하고 패턴은 정하지 않아,
 * 아래 표현식은 이 파일이 임시 정본이다. 정해지면 옮긴다.
 */
const RULES: readonly MaskRule[] = [
  {
    // 6자리 + 뒷자리 첫 숫자 1~4 + 6자리. 형태가 특이해 다른 것과 헷갈리지 않는다
    kind: 'resident_id',
    label: '주민번호',
    pattern: /\b\d{6}-?[1-4]\d{6}\b/g,
  },
  {
    // 네 덩이 또는 붙여 쓴 16자리. 16자리 금액은 현실에 없다
    kind: 'card',
    label: '카드',
    pattern: /\b\d{4}-\d{4}-\d{4}-\d{4}\b|\b\d{16}\b/g,
  },
  {
    // 0으로 시작하는 세 덩이(지역번호 포함) 또는 붙여 쓴 휴대폰
    kind: 'phone',
    label: '전화',
    pattern: /\b0\d{1,2}-\d{3,4}-\d{4}\b|\b01[0-9]\d{7,8}\b/g,
  },
  {
    // 세 덩이로 끊긴 숫자. **하이픈이 없는 것은 1차에서 잡지 않는다** —
    // 붙여 쓴 숫자를 계좌로 보면 금액을 가리게 되고, 그러면 슬롯이 안 채워진다.
    // 그런 계좌는 2차(NER)의 몫이다
    kind: 'account',
    label: '계좌',
    pattern: /\b\d{2,6}-\d{2,6}-\d{2,8}\b/g,
    // 숫자가 열 자리 미만이면 계좌가 아니다. 날짜(2026-08-16)가 여기서 걸러진다
    reject: (matched) => digitsOf(matched).length < 10,
  },
]

export function createPiiMasker(): PiiMasker {
  return {
    mask(text: string, existing: readonly TokenMapping[] = []): MaskResult {
      const mappings: TokenMapping[] = [...existing]

      // 같은 값이 같은 토큰을 유지하게 하는 색인. 종류가 다르면 다른 값으로 센다
      const tokenByValue = new Map(
        existing.map((one) => [keyOf(one.kind, one.value), one.token]),
      )

      // 종류별로 지금까지 쓴 가장 큰 번호
      const lastNumber = new Map<MaskedKind, number>()
      for (const one of existing) {
        const used = numberOf(one.token)
        lastNumber.set(one.kind, Math.max(lastNumber.get(one.kind) ?? 0, used))
      }

      let masked = text

      for (const rule of RULES) {
        masked = masked.replace(rule.pattern, (matched) => {
          // 과잉 마스킹을 막는 자리. 원문 그대로 돌려준다
          if (rule.reject?.(matched)) return matched

          const key = keyOf(rule.kind, matched)
          const already = tokenByValue.get(key)
          if (already) return already

          const next = (lastNumber.get(rule.kind) ?? 0) + 1
          lastNumber.set(rule.kind, next)

          const token = `[${rule.label}-${next}]`
          tokenByValue.set(key, token)
          mappings.push({ token, kind: rule.kind, value: matched })
          return token
        })
      }

      return { text: masked, mappings }
    },
  }
}

function keyOf(kind: MaskedKind, value: string): string {
  return `${kind}:${value}`
}

/** `[계좌-12]` → 12. 형태가 다르면 0으로 본다 */
function numberOf(token: string): number {
  const matched = /-(\d+)\]$/.exec(token)
  return matched ? Number(matched[1]) : 0
}

function digitsOf(value: string): string {
  return value.replace(/\D/g, '')
}
