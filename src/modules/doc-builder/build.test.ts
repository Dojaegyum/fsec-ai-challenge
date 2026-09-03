/**
 * 서류 기재 안내 시험.
 *
 * 검증 대상: decisions/037-doc-guidance-not-generation.md ·
 *            spec/frontend/08-14-screens.md `S-10` ·
 *            spec/common/08-14-pii-boundary.md 규칙 6 · CLAUDE.md 불변 규칙 1·5
 *
 * **여기서 못 박는 것 다섯:**
 * 1. 문서를 조판하지 않는다 — 돌려주는 것은 항목과 값이지 파일이 아니다
 * 2. 칸 목록을 코드가 갖지 않는다 — 밖에서 온 정의만 쓴다
 * 3. 원문을 다루지 않는다 — 토큰화된 값 그대로 나간다
 * 4. 못 채운 칸이 실패로 보이지 않는다
 * 5. 근거 없는 안내를 내보내지 않는다
 */

import { describe, expect, it } from 'vitest'

import { KbError } from '@/lib/errors'

import { createDocBuilder } from './build'
import type { CaseSlotValue, FormDefinition } from './types'

const builder = createDocBuilder()

/**
 * 서식 정의 하나.
 *
 * ⬜ **KB 에 아직 없어 시험용으로 만든 것입니다.** 칸 이름은 실물에서 왔지만
 * (docs/research/01-환급절차-기한.md §5.1) **이 파일이 정본이라는 뜻이 아닙니다** —
 * 모듈이 정의를 그대로 쓰는지만 봅니다.
 */
function formOf(over: Partial<FormDefinition> = {}): FormDefinition {
  return {
    formId: 'relief-application',
    title: '피해구제신청서 (별지 제1호서식)',
    kbEntryId: 'relief-application-form',
    kbVersion: '2026.08.1',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2023-11-07',
    notes: ['첨부서류: 피해자의 신분증 사본 1부. 수수료 없음'],
    sections: [
      {
        id: 'receipt',
        name: '접수',
        fields: [
          { id: 'r-no', label: '접수번호', filledByStaff: true },
          { id: 'r-date', label: '접수일자', filledByStaff: true },
        ],
      },
      {
        id: 'victim',
        name: '피해자',
        fields: [
          { id: 'v-name', label: '성명' },
          {
            id: 'v-birth',
            label: '생년월일',
            hint: '직접 적으셔야 합니다 — 주민등록번호가 아닙니다',
          },
          { id: 'v-org', label: '금융회사', slotKey: 'org_name' },
          { id: 'v-amount', label: '금액', slotKey: 'amount' },
          {
            id: 'v-acct',
            label: '계좌번호',
            slotKey: 'counterpart_account',
            hint: '통장 표지에 있습니다',
          },
        ],
      },
    ],
    ...over,
  }
}

function slot(
  slotKey: string,
  state: CaseSlotValue['state'],
  valueMasked: string | null = null,
): CaseSlotValue {
  return { slotKey, state, valueMasked }
}

describe('문서를 조판하지 않는다 — ADR-037', () => {
  it('돌려주는 것은 항목과 값이다', () => {
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.sections).toHaveLength(2)
    expect(guide.sections[1].fields.map((one) => one.label)).toEqual([
      '성명',
      '생년월일',
      '금융회사',
      '금액',
      '계좌번호',
    ])
  })

  it('파일이나 문서 본문을 만들지 않는다', () => {
    // 서버가 완성 문서를 내려주는 구조는 04-pii-boundary.md 규칙 6 위반입니다.
    // 우리가 조판한 것은 법정 서식이 아니고, 틀린 서류는 반려 → 3영업일 상실입니다
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide).not.toHaveProperty('docx')
    expect(guide).not.toHaveProperty('html')
    expect(guide).not.toHaveProperty('content')
  })

  it('칸 이름을 서식에 적힌 그대로 쓴다', () => {
    // 우리가 바꿔 부르면 사용자가 실물과 대조를 못 합니다
    const guide = builder.build({ form: formOf(), slots: [] })
    const birth = guide.sections[1].fields.find((one) => one.id === 'v-birth')

    expect(birth?.label).toBe('생년월일')
  })

  it('구획 순서를 바꾸지 않는다', () => {
    // 순서는 서식 실물 그대로입니다 — 사용자가 1:1 로 대조하라고 그렇게 둔 것이지
    // 「이 순서로 하세요」가 아닙니다
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.sections.map((one) => one.id)).toEqual(['receipt', 'victim'])
  })
})

