/**
 * kb-selector — 토큰화된 대화를 보고 두 묶음 밖의 자료를 고른다. 답은 쓰지 않고 번호만.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

import 'server-only'

export { createKbSelector } from './select'
export type {
  CandidateKind,
  HistoryLine,
  KbSelector,
  SelectInput,
  SelectResult,
  SelectStats,
  SelectorCall,
  SelectorCandidate,
  SelectorClock,
  SelectorLlm,
  SelectorOptions,
  SkipReason,
} from './types'
