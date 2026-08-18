/**
 * completion-checker — 부산물로 완료를 판정한다 (L1·L2·L3).
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

export { createCompletionChecker } from './verify'
export type {
  ArtifactKind,
  ArtifactSubmission,
  CompletionChecker,
  CompletionInput,
  CompletionVerdict,
  FailReason,
  NextOption,
  ReceiptNumberFormat,
  StepState,
  VerifyLevel,
  VerifyResult,
} from './types'
