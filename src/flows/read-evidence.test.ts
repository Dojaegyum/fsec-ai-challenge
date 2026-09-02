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
    { caseId: CASE_ID, evidenceId: EVIDENCE_ID, kind: 'audio', stored: null },
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
