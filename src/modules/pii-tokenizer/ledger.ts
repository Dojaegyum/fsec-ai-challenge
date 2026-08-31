/**
 * 이름표 장부 — 이 사건에서 **이미 쓰인 번호**를 모은다.
 *
 * 계약: spec/common/08-14-pii-boundary.md 「번호의 단위」
 * 근거: ADR-009(매핑은 암호문으로 서버에) · ADR-027(키는 브라우저에만)
 *
 * ## 왜 필요한가 — 번호를 만드는 곳이 둘입니다
 *
 * 이름표는 **브라우저(1차)와 서버(2차)가 함께** 만듭니다. 두 곳이 각자 1부터
 * 세면 같은 사건 안에 `[계좌-1]` 이 둘 생기고, 브라우저가 자기 표로 복원하는
 * 순간 **서버가 붙인 자리에 엉뚱한 계좌가 그려집니다** — 04-pii-boundary.md 가
 * *"복원이 엉뚱한 값을 되살립니다"* 라고 금지한 그 실패입니다.
 *
 * 그래서 **번호의 단위는 사건 하나**이고, 두 곳이 같은 장부를 봅니다.
 *
 * ## ⚠️ 장부에는 원문이 없습니다 — 그게 요점입니다
 *
 * 볼트 표에서 **평문인 칸은 `token` 하나**이고 `ciphertext` 는 서버가 못 엽니다
 * (ADR-009 · ADR-027). 그래서 서버는 「어느 번호가 쓰였나」만 알고 「그 값이
 * 무엇인가」는 끝까지 모릅니다. 번호를 잇는 데 값이 필요 없다는 것이
 * `tokenize.ts` 의 `nextSeq` 가 **`kind` 와 `seq` 만 보는** 이유입니다.
 *
 * 여기서 만든 항목에 `original` 을 **빈 문자열로도 채우지 마세요.** 그러면
 * 값 매칭(`findExisting`)에 걸려 **서로 다른 값이 같은 이름표를 받습니다** —
 * 지금보다 나쁩니다. 그 방어는 `tokenize.ts` 쪽에 있고 시험이 붙어 있습니다.
 */

import type { TokenKind, TokenMapping } from './types'

/**
 * 이름표의 형식 — 정본은 04-pii-boundary.md `[계좌-1]`.
 *
 * **종류를 다섯으로 못 박습니다.** `pii-restorer/policy.ts` 의 `parseToken` 은
 * 종류 자리에 아무 낱말이나 받는데(브라우저는 화면에 그리기만 하므로 모르는
 * 종류를 만나도 안 펼치면 그만입니다), 서버는 읽어 낸 종류로 **다음 번호를
 * 발급**합니다 — 모르는 종류를 받아 두면 그 종류의 번호를 우리가 세게 됩니다.
 */
const KINDS = ['주민번호', '카드', '전화', '계좌', '이름'] as const

/** 새로 만들어 씁니다 — `lastIndex` 가 남아 호출 사이에 결과가 달라집니다 */
export function tokenShape(): RegExp {
  return new RegExp(`\\[(${KINDS.join('|')})-(\\d+)\\]`, 'g')
}

/** 이름표 하나를 뜯는다. 형식이 아니면 `null` */
export function parseToken(token: string): { kind: TokenKind; seq: number } | null {
  const m = new RegExp(`^\\[(${KINDS.join('|')})-(\\d+)\\]$`).exec(token)
  if (!m) return null
  return { kind: m[1] as TokenKind, seq: Number(m[2]) }
}

/** 토큰화된 글에 박혀 있는 이름표를 전부 긁는다 */
export function tokensInText(text: string): string[] {
  return text.match(tokenShape()) ?? []
}

