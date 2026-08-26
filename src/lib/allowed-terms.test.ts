/**
 * 토큰화 제외 목록이 **부르는 쪽까지** 이어져 있는가.
 *
 * ## 왜 이 파일이 있나
 *
 * 이 자리는 **시험은 있는데 배선이 없던** 곳이었습니다.
 * `tokenize.test.ts` 의 「제외 목록이 NER 결과보다 우선한다」가
 * `allowedTerms: ['카카오페이']` 를 **손으로 넣고** 통과합니다 — 표는 지켰습니다.
 *
 * 그런데 **제품 경로 넷 중 셋이 그 값을 안 넘기고 있었습니다.**
 * `tokenize()` 는 `ctx.allowedTerms ?? []` 로 받으므로 조용히 빈 목록이 됩니다.
 * `NER_URL` 이 비어 있는 동안에는 NER 분기 자체를 건너뛰어 아무도 못 알아챘고,
 * **그 스위치를 켜는 순간 기관명이 통째로 `[이름-N]` 이 됩니다.**
 *
 * 그래서 여기서는 **함수가 맞게 도는가**가 아니라 **부르는 쪽이 넘기는가**를 봅니다.
 * `route-contract` 게이트와 같은 결의 검사입니다.
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createPiiTokenizer } from '@/modules/pii-tokenizer'
import type { NerModel } from '@/modules/pii-tokenizer'

import { allowedTermsFor, createAllowedTermSource } from './allowed-terms'

/** 그 낱말을 사람 이름으로 집어 주는 대역 */
function nerFinding(text: string, ...words: string[]): NerModel {
  return {
    find: async () =>
      words
        .map((word) => {
          const start = text.indexOf(word)
          return { label: 'PERSON', start, end: start + word.length, value: word }
        })
        .filter((one) => one.start >= 0),
  }
}

const ORGS = JSON.parse(
  readFileSync(new URL('../kb/org.json', import.meta.url), 'utf8'),
) as { orgs: { org_id: string; name: string; aliases?: string[] }[] }

const rows = ORGS.orgs.map((one) => ({
  orgId: one.org_id,
  name: one.name,
  aliases: one.aliases ?? [],
}))

const channels = { allCandidates: async () => rows }
const kbVersion = { current: async () => '2026.08.1' }

describe('제외 목록을 사전에서 만든다', () => {
  it('이름과 별칭을 전부 담는다', async () => {
    const terms = await allowedTermsFor({ channels, kbVersion })
    expect(terms).toContain('카카오페이')
    expect(terms).toContain('토스') // 두 글자 별칭도 — 빼면 「토스로 보냈어요」가 가려집니다
    expect(terms.length).toBeGreaterThan(rows.length)
  })

  it('**못 가져와도 빈 목록으로 돌아옵니다** — 절차를 막지 않습니다', async () => {
    // 제외 목록은 절차의 부속이지 절차 자체가 아닙니다 → 불변 규칙 5.
    // 처음에 버전 조회를 밖에 두었더니 그것이 터질 때 **쓰기 경로가 500** 이었습니다
    const terms = await allowedTermsFor({
      channels: {
        allCandidates: async () => {
          throw new Error('DB 없음')
        },
      },
      kbVersion,
    })
    expect(terms).toEqual([])

    const noVersion = await allowedTermsFor({
      channels,
      kbVersion: {
        current: async () => {
          throw new Error('KB_VERSION 없음')
        },
      },
    })
    expect(noVersion).toEqual([])
  })
})

describe('실제 사전으로 걸어도 실명은 그대로 가려진다', () => {
  /**
   * 사전에 **두 글자 표기가 서른**입니다(`국민`·`신한`·`하나`·`토스`…).
   * 그걸 다 넣고도 실명이 안 새는 것은 `isAllowed` 의 규칙 때문입니다 —
   * **허용어로 시작하고 뒤에 조사만** 남아야 통과합니다.
   *
   * `includes` 로 보던 시절에 「김하나」·「이신한」이 통째로 샜습니다.
   * 사전이 51곳으로 늘었으니 **다시 재 둡니다.**
   */
  it.each(['김하나', '이신한', '박국민', '최기업', '정삼성'])(
    '%s 는 가려진다',
    async (name) => {
      const text = `${name} 님께 보냈어요`
      const tokenizer = createPiiTokenizer({ ner: nerFinding(text, name) })
      const { masked } = await tokenizer.tokenize(text, {
        allowedTerms: await allowedTermsFor({ channels, kbVersion }),
      })
      expect(masked).toContain('[이름-1]')
    },
  )

  it.each(['토스', '카카오페이', '케이뱅크', '빗썸'])('%s 는 안 가려진다', async (org) => {
    const text = `${org}로 300만원 보냈어요`
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, org) })
    const { masked } = await tokenizer.tokenize(text, {
      allowedTerms: await allowedTermsFor({ channels, kbVersion }),
    })
    expect(masked).toBe(text)
  })

  it('목록이 비면 기관명이 가려진다 — **이게 배선이 빠졌을 때의 모습입니다**', async () => {
    const text = '토스로 300만원 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '토스') })
    const { masked } = await tokenizer.tokenize(text)
    expect(masked).toContain('[이름-1]')
  })
})

