/**
 * pii-tokenizer — 개인정보를 토큰으로 치환한다. **격리 경계** (층 1 · 층 2)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 *
 * **이 모듈을 거치지 않은 텍스트는 외부 LLM 으로 나갈 수 없습니다**
 * → spec/common/08-16-module-names.md 층 1 · CLAUDE.md 불변 규칙 2.
 */

import 'server-only'

export { createPiiTokenizer } from './tokenize'
/**
 * 번호 장부 → `ledger.ts`. **이름표는 평문이라 서버가 읽을 수 있습니다** —
 * 값은 여전히 못 읽습니다 → 04-pii-boundary.md 「번호의 단위」.
 */
export {
  issuedMappings,
  parseToken,
  readIssuedLedger,
  tokensInText,
  tokenShape,
} from './ledger'
export type { MaskedTextSource, VaultTokenSource } from './ledger'
export { WIRE_NAME } from './types'
export type {
  NerModel,
  NerSpan,
  PiiTokenizer,
  TokenKind,
  TokenMapping,
  TokenizeContext,
  TokenizeResult,
} from './types'
