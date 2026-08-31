/**
 * 답 하나를 받는 흐름 시험 — **못 알아들은 답을 「받았다」로 닫지 않는가.**
 *
 * 검증 대상: spec/common/08-14-api.md §3.5 · spec/backend/08-16-data-model.md §4 §4.1 §11.4.4 ①
 *            spec/backend/08-14-channel-matrix.md · spec/backend/08-14-slot-tiering.md
 * 근거: ADR-040(쓰기도 경계를 지난다) · ADR-041(거부 대신 되묻기) ·
 *       CLAUDE.md 불변 규칙 5(「모름」은 실패가 아니다)
 *
 * **여기서 못 박는 것 넷:**
 * 1. 표에 있는 라벨은 `case_channel` 까지 간다 — 슬롯 문자열만 남기지 않는다
 * 2. **표에 없는 라벨은 슬롯을 아예 안 쓴다** — 그래야 같은 문항이 다시 나온다
 * 3. 기관을 사전에서 못 고르면 값은 남기고 `extracted` 로 둔다 (§11.4.4 ①)
 * 4. 「아니에요」(`keep`)도 ①~③ 과 **같은 자리를 지난다**
 *
 * ## 왜 저장소 대역이 쓴 것을 되읽나
 *
 * 이 파일이 확인하려는 것은 「안 썼다」가 아니라 **「안 써서 다시 묻는다」**입니다.
 * 쓰기와 읽기를 따로 두면 `slotWrite` 를 안 부른 것까지만 보이고, 정작 되묻기가
 * 실제로 도는지는 확인할 수 없습니다 — 그래서 대역이 쓴 슬롯이 `readSlots` 에
 * 그대로 비치게 두고, `slot-checker` 를 진짜로 태웁니다.
 */

import { describe, expect, it } from 'vitest'

