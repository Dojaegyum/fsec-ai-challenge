/**
 * case-intake — 사건을 생성하고 파일을 접수한다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

import 'server-only'

export {
  createCaseIntake,
  DEFAULT_LIMITS,
  DEFAULT_PURGE_DAYS,
} from './intake'
export type {
  CaseIntake,
  CaseStatus,
  CaseStore,
  Clock,
  DateShifter,
  EvidenceKind,
  EvidenceRequest,
  EvidenceRow,
  EvidenceTotals,
  IdSource,
  LinkTokenSource,
  IngestStatus,
  IntakeLimits,
  OpenedCase,
  Track,
  UploadSlot,
  UploadSlotSource,
} from './types'
