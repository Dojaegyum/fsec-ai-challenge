/**
 * 전사문 토큰화 시험 — **증거가 둘이면 번호가 겹치는가.**
 *
 * 검증 대상: spec/common/08-14-pii-boundary.md 「번호의 단위」 · §3.3
 * 근거: ADR-009(매핑은 암호문으로 서버에) · ADR-027(키는 브라우저에만)
 *
 * ## 왜 이 파일이 생겼나
 *
 * `maskLines` 가 **증거 하나마다 `[계좌-1]` 부터** 다시 셌습니다. 그래서
 *
 * - 챗에서 본인 계좌 A 에 붙은 `[계좌-1]` 이 볼트에 있는데, 전사문의 사기범
 *   계좌 B 에도 `[계좌-1]` 이 붙었습니다 → 자료함이 **B 자리에 A 를 그립니다**
 * - 증거 1·2 의 `[계좌-1]` 이 서로 다른 계좌인데 **한 목록으로 매 턴 모델에**
 *   함께 들어갔습니다
 *
 * **여기서 못 박는 것 셋:**
 * 1. 볼트가 쓴 번호를 이어받는다 — 브라우저의 `[계좌-1]` 을 덮지 않는다
 * 2. 앞선 증거가 쓴 번호도 이어받는다 — 서버 이름표는 볼트에 없다
 * 3. 장부가 비면 1번부터다 (회귀)
 */

import { describe, expect, it } from 'vitest'

import type { Container } from '@/lib/container'

import { createPiiTokenizer } from '@/modules/pii-tokenizer'
import type { Line } from '@/modules/transcriber'

import { collectReading, maskLines } from './read-evidence'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'
const EVIDENCE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4B'
const KEY = `${CASE_ID}/${EVIDENCE_ID}`

/** 피해자 본인 계좌 — 브라우저가 챗에서 이미 `[계좌-1]` 로 맡긴 값입니다 */
const MINE = '110-234-567890'
/** 사기범이 불러 준 계좌 — 이번 전사문에 나옵니다 */
const THEIRS = '222-333-444444'

function lineOf(text: string): Line {
  return { speaker: 'A', speakerConfidence: null, text, at: null, pieces: [] }
}

const tokenizerOnly = { piiTokenizer: createPiiTokenizer() } as Pick<
  Container,
  'piiTokenizer'
>

describe('줄을 이어 세는 것은 이미 되고 있었다', () => {
  it('한 증거 안의 여러 줄이 번호를 잇는다', async () => {
    const got = await maskLines(
      [lineOf(`${MINE} 로 보냈어요`), lineOf(`${THEIRS} 도요`)],
      tokenizerOnly,
      [],
    )

    expect(got.lines.map((one) => one.text)).toEqual([
      '[계좌-1] 로 보냈어요',
      '[계좌-2] 도요',
    ])
  })
})

describe('장부를 이어받는다 — 증거 밖의 번호까지', () => {
  /**
   * ⚠️ **이 자리가 비어 있던 것이 사고 ①입니다.** 브라우저가 볼트에 맡긴
   * `[계좌-1]` 은 A 인데 전사문의 B 에도 `[계좌-1]` 이 붙어, 복원이
   * **B 자리에 A 를 그렸습니다**
   */
  it('볼트가 쓴 번호 다음부터 붙인다', async () => {
    const got = await maskLines(
      [lineOf(`${THEIRS} 로 보내라고 했어요`)],
      tokenizerOnly,
      [],
      // 값은 안 옵니다 — 서버는 볼트를 못 엽니다
      [{ token: '[계좌-1]', kind: '계좌', seq: 1 }],
    )

    expect(got.lines[0].text).toBe('[계좌-2] 로 보내라고 했어요')
  })

  /** **회귀** — 장부가 비면 지금까지처럼 1번부터입니다 */
  it('장부가 비면 1번부터', async () => {
    const got = await maskLines([lineOf(`${MINE} 요`)], tokenizerOnly, [], [])

    expect(got.lines[0].text).toBe('[계좌-1] 요')
  })
})

