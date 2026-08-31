/**
 * 언어모델 어댑터 시험.
 *
 * 검증 대상: spec/backend/08-17-system-prompt.md (출력 형식 · `temperature: 0`) ·
 *            CLAUDE.md 불변 규칙 1 (근거 없는 절차를 내보내지 않는다)
 *
 * **여기서 못 박는 것 다섯:**
 * 1. 모델이 형식을 어겨도 **근거 없는 안내로 새지 않는다**
 * 2. `temperature` 는 0 이다 — 같은 물음에 같은 답이 나와야 한다
 * 3. 열쇠도 프롬프트도 오류 메시지에 안 담긴다
 * 4. 모르는 칸은 버린다
 * 5. **감사에 남길 것을 응답에서 읽는다** — 실제로 답한 모델과 토큰 수.
 *    없으면 비웁니다 (09-data-model.md §10.2)
 *
 * 실제 호출은 하지 않습니다. **버그가 사는 곳은 응답을 읽는 자리**이고,
 * 그건 가짜 응답으로 다 확인됩니다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from './env'
import { createLlmClient, llmCallOf } from './llm'

import type { ModelReply } from '@/modules/chat-receiver'

const KEY = 'xai-비밀값이면-메시지에-나오면-안-된다'

function envWith(key: string | undefined, over: Record<string, string> = {}): Env {
  return { values: { XAI_API_KEY: key, ...over } } as unknown as Env
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

    // **칸 목록은 닫혀 있습니다** — 모델이 지어낸 것이 하나도 안 새야 합니다.
    // `call` 은 모델이 준 칸이 아니라 **응답 봉투에서 우리가 읽은 것**입니다
    // (누가 답했나 · 토큰 몇 개) → 09-data-model.md §10.2
    expect(Object.keys(reply).sort()).toEqual(['call', 'citations', 'insufficient', 'reply'])
    expect(reply).not.toHaveProperty('확신도')
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

/**
 * **모델이 안 되는 것은 우리 잘못이 아닙니다** → 08-16-errors.md §1.
 *
 * 여기서 맨 `Error` 를 던지면 라우트가 그것을 `INTERNAL` 로 읽어 500 을 냅니다.
 * 그러면 화면은 「처리 중 문제가 발생했습니다」만 띄우고, **다시 눌러 보라는
 * 말을 못 합니다** — 잠시 뒤면 될 일인데.
 *
 * 2026-08-27 실측: 배포 환경에서 챗 여덟 턴 중 하나가 55초 만에 시간 예산을
 * 다 써서 500 이 났습니다. 그 자리가 이 시험입니다.
 */