describe('칸 목록을 코드가 갖지 않는다', () => {
  it('정의에 없는 칸은 만들어 내지 않는다', () => {
    const bare: FormDefinition = {
      ...formOf(),
      sections: [{ id: 'only', name: '하나뿐', fields: [{ id: 'x', label: '어떤 칸' }] }],
    }

    const guide = builder.build({ form: bare, slots: [] })

    expect(guide.sections).toHaveLength(1)
    expect(guide.sections[0].fields).toHaveLength(1)
  })

  it('보조문도 정의에서 온다 — 지어내지 않는다', () => {
    const guide = builder.build({ form: formOf(), slots: [] })
    const birth = guide.sections[1].fields.find((one) => one.id === 'v-birth')

    expect(birth?.hint).toBe('직접 적으셔야 합니다 — 주민등록번호가 아닙니다')
  })

  it('보조문이 없으면 안 단다', () => {
    const guide = builder.build({ form: formOf(), slots: [] })
    const name = guide.sections[1].fields.find((one) => one.id === 'v-name')

    expect(name?.hint).toBeUndefined()
  })
})

describe('값을 짝짓는다', () => {
  it('확인된 값은 confirmed 다', () => {
    const guide = builder.build({
      form: formOf(),
      slots: [slot('org_name', 'confirmed', '국민은행')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-org')

    expect(field?.state).toBe('confirmed')
    expect(field?.valueMasked).toBe('국민은행')
  })

  it('증거에서 읽은 값은 unread 다 — 확인 전이다', () => {
    // 잘못 읽은 계좌번호를 확인된 값으로 보여주면 그대로 서류에 옮겨 적습니다
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'extracted', '[계좌-1]')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-acct')

    expect(field?.state).toBe('unread')
  })

  it('「모름」은 값이 아니다', () => {
    const guide = builder.build({
      form: formOf(),
      slots: [slot('amount', 'unknown')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-amount')

    expect(field?.state).toBe('unknown')
    expect(field?.valueMasked).toBeUndefined()
  })

  it('슬롯이 아예 없는 칸은 unknown 이다', () => {
    // 서식이 요구하는 것 중 성명·생년월일·주소·개설점포·예금종별·환급받을 계좌는
    // 슬롯이 아예 없습니다 → 01-환급절차-기한.md §5.3
    const guide = builder.build({ form: formOf(), slots: [] })
    const name = guide.sections[1].fields.find((one) => one.id === 'v-name')

    expect(name?.state).toBe('unknown')
  })

  it('값이 있으면 보조문을 안 단다', () => {
    // 값이 있는데 「직접 적으세요」가 뜨면 헷갈립니다
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'confirmed', '[계좌-1]')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-acct')

    expect(field?.hint).toBeUndefined()
  })
})

describe('원문을 다루지 않는다 — 규칙 6', () => {
  it('토큰화된 값을 그대로 내보낸다', () => {
    // 서버에는 복호화 키가 없어 원문을 만들 수 없습니다.
    // 복원은 셸 화면(doc.tsx)이 pii-restorer 로 브라우저에서 합니다 (ADR-064)
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'confirmed', '[계좌-1]')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-acct')

    expect(field?.valueMasked).toBe('[계좌-1]')
  })

  it('원문을 담을 칸을 두지 않는다', () => {
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'confirmed', '[계좌-1]')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-acct')

    expect(field).not.toHaveProperty('raw')
    expect(field).not.toHaveProperty('display')
  })
})

describe('못 채운 칸이 실패로 보이지 않는다', () => {
  it('값이 하나도 없어도 안내가 나간다', () => {
    // 서식이 요구하는 것 대부분은 애초에 사용자가 직접 적는 값입니다
    // → CLAUDE.md 불변 규칙 5
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.sections[1].fields).toHaveLength(5)
    expect(guide.sections[1].filled).toBe(0)
  })

  it('값이 있으면 그만큼 센다', () => {
    // 세는 자리를 0 인 상태로만 보면, 세는 규칙을 통째로 망가뜨려도
    // 시험이 초록으로 남습니다
    const guide = builder.build({
      form: formOf(),
      slots: [
        slot('org_name', 'confirmed', '국민은행'),
        slot('amount', 'extracted', '3000000'),
      ],
    })

    expect(guide.sections[1].filled).toBe(2)
  })

  it('접수처가 채우는 칸은 값이 있는 칸으로 세지 않는다', () => {
    // 그렇게 세면 접수 구획이 「2칸 · 복사할 값 2」로 떠서,
    // 사용자가 복사할 것이 하나도 없는 칸을 자기 할 일로 읽습니다
    const guide = builder.build({
      form: formOf(),
      slots: [slot('org_name', 'confirmed', '국민은행')],
    })

    expect(guide.sections[0].filled).toBe(0)
  })

  it('사용자가 적을 칸 수를 따로 센다', () => {
    // 환급받을 계좌는 원래 알 수 없는 값이고, 그 구획이 0 으로 뜨면
    // 우리가 실패한 것처럼 읽힙니다. 「전부 직접 적습니다」로 말할 수 있어야 합니다
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.sections[1].toWrite).toBe(5)
  })

  it('접수처가 채우는 칸은 사용자 몫으로 안 센다', () => {
    // 사용자가 못 하는 일까지 자기 몫으로 읽으면 안 됩니다
    const guide = builder.build({ form: formOf(), slots: [] })
    const receipt = guide.sections[0]

    expect(receipt.fields.every((one) => one.state === 'staff')).toBe(true)
    expect(receipt.toWrite).toBe(0)
  })

  it('접수처 칸은 값을 찾지 않는다', () => {
    const guide = builder.build({
      form: formOf(),
      slots: [slot('org_name', 'confirmed', '국민은행')],
    })

    expect(guide.sections[0].fields[0].valueMasked).toBeUndefined()
  })
})