describe('목록이 안 걸린 것을 숨기지 않는다', () => {
  /**
   * `catch { return [] }` 로 조용히 넘어가면 **방금 고친 것과 같은 모양**이
   * 됩니다 — 기관명이 가려지고 에러 없이 엉뚱한 매뉴얼이 나갑니다.
   *
   * 막지는 않습니다. **막는 해와 안 막는 해가 다르기 때문**입니다 —
   * NER 이 죽으면 원문이 밖으로 나가지만(되돌릴 수 없음), 목록이 비면
   * 가리지 않아도 될 것이 가려질 뿐입니다(안내가 나빠짐). 대신 **사실을 냅니다.**
   */
  it('목록이 비면 `allowedTermsApplied` 가 거짓이다', async () => {
    const text = '토스로 300만원 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '토스') })
    const result = await tokenizer.tokenize(text)
    expect(result.nerApplied).toBe(true)
    expect(result.allowedTermsApplied).toBe(false)
    // 둘이 겹친 상태가 위험한 상태입니다
    expect(result.masked).toContain('[이름-1]')
  })

  it('목록이 걸리면 참이고 기관명이 살아남는다', async () => {
    const text = '토스로 300만원 보냈어요'
    const tokenizer = createPiiTokenizer({ ner: nerFinding(text, '토스') })
    const result = await tokenizer.tokenize(text, {
      allowedTerms: await allowedTermsFor({ channels, kbVersion }),
    })
    expect(result.allowedTermsApplied).toBe(true)
    expect(result.masked).toBe(text)
  })

  it('**NER 이 안 돌면 목록이 비어도 위험하지 않습니다**', async () => {
    // 지금까지 이 결함이 안 터진 이유가 그것입니다 — `NER_URL` 이 비어 있었습니다
    const text = '토스로 300만원 보냈어요'
    const result = await createPiiTokenizer().tokenize(text)
    expect(result.nerApplied).toBe(false)
    expect(result.allowedTermsApplied).toBe(false)
    expect(result.masked).toBe(text)
  })

  it('전사 흐름이 그 사실을 shortfall 로 내보낸다', () => {
    // 화면이 「이건 직접 확인해 주세요」로 쓰는 통로입니다 — API·화면까지 갑니다
    const source = readFileSync(new URL('../flows/read-evidence.ts', import.meta.url), 'utf8')
    expect(source).toContain('no_org_allowlist')
    expect(source).toMatch(/nerApplied && !result\.allowedTermsApplied/)
  })
})

/**
 * **부르는 쪽을 지킵니다.**
 *
 * 새 호출부가 목록 없이 들어오면 여기서 걸립니다 — 이 결함이 생긴 방식이
 * 정확히 그것이었습니다(경로가 넷으로 늘어나는 동안 하나만 목록을 넘겼습니다).
 */
describe('토큰화를 부르는 곳은 전부 제외 목록을 넘긴다', () => {
  /** `tokenize(` 를 부르는 제품 코드. 시험과 모듈 안쪽은 뺍니다 */
  const CALLERS = [
    'flows/read-evidence.ts',
    'flows/answer-slot.ts',
    'modules/chat-receiver/receive.ts',
    'app/api/cases/[case_token]/steps/[step_id]/artifacts/route.ts',
  ] as const

  /**
   * `.tokenize(` 부터 **괄호가 닫힐 때까지**를 잘라 그 안을 봅니다.
   *
   * ⚠️ **처음에는 파일에 `allowedTerms` 글자가 있는지만 봤습니다.** 그랬더니
   * 배선을 끊어도 **매개변수 선언과 주석에 그 글자가 남아** 시험이 통과했습니다.
   * 헛도는 시험이었고, 끊어 보고 나서야 알았습니다.
   */
  function callArgs(source: string): string[] {
    const out: string[] = []
    for (let at = source.indexOf('.tokenize('); at >= 0; at = source.indexOf('.tokenize(', at + 1)) {
      let depth = 0
      let i = at + '.tokenize'.length
      const from = i
      for (; i < source.length; i += 1) {
        if (source[i] === '(') depth += 1
        else if (source[i] === ')') {
          depth -= 1
          if (depth === 0) break
        }
      }
      out.push(source.slice(from, i + 1))
    }
    return out
  }

  it.each(CALLERS)('%s 의 tokenize 호출이 제외 목록을 싣는다', (path) => {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    const calls = callArgs(source)
    expect(calls.length, `${path} 에 tokenize 호출이 없습니다`).toBeGreaterThan(0)

    const bare = calls.filter((one) => !one.includes('allowedTerms'))
    expect(
      bare,
      `${path} 의 tokenize 호출 ${bare.length}곳이 제외 목록 없이 부릅니다 — ` +
        '기관명이 `[이름-N]` 이 됩니다 → 04-pii-boundary.md',
    ).toEqual([])
  })
})
