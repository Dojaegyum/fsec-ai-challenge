/**
 * retry-checker — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-16-errors.md §2 · §2.1
 * 이름: spec/common/08-16-module-names.md 「층 없음 · 항상」
 *
 * 절대 하지 않는 것: 예외 종류로 분기하기 · 스스로 기다리기 · 대기 값을 여기서 바꾸기
 */

import type { AppError } from '@/lib/errors'

/**
 * 어느 경로에서 부르는가. 전체 예산이 여기서 갈린다.
 *
 * 정본 08-16-errors.md §2.1 「전체 예산」:
 *   - 사용자를 기다리게 하는 경로 (챗·플랜) = 20초
 *   - 배경 경로 (전사·수집) = 120초
 */
export type RetryLane = 'interactive' | 'background'

/**
 * 이 모듈이 밖에 요구하는 것 — 대기에 줄 흔들림(jitter)용 난수.
 *
 * 난수를 직접 부르지 않고 받는 이유는, 받지 않으면 같은 입력에 같은 결과가
 * 나오지 않아 시험할 수 없기 때문이다.
 */
export interface RandomSource {
  /** 0 이상 1 미만 */
  next(): number
}

export interface RetryInput {
  /** 방금 실패로 잡힌 예외 */
  error: AppError

  /** 지금까지 실제로 호출한 횟수. 첫 호출이 실패했으면 1 */
  attempts: number

  /** 첫 호출을 시작한 시점부터 지금까지 걸린 시간 */
  elapsedMs: number

  lane: RetryLane
}

/** 왜 멈추는가. 감사 로그에 남긴다 → 08-16-errors.md §5 */
export type StopReason =
  /** 예외가 retryable=false 다 */
  | 'not_retryable'
  /** retryable=true 인데 정책 표에 이 code 가 없다 → README 「표에 없는 예외」 */
  | 'no_policy'
  /** 이 예외에 정해진 재시도 횟수를 다 썼다 */
  | 'attempts_exhausted'
  /** 대기하고 다시 부르면 전체 예산을 넘는다 */
  | 'budget_exhausted'

export type RetryVerdict =
  | { readonly retry: true; readonly delayMs: number }
  | { readonly retry: false; readonly reason: StopReason }

export interface RetryChecker {
  /**
   * 다시 시킬지 중단할지 판단한다. 기다리거나 다시 부르지는 않는다 —
   * 판단만 돌려주고, 실제 대기와 재호출은 부른 쪽이 한다.
   */
  decide(input: RetryInput): RetryVerdict
}
