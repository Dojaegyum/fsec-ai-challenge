/**
 * 예외 계층과 사용자 문구 시험.
 *
 * 검증 대상은 spec/backend/08-16-errors.md §1 §3 입니다.
 *
 * ## 왜 표를 통째로 베껴 두나
 *
 * `userMessageFor` 는 **모르는 코드를 조용히 `INTERNAL` 로 떨어뜨립니다.** 그게
 * 맞는 설계인데(빈 문자열을 내보내지 않습니다), 그래서 **표에서 한 줄이 빠져도
 * 아무것도 안 깨집니다** — 배포된 뒤에 「처리 중 문제가 발생했습니다」가 나가는
 * 것으로만 드러납니다.
 *
 * 그러니 이 시험은 정본 §3 표를 **글자 그대로** 들고 있습니다. 표가 바뀌면
 * 여기도 함께 고치는 것이 한 작업입니다.
 */

import { describe, expect, it } from 'vitest'

import {
  AppError,
  ArtifactRequiredError,
  EgressBlockedError,
  IngestError,
  KbCitationMissingError,
  KbEntryNotFoundError,
  KbUnavailableError,
  LlmBadRequestError,
  LlmError,
  PiiTokenizerUnavailableError,
  RateLimitedError,
  RestoreDeniedError,
  SlotNotConfirmedError,
  StoreError,
  USER_MESSAGE,
  userMessageFor,
} from './errors'
import { BadRequestError, CaseNotFoundError, UnauthorizedError } from './http'

/** 08-16-errors.md §3 표 — `code` · HTTP · 사용자에게 보일 문구 */
const TABLE: readonly (readonly [string, number, string])[] = [
  ['EGRESS_BLOCKED', 422, '개인정보가 남아 있어 요청을 중단했습니다. 다시 시도해 주세요.'],
  ['RESTORE_DENIED', 403, '요청하신 정보를 표시할 수 없습니다.'],
  ['PII_TOKENIZER_UNAVAILABLE', 503, '지금은 분석할 수 없습니다. 잠시 후 다시 시도해 주세요.'],
  ['KB_CITATION_MISSING', 502, '안내를 만들지 못했습니다. 다시 시도해 주세요.'],
  [
    'CASE_NOT_FOUND',
    404,
    '이 주소의 사건을 찾을 수 없습니다. 마지막 활동일부터 180일이 지나면 자동으로 파기됩니다.',
  ],
  ['KB_ENTRY_NOT_FOUND', 404, '해당하는 절차 정보를 찾지 못했습니다.'],
  [
    'KB_UNAVAILABLE',
    503,
    '지금은 절차를 안내할 수 없습니다. 급하시면 1332(금융감독원)로 연락해 주세요.',
  ],
  ['SLOT_NOT_CONFIRMED', 409, '먼저 확인이 필요한 항목이 있습니다.'],
  ['ARTIFACT_REQUIRED', 409, '앞 단계의 접수번호가 필요합니다.'],
  ['LLM_UNAVAILABLE', 503, '지금은 응답할 수 없습니다. 잠시 후 다시 시도해 주세요.'],
  ['LLM_BAD_REQUEST', 500, '처리 중 문제가 발생했습니다.'],
  ['INGEST_FAILED', 422, '파일을 읽지 못했습니다. 다른 파일로 시도해 주세요.'],
  ['STORE_ERROR', 503, '지금은 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.'],
  ['RATE_LIMITED', 429, '요청이 너무 빠릅니다. 잠시 후 다시 시도해 주세요.'],
  ['BAD_REQUEST', 400, '요청 형식이 올바르지 않습니다.'],
  ['UNAUTHORIZED', 401, '처리 중 문제가 발생했습니다.'],
  ['INTERNAL', 500, '처리 중 문제가 발생했습니다.'],
]

