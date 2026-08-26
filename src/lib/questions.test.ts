/**
 * 문진 문구 표 시험.
 *
 * 검증 대상은 spec/common/08-14-api.md §3.4 (next_question 구조) ·
 * spec/backend/08-14-channel-matrix.md (8유형) ·
 * spec/backend/08-16-data-model.md §5.1 (슬롯 이름·value_type) ·
 * spec/backend/08-14-slot-tiering.md (최소 질문 원칙) 입니다.
 *
 * 가장 중요한 것: **문구가 붙어도 slot-checker 는 여전히 아무도 막지 않습니다.**
 */

import { describe, expect, it } from 'vitest'

import {
  channelForOption,
  createQuestionSource,
  questionsConfigured,
} from './questions'

import { createSlotChecker, type SlotKey } from '@/modules/slot-checker'

const source = createQuestionSource()

/**
 * check.ts 의 ASK_ORDER 와 같은 목록입니다.
 *
 * **저쪽이 고르는 순서라 이 시험은 「빠짐없이 문구가 있는가」만 봅니다** —
 * 순서 자체는 slot-checker 의 시험이 봅니다.
 */
const ASKED: readonly SlotKey[] = [
  'transferred',
  'channel',
  'org_name',
  'amount',
  // 정확한 액수를 「모름」으로 답했을 때만 나갑니다. 언제 나가는지는
  // slot-checker 가 정하고, 여기서는 문구가 있는지만 봅니다
  'amount_hint',
  'occurred_at',
  'elapsed_hint',
  'contact_method',
  // 이미 밟은 절차의 날짜 둘. **자동 추출로는 못 채웁니다** —
  // 이체내역에도 전사에도 「언제 지급정지를 요청했나」가 없습니다
  'freeze_requested_at',
  'relief_applied_at',
]

/** 08-14-channel-matrix.md 「9유형」 표의 경유 서비스 칸 그대로 */
const CHANNEL_OPTIONS = [
  '시중은행 계좌이체',
  '인터넷은행 (토스뱅크 등)',
  '증권사 계좌',
  '간편송금 (카카오페이·토스 등)',
  '가상자산 (거래소 경유)',
  '대면편취 (현금 전달)',
  '상품권 (핀번호 전달)',
  '휴대폰 소액결제',
  // ADR-055 로 더해진 아홉째. 근거법이 여신전문금융업법이라 별개 유형입니다
  '카드 부정사용·카드론',
]

describe('문진 문구 표', () => {
  it('문진으로 채우는 슬롯 일곱에 전부 문구가 있다', () => {
    for (const slotKey of ASKED) {
      expect(source.formFor(slotKey), slotKey).toBeDefined()
    }
  })

  it('증거에서 뽑아 오는 슬롯은 묻지 않는다', () => {
    // 물어서 채우는 값이 아니다 → 08-14-slot-tiering.md T2 「증거에서 자동 추출 우선」.
    // 이체내역·전사에 실제로 들어 있는 값들입니다
    expect(source.formFor('counterpart_account')).toBeUndefined()
    expect(source.formFor('impersonated_org')).toBeUndefined()
    expect(source.formFor('report_filed_at')).toBeUndefined()
    expect(source.formFor('objection_submitted_at')).toBeUndefined()
  })

  it('**절차 날짜 둘은 묻습니다** — 물어야만 채울 수 있습니다', () => {
    // 「언제 지급정지를 요청했나」는 이체내역 OCR 에도 전사에도 없습니다.
    // 부산물에도 없습니다 — 거기 있는 것은 **올린 날**이고, 늦게 올리면
    // 기한이 그만큼 늦게 잡힙니다(틀리는 방향이 나쁩니다 → ADR-054).
    //
    // 정본이 이 경우를 이미 말하고 있습니다 — *"자동 추출 실패는 정상
    // 경로입니다. 예외로 처리하지 말고 질문 경로로 흘려보내세요"*.
    //
    // **이 둘이 비면 3영업일도 14일 유예도 서지 않습니다.**
    expect(source.formFor('freeze_requested_at')).toBeDefined()
    expect(source.formFor('relief_applied_at')).toBeDefined()
  })

  it('버튼 질문에는 선택지가 반드시 붙는다', () => {
    // options 없는 buttons 는 계약 위반입니다 → 08-14-api.md §3.4
    for (const slotKey of ASKED) {
      const form = source.formFor(slotKey)
      if (form?.input !== 'buttons') continue
      expect(form.options?.length, slotKey).toBeGreaterThan(0)
    }
  })

  it('경유 서비스 선택지는 9유형 전부다', () => {
    // 하나라도 빠지면 그 유형 피해자는 자기 경로를 고를 수 없습니다
    expect(source.formFor('channel')?.options).toEqual(CHANNEL_OPTIONS)
  })

  it('금액은 정확한 숫자로 먼저 묻는다', () => {
    // `case_slot.value_type` 이 decimal 입니다 → 08-16-data-model.md §5.1.
    // 아는 사람은 여기서 한 번에 끝납니다
    expect(source.formFor('amount')?.input).toBe('amount')
  })

  it('금액 구간은 버튼이고 선택지가 계약 예시와 같다', () => {
    // 08-14-api.md §3.4 의 예시 그대로입니다. 정확한 액수를 모를 때
    // 대신 받는 값이라 전부 버튼으로 답할 수 있어야 합니다
    const form = source.formFor('amount_hint')

    expect(form?.input).toBe('buttons')
    expect(form?.options).toEqual([
      '100만원 미만',
      '100~500만원',
      '500~1000만원',
      '1000만원 이상',
    ])
  })

  it('시각은 date 입력으로 받는다', () => {
    expect(source.formFor('occurred_at')?.input).toBe('date')
  })

  it('설정 현황에 「붙어 있음」으로 나온다', () => {
    expect(questionsConfigured(source)).toBe(true)
  })
})

