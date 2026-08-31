/**
 * `GET /api/cases/{case_token}/vault` 시험 — **이름표 장부가 양방향인가.**
 *
 * 검증 대상: spec/common/08-14-api.md §3.11 · spec/common/08-14-pii-boundary.md 「번호의 단위」
 * 근거: ADR-009(매핑은 암호문으로 서버에) · ADR-027(키는 브라우저에만)
 *
 * ## 무엇이 깨졌었나
 *
 * 볼트에는 **브라우저가 맡긴 것만** 있습니다. 전사·NER 이 붙인 이름표는 봉할
 * 키가 서버에 없어 못 들어옵니다 — 그래서 브라우저가 볼트만 보면 **서버가 이미
 * 쓴 번호를 모른 채** 같은 번호를 다시 발급했습니다.
 *
 * ```
 * /start 에서 사건 만들고 곧바로 녹음 업로드
 *   → 서버가 전사하며 사기범 계좌에 [계좌-1]      (볼트는 아직 빔)
 * 나중에 챗에 본인 계좌 입력
 *   → 브라우저가 빈 볼트를 보고 [계좌-1] 을 다시 발급
 * 자료함에서 전사문 열기
 *   → 사기범 계좌 자리에 본인 계좌번호가 그려짐
 * ```
 *
 * ⚠️ **여기서 나가는 것은 이름표뿐입니다.** 원문도 키도 아닙니다 — 서버는
 * 그 값을 애초에 모릅니다(불변 규칙 3). 아래 마지막 시험이 그것을 지킵니다.
 */

import { describe, expect, it, vi } from 'vitest'

import { createContainer, unconfiguredPorts, type Ports } from '@/lib/container'
import { readEnv } from '@/lib/env'

import { GET } from './route'

const CASE_ID = '01J8CASE000000000000000000'
const TOKEN = '01J8TKN0000000000000000000'

const holder = vi.hoisted(() => ({ container: undefined as unknown }))

vi.mock('@/lib/wire', () => ({
  getContainer: () => holder.container,
  resetContainer: () => {
    holder.container = undefined
  },
}))

interface VaultBody {
  readonly entries: readonly { token: string; ciphertext: string }[]
  readonly issued: readonly string[]
}

/**
 * 볼트에 맡겨진 것과, 서버가 글에 써 둔 것을 따로 넘깁니다 — **둘은 다른 자리**입니다.
 */
async function vaultOf(
  stored: readonly { token: string; ciphertext: string }[],
  maskedTexts: readonly string[],
): Promise<VaultBody> {
  holder.container = {
    ...createContainer(readEnv({}), {
      ...unconfiguredPorts(readEnv({})),
      auditStore: { lastHash: async () => null, append: async () => {} },
    } as Ports),
    caseTokens: { toCaseId: async () => CASE_ID },
    vaultWrite: {
      list: async () => stored,
      // ⚠️ **`ciphertext` 를 안 봅니다** — 번호를 잇는 데 값이 필요 없습니다
      tokens: async () => stored.map((one) => one.token),
      put: async () => 0,
    },
    maskedTexts: { all: async () => maskedTexts },
  }

  const res = await GET(new Request(`http://x/api/cases/${TOKEN}/vault`), {
    params: Promise.resolve({ case_token: TOKEN }),
  })

  expect(res.status).toBe(200)
  return (await res.json()) as VaultBody
}

describe('맡긴 것을 그대로 되받는다', () => {
  it('암호문은 손대지 않고 나간다 — 여는 것은 브라우저입니다', async () => {
    const body = await vaultOf([{ token: '[계좌-1]', ciphertext: 'c1' }], [])

    expect(body.entries).toEqual([{ token: '[계좌-1]', ciphertext: 'c1' }])
  })
})

describe('서버가 붙인 이름표까지 함께 낸다 — **회귀**', () => {
  it('볼트가 비어 있어도 전사문의 번호가 나온다', async () => {
    const body = await vaultOf([], ['[계좌-1] 로 보내라고 했어요'])

    expect(body.entries).toEqual([])
    // 이것이 없으면 브라우저가 [계좌-1] 을 다시 발급합니다
    expect(body.issued).toEqual(['[계좌-1]'])
  })

  it('챗·슬롯·부산물에 박힌 번호도 함께 나온다', async () => {
    const body = await vaultOf([], ['[전화-1] 로 전화가 왔고', '[이름-1] 이라고 했습니다'])

    expect([...body.issued].sort()).toEqual(['[이름-1]', '[전화-1]'])
  })

  it('볼트와 글에 같은 번호가 있어도 한 번만 나온다', async () => {
    const body = await vaultOf(
      [{ token: '[계좌-1]', ciphertext: 'c1' }],
      ['[계좌-1] 로 보냈습니다'],
    )

    expect(body.issued).toEqual(['[계좌-1]'])
  })

  it('아무것도 없으면 빈 목록 — 새 사건은 1번부터입니다', async () => {
    const body = await vaultOf([], [])

    expect(body.issued).toEqual([])
  })

  /**
   * **경계 시험.** 이 응답에 원문이 실릴 수 있는 자리를 누가 만들면 여기서 걸립니다 —
   * 이름표는 `[종류-번호]` 모양뿐이고 그 안에 값이 들어갈 자리가 없습니다.
   */
  it('이름표만 나갑니다 — 원문이 섞여 나갈 자리가 없다', async () => {
    const body = await vaultOf([], ['계좌 [계좌-1] 는 110-2345-678901 입니다'])

    expect(body.issued).toEqual(['[계좌-1]'])
    expect(JSON.stringify(body.issued)).not.toContain('110-2345-678901')
  })
})