/** 표의 각 줄을 실제로 던지는 예외. `INTERNAL` 은 기반 클래스가 그 자리입니다 */
const THROWN: Readonly<Record<string, AppError>> = {
  EGRESS_BLOCKED: new EgressBlockedError('x'),
  RESTORE_DENIED: new RestoreDeniedError('x'),
  PII_TOKENIZER_UNAVAILABLE: new PiiTokenizerUnavailableError('x'),
  KB_CITATION_MISSING: new KbCitationMissingError('x'),
  CASE_NOT_FOUND: new CaseNotFoundError('x'),
  KB_ENTRY_NOT_FOUND: new KbEntryNotFoundError('x'),
  KB_UNAVAILABLE: new KbUnavailableError('x'),
  SLOT_NOT_CONFIRMED: new SlotNotConfirmedError('x'),
  ARTIFACT_REQUIRED: new ArtifactRequiredError('x'),
  LLM_UNAVAILABLE: new LlmError('x'),
  LLM_BAD_REQUEST: new LlmBadRequestError('x'),
  INGEST_FAILED: new IngestError('x'),
  STORE_ERROR: new StoreError('x'),
  RATE_LIMITED: new RateLimitedError('x'),
  BAD_REQUEST: new BadRequestError('x'),
  UNAUTHORIZED: new UnauthorizedError('x'),
  INTERNAL: new AppError('x'),
}

describe('사용자 문구 — 08-16-errors.md §3 표', () => {
  for (const [code, , message] of TABLE) {
    it(`${code} 의 문구가 계약 그대로다`, () => {
      expect(userMessageFor(code)).toBe(message)
    })
  }

  it('표의 열일곱 줄이 하나도 안 빠졌다', () => {
    // 빠진 줄은 조용히 INTERNAL 로 떨어져 「처리 중 문제가 발생했습니다」가 나갑니다.
    // 2026-08-27 배포 서버에서 CASE_NOT_FOUND·BAD_REQUEST·UNAUTHORIZED 셋이 그랬습니다
    expect(Object.keys(USER_MESSAGE).sort()).toEqual(TABLE.map(([code]) => code).sort())
  })

  it('모르는 코드는 INTERNAL 문구로 떨어진다 — 빈 문자열을 내보내지 않는다', () => {
    expect(userMessageFor('DOES_NOT_EXIST')).toBe('처리 중 문제가 발생했습니다.')
    expect(userMessageFor('')).not.toBe('')
  })
})

describe('예외가 표의 code·HTTP 와 맞는다 — §1 §3', () => {
  for (const [code, status] of TABLE) {
    it(`${code} 는 ${status} 다`, () => {
      const thrown = THROWN[code]
      expect(thrown.code).toBe(code)
      expect(thrown.httpStatus).toBe(status)
    })
  }
})

describe('링크를 잃은 사람이 가장 먼저 보는 화면 — CASE_NOT_FOUND', () => {
  it('파기 안내를 함께 준다 — 없는 것과 파기된 것을 가르지 않는 대신', () => {
    // API 를 나누면 「그 토큰이 한때 유효했다」가 새어 나갑니다 → ADR-021.
    // 가르지 않는 대신 **문구 하나가 둘 다 설명합니다** → §3
    const message = userMessageFor('CASE_NOT_FOUND')

    expect(message).toContain('180일')
    expect(message).toContain('파기')
  })

  it('KB_ENTRY_NOT_FOUND 와 다른 말을 한다 — 같은 404 라도', () => {
    // 저쪽은 절차 항목이 없는 것이고 이쪽은 사건이 없는 것입니다
    expect(userMessageFor('CASE_NOT_FOUND')).not.toBe(userMessageFor('KB_ENTRY_NOT_FOUND'))
  })
})

describe('detail — §3 「감사 로그에만 들어갑니다」', () => {
  it('안 넘기면 빈 객체다', () => {
    expect(new AppError('x').detail).toEqual({})
  })

  it('넘긴 것을 그대로 들고 있다', () => {
    expect(new BadRequestError('x', { param: 'action' }).detail).toEqual({ param: 'action' })
  })
})

describe('재시도 — §2 표', () => {
  const RETRYABLE: readonly string[] = [
    'PII_TOKENIZER_UNAVAILABLE',
    'KB_CITATION_MISSING',
    'KB_UNAVAILABLE',
    'LLM_UNAVAILABLE',
    'INGEST_FAILED',
    'STORE_ERROR',
  ]

  for (const [code] of TABLE) {
    it(`${code} 의 retryable 이 §2 표와 같다`, () => {
      // retry-checker 는 이 값 하나만 보고 판단합니다 — 예외 종류를 따로 분기하지
      // 않으므로, 값이 틀리면 그 자리에서 조용히 다르게 굽니다
      expect(THROWN[code].retryable).toBe(RETRYABLE.includes(code))
    })
  }
})
