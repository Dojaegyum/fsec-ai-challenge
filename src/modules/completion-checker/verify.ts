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

/**
 * 접수번호 **모양**인가 — 형식 규격이 아니라 오타·빈칸 거르개다 → ADR-057.
 *
 * **어느 기관의 형식도 주장하지 않는다.** 「식별자로 쓸 수 있는 문자열인가」만 본다.
 * 구분자를 떼고 남은 것이 영숫자 6자 이상이고 숫자가 하나라도 있으면 통과다.
 *
 *     2026-004821        -> 2026004821    통과
 *     KB-20260826-0001   -> KB20260826…   통과
 *     9                  -> 9             거름 (짧다)
 *     ㅇㅇ                -> ㅇㅇ           거름 (영숫자가 아니다)
 *
 * 여기서 걸려도 막다른 길이 아니다 — L2·L3 이 그대로 열려 있다.
 */
export function looksLikeReceiptNumber(value: string): boolean {
  const bare = value.replace(/[\s\-–—./_()]/g, '')
  return bare.length >= 6 && /^[0-9A-Za-z]+$/.test(bare) && /[0-9]/.test(bare)
}

/**
 * **L1 은 「형식이 맞나」가 아니라 「받아 적었나」를 묻는다** → ADR-057.
 *
 * 형식 정본이 없어서 내린 결론이 아니라, **부산물 원리가 원래 그것**이다 —
 * 불변 규칙 6이 말하는 근거는 「형식이 맞다」가 아니라 「그것이 존재한다」이고,
 * 접수번호는 절차를 밟지 않으면 생기지 않는다.
 *
 * 형식 대조는 **할 수 있을 때만 얹는 덤**이다. 지금은 아무 기관도 못 얹는다.
 */
function verifyReceiptNumber(
  value: string,
  receiptFormat: ReceiptNumberFormat,
): CompletionVerdict {
  const trimmed = value.trim()

  if (!looksLikeReceiptNumber(trimmed)) return failed('not_identifier')

  const matched = receiptFormat.matches(trimmed)

  if (matched === false) return failed('format_mismatch')

  return {
    verifyLevel: 'L1',
    verifyResult: 'passed',
    stepState: 'done_verified',
    // **통과에도 이유를 남긴다.** 형식을 대조한 통과와 모양만 본 통과는 다른 일이고,
    // 형식 정본이 생기는 날 다시 볼 것을 여기서 센다 → types.ts VerifyReason
    ...(matched === undefined ? { verifyDetail: { reason: 'format_unchecked' as const } } : {}),
  }
}

/**
 * 실패해도 단계가 뒤로 가지 않는다 — `in_progress` 다.
 * 그리고 **다음 길을 함께 낸다.** 막다른 길을 만들지 않는다.
 *
 * `reason` 외에 아무것도 담지 않는다. 입력한 값은 개인정보일 수 있다 → §7.
 */
function failed(reason: 'not_identifier' | 'format_mismatch'): CompletionVerdict {
  return {
    verifyLevel: 'L1',
    verifyResult: 'failed',
    verifyDetail: { reason },
    stepState: 'in_progress',
    nextOptions: NEXT_OPTIONS,
  }
}