describe('서식이 준 것을 버리지 않는다', () => {
  it('서식에 인쇄된 문장을 그대로 옮긴다', () => {
    // 「첨부서류: 신분증 사본 1부」는 서식 실물이 요구하는 것입니다
    // → docs/research/01-환급절차-기한.md §5.1.
    // 조용히 버려지면 사용자가 신분증 없이 창구에 갑니다
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.notes).toEqual(['첨부서류: 피해자의 신분증 사본 1부. 수수료 없음'])
  })

  it('서식 이름과 식별자를 옮긴다', () => {
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.title).toBe('피해구제신청서 (별지 제1호서식)')
    expect(guide.formId).toBe('relief-application')
  })

  it('인쇄 문장이 없으면 빈 목록이다', () => {
    const guide = builder.build({ form: formOf({ notes: undefined }), slots: [] })

    expect(guide.notes).toEqual([])
  })
})

describe('공백만 있는 값은 값이 아니다', () => {
  it('확인된 값으로 세지 않는다', () => {
    // 그냥 두면 화면이 그 칸을 「확인된 값」으로 그리고 복사 버튼이 공백을
    // 복사합니다. 사용자는 이미 채워진 줄 알고 비운 채 냅니다 —
    // 필수 기재사항 누락은 반려이고 반려는 3영업일 상실입니다
    for (const blank of ['   ', '\t\n ', '']) {
      const guide = builder.build({
        form: formOf(),
        slots: [slot('counterpart_account', 'confirmed', blank)],
      })
      const field = guide.sections[1].fields.find((one) => one.id === 'v-acct')

      expect(field?.state, JSON.stringify(blank)).toBe('unknown')
      expect(guide.sections[1].filled, JSON.stringify(blank)).toBe(0)
    }
  })

  it('보조문을 그대로 단다', () => {
    // 값이 없는 칸이니 「어디서 찾는지」가 남아야 합니다
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'confirmed', '   ')],
    })
    const field = guide.sections[1].fields.find((one) => one.id === 'v-acct')

    expect(field?.hint).toBe('통장 표지에 있습니다')
    expect(field?.valueMasked).toBeUndefined()
  })
})

