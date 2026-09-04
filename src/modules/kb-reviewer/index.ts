/**
 * kb-reviewer — 변경분을 사람이 검수·승인하는 자리 (층 4)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001.
 *
 * **승인은 사람이 합니다.** LLM 은 영향 분석까지이고 릴리스 판단은 사람의
 * 몫입니다 → spec/common/08-16-module-names.md.
 *
 * **이 모듈이 `kb_entry` 에 쓰지 않습니다** → rfc/002-kb-authoring.md.
 */

import 'server-only'

export { createKbReviewer } from './review'
export type {
  ChangeGroup,
  ChangeStore,
  Clock,
  ImpactAnalysis,
  KbReviewer,
  ReviewDecision,
  ReviewStatus,
  SourceChange,
} from './types'
