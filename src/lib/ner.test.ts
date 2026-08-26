/**
 * ner.ts 시험 — **번역만 하는지**를 봅니다.
 *
 * 가장 중요한 것: **못 부를 때 조용히 빈 목록을 내지 않아야 합니다.**
 * 그러면 `pii-tokenizer` 가 「이름은 없었다」로 읽고, 토큰화 없이 LLM 을 부르는
 * 우회 경로가 생깁니다 → CLAUDE.md 불변 규칙 2.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createNerModel } from './ner'

const BASE = 'https://ner.example'

function respond(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('createNerModel', () => {
  it('구간을 그대로 옮긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      respond({ spans: [{ label: 'PERSON', start: 0, end: 3, value: '김민수' }] }),
    ))

    const model = createNerModel({ baseUrl: BASE })
    expect(await model.find('김민수 님')).toEqual([
      { label: 'PERSON', start: 0, end: 3, value: '김민수' },
    ])
  })

  it('주소와 비밀값·모델명을 실어 보낸다', async () => {
    const fetchMock = vi.fn(async () => respond({ spans: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await createNerModel({ baseUrl: BASE, token: 'sh', model: 'gemma3:4b' }).find('가나다')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${BASE}/ner`)
    expect((init.headers as Record<string, string>)['x-finally-token']).toBe('sh')
    expect(JSON.parse(init.body as string)).toEqual({ text: '가나다', model: 'gemma3:4b' })
  })

  it('모델명을 안 주면 안 싣는다', async () => {
    const fetchMock = vi.fn(async () => respond({ spans: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await createNerModel({ baseUrl: BASE }).find('가나다')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ text: '가나다' })
  })

  // 한 조각이 이상하다고 통째로 버리면 1차 정규식이 잡아 둔 것까지 못 씁니다
  it('모양이 안 맞는 조각만 버린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      respond({
        spans: [
          { label: 'PERSON', start: 0, end: 3, value: '김민수' },
          { label: 'PERSON', start: 5, end: 5, value: '' }, // end 가 start 보다 크지 않다
          { label: 'ORG', start: -1, end: 2, value: 'KT' }, // 음수
          { start: 7, end: 9, value: '없음' }, // label 이 없다
          null,
        ],
      }),
    ))

    const spans = await createNerModel({ baseUrl: BASE }).find('아무 글')
    expect(spans).toEqual([{ label: 'PERSON', start: 0, end: 3, value: '김민수' }])
  })

  describe('못 부르면 던진다 — 빈 목록으로 내려가지 않는다', () => {
    it('닿지 못했을 때', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom') }))
      await expect(createNerModel({ baseUrl: BASE }).find('가나다')).rejects.toThrow(
        '탐지 서비스에 닿지 못했습니다',
      )
    })

    it('거절당했을 때 — 상태 코드만 담고 본문은 안 담는다', async () => {
      vi.stubGlobal('fetch', vi.fn(async () =>
        respond({ detail: '김민수 님의 계좌 110-123-456' }, { status: 503 }),
      ))
      const error = await createNerModel({ baseUrl: BASE }).find('가').catch((e: Error) => e)
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('탐지 서비스가 거절했습니다 (503)')
      // **원문이 감사 기록으로 새면 안 됩니다** → 08-14-pii-boundary.md
      expect((error as Error).message).not.toContain('김민수')
      expect((error as Error).message).not.toContain('110-123-456')
    })

    it('목록이 아닐 때', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => respond({ spans: '없음' })))
      await expect(createNerModel({ baseUrl: BASE }).find('가')).rejects.toThrow(
        '탐지 서비스가 목록을 안 줬습니다',
      )
    })

    it('JSON 이 아닐 때', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })))
      await expect(createNerModel({ baseUrl: BASE }).find('가')).rejects.toThrow(
        '탐지 서비스의 응답을 읽지 못했습니다',
      )
    })
  })
})