describe('모델이 못 답한 것은 503 으로 나간다 — 다시 누를 수 있게', () => {
  const codeOf = async (fetchImpl: () => Promise<Response> | never) => {
    vi.stubGlobal('fetch', vi.fn(fetchImpl))
    const failed = await client().complete(ask).catch((error: unknown) => error)
    return failed as { code?: string; httpStatus?: number; retryable?: boolean }
  }

  it('닿지 못하면 잠시 뒤 다시', async () => {
    const failed = await codeOf(async () => { throw new Error('ECONNREFUSED') })
    expect(failed.code).toBe('LLM_UNAVAILABLE')
    expect(failed.httpStatus).toBe(503)
    expect(failed.retryable).toBe(true)
  })

  it('시간이 다 되어도 잠시 뒤 다시 — 늦은 것뿐입니다', async () => {
    const failed = await codeOf(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    expect(failed.code).toBe('LLM_UNAVAILABLE')
    expect(failed.httpStatus).toBe(503)
  })

  it('빈 답도 잠시 뒤 다시', async () => {
    const failed = await codeOf(async () => new Response('{"choices":[]}', { status: 200 }))
    expect(failed.code).toBe('LLM_UNAVAILABLE')
  })

  it('**403 은 다시 눌러도 같습니다** — 잔액은 기다린다고 안 생깁니다', async () => {
    const failed = await codeOf(async () => new Response('{}', { status: 403 }))
    expect(failed.code).toBe('LLM_BAD_REQUEST')
    expect(failed.httpStatus).toBe(500)
    expect(failed.retryable).toBe(false)
  })

  it('503 은 다 쓰고 나서도 잠시 뒤 다시', async () => {
    const failed = await codeOf(async () => new Response('{}', { status: 503 }))
    expect(failed.code).toBe('LLM_UNAVAILABLE')
    expect(failed.retryable).toBe(true)
  })
})

/**
 * 제공자를 갈아끼우는 자리 — **개발 중에 유료 잔액이 떨어지면 챗을 한 번도
 * 못 봅니다.** 2026-08-25 에 실제로 그랬습니다(403 · 크레딧 없음).
 */
describe('주소와 모델을 환경변수로 갈아끼운다', () => {
  const urlOf = (spy: ReturnType<typeof respondWith>) => String(spy.mock.calls[0]![0])
  const bodyOf = (spy: ReturnType<typeof respondWith>) =>
    JSON.parse(String(spy.mock.calls[0]![1]!.body)) as { model: string }

  it('아무것도 안 주면 xAI 로 간다', async () => {
    const spy = respondWith('{"insufficient":true,"citations":[]}')
    vi.stubGlobal('fetch', spy)

    await client().complete(ask)
    expect(urlOf(spy)).toBe('https://api.x.ai/v1/chat/completions')
    expect(bodyOf(spy).model).toBe('grok-4.5')
  })

  it('주소와 모델을 주면 그쪽으로 간다', async () => {
    const spy = respondWith('{"insufficient":true,"citations":[]}')
    vi.stubGlobal('fetch', spy)

    const other = createLlmClient(
      envWith(KEY, {
        LLM_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        LLM_MODEL: 'gemini-2.5-flash',
      }),
    )!
    await other.complete(ask)

    expect(urlOf(spy)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    )
    expect(bodyOf(spy).model).toBe('gemini-2.5-flash')
  })

  it('끝에 빗금이 붙어 와도 `//v1` 이 안 된다', async () => {
    const spy = respondWith('{"insufficient":true,"citations":[]}')
    vi.stubGlobal('fetch', spy)

    const other = createLlmClient(envWith(KEY, { LLM_BASE_URL: 'http://127.0.0.1:11434/v1/' }))!
    await other.complete(ask)
    expect(urlOf(spy)).toBe('http://127.0.0.1:11434/v1/chat/completions')
  })

  it('개발용 열쇠만 있어도 선다 — `XAI_API_KEY` 가 비어도', () => {
    const only = { values: { LLM_API_KEY: '개발용-열쇠' } } as unknown as Env
    expect(createLlmClient(only)).not.toBeNull()
  })

  it('개발용 열쇠가 있으면 그것을 먼저 쓴다', async () => {
    const spy = respondWith('{"insufficient":true,"citations":[]}')
    vi.stubGlobal('fetch', spy)

    const other = createLlmClient(envWith(KEY, { LLM_API_KEY: '개발용-열쇠' }))!
    await other.complete(ask)

    const headers = spy.mock.calls[0]![1]!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer 개발용-열쇠')
  })

  it('열쇠가 하나도 없으면 안 선다', () => {
    expect(createLlmClient(envWith(undefined))).toBeNull()
  })
})

/**
 * 과부하에 다시 보낸다 — **무료 한도에서는 503 이 상시로 옵니다.**
 *
 * 2026-08-25 실측: 같은 프롬프트를 다섯 모델에 보냈더니 둘이 `503 UNAVAILABLE`
 * 이었고, 잠시 뒤에는 다른 둘이 그랬습니다. 재시도가 없으면 그때마다
 * **대화가 그 자리에서 끊깁니다.**
 */
describe('다시 보내면 될 것만 다시 보낸다', () => {
  const ok = '{"insufficient":false,"citations":[{"ref":"kb-1","why":"근거"}],"reply":"답"}'

  /** 앞의 `codes` 를 차례로 내고, 그 뒤로는 정상 응답을 냅니다 */
  function failThen(codes: readonly number[]) {
    let call = 0
    type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    const impl: Fetch = async () => {
      const code = codes[call]
      call += 1
      if (code === undefined) {
        return new Response(JSON.stringify({ choices: [{ message: { content: ok } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{"error":{"message":"overloaded"}}', { status: code })
    }
    return vi.fn(impl)
  }

  it('503 이면 다시 보내고, 두 번째가 되면 그 답을 쓴다', async () => {
    const spy = failThen([503])
    vi.stubGlobal('fetch', spy)

    const reply = await client().complete(ask)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(reply.insufficient).toBe(false)
    expect(reply.citations[0]?.ref).toBe('kb-1')
  })

  it('모델이 하나면 두 번까지만 보낸다 — 한 바퀴가 한 번이다', async () => {
    const spy = failThen([503, 503, 503, 503])
    vi.stubGlobal('fetch', spy)

    await expect(client().complete(ask)).rejects.toThrow('모델이 거절했습니다 (503)')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('429 도 다시 보낸다 — 창이 지나면 통과합니다', async () => {
    const spy = failThen([429])
    vi.stubGlobal('fetch', spy)

    await client().complete(ask)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('**403 은 다시 안 보냅니다** — 잔액이 없는 것은 기다린다고 안 생깁니다', async () => {
    const spy = failThen([403])
    vi.stubGlobal('fetch', spy)

    await expect(client().complete(ask)).rejects.toThrow('모델이 거절했습니다 (403)')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('400 도 다시 안 보냅니다 — 요청이 잘못된 것은 같은 것을 또 보내도 같습니다', async () => {
    const spy = failThen([400])
    vi.stubGlobal('fetch', spy)

    await expect(client().complete(ask)).rejects.toThrow('모델이 거절했습니다 (400)')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('**같은 것을 그대로 다시 보냅니다** — 시도마다 프롬프트가 달라지면 안 됩니다', async () => {
    const spy = failThen([503])
    vi.stubGlobal('fetch', spy)

    await client().complete(ask)
    const first = String(spy.mock.calls[0]![1]!.body)
    const second = String(spy.mock.calls[1]![1]!.body)
    expect(second).toBe(first)
  })
})

/**
 * 후보를 여럿 두는 자리 — **무료 한도에서는 모델마다 막히는 때가 다릅니다.**
 *
 * 2026-08-25 실측: 같은 프롬프트를 다섯 모델에 보냈더니 어느 순간엔 둘이,
 * 잠시 뒤엔 다른 둘이 503 이었습니다. 하나만 박아 두면 그때그때 멈춥니다.
 */
describe('막히면 다음 모델로 넘어간다', () => {
  const ok = '{"insufficient":false,"citations":[{"ref":"kb-1","why":"근거"}],"reply":"답"}'

  function failThen(codes: readonly number[]) {
    let call = 0
    type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    const impl: Fetch = async () => {
      const code = codes[call]
      call += 1
      if (code === undefined) {
        return new Response(JSON.stringify({ choices: [{ message: { content: ok } }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('{"error":{"message":"overloaded"}}', { status: code })
    }
    return vi.fn(impl)
  }

  const three = () =>
    createLlmClient(envWith(KEY, { LLM_MODEL: 'first, second ,third' }))!

  const modelOf = (spy: ReturnType<typeof failThen>, i: number) =>
    (JSON.parse(String(spy.mock.calls[i]![1]!.body)) as { model: string }).model

  it('쉼표로 적은 것을 차례로 시도한다', async () => {
    const spy = failThen([503, 503])
    vi.stubGlobal('fetch', spy)

    await three().complete(ask)
    expect(spy).toHaveBeenCalledTimes(3)
    expect([0, 1, 2].map((i) => modelOf(spy, i))).toEqual(['first', 'second', 'third'])
  })

  it('공백을 지우고 읽는다', async () => {
    const spy = failThen([])
    vi.stubGlobal('fetch', spy)

    await three().complete(ask)
    expect(modelOf(spy, 0)).toBe('first')
  })

  /**
   * **늦은 것도 다음 후보로 넘어갑니다** — 2026-08-27 에 여기서 막혔습니다.
   *
   * 첫 후보가 닿지 않으면 그 자리에서 던져 버려서, 뒤에 선 멀쩡한 후보를
   * **한 번도 안 불렀습니다.** 같은 순간 `gemini-3.6-flash` 는 3~7초에
   * 답하고 있었는데 사용자는 503 을 받았습니다.
   */
  it('첫 후보가 닿지 않아도 둘째를 부른다 — 503 과 같이 다룹니다', async () => {
    let call = 0
    type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    const impl: Fetch = async () => {
      call += 1
      if (call === 1) throw new Error('ECONNREFUSED')
      return new Response(JSON.stringify({ choices: [{ message: { content: ok } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const spy = vi.fn(impl)
    vi.stubGlobal('fetch', spy)

    const reply = await three().complete(ask)
    expect(reply.insufficient).toBe(false)
    expect(spy).toHaveBeenCalledTimes(2)
    expect(modelOf(spy, 1)).toBe('second')
  })

  it('다 닿지 못하면 그때는 그렇게 말한다', async () => {
    const spy = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    vi.stubGlobal('fetch', spy)

    await expect(three().complete(ask)).rejects.toThrow('모델에 닿지 못했습니다')
    // 후보 셋 × 두 바퀴
    expect(spy).toHaveBeenCalledTimes(6)
  })

  it('**글은 그대로 두고 모델만 바뀝니다**', async () => {
    const spy = failThen([503])
    vi.stubGlobal('fetch', spy)

    await three().complete(ask)
    const a = JSON.parse(String(spy.mock.calls[0]![1]!.body)) as Record<string, unknown>
    const b = JSON.parse(String(spy.mock.calls[1]![1]!.body)) as Record<string, unknown>
    expect(a.messages).toEqual(b.messages)
    expect(a.model).not.toBe(b.model)
  })

  it('두 바퀴까지 돈다 — 셋이면 최대 여섯 번', async () => {
    const spy = failThen(Array.from({ length: 10 }, () => 503))
    vi.stubGlobal('fetch', spy)

    await expect(three().complete(ask)).rejects.toThrow('모델이 거절했습니다 (503)')
    expect(spy).toHaveBeenCalledTimes(6)
  })

  it('403 이면 다음 모델로도 안 넘어갑니다 — 열쇠 문제는 모델을 바꿔도 같습니다', async () => {
    const spy = failThen([403])
    vi.stubGlobal('fetch', spy)

    await expect(three().complete(ask)).rejects.toThrow('모델이 거절했습니다 (403)')
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

/**
 * 감사 기록에 남길 것 — 09-data-model.md §10.2 가 `llm.called` 의 detail 을
 * `{"model":"...","token_in":1200}` 로 정해 뒀는데, 응답을 읽는 자리가
 * `choices[].message.content` 만 꺼내고 `model` 과 `usage` 를 버리고
 * 있었습니다.
 *
 * **여기서 못 박는 것 셋:**
 * 1. 응답에서 모델 이름과 토큰 수를 읽는다
 * 2. **실제로 답한 모델**의 이름이다 — 우리가 보낸 이름이 아니다 (폴백)
 * 3. 없으면 비운다 — 지어내면 감사 기록이 거짓이 됩니다
 */
describe('모델 호출 자취를 감사에 넘긴다 — 09-data-model.md §10.2', () => {
  const ok = '{"insufficient":false,"citations":[{"ref":"kb-1","why":"근거"}],"reply":"답"}'

  /** 본문을 통째로 정해 응답합니다 — `model`·`usage` 를 넣고 빼기 위해서 */
  function bodyOf(extra: Record<string, unknown>, content = ok) {
    type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    const impl: Fetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }], ...extra }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    return vi.fn(impl)
  }

  it('모델 이름과 토큰 수를 읽는다', async () => {
    vi.stubGlobal(
      'fetch',
      bodyOf({
        model: 'grok-4.5',
        usage: { prompt_tokens: 1200, completion_tokens: 340 },
      }),
    )

    const reply = await client().complete(ask)

    expect(reply.call).toEqual({ model: 'grok-4.5', tokenIn: 1200, tokenOut: 340 })
  })

  it('**실제로 답한 모델**의 이름이다 — 보낸 이름이 아니다', async () => {
    // 폴백이 있어서 우리가 부른 후보와 답한 모델이 다를 수 있습니다.
    // 제공자가 별칭을 실제 판번호로 바꿔 답하는 것도 흔합니다 —
    // **보낸 이름을 남기면 감사 기록이 거짓이 됩니다**
    let call = 0
    type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    const spy = vi.fn<Fetch>(async () => {
      call += 1
      if (call === 1) return new Response('{"error":{"message":"overloaded"}}', { status: 503 })
      return new Response(
        JSON.stringify({ choices: [{ message: { content: ok } }], model: 'second-2026-08-27' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    vi.stubGlobal('fetch', spy)

    const two = createLlmClient(envWith(KEY, { LLM_MODEL: 'first,second' }))!
    const reply = await two.complete(ask)

    // 보낸 것은 `second`, 답한 것은 `second-2026-08-27` 입니다
    expect((JSON.parse(String(spy.mock.calls[1]![1]!.body)) as { model: string }).model)
      .toBe('second')
    expect(reply.call.model).toBe('second-2026-08-27')
  })

  it('응답에 없으면 비운다 — 지어내지 않는다', async () => {
    // 제공자마다 다릅니다. 없는 것을 보낸 이름이나 0 으로 메우면 그것도 거짓입니다
    vi.stubGlobal('fetch', bodyOf({}))

    const reply = await client().complete(ask)

    expect(reply.call).toEqual({ model: null, tokenIn: null, tokenOut: null })
  })

  it('토큰 수만 없어도 이름은 남긴다 — 아는 것까지는 남깁니다', async () => {
    vi.stubGlobal('fetch', bodyOf({ model: 'grok-4.5' }))

    const reply = await client().complete(ask)

    expect(reply.call).toEqual({ model: 'grok-4.5', tokenIn: null, tokenOut: null })
  })

  it('숫자가 아닌 토큰 수는 못 본 것으로 둔다', async () => {
    vi.stubGlobal(
      'fetch',
      bodyOf({ model: 'grok-4.5', usage: { prompt_tokens: '1200', completion_tokens: null } }),
    )

    const reply = await client().complete(ask)

    expect(reply.call.tokenIn).toBeNull()
    expect(reply.call.tokenOut).toBeNull()
  })

  it('**형식을 어긴 답에도 자취가 남는다** — 호출은 일어났습니다', async () => {
    // 「근거 없음」으로 다루는 갈래인데, 모델은 이미 불렸고 토큰도 썼습니다.
    // 여기서 자취를 버리면 그 호출이 감사에서 통째로 사라집니다
    vi.stubGlobal(
      'fetch',
      bodyOf({ model: 'grok-4.5', usage: { prompt_tokens: 1200 } }, 'JSON 이 아닙니다'),
    )

    const reply = await client().complete(ask)

    expect(reply.insufficient).toBe(true)
    expect(reply.call).toEqual({ model: 'grok-4.5', tokenIn: 1200, tokenOut: null })
  })

  it('글을 그대로 받는 쪽(`completeText`)도 함께 준다 → ADR-056', async () => {
    vi.stubGlobal(
      'fetch',
      bodyOf({ model: 'grok-4.5', usage: { prompt_tokens: 90 } }, '교정 결과'),
    )

    const one = await client().completeText(ask)

    expect(one.text).toBe('교정 결과')
    expect(one.call.model).toBe('grok-4.5')
    expect(one.call.tokenIn).toBe(90)
  })
})

/**
 * 감사를 남기는 흐름까지 오면 타입에서 `call` 이 사라집니다 — `chat-receiver`
 * 가 모델의 답을 `ModelReply` 로 들고 다니기 때문입니다(층 1 모듈은 이 칸을
 * 모릅니다). **객체는 그대로 지나오므로** 되꺼내는 자리를 둡니다.
 */
describe('호출 자취를 되꺼낸다 — `llmCallOf`', () => {
  it('붙어 있으면 그대로 꺼낸다', async () => {
    type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
    const impl: Fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"insufficient":true,"citations":[]}' } }],
          model: 'grok-4.5',
          usage: { prompt_tokens: 1200, completion_tokens: 340 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    vi.stubGlobal('fetch', vi.fn(impl))

    // 흐름이 보는 것과 같은 모양으로 좁혀 둡니다 — `call` 은 타입에서 안 보입니다
    const reply: ModelReply = await client().complete(ask)

    expect(llmCallOf(reply)).toEqual({ model: 'grok-4.5', tokenIn: 1200, tokenOut: 340 })
  })

  it('없으면 빈 것을 돌려준다 — 보낸 이름을 끼우지 않는다', () => {
    // 모르는 것을 「아는 것처럼」 남기면 감사 기록이 거짓이 됩니다
    expect(llmCallOf({ insufficient: true, citations: [] })).toEqual({
      model: null,
      tokenIn: null,
      tokenOut: null,
    })
    expect(llmCallOf(null)).toEqual({ model: null, tokenIn: null, tokenOut: null })
    expect(llmCallOf(undefined)).toEqual({ model: null, tokenIn: null, tokenOut: null })
  })
})
