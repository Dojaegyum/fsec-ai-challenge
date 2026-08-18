/**
 * prompt-builder — 7블록을 순서대로 조립하고 비신뢰 블록에 격리 태그를 씌운다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createPromptBuilder } from './build'
export { createXmlRenderer } from './xml-renderer'
export { OUTPUT_FORMAT, SYSTEM_PROMPT } from './system-prompt'
export type {
  BlockRenderer,
  BuiltPrompt,
  CaseStateItem,
  HistoryTurn,
  IssuedRef,
  KbEntryForPrompt,
  PromptBlock,
  PromptBuilder,
  PromptCounts,
  PromptInput,
  PromptItem,
  TalkLine,
} from './types'
