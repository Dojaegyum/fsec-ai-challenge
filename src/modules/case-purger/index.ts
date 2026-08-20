/**
 * case-purger — `purge_after` 가 지난 사건의 세 층을 함께 지우고 확인한다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createCasePurger } from './purge'
export type {
  AuditSink,
  CasePurge,
  CasePurger,
  CaseStore,
  Clock,
  Layer,
  ObjectStore,
  PurgeRun,
  PurgeTarget,
  VaultStore,
} from './types'