describe('경유 서비스 선택지를 슬롯 값으로 되돌리기', () => {
  it('선택지 아홉이 전부 9유형 값으로 되돌아간다', () => {
    // 화면에 나가는 것은 라벨이고 case_slot 에 적재되는 것은 CH-* 입니다
    // → 08-14-api.md §3.4 (options 는 string[]) · §3.5 (value 는 "CH-bank")
    expect(CHANNEL_OPTIONS.map(channelForOption)).toEqual([
      'CH-bank',
      'CH-neobank',
      'CH-securities',
      'CH-easypay',
      'CH-crypto',
      'CH-facetoface',
      'CH-giftcard',
      'CH-carrier',
      'CH-card',
    ])
  })

  it('물어본 선택지 중에 값으로 못 되돌리는 것이 없다', () => {
    // 하나라도 비면 그 유형을 고른 사용자의 답이 조용히 버려집니다
    const asked = source.formFor('channel')?.options ?? []

    expect(asked.filter((option) => channelForOption(option) === undefined)).toEqual([])
  })

  it('「모름·기억 안 남」은 경유 서비스 값이 아니다', () => {
    // 모름은 PATCH …/slots 의 action:"unknown" 으로 갑니다 → 08-14-api.md §3.5
    expect(channelForOption('모름·기억 안 남')).toBeUndefined()
  })

  it('표에 없는 문자열은 값으로 만들지 않는다', () => {
    // 8유형 밖의 값이 case_slot 에 들어가면 KB 분기가 조용히 빗나갑니다
    expect(channelForOption('토스')).toBeUndefined()
    expect(channelForOption('')).toBeUndefined()
  })
})

describe('slot-checker 와 함께', () => {
  const checker = createSlotChecker({ questions: source })

  it('사건을 막 만든 직후 첫 질문은 송금 여부다', () => {
    // T1 이 분기를 결정하고, 그 안에서 transferred 가 앞입니다 → check.ts ASK_ORDER
    const result = checker.check({ slots: [] })

    expect(result.nextQuestion?.slotKey).toBe('transferred')
    expect(result.needsSupersetPlan).toBe(true)
  })

  it('버튼 질문에 「모름·기억 안 남」이 들어 있다', () => {
    // 없으면 스펙 위반입니다 → 08-14-api.md §3.4
    const result = checker.check({ slots: [] })

    expect(result.nextQuestion?.input).toBe('buttons')
    expect(result.nextQuestion?.options).toContain('모름·기억 안 남')
  })

  it('송금 여부가 채워지면 다음은 송금 수단이다', () => {
    const result = checker.check({
      slots: [{ slotKey: 'transferred', tier: 'T1', state: 'confirmed' }],
    })

    expect(result.nextQuestion?.slotKey).toBe('channel')
    expect(result.nextQuestion?.options).toContain('모름·기억 안 남')
  })

  it('문진 대상이 전부 차면 더 묻지 않고 그래도 보드는 열린다', () => {
    // `ASKED` 에 절차 날짜 둘이 들어와 있습니다 — 그것까지 다 차야 질문이 끝납니다
    const result = checker.check({
      slots: ASKED.map((slotKey) => ({
        slotKey,
        tier: slotKey === 'transferred' || slotKey === 'channel' ? 'T1' : 'T2',
        state: 'confirmed' as const,
      })),
    })

    expect(result.nextQuestion).toBeNull()
    expect(result.t1).toBe('satisfied')
  })
})