/**
 * 이름표 문자열들을 **번호만 있는 매핑**으로 옮긴다.
 *
 * `original` 을 **넣지 않습니다** — 위 경고 참고. 형식이 아닌 것은 버립니다
 * (사용자가 캡처에 적어 온 `[계좌-1]` 같은 글자가 섞여 들어올 수 있는데,
 * 그것까지 번호로 세면 안 쓴 번호를 건너뜁니다 — 건너뛰는 쪽이 겹치는 쪽보다
 * 안전하므로 **모양이 맞으면 셉니다.** 모양이 아닌 것만 버립니다).
 */
export function issuedMappings(tokens: Iterable<string>): TokenMapping[] {
  const out: TokenMapping[] = []
  const seen = new Set<string>()

  for (const token of tokens) {
    if (seen.has(token)) continue
    const parsed = parseToken(token)
    if (!parsed) continue
    seen.add(token)
    out.push({ token, kind: parsed.kind, seq: parsed.seq })
  }
  return out
}

/**
 * 이 모듈이 밖에 요구하는 것 — 볼트의 **이름표 목록**.
 *
 * ⚠️ **`ciphertext` 를 받는 자리를 여기 만들지 마세요.** 번호를 잇는 데 값이
 * 필요 없고, 안 받는 것이 이 설계의 요점입니다 → `lib/db.ts` 「서버는 이것을
 * 열 수 없습니다」.
 */
export interface VaultTokenSource {
  tokens(caseId: string): Promise<readonly string[]>
}

/**
 * 이 모듈이 밖에 요구하는 것 — **서버가 만든** 이름표가 남아 있는 곳.
 *
 * 서버 2차가 붙인 이름표는 **짝이 볼트에 없습니다**(봉할 키가 서버에 없어서).
 * 그래서 볼트만 보면 서버가 앞서 쓴 번호를 못 보고, 증거 둘의 `[계좌-1]` 이
 * 서로 다른 계좌가 됩니다 — 그 둘이 매 턴 한 목록으로 모델에 함께 들어갑니다.
 *
 * 토큰화된 글이 그 이름표를 **글 안에 그대로** 갖고 있어, 새 칸을 만들지
 * 않고 거기서 긁습니다.
 *
 * ⚠️ **전사문 하나만 보면 안 됩니다.** 2026-08-31 까지 이 자리가
 * `transcript(caseId)` 였고, 그래서 챗 답변에 붙은 `[이름-1]` 을 다음 턴이
 * 못 봤습니다. 무엇을 보는지는 `lib/db.ts` 의 `createMaskedTexts` 에 있습니다.
 */
export interface MaskedTextSource {
  all(caseId: string): Promise<readonly string[]>
}

/**
 * 이 사건에서 이미 발급된 이름표를 모아 온다 — **다음 번호는 여기 뒤에서** 나옵니다.
 *
 * ## 못 읽으면 던집니다
 *
 * 장부 없이 토큰화하면 1번부터 다시 세어 **엉뚱한 값이 복원되는 상태**로
 * 돌아갑니다. 통과시키고 로그만 남기는 경로를 만들지 않는 것이 이 모듈의
 * 존재 이유입니다 → 08-16-errors.md 원칙 1 · `tokenize` 가 NER 실패를
 * 삼키지 않는 것과 같은 규칙입니다.
 */
export async function readIssuedLedger(
  caseId: string,
  deps: {
    /** 브라우저가 맡긴 이름표 → `container.vaultWrite` */
    readonly vault: VaultTokenSource
    /**
     * 서버가 앞서 붙인 이름표 → `container.maskedTexts`.
     *
     * **선택입니다.** 토큰화된 글이 아직 없는 자리에서도 볼트만으로 겹침이
     * 막히므로, 못 넘기는 자리에서 장부 자체가 없어지지는 않습니다
     */
    readonly masked?: MaskedTextSource
  },
): Promise<TokenMapping[]> {
  const [vaultTokens, texts] = await Promise.all([
    deps.vault.tokens(caseId),
    deps.masked ? deps.masked.all(caseId) : Promise.resolve([] as readonly string[]),
  ])

  const tokens: string[] = [...vaultTokens]
  for (const text of texts) tokens.push(...tokensInText(text))

  return issuedMappings(tokens)
}
