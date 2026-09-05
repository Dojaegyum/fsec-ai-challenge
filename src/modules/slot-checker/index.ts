/**
 * slot-checker — T1 충족 여부를 판정하고 다음 질문 1문항을 고른다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

import 'server-only'

export {
  CONFIRMABLE_KEYS,
  CONFIRM_NO,
  CONFIRM_YES,
  FROZEN_T2_KEYS,
  createSlotChecker,
  isSlotKey,
  tierOf,
  valueTypeOf,
} from './check'
export type {
  NextQuestion,
  QuestionForm,
  QuestionSource,
  SlotCheckInput,
  SlotCheckResult,
  SlotChecker,
  SlotKey,
  SlotSnapshot,
  SlotState,
  SlotTier,
  SlotValueType,
  TierStatus,
  Track,
} from './types'