/** `collectReading` 이 그 장부를 **실제로 읽어 넘기는가** */
function harness(base: {
  readonly vaultTokens?: readonly string[]
  readonly transcripts?: readonly { speaker: string; text: string }[]
  readonly lines: readonly Line[]
}) {
  const finished: { transcriptMasked: string }[] = []

  const container = {
    piiTokenizer: createPiiTokenizer(),
    transcriber: {
      async collect() {
        return {
          status: 'done' as const,
          result: { lines: [...base.lines], shortfalls: [] },
        }
      },
    },
    // 제외 목록은 이 파일이 보는 것이 아닙니다 → `allowed-terms.test.ts`
    channelWrite: { allCandidates: async () => [], allPublicNames: async () => [] },
    ports: {
      kbVersion: { current: async () => '2026.08.1' },
      // 기관 교정은 안 봅니다 — `repairOrgs` 는 사전이 비면 모델을 안 부릅니다
      llm: { completeText: async () => ({ text: '' }) },
    },
    vaultWrite: {
      put: async () => 0,
      list: async () => [],
      tokens: async () => base.vaultTokens ?? [],
    },
    messages: {
      write: async () => {},
      history: async () => [],
      transcript: async () => base.transcripts ?? [],
      turns: async () => ({ turns: [], truncated: false }),
    },
    // **장부는 여기서 읽습니다** — 전사문만이 아니라 챗·슬롯·부산물까지
    maskedTexts: { all: async () => (base.transcripts ?? []).map((one) => one.text) },
    evidenceWrite: {
      async finish(one: { transcriptMasked: string }) {
        finished.push(one)
      },
      fail: async () => {},
    },
  } as unknown as Container

  return { container, finished }
}

const read = (one: ReturnType<typeof harness>) =>
  collectReading(
    { caseId: CASE_ID, evidenceId: EVIDENCE_ID, kind: 'audio', objectKey: KEY, stored: null },
    one.container,
  )

describe('흐름이 그 장부를 실제로 읽는다', () => {
  it('볼트의 이름표를 이어받는다', async () => {
    const one = harness({
      vaultTokens: ['[계좌-1]'],
      lines: [lineOf(`${THEIRS} 로 보내라고 했어요`)],
    })

    const got = await read(one)

    expect(got.status).toBe('done')
    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.lines[0].text).toBe('[계좌-2] 로 보내라고 했어요')
    // 저장되는 것도 같은 값입니다 — 챗이 이걸 맥락으로 씁니다
    expect(one.finished[0].transcriptMasked).toContain('[계좌-2]')
  })

  /**
   * ⚠️ **이것이 사고 ②입니다.** 서버가 붙인 이름표는 짝을 봉할 키가 없어
   * **볼트에 안 올라갑니다** — 볼트만 보면 증거 1 이 쓴 번호를 증거 2 가
   * 그대로 다시 씁니다
   */
  it('앞선 증거가 쓴 번호도 이어받는다 — 볼트에 없는 이름표', async () => {
    const one = harness({
      vaultTokens: [],
      transcripts: [{ speaker: 'A', text: '[계좌-1] 로 보내라고 했어요' }],
      lines: [lineOf(`${THEIRS} 도 불러줬어요`)],
    })

    const got = await read(one)

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.lines[0].text).toBe('[계좌-2] 도 불러줬어요')
  })

  it('둘 다 비면 1번부터 — 첫 증거', async () => {
    const one = harness({ lines: [lineOf(`${MINE} 요`)] })

    const got = await read(one)

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.lines[0].text).toBe('[계좌-1] 요')
  })
})

/**
 * ⚠️ **대응표를 그 자리에서 버리고 있었습니다** (2026-09-02).
 *
 * 토큰화는 **브라우저의 폴링 요청 안에서** 딱 한 번 일어납니다. 그 순간
 * `token ↔ 원문` 대응표가 메모리에 있는데, 아무에게도 안 주고 버렸습니다 —
 * 그래서 올린 녹음의 계좌번호를 **올린 본인의 기기에서도** 영영 못 봤고,
 * 화면은 그 이유를 「기기가 달라서」라고 틀리게 말했습니다.
 *
 * 이제 그 요청의 응답에 실어 브라우저에 건네고, 브라우저가 자기 열쇠로 잠가
 * 볼트에 넣습니다. 서버에는 여전히 가려진 것만 남습니다(ADR-009 그대로 —
 * 서버는 원문을 **보관하지 않습니다**, 이미 보고 있던 것을 건넬 뿐입니다).
 */