import { createContainer, unconfiguredPorts, type Container, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import type { ChannelWriter, OrgCandidateRow, SlotWriter } from '@/lib/db'
import type { SlotKey, SlotState, SlotTier } from '@/modules/slot-checker'

import { afterAnswer, answerSlot } from './answer-slot'
import type { CasePlanStore, StoredSlot } from './regenerate-plan'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** 표 안의 라벨 하나 — `lib/questions.ts` 의 `CHANNEL_CHOICES` 첫 줄 그대로 */
const IN_TABLE = '시중은행 계좌이체'

/**
 * 표에 **없는** 라벨.
 *
 * 지어낸 값이 아니라 **화면 밖에서 오는 값**입니다 — 챗 답변·옛 화면·직접 호출.
 * 글자 하나가 달라도 `channelForOption` 은 `undefined` 이고, 그때가 이 파일이
 * 보는 자리입니다.
 */
const OFF_TABLE = '은행 계좌이체'

/** 그 유형의 기관 사전 — 되물을 선택지가 여기서 나옵니다 → §11.4.4 ① */
const ORGS: readonly OrgCandidateRow[] = [
  { orgId: 'kb-bank', name: 'KB국민은행', aliases: ['국민은행'] },
  { orgId: 'shinhan-bank', name: '신한은행', aliases: ['신한'] },
]

type SlotWrite = Parameters<SlotWriter['write']>[0]
type ChannelWrite = Parameters<ChannelWriter['write']>[0]

/** 감사 기록만 받아 두고, KB 는 빈 묶음으로 답합니다 — 이 파일이 보는 것은 슬롯 쪽입니다 */
function portsWith(over: Partial<Ports>): Ports {
  const env = readEnv({})
  return {
    ...unconfiguredPorts(env),
    auditStore: { lastHash: async () => null, append: async () => {} },
    // **미설정 대역이면 `recordChannel` 의 `try` 가 삼킵니다** — 기관을 못 고른
    // 것과 조회가 터진 것이 한 결과로 뭉개져, 되묻기 시험이 조용히 통과합니다
    kbVersion: { current: async () => '2026.08.1' },
    kbStore: { findApplied: async () => [], findReference: async () => [] },
    ...over,
  } as Ports
}

interface Harness {
  readonly container: Container
  /** `slotWrite.write` 가 받은 것 전부. **빈 배열이 「안 썼다」입니다** */
  readonly slotWrites: readonly SlotWrite[]
  readonly channelWrites: readonly ChannelWrite[]
}

/**
 * 사건 하나의 상태를 들고 있는 대역.
 *
 * 슬롯·유형 쓰기가 **읽기에 그대로 비칩니다** — 위 「왜 되읽나」 참고.
 */
function harness(
  base: {
    /** 답하기 전에 이미 채워져 있던 슬롯 */
    readonly slots?: readonly StoredSlot[]
    /** 이미 특정된 유형. `org_name` 은 이것이 있어야 후보를 좁힙니다 */
    readonly channel?: { readonly channelId: string; readonly orgId: string | null } | null
    /** 그 유형의 기관 사전. 비면 되묻지 않습니다 */
    readonly orgs?: readonly OrgCandidateRow[]
    /** 브라우저가 볼트에 맡겨 둔 이름표 — **값이 아니라 번호만** 옵니다 */
    readonly vaultTokens?: readonly string[]
    /** 서버가 앞서 전사문에 붙인 이름표가 박혀 있는 줄 */
    readonly transcript?: readonly { speaker: string; text: string }[]
  } = {},
): Harness {
  const slotWrites: SlotWrite[] = []
  const channelWrites: ChannelWrite[] = []
  const written = new Map<string, StoredSlot>()

  const slotWrite: SlotWriter = {
    async write(input) {
      slotWrites.push(input)
      written.set(input.slotKey, {
        slotKey: input.slotKey as SlotKey,
        tier: input.tier as SlotTier,
        state: input.state as SlotState,
      })
    },
  }

  const channelWrite: ChannelWriter = {
    async write(input) {
      channelWrites.push(input)
    },
    async candidates() {
      return base.orgs ?? ORGS
    },
    /**
     * **가리지 말 이름** — 경유 서비스가 아닌 기관입니다. 이 파일이 보는 것은
     * 슬롯 쪽이라 빈 목록으로 둡니다 (origin/main 에서 넓어진 칸)
     */
    async allPublicNames(): Promise<readonly string[]> {
      return []
    },

    async allCandidates() {
      return base.orgs ?? ORGS
    },
  }

  const store: CasePlanStore = {
    async readCase() {
      return { track: 'victim' as const }
    },
    async readSlots() {
      const merged = new Map((base.slots ?? []).map((one) => [one.slotKey as string, one]))
      for (const [key, one] of written) merged.set(key, one)
      return [...merged.values()]
    },
    async readChannel() {
      // **방금 적힌 줄이 이깁니다** — `case_channel` 은 쌓이고 읽는 쪽이 확신
      // 높은 것을 고릅니다(§4). 사용자가 직접 고른 답이 확신 1.00 입니다
      const last = channelWrites.at(-1)
      if (last) return { channelId: last.channelId, orgId: last.orgId }
      return base.channel ?? null
    },
    async readChannels() {
      return []
    },
    async readSteps() {
      return []
    },
    async applyPlan() {
      return []
    },
    async openCase() {
      return []
    },
  }

  const container: Container = {
    ...createContainer(readEnv({}), portsWith({ casePlan: store })),
    slotWrite,
    channelWrite,
    // 기한은 이 파일이 보는 것이 아닙니다 → compute-deadlines.test.ts
    slots: { read: async () => [] },
    deadlineWrite: { apply: async () => [], sweepOverdue: async () => 0 },
    // ── 이름표 장부 → 04-pii-boundary.md 「번호의 단위」 ──────────────
    // 답을 토큰화할 때 **이미 쓰인 번호를 이어받는** 자리입니다. 기본은 비어
    // 있어 1번부터이고, 이어받는지를 보는 시험이 이 둘을 바꿔 넣습니다
    vaultWrite: {
      put: async () => 0,
      list: async () => [],
      tokens: async () => base.vaultTokens ?? [],
    },
    messages: {
      write: async () => {},
      history: async () => [],
      transcript: async () => base.transcript ?? [],
      turns: async () => ({ turns: [], truncated: false }),
    },
    // **장부는 여기서 읽습니다** — 전사문만이 아니라 챗·슬롯·부산물까지
    maskedTexts: { all: async () => (base.transcript ?? []).map((one) => one.text) },
  }

  return { container, slotWrites, channelWrites }
}

/** 이미 「돈이 나갔다」에 답한 상태 — 다음 문항이 `channel` 인 자리입니다 */
const TRANSFERRED: readonly StoredSlot[] = [
  { slotKey: 'transferred', tier: 'T1', state: 'confirmed' },
]

describe('표에 있는 라벨 — 유형이 적히고 슬롯이 닫힌다', () => {
  it('`case_channel` 에 유형 코드가 간다', async () => {
    // 라벨 문자열이 슬롯에만 남으면 유형별 KB 가 조회에 안 걸립니다 (§11.2 2순위)
    const one = harness()

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: IN_TABLE },
      one.container,
    )

    expect(one.channelWrites).toEqual([
      { caseId: CASE_ID, channelId: 'CH-bank', orgId: null, orgNameRaw: null, source: 'user' },
    ])
  })

  it('슬롯이 confirmed 로 저장된다 — 티어와 값 종류까지', async () => {
    const one = harness()

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: IN_TABLE },
      one.container,
    )

    expect(got.state).toBe('confirmed')
    // 티어·값 종류의 정본은 `slot-checker` 하나입니다 — 여기서 따로 들면 어긋납니다
    expect(one.slotWrites).toHaveLength(1)
    expect(one.slotWrites[0]).toMatchObject({
      slotKey: 'channel',
      tier: 'T1',
      valueType: 'enum',
      state: 'confirmed',
      valueMasked: IN_TABLE,
      source: 'user',
    })
  })

  it('플랜을 다시 만든다', async () => {
    const one = harness()

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: IN_TABLE },
      one.container,
    )

    expect(got.planRegenerated).toBe(true)
    expect(got.value).toBe(IN_TABLE)
  })
})

