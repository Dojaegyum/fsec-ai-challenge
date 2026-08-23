/**
 * 언어모델 어댑터 시험.
 *
 * 검증 대상: spec/backend/08-17-system-prompt.md (출력 형식 · `temperature: 0`) ·
 *            CLAUDE.md 불변 규칙 1 (근거 없는 절차를 내보내지 않는다)
 *
 * **여기서 못 박는 것 넷:**
 * 1. 모델이 형식을 어겨도 **근거 없는 안내로 새지 않는다**
 * 2. `temperature` 는 0 이다 — 같은 물음에 같은 답이 나와야 한다
 * 3. 열쇠도 프롬프트도 오류 메시지에 안 담긴다
 * 4. 모르는 칸은 버린다
 *
 * 실제 호출은 하지 않습니다. **버그가 사는 곳은 응답을 읽는 자리**이고,
 * 그건 가짜 응답으로 다 확인됩니다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from './env'
import { createLlmClient } from './llm'

const KEY = 'xai-비밀값이면-메시지에-나오면-안-된다'

function envWith(key: string | undefined): Env {
  return { values: { XAI_API_KEY: key } } as unknown as Env
}

/** 모델이 이런 글을 돌려줬다고 치고 */
function respondWith(content: string, status = 200) {
  // 인자를 쓰지는 않지만 타입을 잡아야 `spy.mock.calls[0][1]` 이 typed 됩니다
  type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
  const impl: Fetch = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  return vi.fn(impl)
}

const client = () => createLlmClient(envWith(KEY))!
const ask = { system: '지시문', user: '사건 내용이 들어 있는 물음' }

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('열쇠가 없으면 만들지 않는다', () => {
  it('null 을 돌려준다 — 조립이 성공해야 하기 때문', () => {
    expect(createLlmClient(envWith(undefined))).toBe(null)
  })
})

describe('모델이 형식을 어겨도 근거 없는 안내로 새지 않는다 — 불변 규칙 1', () => {
  it('JSON 이 아니면 「근거 없음」으로 다룬다', async () => {
    vi.stubGlobal('fetch', respondWith('안녕하세요. 3영업일 안에 신고하시면 됩니다.'))
    const reply = await client().complete(ask)

    // 던지지 않습니다 — 던지면 사용자가 다시 물어볼 수 없습니다.
    // 억지로 읽지도 않습니다 — 그러면 근거 없는 절차가 그대로 나갑니다
    expect(reply.insufficient).toBe(true)
    expect(reply.citations).toEqual([])
    expect(reply.reply).toBeUndefined()
  })

  it('`insufficient` 가 빠지면 참으로 본다', async () => {
    vi.stubGlobal('fetch', respondWith('{"reply":"3영업일 안에 하세요"}'))
    const reply = await client().complete(ask)

    // 빠진 것을 「충분하다」로 읽으면, 형식을 어긴 순간 근거 없는 안내가 나갑니다
    expect(reply.insufficient).toBe(true)
  })

  it('근거가 없는 인용은 버린다', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith(
        '{"insufficient":false,"citations":[{"ref":"kb-1","why":"근거"},{"why":"번호 없음"}]}',
      ),
    )
    const reply = await client().complete(ask)

    expect(reply.citations).toEqual([{ ref: 'kb-1', why: '근거' }])
  })

  it('모델이 지어낸 칸은 버린다', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith('{"insufficient":false,"citations":[],"reply":"네","확신도":0.9}'),
    )
    const reply = await client().complete(ask)

    expect(Object.keys(reply).sort()).toEqual(['citations', 'insufficient', 'reply'])
  })
})

describe('울타리를 두른 답은 벗겨서 읽는다', () => {
  it('```json 으로 감싸도 통과한다', async () => {
    // 지시문이 「JSON 하나만」이라고 못 박았지만 모델이 감싸는 일이 있습니다.
    // 그것 때문에 답을 통째로 버리지 않습니다 — 울타리는 뜻을 안 바꿉니다
    vi.stubGlobal(
      'fetch',
      respondWith('```json\n{"insufficient":false,"citations":[],"reply":"됩니다"}\n```'),
    )
    const reply = await client().complete(ask)

    expect(reply.insufficient).toBe(false)
    expect(reply.reply).toBe('됩니다')
  })
})

describe('같은 물음에 같은 답이 나와야 한다', () => {
  it('temperature 를 0 으로 보낸다', async () => {
    const spy = respondWith('{"insufficient":true,"citations":[]}')
    vi.stubGlobal('fetch', spy)
    await client().complete(ask)

    const body = JSON.parse(String(spy.mock.calls[0][1]?.body))
    // 절차 안내는 흔들리면 안 됩니다. 정본이 이 값으로 재서 확인했습니다
    expect(body.temperature).toBe(0)
    expect(body.model).toBe('grok-4.5')
    expect(body.messages).toEqual([
      { role: 'system', content: '지시문' },
      { role: 'user', content: '사건 내용이 들어 있는 물음' },
    ])
  })

  it('도구 호출을 쓰지 않는다 — ARCHITECTURE §2', async () => {
    const spy = respondWith('{"insufficient":true,"citations":[]}')
    vi.stubGlobal('fetch', spy)
    await client().complete(ask)

    const body = JSON.parse(String(spy.mock.calls[0][1]?.body))
    expect(body.tools).toBeUndefined()
  })
})

describe('오류 메시지가 비밀을 흘리지 않는다', () => {
  it('닿지 못했을 때 열쇠도 프롬프트도 안 담는다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))

    // 이 메시지는 로그와 감사 기록으로 갑니다. 프롬프트에는 사건 내용이 있습니다
    await expect(client().complete(ask)).rejects.toThrow('모델에 닿지 못했습니다')
    await expect(client().complete(ask)).rejects.not.toThrow(KEY)
  })

  it('거절당했을 때 상태 코드만 남긴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"no credits"}', { status: 403 })))

    const failed = await client().complete(ask).catch((error: Error) => error)
    expect((failed as Error).message).toBe('모델이 거절했습니다 (403)')
    // 응답 본문에 계정 정보가 실려 오므로 그대로 옮기지 않습니다
    expect((failed as Error).message).not.toContain('credits')
  })

  it('빈 답은 빈 답이라고 말한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"choices":[]}', { status: 200 })))
    await expect(client().complete(ask)).rejects.toThrow('모델이 빈 답을 냈습니다')
  })
})