describe('막 만든 대응표는 브라우저에 건넨다 — 버리지 않습니다', () => {
  it('토큰화한 그 응답에 원문 포함 대응표가 실린다', async () => {
    const one = harness({ lines: [lineOf(`${MINE} 로 보냈어요`)] })

    const got = await read(one)

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.freshMappings).toHaveLength(1)
    expect(got.freshMappings?.[0]).toMatchObject({
      token: '[계좌-1]',
      kind: '계좌',
      original: MINE,
    })
  })

  it('**저장된 것을 읽는 폴링에는 없다** — 서버가 원문을 보관하지 않았습니다', async () => {
    const one = harness({ lines: [] })
    const got = await collectReading(
      {
        caseId: CASE_ID,
        evidenceId: EVIDENCE_ID,
        kind: 'audio',
        objectKey: KEY,
        stored: JSON.stringify({
          lines: [{ speaker: 'A', text: '[계좌-1] 로 보냈어요', startMs: 0 }],
          tokens: [{ token: '[계좌-1]', kind: '계좌' }],
          shortfalls: [],
        }),
      },
      one.container,
    )

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.freshMappings ?? []).toHaveLength(0)
  })

  it('장부에서 이어받은 이름표는 안 실린다 — 그 원문은 서버가 모릅니다', async () => {
    const one = harness({
      vaultTokens: ['[계좌-1]'],
      lines: [lineOf(`${THEIRS} 로 보내라고 했어요`)],
    })

    const got = await read(one)

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    // 새로 만든 [계좌-2] 하나뿐 — 볼트에서 온 [계좌-1] 은 원문이 없어 못 싣습니다
    expect(got.freshMappings?.map((m) => m.token)).toEqual(['[계좌-2]'])
    expect(got.freshMappings?.[0].original).toBe(THEIRS)
  })

  it('저장되는 본문에는 여전히 원문이 없다 — 스키마의 「원문 금지」 그대로', async () => {
    const one = harness({ lines: [lineOf(`${MINE} 로 보냈어요`)] })
    await read(one)

    expect(one.finished[0].transcriptMasked).not.toContain(MINE)
  })
})

/**
 * ⚠️ **전사 교정이 사용자가 확정한 기관명을 덮어썼습니다** (2026-09-03).
 *
 * 문진에서 「카카오뱅크」라고 답해 `org_name` 이 `confirmed` 가 된 뒤 통화
 * 녹음을 올리면, `repairOrgs` 가 전사문에서 집은 다른 기관을 `extracted` 로
 * **그 위에 적었습니다.** `extracted` 는 되묻기를 다시 열므로(§11.4.4 ①),
 * 이미 답한 사람에게 「어느 곳이었는지 골라 주세요」가 다시 왔습니다.
 * `anchor-from-artifact` 가 같은 자리에서 이미 쓰는 그물 — **`confirmed` 는
 * 안 덮는다** — 을 여기에도 겁니다.
 */
describe('전사 교정은 사용자의 답을 덮지 않는다', () => {
  function orgHarness(base: {
    readonly already: readonly { slotKey: string; state: string; valueMasked: string | null }[]
  }) {
    const wrote: { slotKey: string; state: string; valueMasked: string }[] = []
    const one = harness({ lines: [lineOf('국민은행에서 왔다고 했어요')] })
    const container = one.container as unknown as Record<string, unknown>
    container.channelWrite = {
      allCandidates: async () => [
        { orgId: 'kb', name: '국민은행', aliases: ['KB국민은행'] },
      ],
      allPublicNames: async () => [],
    }
    ;(container.ports as Record<string, unknown>).llm = {
      completeText: async () => ({
        text: JSON.stringify({ orgs: [{ heard: '국민은행', candidates: ['국민은행'] }] }),
      }),
    }
    container.slots = { read: async () => base.already }
    container.slotWrite = {
      write: async (input: { slotKey: string; state: string; valueMasked: string }) => {
        wrote.push(input)
      },
    }
    return { container: one.container, wrote }
  }

  it('빈 슬롯에는 올린다 — 지금까지처럼', async () => {
    const one = orgHarness({ already: [] })
    await collectReading(
      { caseId: CASE_ID, evidenceId: EVIDENCE_ID, kind: 'audio', objectKey: KEY, stored: null },
      one.container,
    )
    expect(one.wrote.map((w) => w.slotKey)).toContain('org_name')
  })

  it('**사용자가 확정한 값은 덮지 않는다**', async () => {
    const one = orgHarness({
      already: [{ slotKey: 'org_name', state: 'confirmed', valueMasked: '카카오뱅크' }],
    })
    await collectReading(
      { caseId: CASE_ID, evidenceId: EVIDENCE_ID, kind: 'audio', objectKey: KEY, stored: null },
      one.container,
    )
    expect(one.wrote.map((w) => w.slotKey)).not.toContain('org_name')
  })
})