describe('표에 없는 라벨 — 값을 안 남기고 다시 묻는다', () => {
  /**
   * ⚠️ **2026-08-27 까지 여기가 `confirmed` 였습니다.** `channel` 은 T1 이라
   * 그 상태가 채워진 것으로 세어져(`tierStatus`) `needsSupersetPlan` 이 거짓이
   * 되고, 참고 묶음이 통째로 버려져 T0 공통 단계만 남았습니다 — 그러고도
   * 다시 묻지 않았으니 **「모름」을 누른 것보다 나쁩니다.**
   */
  it('슬롯을 아예 안 쓴다', async () => {
    const one = harness()

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: OFF_TABLE },
      one.container,
    )

    expect(one.slotWrites).toHaveLength(0)
  })

  it('`case_channel` 에도 안 적는다 — 표 밖의 값을 만들지 않습니다', async () => {
    const one = harness()

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: OFF_TABLE },
      one.container,
    )

    expect(one.channelWrites).toHaveLength(0)
  })

  it('상태가 empty 이고 플랜을 다시 만들지 않는다', async () => {
    const one = harness()

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: OFF_TABLE },
      one.container,
    )

    expect(got).toMatchObject({
      slotKey: 'channel',
      state: 'empty',
      value: null,
      piiConfirm: null,
      planRegenerated: false,
    })
  })

  it('같은 문항이 버튼으로 다시 나온다', async () => {
    // **되묻기가 실제로 도는지를 봅니다** — 안 쓴 것까지만 보면 사용자가
    // 아무 말도 못 들은 채 유형 기본 절차로 떨어지는 것을 못 잡습니다.
    // 라우트도 `planRegenerated` 를 그대로 넘깁니다 (slots/[slot_key]/route.ts)
    const one = harness({ slots: TRANSFERRED })

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: OFF_TABLE },
      one.container,
    )
    const after = await afterAnswer(CASE_ID, one.container, got.planRegenerated)

    expect(after.nextQuestion?.slotKey).toBe('channel')
    // 버튼은 반드시 표 안의 라벨이라 **다음 답에서 확정됩니다** — 되풀이가
    // 구조적으로 안 생깁니다
    expect(after.nextQuestion?.input).toBe('buttons')
    expect(after.nextQuestion?.options).toContain(IN_TABLE)
  })

  it('알아본 라벨이었으면 그 문항은 안 나온다', async () => {
    const one = harness({ slots: TRANSFERRED })

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'answer', value: IN_TABLE },
      one.container,
    )
    const after = await afterAnswer(CASE_ID, one.container, got.planRegenerated)

    // **다음 슬롯으로 넘어가는 것까지 봅니다.** 「`channel` 이 아니다」만 보면
    // 물을 것이 없어 `null` 이 된 경우와 구분되지 않습니다
    expect(after.nextQuestion?.slotKey).toBe('org_name')
  })
})

