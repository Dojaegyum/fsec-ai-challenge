/**
 * 진술에서도 값을 뽑는다 — ADR-087.
 *
 * 검증 대상: spec/backend/08-14-slot-tiering.md 「진술에서 뽑은 값」 ·
 *            [ADR-069](../../decisions/069-evidence-slot-extraction.md) ·
 *            [ADR-087](../../decisions/087-statement-slot-extraction.md)
 *
 * ## 왜 이 파일이 생겼나
 *
 * 2026-09-06 QA 에서 사용자가 첫 진술에 「국민은행 [계좌-1] 로 300만원을 보냈습니다」라고
 * 적었는데 **금액은 「모름」으로 남았습니다.** 추출기는 자료(전사·OCR)에만 걸려 있었고,
 * 사람이 직접 타이핑한 문장은 아무도 안 읽었습니다.
 *
 * **여기서 못 박는 것 넷:**
 * 1. 진술에서 뽑은 값은 `extracted` 이고 `source_ref` 는 **메시지 번호**다
 * 2. 이미 `confirmed` 인 슬롯은 안 덮는다 — 자료 추출과 같은 그물
 * 3. 모델이 보는 것은 **가려진 발화**뿐이다 (불변 규칙 2)
 * 4. 추출이 실패해도 **던지지 않는다** (불변 규칙 5)
 */

import { describe, expect, it } from 'vitest'

import type { Container } from '@/lib/container'

import { extractSlotsFrom } from './extract-slots'
import { fakeSlotContainer } from './test-container'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const MESSAGE_ID = '01J8XKRE000000000000000000'

/** QA 에서 실제로 들어온 첫 진술 — 계좌는 브라우저가 이미 가렸습니다 */
const SAID = '국민은행 [계좌-1] 로 300만원을 보냈습니다'

const said = (container: Container, text = SAID) =>
  extractSlotsFrom(
    { caseId: CASE_ID, sourceRef: MESSAGE_ID, sourceLabel: '사용자 진술', text },
    container,
  )

