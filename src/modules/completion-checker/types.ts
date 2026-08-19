/**
 * completion-checker — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-14-completion-hook.md (검증 3단계·상태 머신)
 *       spec/backend/08-16-data-model.md §7 (artifact 테이블·레벨 대응)
 *       spec/common/08-14-api.md §3.8 (응답 형태)
 * 근거: ADR-028
 *
 * **CLAUDE.md 불변 규칙 6을 집행하는 자리입니다** —
 * 완료는 사용자의 체크가 아니라 부산물로 판정합니다.
 *
 * 절대 하지 않는 것: 사용자의 체크만으로 완료 처리하기 · L3 하나로 done_verified 만들기 · 검증 상세에 개인정보 담기
 */

/** 08-16-data-model.md §7 의 kind */
export type ArtifactKind = 'receipt_no' | 'sms_capture' | 'receipt_doc' | 'other'

/**
 * 사용자가 낸 것. 낸 형태가 곧 검증 레벨을 정합니다 → 08-14-api.md §3.8.
 *
 *   접수번호를 직접 입력  → L1 (포맷 체크)
 *   캡처·서류를 올림      → L2 (증빙 확인)
 *   했다고만 말함         → L3 (자기 신고)
 */
export type ArtifactSubmission =
  | { readonly kind: 'receipt_no'; readonly value: string }
  | {
      readonly kind: 'sms_capture' | 'receipt_doc'
      readonly evidenceId: string
    }
  | { readonly kind: 'other'; readonly selfReported: true }

export type VerifyLevel = 'L1' | 'L2' | 'L3'
export type VerifyResult = 'passed' | 'failed' | 'not_applicable'

/** 08-16-domain-model.md 의 PlanStep 상태 중 이 모듈이 내는 셋 */
export type StepState = 'done_verified' | 'in_progress' | 'unconfirmed'

/** L1 이 왜 실패했나. **PII 를 넣지 않습니다** → §7 verify_detail */
export type FailReason =
  /** 기관의 접수번호 형식과 다르다 */
  | 'format_mismatch'
  /** 그 기관의 형식을 아직 모른다 → README 「형식을 모를 때」 */
  | 'format_unknown'

/** 사용자가 다음에 할 수 있는 것. **L1 이 실패해도 길이 막히지 않습니다** */
export interface NextOption {
  readonly level: 'L2' | 'L3'
  readonly label: string
}

export interface CompletionVerdict {
  readonly verifyLevel: VerifyLevel
  readonly verifyResult: VerifyResult
  readonly verifyDetail?: { readonly reason: FailReason }
  readonly stepState: StepState
  /** 실패했을 때만. 사용자가 막히지 않도록 다음 길을 함께 냅니다 */
  readonly nextOptions?: readonly NextOption[]
}

/**
 * 이 모듈이 밖에 요구하는 것 — 기관별 접수번호 형식.
 *
 * **형식의 정본이 아직 없습니다** → 08-14-completion-hook.md TODO(근거 필요).
 * 그래서 이 모듈은 형식을 갖지 않고 물어봅니다. 정해지면 구현만 바뀝니다.
 */
export interface ReceiptNumberFormat {
  /**
   * 형식에 맞는가.
   *
   * **모르면 undefined 를 돌려주세요.** `false`(틀렸다)와 구분해야 사용자에게
   * 다른 말을 할 수 있습니다.
   */
  matches(value: string): boolean | undefined
}

export interface CompletionInput {
  readonly submission: ArtifactSubmission
}

export interface CompletionChecker {
  verify(input: CompletionInput): CompletionVerdict
}