describe('기관을 사전에서 못 고르면 확인 전으로 둔다 — §11.4.4 ①', () => {
  const bankCase = { channel: { channelId: 'CH-bank', orgId: null } }

  it('값은 남기고 상태만 extracted 다', async () => {
    // **유형과 다르게 다룹니다.** 사용자가 그렇게 말한 것은 사실이라 값은
    // 남고, 어느 곳인지가 확인 전입니다 — 되묻기는 선택지로 갑니다
    const one = harness(bankCase)

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'org_name', action: 'answer', value: '우리동네은행' },
      one.container,
    )

    expect(got.state).toBe('extracted')
    expect(got.value).toBe('우리동네은행')
    expect(one.slotWrites[0]).toMatchObject({
      slotKey: 'org_name',
      tier: 'T2',
      valueType: 'string',
      state: 'extracted',
    })
  })

  it('그래도 유형은 적습니다 — 유형 기본 절차는 그대로 나갑니다', async () => {
    const one = harness(bankCase)

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'org_name', action: 'answer', value: '우리동네은행' },
      one.container,
    )

    expect(one.channelWrites[0]).toMatchObject({
      channelId: 'CH-bank',
      orgId: null,
      orgNameRaw: '우리동네은행',
    })
  })

  it('사전에서 고르면 confirmed 이고 `org_id` 가 함께 간다', async () => {
    const one = harness(bankCase)

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'org_name', action: 'answer', value: '국민은행' },
      one.container,
    )

    expect(got.state).toBe('confirmed')
    expect(one.channelWrites[0]).toMatchObject({ orgId: 'kb-bank' })
  })

  it('그 유형에 사전이 아직 없으면 되묻지 않는다', async () => {
    // 물어도 사용자가 고를 것이 없습니다 — 「사전에 없어서 못 찾은 것」과
    // 「잘못 들어서 못 찾은 것」이 구분되지 않습니다
    const one = harness({ ...bankCase, orgs: [] })

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'org_name', action: 'answer', value: '우리동네은행' },
      one.container,
    )

    expect(got.state).toBe('confirmed')
  })

  it('유형을 아직 모르면 되묻지 않는다 — 유형 문항이 먼저입니다', async () => {
    const one = harness({ channel: null })

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'org_name', action: 'answer', value: '우리동네은행' },
      one.container,
    )

    expect(got.state).toBe('confirmed')
    expect(one.channelWrites).toHaveLength(0)
  })
})

describe('「아니에요」(keep)도 같은 판정을 지난다', () => {
  /**
   * ⚠️ **2026-08-27 까지 이 경로만 무조건 `confirmed` 였습니다.** 과차단을 푸는
   * 답 하나가 되묻기를 통째로 건너뛰었습니다 — 갈래를 하나 더 만들면 그 갈래만
   * 조용히 옛 동작으로 남습니다.
   */
  it('표에 없는 채널 라벨은 keep 으로 와도 안 쓴다', async () => {
    const one = harness()

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'keep', value: OFF_TABLE },
      one.container,
    )

    expect(one.slotWrites).toHaveLength(0)
    expect(one.channelWrites).toHaveLength(0)
    expect(got).toMatchObject({ state: 'empty', value: null, planRegenerated: false })
  })

  it('못 고른 기관은 keep 으로 와도 extracted 다', async () => {
    const one = harness({ channel: { channelId: 'CH-bank', orgId: null } })

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'org_name', action: 'keep', value: '우리동네은행' },
      one.container,
    )

    expect(got.state).toBe('extracted')
    expect(one.slotWrites[0]).toMatchObject({ slotKey: 'org_name', state: 'extracted' })
  })

  it('표에 있는 라벨은 keep 으로도 confirmed 다', async () => {
    const one = harness()

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'keep', value: IN_TABLE },
      one.container,
    )

    expect(got.state).toBe('confirmed')
    expect(one.channelWrites[0]).toMatchObject({ channelId: 'CH-bank' })
  })
})

