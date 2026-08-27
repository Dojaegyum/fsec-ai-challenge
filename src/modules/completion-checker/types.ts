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

/**
 * L1 이 무엇을 보고 그렇게 판정했나. **PII 를 넣지 않습니다** → §7 verify_detail.
 *
 * **실패 이유만 담는 칸이 아닙니다** → [ADR-057](../../../decisions/057-receipt-number-l1.md).
 * 통과에도 붙습니다 — 형식을 대조한 통과와 모양만 본 통과는 다른 일이고,
 * 나중에 형식 정본이 생기면 **다시 볼 것을 여기서 셉니다.**
 */
export type VerifyReason =
  /** 접수번호 모양이 아니다 — 빈칸·너무 짧음·숫자 없음. **실패** */
  | 'not_identifier'
  /** 기관의 접수번호 형식과 다르다. **실패** */
  | 'format_mismatch'
  /**
   * **통과.** 다만 그 기관의 형식 정본이 없어 모양만 봤습니다 (U-18).
   * 형식이 생기면 이 표시가 붙은 것들이 재검증 대상입니다.
   */
  | 'format_unchecked'

/** 사용자가 다음에 할 수 있는 것. **L1 이 실패해도 길이 막히지 않습니다** */
export interface NextOption {
  readonly level: 'L2' | 'L3'
  readonly label: string
}

export interface CompletionVerdict {
  readonly verifyLevel: VerifyLevel
  readonly verifyResult: VerifyResult
  readonly verifyDetail?: { readonly reason: VerifyReason }
  readonly stepState: StepState
  /** 실패했을 때만. 사용자가 막히지 않도록 다음 길을 함께 냅니다 */
  readonly nextOptions?: readonly NextOption[]
  /**
   * **완료가 안 됐을 때 그 이유를 사람 말로.** 문구의 정본은 08-14-api.md §3.8 입니다.
   *
   * 이것이 없으면 L3 자기 신고가 화면에 「아직 완료로 기록하지 않았습니다」 한 줄로만
   * 떨어져 **버튼이 안 먹은 것처럼** 보입니다. 완료가 안 되는 것 자체는 맞습니다
   * (불변 규칙 6) — 말을 안 해 주는 것이 틀린 것이었습니다.
   */
  readonly note?: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 기관별 접수번호 형식.
 *
 * ❌ **형식의 정본이 없습니다.** 112·은행·금감원 어디에도 공개된 규격이 없고,
 * 흔히 보이는 `2025-000000` 꼴은 사설 안내에만 나옵니다 → U-18 · docs/research/19 §4.
 * **기다리지 않기로 했습니다** → [ADR-057](../../../decisions/057-receipt-number-l1.md).
 *
 * 그래서 이 자리는 **지금 아무도 안 채웁니다.** 나중에 어느 기관의 형식이 실제로
 * 확인되면 그때 채우면 되고, 그전까지 `matches()` 는 `undefined` 를 냅니다.
 */
export interface ReceiptNumberFormat {
  /**
   * 형식에 맞는가.
   *
   * **모르면 undefined 를 돌려주세요.** `false`(틀렸다)와 구분해야 합니다 —
   * `undefined` 는 이제 **실패가 아니라 통과**입니다(`format_unchecked`).
   * 모른다고 막아 세우면 제대로 받아 적은 피해자가 실패 화면을 봅니다.
   */
  matches(value: string): boolean | undefined
}

export interface CompletionInput {
  readonly submission: ArtifactSubmission
}

export interface CompletionChecker {
  verify(input: CompletionInput): CompletionVerdict
}