/**
 * ⚠️ **글로 올린 자료의 내용이 통째로 버려지고 있었습니다** (2026-09-03).
 *
 * 자료 레일이 `text/*` 를 받습니다(`evidence.tsx` 의 `accept`). 카카오톡
 * 「대화 내보내기」가 내는 것이 `.txt` 라, 사기범과의 대화 전체를 그것으로
 * 올리는 것은 **가장 자연스러운 경로**입니다. 그런데 —
 *
 * ```
 * startReading   kind === 'text' 면 바로 돌아섬 (맡길 것이 없음 — 맞습니다)
 * collectReading transcriber.collect → {status:'done', lines: []}
 *                                       ^^^^^^^^^^^^^^^^^^^^^^^^ 내용이 여기서 사라집니다
 * 화면            「다 읽었습니다」
 * ```
 *
 * 파일은 저장소에 멀쩡히 있는데 **아무도 안 읽습니다.** 전사기의 주석이
 * *"부르는 쪽이 토큰화만 거쳐 그대로 저장하면 됩니다"* 라고 그 몫을 부르는
 * 쪽에 넘겨 놓았는데, 부르는 쪽인 이 흐름이 그것을 안 하고 있었습니다.
 *
 * 사용자에게는 **가장 나쁜 실패 모양**입니다 — 실패했다고 말하지 않으니
 * 다시 올리지도 않고, 그 대화에 들어 있던 계좌·기관은 영영 안 잡힙니다.
 */
describe('글로 올린 자료도 읽는다', () => {
  const CHAT = `안녕하세요 김수사관입니다\n${THEIRS} 로 보내주세요\n네 알겠습니다`

  function textHarness(body: string | Error) {
    const one = harness({ lines: [] })
    const container = one.container as unknown as Record<string, unknown>
    ;(container.ports as Record<string, unknown>).mediaReader = {
      readUrl: async () => 'https://store.example/x',
      readText: async () => {
        if (body instanceof Error) throw body
        return body
      },
    }
    return { ...one, container: one.container }
  }

  it('본문을 줄로 갈라 토큰화한다 — 버리지 않습니다', async () => {
    const one = textHarness(CHAT)

    const got = await collectReading(
      {
        caseId: CASE_ID,
        evidenceId: EVIDENCE_ID,
        kind: 'text',
        objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
        stored: null,
      },
      one.container,
    )

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.lines.map((l) => l.text)).toEqual([
      '안녕하세요 김수사관입니다',
      '[계좌-1] 로 보내주세요',
      '네 알겠습니다',
    ])
    // 저장되는 것도 가려진 쪽입니다 — 스키마의 「원문 금지」
    expect(one.finished[0].transcriptMasked).toContain('[계좌-1]')
    expect(one.finished[0].transcriptMasked).not.toContain(THEIRS)
  })

  it('막 만든 대응표를 브라우저에 건넨다 — 녹음과 같은 길', async () => {
    const one = textHarness(CHAT)

    const got = await collectReading(
      {
        caseId: CASE_ID,
        evidenceId: EVIDENCE_ID,
        kind: 'text',
        objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
        stored: null,
      },
      one.container,
    )

    if (got.status !== 'done') throw new Error('끝났어야 합니다')
    expect(got.freshMappings?.[0]).toMatchObject({ token: '[계좌-1]', original: THEIRS })
  })

  /** **못 읽으면 못 읽었다고 말합니다** — 「다 됐다」로 덮지 않습니다 */
  it('읽지 못하면 실패로 답한다', async () => {
    const one = textHarness(new Error('저장소에 닿지 못했습니다'))

    const got = await collectReading(
      {
        caseId: CASE_ID,
        evidenceId: EVIDENCE_ID,
        kind: 'text',
        objectKey: `${CASE_ID}/${EVIDENCE_ID}`,
        stored: null,
      },
      one.container,
    )

    expect(got.status).toBe('failed')
  })
})

/**
 * 증거에서 금액·시각·상대 계좌를 뽑는다 — ADR-069.
 *
 * `slot-extractor` 는 2026-09-04 까지 어느 흐름도 부르지 않았습니다. 이체 내역 캡처를 올려도
 * 「얼마를 보내셨나요」를 그대로 물었습니다.
 */
