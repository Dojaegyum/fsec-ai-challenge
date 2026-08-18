/**
 * citation-checker 시험.
 *
 * 검증 대상은 spec/backend/08-16-chat-context.md §6.1 · §6.2 · §6.3 입니다.
 * 값을 바꾸려면 여기가 아니라 정본을 먼저 고칩니다.
 */

import { describe, expect, it } from 'vitest'

import type { CitationInput } from './contract'
import { createCitationChecker } from './index'

const checker = createCitationChecker()

/** 이번 턴에 서버가 붙인 번호 — 절차 둘, 사건 정보 하나, 사건 대화 한 줄 */
const ISSUED: readonly string[] = ['kb-1', 'kb-2', 'case-3', 't-15']

function input(over: Partial<CitationInput> = {}): CitationInput {
  return {
    reply: { insufficient: false, citations: [] },
    issued: ISSUED,
    kbResultEmpty: false,
    ...over,
  }
}

describe('insufficient 는 에러가 아니라 되묻기다', () => {
  it('조회는 됐는데 근거를 못 찾으면 슬롯 질문으로 넘긴다', () => {
    // §6.3 — 사건 정보가 부족하다는 신호이지 시스템 실패가 아니다
    expect(
      checker.check(input({ reply: { insufficient: true, citations: [] } })),
    ).toEqual({ kind: 'ask_slot' })
  })

  it('KB 조회가 0건이면 되물어도 안 나오므로 1332 안내다', () => {
    // §6.3 — 그 조합에 해당하는 절차가 KB 에 없다
    expect(
      checker.check(
        input({
          reply: { insufficient: true, citations: [] },
          kbResultEmpty: true,
        }),
      ),
    ).toEqual({ kind: 'guide_1332' })
  })

  it('insufficient 면 인용에 흠이 있어도 재시도하지 않는다', () => {
    // §6.3 — 같은 프롬프트로 다시 부르면 같은 답이 온다
    expect(
      checker.check(
        input({
          reply: {
            insufficient: true,
            citations: [{ ref: 'kb-99', why: '' }],
          },
        }),
      ),
    ).toEqual({ kind: 'ask_slot' })
  })
})

describe('인용이 비어 있는 것 자체는 위반이 아니다', () => {
  it('인사말처럼 인용할 것이 없는 답변은 통과한다', () => {
    // §6.1 — 「인용이 비면 에러」로 만들면 인사말에도 발동한다
    expect(checker.check(input())).toEqual({ kind: 'pass' })
  })

  it('KB 조회가 0건이어도 모델이 근거 부족을 밝히지 않았으면 통과다', () => {
    // 0건이면 프롬프트에 kb- 항목이 없으므로, 모델이 절차를 지어내
    // kb- 를 쓰면 unknown_ref 로 걸린다. 그 방어로 충분하다 → §6.4
    expect(
      checker.check(input({ kbResultEmpty: true, issued: ['case-3'] })),
    ).toEqual({ kind: 'pass' })
  })
})

