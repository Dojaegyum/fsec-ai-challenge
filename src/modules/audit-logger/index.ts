/**
 * audit-logger — 모든 LLM 호출을 토큰화 텍스트 기준으로 기록하고, 해시 사슬로 잇는다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

import 'server-only'

export { createAuditLogger, hashOf, verifyChain } from './audit'
export type {
  ActorType,
  AuditEvent,
  AuditEventType,
  AuditLogger,
  AuditRecord,
  AuditStore,
  ChainVerdict,
} from './types'
