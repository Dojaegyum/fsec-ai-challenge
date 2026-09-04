/**
 * retry-checker — 예외의 retryable 값을 보고 다시 시킬지 중단할지 판단한다.
 *
 * 정본: spec/backend/08-16-errors.md §2 · §2.1
 * 근거: ADR-014 (이름) · ADR-028 (모듈 모양)
 *
 * 이 모듈은 예외 종류로 분기하지 않는다. retryable 을 보고 "재시도할 것인가"를
 * 정하고, 그 뒤 "얼마나 기다릴 것인가"만 code 로 표를 조회한다 → README.
 */

import type {
  RandomSource,
  RetryChecker,
  RetryInput,
  RetryLane,
  RetryVerdict,
} from './types'

/**
 * 예외별 대기 간격. 배열 길이가 곧 최대 재시도 횟수다.
 *
 * 정본 08-16-errors.md §2.1 의 표를 그대로 옮긴 것이다. 값을 여기서 바꾸지 말고
 * 정본을 먼저 고친다.
 *
 * KB_CITATION_MISSING 만 대기가 0인 이유는 상대 서비스가 아픈 것이 아니라
 * 모델이 형식을 틀린 것이라, 기다린다고 나아지지 않기 때문이다.
 *
 * INGEST_FAILED 는 1회뿐이다. 배경 작업이라 여유가 있지만 STT·OCR 재실행이 비싸다.
 */
const DELAYS_MS: Readonly<Record<string, readonly number[]>> = {
  STORE_ERROR: [200, 600],
  LLM_UNAVAILABLE: [500, 1500],
  PII_TOKENIZER_UNAVAILABLE: [1000, 3000],
  INGEST_FAILED: [2000],
  // **한 번**입니다 — 정본 08-16-errors.md §2 (2026-09-04 개정). 실제 상한은
  // chat-receiver 의 `MAX_ATTEMPTS = 2`(원 1회 + 재시도 1회)이고, 한 호출이 11~25초라
  // 세 번 부르면 함수 상한 60초를 넘깁니다. 2026-09-04 까지 `[0, 0]` 이라 표와 어긋나 있었습니다
  KB_CITATION_MISSING: [0],
}

/** 전체 예산. 정본 08-16-errors.md §2.1 「전체 예산」 */
const BUDGET_MS: Readonly<Record<RetryLane, number>> = {
  interactive: 20_000,
  background: 120_000,
}

/**
 * 대기에 주는 흔들림의 폭. ±20%.
 *
 * 동시에 실패한 요청들이 같은 시각에 몰려 다시 때리는 것을 막는다.
 */
const JITTER_RATIO = 0.2

/** 난수를 주지 않으면 이것을 쓴다. 실제 운영 경로의 기본값이다. */
const systemRandom: RandomSource = {
  next: () => Math.random(),
}

export function createRetryChecker(
  deps: { random?: RandomSource } = {},
): RetryChecker {
  const random = deps.random ?? systemRandom

  return {
    decide(input: RetryInput): RetryVerdict {
      const { error, attempts, elapsedMs, lane } = input

      // 1. retryable 하나만 본다. 예외 종류를 분기하지 않는다 → §2
      if (!error.retryable) {
        return { retry: false, reason: 'not_retryable' }
      }

      // 2. 정책 표에 없으면 재시도하지 않는다 → README 「표에 없는 예외」
      const delays = DELAYS_MS[error.code]
      if (!delays) {
        return { retry: false, reason: 'no_policy' }
      }

      // 3. 정해진 횟수를 다 썼는가. 배열 길이가 곧 최대 횟수다
      if (attempts < 1 || attempts > delays.length) {
        return { retry: false, reason: 'attempts_exhausted' }
      }

      const delayMs = withJitter(delays[attempts - 1], random)

      // 4. 기다렸다가 다시 부르면 예산을 넘는가.
      //    넘으면 횟수가 남아 있어도 멈춘다 → §2.1
      //    대기까지 더해서 재는 이유는, 대기한 뒤에 부르면 그 시점에 이미
      //    예산을 넘어 있기 때문이다. 사용자를 20초 넘게 세워두지 않는다.
      if (elapsedMs + delayMs >= BUDGET_MS[lane]) {
        return { retry: false, reason: 'budget_exhausted' }
      }

      return { retry: true, delayMs }
    },
  }
}

/**
 * 대기에 ±20% 흔들림을 준다. 0은 0으로 남긴다 —
 * KB_CITATION_MISSING 은 즉시 다시 생성하는 것이 정본의 뜻이다.
 */
function withJitter(baseMs: number, random: RandomSource): number {
  if (baseMs === 0) return 0
  const factor = 1 + (random.next() * 2 - 1) * JITTER_RATIO
  return Math.round(baseMs * factor)
}
