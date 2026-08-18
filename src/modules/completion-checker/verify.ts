/**
 * completion-checker — 부산물로 완료를 판정한다 (L1·L2·L3).
 *
 * 정본: spec/backend/08-14-completion-hook.md · spec/backend/08-16-data-model.md §7
 *       spec/common/08-14-api.md §3.8
 * 근거: ADR-028
 *
 * **CLAUDE.md 불변 규칙 6** — 완료는 사용자의 체크가 아니라 부산물로 판정한다.
 * 체크리스트는 "체크는 됐는데 행위는 안 된 상태"를 막지 못하고, 은행·경찰 시스템 API 가
 * 없어 완수를 직접 조회할 수도 없다. 그래서 절차가 남기는 부산물을 근거로 삼는다.
 */

import type {
  ArtifactSubmission,
  CompletionChecker,
  CompletionInput,
  CompletionVerdict,
  NextOption,
  ReceiptNumberFormat,
} from './types'

/**
 * L1 이 실패했을 때 내미는 길. **문구의 정본은 08-14-api.md §3.8 입니다.**
 *
 * 이것이 없으면 사용자가 막힌다. L1 자동 검증이 실패했다고 막아 세우지 않는다 →
 * 08-14-completion-hook.md 구현 주의.
 */
const NEXT_OPTIONS: readonly NextOption[] = [
  { level: 'L2', label: '접수 문자 캡처를 올려주세요' },
  { level: 'L3', label: '번호 없이 접수했다고 표시' },
]

export function createCompletionChecker(deps: {
  receiptFormat: ReceiptNumberFormat
}): CompletionChecker {
  const { receiptFormat } = deps

  return {
    verify(input: CompletionInput): CompletionVerdict {
      return verifyOne(input.submission, receiptFormat)
    },
  }
}

function verifyOne(
  submission: ArtifactSubmission,
  receiptFormat: ReceiptNumberFormat,
): CompletionVerdict {
  switch (submission.kind) {
    // L1 — 접수번호 포맷 체크
    case 'receipt_no':
      return verifyReceiptNumber(submission.value, receiptFormat)

    // L2 — 캡처·서류를 올렸다. 업로드 자체가 증빙이다
    case 'sms_capture':
    case 'receipt_doc':
      return {
        verifyLevel: 'L2',
        verifyResult: 'passed',
        stepState: 'done_verified',
      }

    // L3 — 했다고만 말했다. **완료가 아니다**
    case 'other':
      return {
        verifyLevel: 'L3',
        // 검증할 것이 없었다는 뜻이다. 실패와 다르다
        verifyResult: 'not_applicable',
        // 종결 상태가 아니라 리마인더 추적 대상으로 남는다
        stepState: 'unconfirmed',
      }
  }
}

function verifyReceiptNumber(
  value: string,
  receiptFormat: ReceiptNumberFormat,
): CompletionVerdict {
  const trimmed = value.trim()

  if (trimmed === '') return failed('format_mismatch')

  const matched = receiptFormat.matches(trimmed)

  // 형식을 모른다. **모른다고 통과시키지 않는다** — 아무 숫자나 완료가 된다.
  // 틀린 것과 구분해 두면 나중에 「형식을 아직 못 넣은 기관」을 셀 수 있다
  if (matched === undefined) return failed('format_unknown')

  if (!matched) return failed('format_mismatch')

  return {
    verifyLevel: 'L1',
    verifyResult: 'passed',
    stepState: 'done_verified',
  }
}

/**
 * 실패해도 단계가 뒤로 가지 않는다 — `in_progress` 다.
 * 그리고 **다음 길을 함께 낸다.** 막다른 길을 만들지 않는다.
 *
 * `reason` 외에 아무것도 담지 않는다. 입력한 값은 개인정보일 수 있다 → §7.
 */
function failed(reason: 'format_mismatch' | 'format_unknown'): CompletionVerdict {
  return {
    verifyLevel: 'L1',
    verifyResult: 'failed',
    verifyDetail: { reason },
    stepState: 'in_progress',
    nextOptions: NEXT_OPTIONS,
  }
}
