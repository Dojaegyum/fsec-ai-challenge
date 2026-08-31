/**
 * chat-receiver — 발화를 받아 층 2의 순서를 부른다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createChatReceiver } from './receive'
export type {
  CaseContext,
  ChatReceiver,
  CitationOutcome,
  CitationSource,
  Clock,
  IssuedRef,
  IssuedToken,
  KbContextRef,
  KbEntry,
  KbSource,
  LlmClient,
  ModelReply,
  PiiTokenizer,
  PromptSource,
  RetryJudge,
  SettledOutcome,
  Track,
  TurnInput,
  TurnOutcome,
  Violation,
} from './types'
