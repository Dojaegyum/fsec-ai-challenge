/**
 * citation-checker — 인용 셋을 확인하고, 근거가 없으면 되묻기로 넘길지 판정한다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createCitationChecker } from './check'
export type {
  CitationChecker,
  CitationInput,
  CitationOutcome,
  ModelCitation,
  ModelReply,
  Violation,
} from './types'
