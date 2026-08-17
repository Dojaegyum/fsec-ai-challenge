/**
 * retry-checker 시험.
 *
 * 검증 대상은 spec/backend/08-16-errors.md §2 · §2.1 의 표입니다.
 * 값을 바꾸려면 여기가 아니라 정본을 먼저 고칩니다.
 */

import { describe, expect, it } from 'vitest'

import {
  AppError,
  IngestError,
  KbCitationMissingError,
  KbEntryNotFoundError,
  LlmBadRequestError,
  LlmError,
  PiiTokenizerUnavailableError,
  RateLimitedError,
  RestoreDeniedError,
  StoreError,
} from '@/lib/errors'

import type { RandomSource } from './contract'
import { createRetryChecker } from './index'

/** next() 가 0.5 면 흔들림 계수가 정확히 1이 되어 표의 값이 그대로 나온다 */
const noJitter: RandomSource = { next: () => 0.5 }

const checker = createRetryChecker({ random: noJitter })

/** 흔들림 없이 attempts 번째 재시도의 대기를 얻는다 */
function delayFor(error: AppError, attempts: number): number {
  const verdict = checker.decide({
    error,
    attempts,
    elapsedMs: 0,
    lane: 'background',
  })
  if (!verdict.retry) {
    throw new Error(`재시도할 줄 알았는데 멈췄습니다: ${verdict.reason}`)
  }
  return verdict.delayMs
}

