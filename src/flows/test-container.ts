/**
 * 슬롯 추출만 보는 가짜 컨테이너 — **시험 전용입니다.** 앱 코드가 부르지 않습니다.
 *
 * `extract-slots.ts` 가 컨테이너에서 읽는 것은 셋뿐입니다 — 모델(`ports.llm.completeText`) ·
 * 이미 적힌 슬롯(`slots.read`) · 적는 자리(`slotWrite.write`). 그 셋을 여기 한 번만
 * 짓고, **자료 쪽**(`read-evidence.test.ts`)과 **진술 쪽**(`extract-slots.test.ts`)이
 * 같은 것을 씁니다 — 두 벌로 두면 한쪽만 고쳐져 「자료에서는 걸러지는데 진술에서는
 * 안 걸러지는」 자리가 시험에서만 안 보이게 됩니다.
 *
 * 자료 쪽은 컨테이너가 훨씬 큽니다(전사기·토큰화기·저장소). 그래서 통째로 주지 않고
 * **세 칸을 따로 냅니다** — 부르는 쪽이 자기 컨테이너의 그 자리만 갈아끼웁니다.
 */

import type { Container } from '@/lib/container'
import type { SlotWriteInput } from '@/lib/db'

/** 이미 적혀 있는 슬롯 — 흐름이 읽는 것은 `slotKey`·`state` 둘뿐입니다 */
export interface AlreadySlot {
  readonly slotKey: string
  readonly state: string
  readonly valueMasked: string | null
}

export interface SlotExtractionFake {
  /** `ports.llm` 자리에 얹습니다 — `ports` 를 통째로 덮지 않습니다(`kbVersion` 이 함께 있습니다) */
  readonly llm: { completeText(prompt: { system: string; user: string }): Promise<{ text: string }> }
  readonly slots: { read(): Promise<readonly AlreadySlot[]> }
  readonly slotWrite: { write(input: SlotWriteInput): Promise<void> }
  /** 위 셋만 든 컨테이너 — 추출 흐름을 홀로 부를 때 씁니다 */
  readonly container: Container
  /** `slotWrite.write` 가 받은 것. **빈 배열이 「아무것도 안 적었다」입니다** */
  readonly wrote: SlotWriteInput[]
  /** 추출기에 실제로 간 사용자 프롬프트 — 「모델이 무엇을 봤나」를 봅니다 */
  readonly prompts: string[]
}

export function fakeSlotContainer(base: {
  readonly already?: readonly AlreadySlot[]
  /** 모델이 낼 것. 객체를 주면 JSON 으로 싸서 냅니다 */
  readonly reply: (maskedText: string) => unknown
}): SlotExtractionFake {
  const wrote: SlotWriteInput[] = []
  const prompts: string[] = []

  const llm = {
    async completeText(prompt: { system: string; user: string }) {
      // 기관 교정(`repairOrgs`)은 사전이 비면 모델을 안 부릅니다 — 여기 오는 것은 추출뿐
      if (!prompt.system.includes('사실만 뽑아내는')) return { text: '' }
      prompts.push(prompt.user)
      return { text: JSON.stringify(base.reply(prompt.user)) }
    },
  }

  const slots = {
    async read() {
      return base.already ?? []
    },
  }

  const slotWrite = {
    async write(input: SlotWriteInput) {
      wrote.push(input)
    },
  }

  return {
    llm,
    slots,
    slotWrite,
    container: { ports: { llm }, slots, slotWrite } as unknown as Container,
    wrote,
    prompts,
  }
}