describe('「모름」은 실패가 아니다 — 불변 규칙 5', () => {
  it('상태가 unknown 이고 값이 없다', async () => {
    const one = harness()

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'channel', action: 'unknown' },
      one.container,
    )

    expect(got).toMatchObject({ state: 'unknown', value: null, planRegenerated: false })
    expect(one.slotWrites[0]).toMatchObject({ state: 'unknown', valueMasked: null })
  })

  it('유형을 적지 않는다 — 「모름」은 값이 아니라 상태입니다', async () => {
    const one = harness()

    await answerSlot({ caseId: CASE_ID, slotKey: 'channel', action: 'unknown' }, one.container)

    expect(one.channelWrites).toHaveLength(0)
  })

  it('다시 묻지 않는다 — 질문 대상은 empty 뿐입니다', async () => {
    const one = harness({ slots: TRANSFERRED })

    await answerSlot({ caseId: CASE_ID, slotKey: 'channel', action: 'unknown' }, one.container)
    const after = await afterAnswer(CASE_ID, one.container, false)

    expect(after.nextQuestion?.slotKey).toBe('org_name')
  })
})

/**
 * 서버가 붙이는 이름표의 번호는 **사건 하나**를 단위로 합니다
 * → 04-pii-boundary.md 「번호의 단위」.
 *
 * ⚠️ **2026-08-30 까지 이 자리가 호출마다 1번부터였습니다.** 챗에서 본인 계좌에
 * 붙은 `[계좌-1]` 이 볼트에 있는데 여기서도 `[계좌-1]` 을 붙여, **다른 계좌인데
 * 같은 이름표**가 됐습니다 — 브라우저는 자기 표로 복원하므로 슬롯 칸에
 * 엉뚱한 계좌가 그려집니다.
 */
describe('이름표 번호가 사건 안에서 안 겹친다', () => {
  /** 사기범 계좌 — 사용자가 문진 칸에 직접 타이핑한 값입니다 */
  const THEIRS = '222-333-444444'

  it('볼트가 쓴 번호 다음부터 붙인다', async () => {
    // 브라우저가 챗에서 본인 계좌에 `[계좌-1]` 을 붙여 맡겨 뒀습니다.
    // **원문은 안 옵니다** — 서버는 볼트를 못 엽니다
    const one = harness({ vaultTokens: ['[계좌-1]'] })

    const got = await answerSlot(
      { caseId: CASE_ID, slotKey: 'counterpart_account', action: 'answer', value: THEIRS },
      one.container,
    )

    // 확인 전이라 값은 안 나갑니다(ADR-041). 표에 적힌 것을 봅니다
    expect(got.state).toBe('pii_pending')
    expect(one.slotWrites[0].valueMasked).toBe('[계좌-2]')
    expect(got.piiConfirm?.found).toEqual([{ kind: '계좌', text: '[계좌-2]' }])
  })

  it('전사문이 쓴 번호도 이어받는다 — 그건 볼트에 없습니다', async () => {
    const one = harness({
      transcript: [{ speaker: 'A', text: '[계좌-1] 로 보내라고 했어요' }],
    })

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'counterpart_account', action: 'answer', value: THEIRS },
      one.container,
    )

    expect(one.slotWrites[0].valueMasked).toBe('[계좌-2]')
  })

  it('「아니에요」로 와도 이어받는다 — 그 갈래만 1번부터가 되면 안 됩니다', async () => {
    const one = harness({ vaultTokens: ['[계좌-1]', '[계좌-2]'] })

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'counterpart_account', action: 'keep', value: THEIRS },
      one.container,
    )

    // 계좌는 정규식이 잡은 것이라 「아니에요」로도 안 풀립니다(ADR-041 ④)
    expect(one.slotWrites[0].valueMasked).toBe('[계좌-3]')
  })

  /** **회귀** — 장부가 비면 지금까지처럼 1번부터입니다 */
  it('장부가 비면 1번부터', async () => {
    const one = harness()

    await answerSlot(
      { caseId: CASE_ID, slotKey: 'counterpart_account', action: 'answer', value: THEIRS },
      one.container,
    )

    expect(one.slotWrites[0].valueMasked).toBe('[계좌-1]')
  })
})
