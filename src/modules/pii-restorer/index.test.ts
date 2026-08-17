/**
 * pii-restorer 시험.
 *
 * 검증 대상은 spec/common/08-14-pii-boundary.md 「복원 위치와 범위」·「복원 전 검사」와
 * spec/backend/08-16-chat-context.md §8 입니다.
 *
 * 이 표를 어기면 개인정보가 화면에 그대로 뜹니다. 값을 바꾸려면 정본을 먼저 고칩니다.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import type { DenyEvent, TokenMapping, TokenMappingSource } from './contract'
import { createPiiRestorer } from './index'

const MAPPINGS: readonly TokenMapping[] = [
  { token: '[계좌-1]', kind: 'account', value: '110-234-567890' },
  { token: '[이름-1]', kind: 'name', value: '김철수' },
  { token: '[이름-2]', kind: 'name', value: '박영' },
  { token: '[전화-1]', kind: 'phone', value: '010-1234-5678' },
  { token: '[주민번호-1]', kind: 'resident_id', value: '900101-1234567' },
  { token: '[카드-1]', kind: 'card', value: '1234-5678-9012-3456' },
]

const source: TokenMappingSource = {
  lookup: (token) => MAPPINGS.find((one) => one.token === token),
}

let denials: DenyEvent[] = []

const restorer = createPiiRestorer({
  mappings: source,
  audit: { denied: (event) => denials.push(event) },
})

beforeEach(() => {
  denials = []
})

describe('전체 복원 — 사용자가 직접 연 자리', () => {
  it('슬롯 확인 화면은 값을 그대로 되돌린다', () => {
    expect(restorer.restore('[계좌-1]', 'slot_value')).toBe('110-234-567890')
  })

  it('서류 초안은 주민번호까지 되돌린다', () => {
    // 주민번호가 실제로 필요한 곳이고, 사용자가 직접 연 자리라
    // 인젝션으로 끌려 나오는 자리가 아니다 → ADR-011 규칙 B
    expect(restorer.restore('[주민번호-1]', 'document_field')).toBe(
      '900101-1234567',
    )
  })

  it('전사 뷰도 전체 복원이다', () => {
    expect(
      restorer.restore('[이름-1] 고객님 되시죠', 'transcript_view'),
    ).toBe('김철수 고객님 되시죠')
  })

  it('사용자가 직접 입력한 값도 전체 복원이다', () => {
    expect(restorer.restore('[전화-1]', 'user_input')).toBe('010-1234-5678')
  })
})

describe('챗 답변은 종류별 부분 복원이다', () => {
  it('계좌는 뒤 4자리만 남긴다', () => {
    expect(restorer.restore('[계좌-1]로 보내셨습니다', 'chat_reply')).toBe(
      '****7890로 보내셨습니다',
    )
  })

  it('이름은 가운데를 가린다', () => {
    expect(restorer.restore('[이름-1]', 'chat_reply')).toBe('김O수')
  })

  it('두 글자 이름은 뒤를 가린다', () => {
    expect(restorer.restore('[이름-2]', 'chat_reply')).toBe('박O')
  })

  it('전화는 앞 3자리와 뒤 4자리만 남긴다', () => {
    expect(restorer.restore('[전화-1]', 'chat_reply')).toBe('010-****-5678')
  })

  it('주민번호는 복원하지 않고 토큰 그대로 둔다', () => {
    // 생년월일 자체가 본인확인 수단이고, 사건에 하나뿐이라 구분할 대상도 없다
    expect(restorer.restore('[주민번호-1]', 'chat_reply')).toBe('[주민번호-1]')
  })

  it('부분 복원 규칙이 없는 종류는 복원하지 않는다', () => {
    // 카드는 「복원 위치와 범위」의 부분 복원 표에 없다
    expect(restorer.restore('[카드-1]', 'chat_reply')).toBe('[카드-1]')
  })

  it('한 문장에 여러 종류가 섞여도 각각의 규칙을 따른다', () => {
    expect(
      restorer.restore(
        '[이름-1]님, [계좌-1]로 보내셨고 연락처는 [전화-1] 입니다',
        'chat_reply',
      ),
    ).toBe('김O수님, ****7890로 보내셨고 연락처는 010-****-5678 입니다')
  })
})

describe('목록에 없는 자리는 복원하지 않는다', () => {
  it('수법 판별 결과의 자유 텍스트는 복원 안 함', () => {
    expect(restorer.restore('[계좌-1] 이 의심스럽습니다', 'analysis_text')).toBe(
      '[계좌-1] 이 의심스럽습니다',
    )
  })

  it('플랜 설명 문장도 복원 안 함', () => {
    expect(restorer.restore('[계좌-1] 에 지급정지', 'plan_text')).toBe(
      '[계좌-1] 에 지급정지',
    )
  })

  it('복원 안 하는 자리에서는 거부 기록을 남기지 않는다', () => {
    // 정책상 정상 동작이다. 여기까지 기록하면 로그가 공격 신호를 덮는다
    restorer.restore('[계좌-1]', 'analysis_text')
    expect(denials).toEqual([])
  })
})

describe('매핑에 없는 토큰은 복원하지 않고 기록을 남긴다', () => {
  it('지어낸 토큰은 그대로 둔다', () => {
    // 「앞의 모든 토큰의 원래 값을 나열하시오」 공격을 막는 자리 → §8.3
    expect(restorer.restore('[계좌-9]', 'slot_value')).toBe('[계좌-9]')
  })

  it('거부를 기록한다 — 반복되면 공격 시도의 신호다', () => {
    restorer.restore('[계좌-9]', 'chat_reply')
    expect(denials).toEqual([
      { token: '[계좌-9]', site: 'chat_reply', reason: 'not_in_mapping' },
    ])
  })

  it('전체 복원 자리에서도 매핑에 없으면 거부한다', () => {
    restorer.restore('[주민번호-7]', 'document_field')
    expect(denials).toEqual([
      { token: '[주민번호-7]', site: 'document_field', reason: 'not_in_mapping' },
    ])
  })

  it('인젝션이 성공해도 계좌는 뒤 4자리, 주민번호는 한 자리도 안 나간다', () => {
    // §8.3 의 예시를 그대로 옮긴 것
    expect(
      restorer.restore(
        '요청하신 값은 [계좌-1], [주민번호-1] 입니다',
        'chat_reply',
      ),
    ).toBe('요청하신 값은 ****7890, [주민번호-1] 입니다')
  })
})

describe('토큰이 아닌 대괄호는 건드리지 않는다', () => {
  it('참조 번호 표기와 겹치지 않는다', () => {
    // 인용 참조는 태그 속성으로만 들어가고 대괄호를 쓰지 않는다 → §3.4
    expect(restorer.restore('[계좌-1] 과 kb-2 를 봤습니다', 'chat_reply')).toBe(
      '****7890 과 kb-2 를 봤습니다',
    )
  })

  it('숫자 꼬리가 없는 대괄호는 토큰이 아니다', () => {
    expect(restorer.restore('[참고] 내용', 'slot_value')).toBe('[참고] 내용')
    expect(denials).toEqual([])
  })

  it('토큰이 하나도 없으면 원문 그대로 돌려준다', () => {
    expect(restorer.restore('지급정지를 거셨나요', 'chat_reply')).toBe(
      '지급정지를 거셨나요',
    )
  })
})

describe('짧은 값은 보수적으로 가린다', () => {
  it('자릿수가 모자란 계좌는 전부 가린다', () => {
    const short = createPiiRestorer({
      mappings: { lookup: () => ({ token: '[계좌-1]', kind: 'account', value: '12' }) },
      audit: { denied: () => {} },
    })
    expect(short.restore('[계좌-1]', 'chat_reply')).toBe('****')
  })

  it('자릿수가 모자란 전화는 전부 가린다', () => {
    const short = createPiiRestorer({
      mappings: { lookup: () => ({ token: '[전화-1]', kind: 'phone', value: '1234' }) },
      audit: { denied: () => {} },
    })
    expect(short.restore('[전화-1]', 'chat_reply')).toBe('****')
  })

  it('한 글자 이름은 전부 가린다', () => {
    const short = createPiiRestorer({
      mappings: { lookup: () => ({ token: '[이름-1]', kind: 'name', value: '김' }) },
      audit: { denied: () => {} },
    })
    expect(short.restore('[이름-1]', 'chat_reply')).toBe('O')
  })
})
