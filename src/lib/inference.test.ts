/**
 * 전사 서비스 어댑터 시험.
 *
 * 검증 대상: src/lib/inference.ts · services/transcriber/app.py 의 계약
 *
 * **여기서 못 박는 것 넷:**
 * 1. 번역만 한다 — 판단이 섞이면 서비스를 갈아끼울 때 모듈이 따라 바뀐다
 * 2. 모르는 상태를 「도는 중」으로 두지 않는다 — 영원히 폴링하는 화면이 된다
 * 3. 응답 본문을 오류 메시지에 담지 않는다 — 파일 내용이 섞여 올 수 있다
 * 4. 줄을 여기서 거르지 않는다 — 모듈이 거른다. 두 곳에서 거르면 추적이 안 된다
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createInferenceEngines } from './inference'

const CFG = { baseUrl: 'http://svc.test', timeoutMs: 1000 }

/** 넘긴 것을 돌려주는 가짜 서버. 요청도 기록해 둔다 */
function server(replies: Array<{ status?: number; body?: unknown }>) {
  const seen: Array<{ url: string; init: RequestInit }> = []
  let turn = 0
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} })
    const reply = replies[Math.min(turn++, replies.length - 1)]
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => {
        if (reply.body === undefined) throw new Error('본문 없음')
        return reply.body
      },
    } as Response
  })
  vi.stubGlobal('fetch', spy)
  return seen
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('맡긴다', () => {
  it('종류와 주소를 그대로 넘기고 번호를 받는다', async () => {
    const seen = server([{ body: { job_id: 'abc123' } }])
    const { stt } = createInferenceEngines(CFG)

    const id = await stt.submit({ url: 'https://store/x.m4a', mimeType: 'audio/m4a' })

    expect(id).toBe('abc123')
    expect(seen[0].url).toBe('http://svc.test/jobs')
    expect(JSON.parse(String(seen[0].init.body))).toEqual({
      kind: 'audio',
      url: 'https://store/x.m4a',
      mime_type: 'audio/m4a',
    })
  })

  it('이미지는 종류만 다르다 — 같은 서비스를 부른다', async () => {
    const seen = server([{ body: { job_id: 'x' } }])
    const { ocr } = createInferenceEngines(CFG)

    await ocr.submit({ url: 'https://store/s.png', mimeType: 'image/png' })

    expect(JSON.parse(String(seen[0].init.body)).kind).toBe('image')
  })

  it('어휘 힌트가 있으면 함께 넘긴다', async () => {
    // ⬜ 효과는 아직 검증되지 않았습니다 → docs/research/09 §5.6
    const seen = server([{ body: { job_id: 'x' } }])
    const { stt } = createInferenceEngines(CFG)

    await stt.submit({
      url: 'https://store/x.m4a',
      mimeType: 'audio/m4a',
      vocabulary: ['케이뱅크', '토스뱅크'],
    })

    expect(JSON.parse(String(seen[0].init.body)).vocabulary).toEqual([
      '케이뱅크',
      '토스뱅크',
    ])
  })

  it('어휘가 비면 칸을 아예 안 보낸다', async () => {
    const seen = server([{ body: { job_id: 'x' } }])
    const { stt } = createInferenceEngines(CFG)

    await stt.submit({ url: 'u', mimeType: 'audio/m4a', vocabulary: [] })

    expect(JSON.parse(String(seen[0].init.body))).not.toHaveProperty('vocabulary')
  })

  it('비밀값이 있으면 붙인다', async () => {
    const seen = server([{ body: { job_id: 'x' } }])
    const { stt } = createInferenceEngines({ ...CFG, token: 'secret' })

    await stt.submit({ url: 'u', mimeType: 'audio/m4a' })

    const headers = seen[0].init.headers as Record<string, string>
    expect(headers['x-finally-token']).toBe('secret')
  })

  it('번호를 안 주면 실패다 — 물어볼 대상이 없다', async () => {
    server([{ body: { ok: true } }])
    const { stt } = createInferenceEngines(CFG)

    await expect(stt.submit({ url: 'u', mimeType: 'audio/m4a' })).rejects.toThrow()
  })
})