describe('재시도 여부는 retryable 하나로 정한다', () => {
  it('retryable 이 false 면 멈춘다 — LLM_BAD_REQUEST', () => {
    // 같은 요청은 같은 결과가 나온다 → §2
    expect(
      checker.decide({
        error: new LlmBadRequestError('형식 오류'),
        attempts: 1,
        elapsedMs: 0,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'not_retryable' })
  })

  it('속도 제한은 서버가 재시도하지 않는다', () => {
    // 서버가 재시도하면 제한의 뜻이 없어진다 → §2
    expect(
      checker.decide({
        error: new RateLimitedError('too fast'),
        attempts: 1,
        elapsedMs: 0,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'not_retryable' })
  })

  it('PII 경계 실패는 재시도하지 않는다', () => {
    // 부분 처리된 상태로 통과할 수 있다 → §1
    expect(
      checker.decide({
        error: new RestoreDeniedError('복원 거부'),
        attempts: 1,
        elapsedMs: 0,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'not_retryable' })
  })

  it('retryable 인데 정책 표에 없으면 멈추고 no_policy 를 남긴다', () => {
    // 근거 없는 기본값을 지어내 재시도하지 않는다 → README 「표에 없는 예외」
    class UnknownRetryableError extends AppError {
      readonly code: string = 'SOMETHING_NEW'
      readonly retryable: boolean = true
    }

    expect(
      checker.decide({
        error: new UnknownRetryableError('새 예외'),
        attempts: 1,
        elapsedMs: 0,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'no_policy' })
  })

  it('retryable 이 false 면 표에 없어도 not_retryable 이 먼저다', () => {
    expect(
      checker.decide({
        error: new KbEntryNotFoundError('0건'),
        attempts: 1,
        elapsedMs: 0,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'not_retryable' })
  })
})

describe('대기 간격은 §2.1 표를 그대로 따른다', () => {
  it('StoreError 는 200ms · 600ms 두 번', () => {
    expect(delayFor(new StoreError('연결 끊김'), 1)).toBe(200)
    expect(delayFor(new StoreError('연결 끊김'), 2)).toBe(600)
  })

  it('LlmError 는 500ms · 1500ms 두 번', () => {
    expect(delayFor(new LlmError('일시 장애'), 1)).toBe(500)
    expect(delayFor(new LlmError('일시 장애'), 2)).toBe(1500)
  })

  it('PiiTokenizerUnavailableError 는 1s · 3s 두 번', () => {
    // 모델 서비스 기동에 시간이 걸린다 → §2.1
    expect(delayFor(new PiiTokenizerUnavailableError('NER 다운'), 1)).toBe(1000)
    expect(delayFor(new PiiTokenizerUnavailableError('NER 다운'), 2)).toBe(3000)
  })

  it('IngestError 는 2s 한 번뿐', () => {
    expect(delayFor(new IngestError('STT 실패'), 1)).toBe(2000)
    expect(
      checker.decide({
        error: new IngestError('STT 실패'),
        attempts: 2,
        elapsedMs: 0,
        lane: 'background',
      }),
    ).toEqual({ retry: false, reason: 'attempts_exhausted' })
  })

  it('KbCitationMissingError 만 대기가 0이다', () => {
    // 상대 서비스가 아픈 것이 아니라 모델이 형식을 틀린 것이라
    // 기다린다고 나아지지 않는다 → §2.1
    expect(delayFor(new KbCitationMissingError('지어낸 ref'), 1)).toBe(0)
    expect(delayFor(new KbCitationMissingError('지어낸 ref'), 2)).toBe(0)
  })
})

describe('정해진 횟수를 다 쓰면 멈춘다', () => {
  it('세 번째 시도는 소진이다 — 최대 2회', () => {
    expect(
      checker.decide({
        error: new StoreError('연결 끊김'),
        attempts: 3,
        elapsedMs: 0,
        lane: 'background',
      }),
    ).toEqual({ retry: false, reason: 'attempts_exhausted' })
  })

  it('attempts 가 0 이하로 들어오면 재시도하지 않는다', () => {
    // 부른 쪽의 실수다. 표의 첫 값을 조용히 쓰지 않는다
    expect(
      checker.decide({
        error: new StoreError('연결 끊김'),
        attempts: 0,
        elapsedMs: 0,
        lane: 'background',
      }),
    ).toEqual({ retry: false, reason: 'attempts_exhausted' })
  })
})

describe('전체 예산을 넘으면 횟수가 남아도 멈춘다', () => {
  it('사용자를 기다리게 하는 경로는 20초', () => {
    // 19,400 + 500 = 19,900 < 20,000 → 아직 된다
    expect(
      checker.decide({
        error: new LlmError('일시 장애'),
        attempts: 1,
        elapsedMs: 19_400,
        lane: 'interactive',
      }),
    ).toEqual({ retry: true, delayMs: 500 })

    // 19,600 + 500 = 20,100 ≥ 20,000 → 멈춘다
    expect(
      checker.decide({
        error: new LlmError('일시 장애'),
        attempts: 1,
        elapsedMs: 19_600,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'budget_exhausted' })
  })

  it('배경 경로는 120초라 같은 상황에서 계속 간다', () => {
    expect(
      checker.decide({
        error: new LlmError('일시 장애'),
        attempts: 1,
        elapsedMs: 19_600,
        lane: 'background',
      }),
    ).toEqual({ retry: true, delayMs: 500 })

    expect(
      checker.decide({
        error: new LlmError('일시 장애'),
        attempts: 1,
        elapsedMs: 119_600,
        lane: 'background',
      }),
    ).toEqual({ retry: false, reason: 'budget_exhausted' })
  })

  it('대기까지 더해서 잰다 — 기다린 뒤에 이미 넘어 있으면 안 된다', () => {
    // 남은 시간이 2,900ms 인데 대기가 3,000ms 라 기다리면 넘는다
    expect(
      checker.decide({
        error: new PiiTokenizerUnavailableError('NER 다운'),
        attempts: 2,
        elapsedMs: 17_100,
        lane: 'interactive',
      }),
    ).toEqual({ retry: false, reason: 'budget_exhausted' })
  })
})

describe('흔들림은 ±20% 안에 든다', () => {
  it('next() 가 0 이면 20% 짧아진다', () => {
    const low = createRetryChecker({ random: { next: () => 0 } })
    const verdict = low.decide({
      error: new StoreError('연결 끊김'),
      attempts: 1,
      elapsedMs: 0,
      lane: 'background',
    })
    expect(verdict).toEqual({ retry: true, delayMs: 160 })
  })

  it('next() 가 1에 가까우면 20% 길어진다', () => {
    const high = createRetryChecker({ random: { next: () => 1 } })
    const verdict = high.decide({
      error: new StoreError('연결 끊김'),
      attempts: 1,
      elapsedMs: 0,
      lane: 'background',
    })
    expect(verdict).toEqual({ retry: true, delayMs: 240 })
  })

  it('대기가 0인 것에는 흔들림을 주지 않는다', () => {
    const high = createRetryChecker({ random: { next: () => 1 } })
    const verdict = high.decide({
      error: new KbCitationMissingError('지어낸 ref'),
      attempts: 1,
      elapsedMs: 0,
      lane: 'interactive',
    })
    expect(verdict).toEqual({ retry: true, delayMs: 0 })
  })

  it('난수를 안 주면 표의 값 ±20% 안에 들어온다', () => {
    const real = createRetryChecker()
    for (let i = 0; i < 50; i += 1) {
      const verdict = real.decide({
        error: new LlmError('일시 장애'),
        attempts: 2,
        elapsedMs: 0,
        lane: 'background',
      })
      if (!verdict.retry) throw new Error('재시도할 줄 알았습니다')
      expect(verdict.delayMs).toBeGreaterThanOrEqual(1200)
      expect(verdict.delayMs).toBeLessThanOrEqual(1800)
    }
  })
})