describe('개인정보 확인 전에는 없는 값과 같다 — ADR-041', () => {
  // 이 상태가 이 모듈에만 빠져 있었습니다. planner·slot-checker 는 알고 있었고
  // doc-builder 만 자기 유니온을 따로 적어 둬서, `stateOf` 의 마지막 줄이
  // `pii_pending` 을 `'unread'` 로 떨어뜨렸습니다. 터지지 않고 조용히 틀리는
  // 자리라 시험으로 박습니다.
  //
  // ⚠️ **슬롯 이름은 위 `formOf` 가 실제로 짝지은 것만 씁니다.** 없는 이름을
  // 쓰면 애초에 짝이 안 지어져 시험이 통과해 버립니다 — 아무것도 안 지킵니다.

  const account = (guide: ReturnType<typeof builder.build>) =>
    guide.sections[1].fields.find((one) => one.label === '계좌번호')

  it('확인 전 값은 「직접 적으셔야 합니다」로 나간다', () => {
    const guide = builder.build({
      form: formOf(),
      // 자연스러운 날짜로 잘못 전사된 주민번호가 이 상태로 들어옵니다 —
      // 신뢰도가 낮을 이유가 없어 `extracted` 로는 안 잡히는 값입니다
      slots: [slot('counterpart_account', 'pii_pending', '110-***-******')],
    })

    expect(account(guide)?.state).toBe('unknown')
    // 값이 없는 칸으로 취급되니 보조문이 다시 붙어야 합니다
    expect(account(guide)?.hint).toBe('통장 표지에 있습니다')
  })

  it('확인 전 값은 실려 나가지 않는다', () => {
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'pii_pending', '110-***-******')],
    })

    expect(JSON.stringify(guide)).not.toContain('110-***-******')
  })

  it('채워진 칸으로 세지 않는다', () => {
    const pending = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'pii_pending', '110-***-******')],
    })
    const nothing = builder.build({ form: formOf(), slots: [] })

    // slot-checker 의 `tierStatus` 가 같은 이유로 이 상태를 채움에서 뺍니다
    expect(pending.sections[1].filled).toBe(nothing.sections[1].filled)
  })

  it('확인을 마치면 그때 값이 나간다 — 막아 두기만 하는 것이 아니다', () => {
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'confirmed', '110-***-******')],
    })

    expect(account(guide)?.state).toBe('confirmed')
    expect(JSON.stringify(guide)).toContain('110-***-******')
  })

  it('읽어만 둔 값은 확인 전 값과 다르게 다뤄진다', () => {
    // `extracted` 는 값이 실립니다 — 「확인해 주세요」로. 두 상태를 같이
    // 막아 버리면 확인 화면에 보여줄 것이 없어집니다
    const guide = builder.build({
      form: formOf(),
      slots: [slot('counterpart_account', 'extracted', '110-***-******')],
    })

    expect(account(guide)?.state).toBe('unread')
    expect(JSON.stringify(guide)).toContain('110-***-******')
  })
})

describe('근거 없는 안내를 내보내지 않는다 — 불변 규칙 1', () => {
  it('근거를 함께 낸다', () => {
    const guide = builder.build({ form: formOf(), slots: [] })

    expect(guide.citation).toEqual({
      kbEntryId: 'relief-application-form',
      kbVersion: '2026.08.1',
      sourceUrl: 'https://www.law.go.kr/...',
      effectiveFrom: '2023-11-07',
    })
  })

  it('시행일이 없으면 던진다', () => {
    // 서식은 개정됩니다. 어느 개정본을 보고 안내했는지가 남아야
    // 나중에 「왜 이렇게 안내했나」를 재현할 수 있습니다
    expect(() =>
      builder.build({ form: formOf({ effectiveFrom: '' }), slots: [] }),
    ).toThrow(KbError)
  })

  it('근거 네 칸 중 하나라도 비면 던진다', () => {
    for (const over of [
      { kbEntryId: '' },
      { kbVersion: '' },
      { sourceUrl: '' },
      { effectiveFrom: '   ' },
    ]) {
      expect(() =>
        builder.build({ form: formOf(over), slots: [] }),
      ).toThrow(KbError)
    }
  })

  it('칸이 하나도 없으면 던진다', () => {
    // 칸이 없는 안내는 「무엇을 적는지」를 못 말합니다
    expect(() =>
      builder.build({
        form: formOf({ sections: [{ id: 'x', name: '빔', fields: [] }] }),
        slots: [],
      }),
    ).toThrow(KbError)
  })

  it('그 예외는 다시 시도하지 않는다', () => {
    // 적재된 정의가 요건을 못 갖춘 것이라 재시도로 안 풀립니다
    let thrown: KbError | undefined
    try {
      builder.build({ form: formOf({ sourceUrl: '' }), slots: [] })
    } catch (error) {
      thrown = error as KbError
    }

    expect(thrown?.retryable).toBe(false)
  })

  it('실패 기록에 값을 담지 않는다', () => {
    // **값이 실제로 들어간 상태에서 봅니다.** 빈 슬롯으로 보면 담아도 통과해,
    // 나중에 진단하려고 값을 싣는 회귀를 못 잡습니다.
    // detail 은 감사 로그로 갑니다 → 08-16-errors.md §3
    let thrown: KbError | undefined
    try {
      builder.build({
        form: formOf({ sourceUrl: '' }),
        slots: [
          slot('org_name', 'confirmed', '국민은행'),
          slot('counterpart_account', 'confirmed', '[계좌-1]'),
        ],
      })
    } catch (error) {
      thrown = error as KbError
    }

    // 모양까지 못 박습니다 — 칸이 늘면 여기서 걸립니다
    expect(thrown?.detail).toEqual({
      formId: 'relief-application',
      missing: ['sourceUrl'],
    })
    expect(JSON.stringify(thrown?.detail)).not.toContain('국민은행')
    expect(JSON.stringify(thrown?.detail)).not.toContain('[계좌-1]')
  })
})