describe('물어본다', () => {
  it('아직이면 진행률을 낸다', async () => {
    server([{ body: { status: 'running', percent: 62 } }])
    const { stt } = createInferenceEngines(CFG)

    expect(await stt.poll('j1')).toEqual({ status: 'running', percent: 62 })
  })

  it('진행률이 숫자가 아니면 0 으로 본다 — 던지지 않는다', async () => {
    server([{ body: { status: 'running', percent: '많이' } }])
    const { stt } = createInferenceEngines(CFG)

    expect(await stt.poll('j1')).toEqual({ status: 'running', percent: 0 })
  })

  it('끝났으면 읽은 것을 그대로 넘긴다 — 여기서 거르지 않는다', async () => {
    // 모듈이 unknown 으로 받아 스스로 거릅니다. 두 곳에서 거르면
    // 어느 쪽이 버렸는지 알 수 없어집니다
    const lines = [{ text: '여보세요', startMs: 0, junk: '이상한칸' }]
    server([{ body: { status: 'done', engine: 'faster-whisper medium', lines } }])
    const { stt } = createInferenceEngines(CFG)

    expect(await stt.poll('j1')).toEqual({
      status: 'done',
      output: { engine: 'faster-whisper medium', lines },
    })
  })

  it('실패는 사유를 그대로 넘긴다', async () => {
    server([{ body: { status: 'failed', reason: 'too_large' } }])
    const { stt } = createInferenceEngines(CFG)

    expect(await stt.poll('j1')).toEqual({ status: 'failed', reason: 'too_large' })
  })

  it('모르는 상태는 실패로 본다 — 영원히 폴링하지 않는다', async () => {
    server([{ body: { status: '뭔가새로운것' } }])
    const { stt } = createInferenceEngines(CFG)

    expect(await stt.poll('j1')).toEqual({ status: 'failed', reason: 'unknown_status' })
  })

  it('작업 번호를 주소에 안전하게 넣는다', async () => {
    const seen = server([{ body: { status: 'running', percent: 1 } }])
    const { stt } = createInferenceEngines(CFG)

    await stt.poll('a b/c')

    expect(seen[0].url).toBe('http://svc.test/jobs/a%20b%2Fc')
  })
})

describe('실패를 다루는 방식', () => {
  it('서비스가 거절하면 던진다', async () => {
    server([{ status: 503 }])
    const { stt } = createInferenceEngines(CFG)

    await expect(stt.poll('j1')).rejects.toThrow()
  })

  it('응답 본문을 오류 메시지에 담지 않는다', async () => {
    // 서비스가 뱉은 말에 파일 내용이 섞여 올 수 있고, 이 값은 감사 기록으로 갑니다
    server([{ status: 500, body: { detail: '110-234-567890 처리 실패' } }])
    const { stt } = createInferenceEngines(CFG)

    await expect(stt.poll('j1')).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('110-234'),
      }) as Error,
    )
  })

  it('닿지 못하면 던진다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))
    const { stt } = createInferenceEngines(CFG)

    await expect(stt.poll('j1')).rejects.toThrow()
  })

  it('이 계층의 예외를 지어내지 않는다 — 모듈이 감싼다', async () => {
    // 08-16-errors.md §2 가 STT·OCR 실패에 INGEST_FAILED 를 정해 뒀습니다.
    // 여기서 다른 코드를 만들면 재시도 규칙이 두 곳에서 갈립니다
    server([{ status: 500 }])
    const { stt } = createInferenceEngines(CFG)

    const thrown = await stt.poll('j1').catch((e: unknown) => e)

    expect(thrown).toBeInstanceOf(Error)
    expect(thrown).not.toHaveProperty('httpStatus')
  })
})