describe('1. 발급하지 않은 번호는 지어낸 참조다', () => {
  it('발급 목록에 없는 ref 를 쓰면 재시도로 보낸다', () => {
    expect(
      checker.check(
        input({
          reply: {
            insufficient: false,
            citations: [{ ref: 'kb-9', why: '썼습니다' }],
          },
        }),
      ),
    ).toEqual({
      kind: 'retry',
      violations: [{ rule: 'unknown_ref', ref: 'kb-9' }],
    })
  })

  it('ref 가 아예 없으면 지어낸 참조로 본다', () => {
    expect(
      checker.check(
        input({
          reply: { insufficient: false, citations: [{ why: '썼습니다' }] },
        }),
      ),
    ).toEqual({
      kind: 'retry',
      violations: [{ rule: 'unknown_ref', ref: '' }],
    })
  })

  it('적용 묶음과 참고 묶음 모두 인용할 수 있다', () => {
    // §6.2 — 허용 집합 = applied ∪ reference
    expect(
      checker.check(
        input({
          reply: {
            insufficient: false,
            citations: [
              { ref: 'kb-1', why: '지급정지 요청처를 안내하는 데 썼습니다' },
              { ref: 'kb-2', why: '다음 단계가 신청서라고 안내하는 데 썼습니다' },
            ],
          },
        }),
      ),
    ).toEqual({ kind: 'pass' })
  })

  it('사건 정보와 사건 대화도 인용할 수 있다', () => {
    // 절차만 검사하면 없는 계좌번호를 말해도 안 잡힌다 → §3.4
    expect(
      checker.check(
        input({
          reply: {
            insufficient: false,
            citations: [
              { ref: 'case-3', why: '8월 20일이라는 날짜를 옮기는 데 썼습니다' },
              { ref: 't-15', why: '상대가 검사를 사칭했다는 대목에 썼습니다' },
            ],
          },
        }),
      ),
    ).toEqual({ kind: 'pass' })
  })
})

describe('2. why 가 비면 형식 위반이다', () => {
  it('why 가 없으면 걸린다', () => {
    expect(
      checker.check(
        input({
          reply: { insufficient: false, citations: [{ ref: 'case-3' }] },
        }),
      ),
    ).toEqual({
      kind: 'retry',
      violations: [{ rule: 'why_empty', ref: 'case-3' }],
    })
  })

  it('why 가 빈 문자열이면 걸린다', () => {
    expect(
      checker.check(
        input({
          reply: {
            insufficient: false,
            citations: [{ ref: 'case-3', why: '' }],
          },
        }),
      ),
    ).toEqual({
      kind: 'retry',
      violations: [{ rule: 'why_empty', ref: 'case-3' }],
    })
  })

  it('why 가 공백뿐이어도 걸린다', () => {
    expect(
      checker.check(
        input({
          reply: {
            insufficient: false,
            citations: [{ ref: 'case-3', why: '   \n  ' }],
          },
        }),
      ),
    ).toEqual({
      kind: 'retry',
      violations: [{ rule: 'why_empty', ref: 'case-3' }],
    })
  })

  it('내용이 그럴듯하기만 한 why 는 통과한다 — 검사로 잡지 않는다', () => {
    // §5.1 — 서버는 비었는지만 본다. 과잉 인용은 「어떻게 썼는지를 쓰게 하는 것」으로
    // 억제하고 검사로 잡지 않는다
    expect(
      checker.check(
        input({
          reply: {
            insufficient: false,
            citations: [{ ref: 'case-3', why: '기한이 중요하기 때문' }],
          },
        }),
      ),
    ).toEqual({ kind: 'pass' })
  })
})

describe('위반을 모아서 보고한다', () => {
  it('여러 항목이 각각 다른 규칙을 어기면 전부 담는다', () => {
    // 재생성 프롬프트에 무엇이 틀렸는지 다 알려줘야 한 번에 고쳐진다
    const outcome = checker.check(
      input({
        reply: {
          insufficient: false,
          citations: [
            { ref: 'kb-9', why: '썼습니다' },
            { ref: 'case-3', why: '' },
          ],
        },
      }),
    )

    expect(outcome).toEqual({
      kind: 'retry',
      violations: [
        { rule: 'unknown_ref', ref: 'kb-9' },
        { rule: 'why_empty', ref: 'case-3' },
      ],
    })
  })

  it('발급 안 된 번호는 why 까지 따지지 않는다', () => {
    // 없는 번호라 대조할 발급값 자체가 없다. unknown_ref 하나로 끝낸다
    const outcome = checker.check(
      input({
        reply: {
          insufficient: false,
          citations: [{ ref: 'kb-9' }],
        },
      }),
    )

    expect(outcome).toEqual({
      kind: 'retry',
      violations: [{ rule: 'unknown_ref', ref: 'kb-9' }],
    })
  })
})