describe('증거에서 값을 뽑아 확인 전으로 둔다 — ADR-069', () => {
  const RECEIPT = [
    lineOf('이체가 완료되었습니다'),
    lineOf('받는 계좌 국민은행 110-234-567890'),
    lineOf('보낸 계좌 국민은행 604702-01-338291'),
    lineOf('거래일시 2026.09.01 14:22:41'),
    lineOf('32,000,000원'),
  ]

  function extractHarness(base: {
    readonly already?: readonly { slotKey: string; state: string; valueMasked: string | null }[]
    readonly reply: (maskedText: string) => unknown
  }) {
    const wrote: { slotKey: string; state: string; valueMasked: string | null; source: string }[] = []
    const one = harness({ lines: RECEIPT })
    const container = one.container as unknown as Record<string, unknown>
    ;(container.ports as Record<string, unknown>).llm = {
      completeText: async (prompt: { system: string; user: string }) => {
        // 기관 교정(`repairOrgs`)은 사전이 비어 모델을 안 부릅니다 — 여기 오는 것은 추출뿐
        if (!prompt.system.includes('사실만 뽑아내는')) return { text: '' }
        return { text: JSON.stringify(base.reply(prompt.user)) }
      },
    }
    container.slots = { read: async () => base.already ?? [] }
    container.slotWrite = {
      write: async (input: (typeof wrote)[number]) => {
        wrote.push(input)
      },
    }
    return { container: one.container, wrote }
  }

  const collect = (container: Container) =>
    collectReading(
      { caseId: CASE_ID, evidenceId: EVIDENCE_ID, kind: 'image', objectKey: KEY, stored: null },
      container,
    )

  it('모델이 본 것은 토큰뿐이고, 뽑힌 셋이 extracted 로 적힌다', async () => {
    let seen = ''
    const one = extractHarness({
      reply: (user) => {
        seen = user
        return {
          slots: [
            { slot_key: 'amount', value: '32,000,000원', confidence: 0.95 },
            { slot_key: 'occurred_at', value: '2026.09.01 14:22:41', confidence: 0.9 },
            { slot_key: 'counterpart_account', value: '[계좌-1]', confidence: 0.9 },
          ],
        }
      },
    })

    await collect(one.container)

    expect(seen).not.toContain('110-234-567890')
    expect(seen).toContain('[계좌-1]')
    expect(seen).toContain('자료 종류')
    expect(one.wrote).toEqual([
      expect.objectContaining({ slotKey: 'amount', state: 'extracted', valueMasked: '32000000', source: 'auto' }),
      expect.objectContaining({ slotKey: 'occurred_at', state: 'extracted', valueMasked: '2026-09-01T14:22:41+09:00' }),
      expect.objectContaining({ slotKey: 'counterpart_account', state: 'extracted', valueMasked: '[계좌-1]' }),
    ])
  })

  it('확신이 낮거나 · 모양이 안 맞거나 · 전사문에 없는 토큰이면 버린다', async () => {
    const one = extractHarness({
      reply: () => ({
        slots: [
          { slot_key: 'amount', value: '32,000,000원', confidence: 0.4 },
          { slot_key: 'occurred_at', value: '어제 오후', confidence: 0.9 },
          { slot_key: 'counterpart_account', value: '[계좌-9]', confidence: 0.9 },
        ],
      }),
    })

    await collect(one.container)

    expect(one.wrote).toEqual([])
  })

  it('org_name 과 T1 은 여기서 안 받는다 — 기관은 사전 대조, 분기는 사람의 답', async () => {
    const one = extractHarness({
      reply: () => ({
        slots: [
          { slot_key: 'org_name', value: '국민은행', confidence: 0.99 },
          { slot_key: 'transferred', value: 'true', confidence: 0.99 },
          { slot_key: 'channel', value: 'CH-bank', confidence: 0.99 },
        ],
      }),
    })

    await collect(one.container)

    expect(one.wrote).toEqual([])
  })

  it('사용자가 확정한 값은 덮지 않고, 「모름」은 채운다', async () => {
    const one = extractHarness({
      already: [
        { slotKey: 'amount', state: 'confirmed', valueMasked: '30000000' },
        { slotKey: 'occurred_at', state: 'unknown', valueMasked: null },
      ],
      reply: () => ({
        slots: [
          { slot_key: 'amount', value: '32,000,000원', confidence: 0.95 },
          { slot_key: 'occurred_at', value: '2026.09.01', confidence: 0.9 },
        ],
      }),
    })

    await collect(one.container)

    expect(one.wrote.map((w) => w.slotKey)).toEqual(['occurred_at'])
  })

  it('모델이 헛소리를 해도 전사 결과는 남는다', async () => {
    const one = extractHarness({ reply: () => 'not json at all' })

    const got = await collect(one.container)

    expect(got.status).toBe('done')
    expect(one.wrote).toEqual([])
  })
})
