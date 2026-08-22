/**
 * pii-tokenizer — 개인정보를 토큰으로 치환한다. **격리 경계** (층 1 · 층 2)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 *
 * **이 모듈을 거치지 않은 텍스트는 외부 LLM 으로 나갈 수 없습니다**
 * → spec/common/08-16-module-names.md 층 1 · CLAUDE.md 불변 규칙 2.
 */

export { createPiiTokenizer } from './tokenize'
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
