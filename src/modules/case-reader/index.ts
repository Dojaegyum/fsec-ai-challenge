/**
 * case-reader — 수법과 위험도를 판정하고 근거 스팬을 낸다 (층 1)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001.
 *
 * **이 판정은 절차를 가르지 않습니다.** 분기축은 경유 서비스 하나이고, 여기 결과는
 * 화면 표시와 관리자 조회에서만 소비됩니다
 * → spec/common/08-16-module-names.md.
 */

import 'server-only'

export { createCaseReader } from './read'
export type {
  Analysis,
  CaseReader,
  EvidenceSpan,
  LlmClient,
  ReadInput,
  ReadResult,
  RejectReason,
  Taxonomy,
} from './types'