describe('진술에서 뽑은 값도 확인 전으로 둔다 — ADR-087', () => {
  it('금액을 뽑아 extracted 로 두고 source_ref 에 메시지 번호를 적는다', async () => {
    const fake = fakeSlotContainer({
      reply: () => ({ slots: [{ slot_key: 'amount', value: '300만원', confidence: 0.9 }] }),
    })

    await said(fake.container)

    expect(fake.wrote).toEqual([
      expect.objectContaining({
        caseId: CASE_ID,
        slotKey: 'amount',
        tier: 'T2',
        state: 'extracted',
        // 사람이 문진에서 답한 것과 같은 모양입니다 — 원 단위 정수
        valueMasked: '3000000',
        source: 'auto',
        sourceRef: MESSAGE_ID,
      }),
    ])
  })

  it('모델이 보는 것은 가려진 발화뿐이고, 첫 줄이 「사용자 진술」이다', async () => {
    const fake = fakeSlotContainer({ reply: () => ({ slots: [] }) })

    await said(fake.container)

    expect(fake.prompts).toHaveLength(1)
    expect(fake.prompts[0]).toContain('사용자 진술')
    expect(fake.prompts[0]).toContain('[계좌-1]')
    // 자료 쪽의 「자료 종류: …」가 진술에 붙으면 모델이 캡처를 읽는 줄 압니다
    expect(fake.prompts[0]).not.toContain('자료 종류')
  })

  it('상대 계좌는 발화에 실제로 있는 토큰일 때만 받는다', async () => {
    const fake = fakeSlotContainer({
      reply: () => ({
        slots: [
          { slot_key: 'counterpart_account', value: '[계좌-1]', confidence: 0.9 },
          // 발화에 없는 번호 — 지어낸 계좌가 서류에 적히면 남의 계좌가 됩니다
          { slot_key: 'victim_account', value: '[계좌-9]', confidence: 0.9 },
        ],
      }),
    })

    await said(fake.container)

    expect(fake.wrote.map((one) => one.slotKey)).toEqual(['counterpart_account'])
  })

  it('이미 confirmed 인 슬롯은 덮지 않는다 — 자료 추출과 같은 그물', async () => {
    const fake = fakeSlotContainer({
      already: [
        { slotKey: 'amount', state: 'confirmed', valueMasked: '5000000' },
        { slotKey: 'counterpart_account', state: 'unknown', valueMasked: null },
      ],
      reply: () => ({
        slots: [
          { slot_key: 'amount', value: '300만원', confidence: 0.9 },
          { slot_key: 'counterpart_account', value: '[계좌-1]', confidence: 0.9 },
        ],
      }),
    })

    await said(fake.container)

    // 「모름」은 채우고, 사람이 확정한 값은 그대로 둡니다
    expect(fake.wrote.map((one) => one.slotKey)).toEqual(['counterpart_account'])
  })

  /**
   * ⚠️ **미룬 쓰기가 방금 받은 확인을 되돌릴 수 있습니다.**
   *
   * 슬롯 쓰기는 `state = EXCLUDED.state` 로 덮어씁니다(`lib/db.ts`). 챗 응답에 그 슬롯의
   * 확인 문항이 함께 실려 나가면, 사용자의 「맞아요」(§3.5 `PATCH /slots`)가 **모델이 답하는
   * 몇 초 사이에** 도착합니다. 부르기 전에 뜬 그물만 들고 있으면 그 뒤에 적어 `confirmed` 를
   * `extracted` 로 — 그것도 **다른 값으로** — 되돌립니다. 그래서 **부른 뒤에 한 번 더 읽습니다.**
   */
  it('모델을 부르는 동안 확정된 값은 덮지 않는다 — 부르기 전후로 두 번 읽는다', async () => {
    const fake = fakeSlotContainer({
      already: (read) =>
        read === 1
          ? // 부르기 전: 아직 확인 전이라 추출기의 `known` 에도 안 들어갑니다
            [{ slotKey: 'amount', state: 'extracted', valueMasked: '3000000' }]
          : // 부른 뒤: 그 사이에 「맞아요」가 도착했습니다
            [{ slotKey: 'amount', state: 'confirmed', valueMasked: '3000000' }],
      reply: () => ({ slots: [{ slot_key: 'amount', value: '32,000,000원', confidence: 0.95 }] }),
    })

    await said(fake.container)

    expect(fake.reads()).toBe(2)
    expect(fake.wrote).toEqual([])
  })

  /**
   * ⚠️ **거절한 값이 되살아나던 자리.**
   *
   * 「아니에요, 다시 적을게요」는 슬롯을 `state: 'empty'` · `source: 'user'` 로 비웁니다
   * (`answer-slot.ts` 의 `rejectHeld`). 그런데 아래 그물이 `confirmed` 만 보고 있어서,
   * 다음 발화나 두 번째 자료의 추출이 **같은 값을 다시 `extracted` 로** 적었고 같은
   * 되묻기가 다시 떴습니다 — 사용자가 아니라고 말한 값을 계속 다시 묻는 것입니다.
   *
   * 그 조합을 만드는 자리는 거절 하나뿐입니다(`grep "state: 'empty'"` — 나머지 한 곳은
   * 아무것도 안 쓰고 돌아갑니다).
   */
  it('사용자가 거절한 값은 다시 뽑지 않는다 — empty + user', async () => {
    const fake = fakeSlotContainer({
      already: [{ slotKey: 'amount', state: 'empty', valueMasked: null, source: 'user' }],
      reply: () => ({ slots: [{ slot_key: 'amount', value: '300만원', confidence: 0.9 }] }),
    })

    await said(fake.container)

    expect(fake.wrote).toEqual([])
  })

  it('자동으로 비워진 것은 그대로 채운다 — 거절이 아닙니다', async () => {
    const fake = fakeSlotContainer({
      already: [{ slotKey: 'amount', state: 'empty', valueMasked: null, source: 'auto' }],
      reply: () => ({ slots: [{ slot_key: 'amount', value: '300만원', confidence: 0.9 }] }),
    })

    await said(fake.container)

    expect(fake.wrote.map((one) => one.slotKey)).toEqual(['amount'])
  })

  it('모델을 부르는 동안 거절이 도착해도 안 덮는다 — 부른 뒤 그물이 봅니다', async () => {
    const fake = fakeSlotContainer({
      already: (read) =>
        read === 1
          ? [{ slotKey: 'amount', state: 'extracted', valueMasked: '3000000', source: 'auto' }]
          : // 그 사이에 「아니에요, 다시 적을게요」가 도착했습니다
            [{ slotKey: 'amount', state: 'empty', valueMasked: null, source: 'user' }],
      reply: () => ({ slots: [{ slot_key: 'amount', value: '32,000,000원', confidence: 0.95 }] }),
    })

    await said(fake.container)

    expect(fake.wrote).toEqual([])
  })

  it('확신이 낮으면 버린다 — 임계값 0.7 (ADR-069 ③)', async () => {
    const fake = fakeSlotContainer({
      reply: () => ({ slots: [{ slot_key: 'amount', value: '300만원', confidence: 0.4 }] }),
    })

    await said(fake.container)

    expect(fake.wrote).toEqual([])
  })

  it('빈 발화면 모델을 아예 안 부른다 — 되묻기 답 한 글자에 값을 치르지 않는다', async () => {
    const fake = fakeSlotContainer({ reply: () => ({ slots: [] }) })

    await said(fake.container, '   ')

    expect(fake.prompts).toEqual([])
    expect(fake.wrote).toEqual([])
  })

  it('모델이 안 떠도 던지지 않는다 — 추출 실패는 진행을 막지 않는다 (불변 규칙 5)', async () => {
    const container = {
      ports: {
        llm: {
          completeText: async () => {
            throw new Error('모델이 안 떴습니다')
          },
        },
      },
      slots: { read: async () => [] },
      slotWrite: {
        write: async () => {
          throw new Error('불리면 안 됩니다')
        },
      },
    } as unknown as Container

    await expect(said(container)).resolves.toBeUndefined()
  })
})
