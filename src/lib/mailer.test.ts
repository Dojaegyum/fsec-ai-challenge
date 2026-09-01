/**
 * 메일러 어댑터 시험 — Brevo.
 *
 * **여기서 못 박는 것 넷:**
 * 1. 셋(열쇠·발신자·밑동) 중 하나라도 비면 만들지 않는다 — 반쪽 설정으로 서지 않는다
 * 2. 재진입 링크가 본문에 실린다 — 링크 없는 알림은 재진입이 아니다
 * 3. 오류 메시지에 열쇠도 수신자 주소도 안 담긴다
 * 4. 본문에 환급 기대치·지어낸 절차가 없다 (불변 규칙 1 · 8)
 *
 * 실제 발송은 하지 않습니다 — 그건 배포 뒤 실측이 합니다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Env } from './env'
import { createMailer } from './mailer'

import type { Reminder } from '@/modules/reminder-sender'

const KEY = 'xkeysib-비밀값이면-메시지에-나오면-안-된다'

function envWith(over: Record<string, string | undefined>): Env {
  return {
    values: {
      MAILER_API_KEY: KEY,
      MAILER_FROM: 'sender@example.com',
      APP_ORIGIN: 'https://fin-ally.example',
      ...over,
    },
  } as unknown as Env
}

const reminder: Reminder = {
  caseId: '01CASE00000000000000000000',
  email: 'victim@example.com',
  linkToken: '01LINKTOKENTESTTESTTESTTES',
  reason: 'deadline_near',
  dedupeKey: 'dk',
  deadlines: [
    {
      deadlineId: '01DL000000000000000000000',
      caseId: '01CASE00000000000000000000',
      kind: 'primary',
      status: 'open',
      dueDate: '2026-09-03',
      confirmed: true,
    },
  ],
  steps: [],
}

// 인자를 쓰지는 않지만 타입을 잡아야 `spy.mock.calls[0][1]` 이 typed 됩니다 — llm.test.ts 와 같은 트릭
type Fetch = (url: string | URL | Request, init?: RequestInit) => Promise<Response>
const ok = () => {
  const impl: Fetch = async () => new Response('{"messageId":"m1"}', { status: 201 })
  return vi.fn(impl)
}

afterEach(() => vi.unstubAllGlobals())

describe('셋 중 하나라도 비면 만들지 않는다', () => {
  it('열쇠가 없으면 null', () => {
    expect(createMailer(envWith({ MAILER_API_KEY: undefined }))).toBe(null)
  })
  it('발신자가 없으면 null — 미인증 주소로 보내면 거절만 늘어납니다', () => {
    expect(createMailer(envWith({ MAILER_FROM: undefined }))).toBe(null)
  })
  it('링크 밑동이 없으면 null — 링크 없는 알림은 재진입이 아닙니다', () => {
    expect(createMailer(envWith({ APP_ORIGIN: undefined }))).toBe(null)
  })
  it('`BREVO_API_KEY` 로도 선다 — `LLM_API_KEY ?? XAI_API_KEY` 와 같은 무늬', () => {
    expect(
      createMailer(envWith({ MAILER_API_KEY: undefined, BREVO_API_KEY: KEY })),
    ).not.toBe(null)
  })
})

describe('무엇이 나가나', () => {
  it('재진입 링크가 본문에 실린다 — 밑동의 빗금은 겹치지 않는다', async () => {
    const spy = ok()
    vi.stubGlobal('fetch', spy)
    await createMailer(envWith({ APP_ORIGIN: 'https://fin-ally.example/' }))!.send(reminder)

    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body))
    expect(body.textContent).toContain('https://fin-ally.example/c/01LINKTOKENTESTTESTTESTTES')
  })

  it('기한 날짜는 서버가 센 값 그대로 — 불변 규칙 7', async () => {
    const spy = ok()
    vi.stubGlobal('fetch', spy)
    await createMailer(envWith({}))!.send(reminder)

    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body))
    expect(body.textContent).toContain('2026-09-03 까지')
  })

  it('환급을 약속하는 낱말이 없다 — 불변 규칙 8', async () => {
    const spy = ok()
    vi.stubGlobal('fetch', spy)
    await createMailer(envWith({}))!.send(reminder)

    const body = JSON.parse(String(spy.mock.calls[0]![1]!.body))
    const whole = `${body.subject} ${body.textContent}`
    expect(whole).not.toContain('환급받')
    expect(whole).not.toContain('돌려받')
    expect(whole).not.toContain('배상')
  })

  it('열쇠는 헤더로만 간다', async () => {
    const spy = ok()
    vi.stubGlobal('fetch', spy)
    await createMailer(envWith({}))!.send(reminder)

    const init = spy.mock.calls[0]![1]!
    expect((init.headers as Record<string, string>)['api-key']).toBe(KEY)
    expect(String(init.body)).not.toContain(KEY)
  })
})

describe('오류가 비밀을 흘리지 않는다', () => {
  it('거절당하면 상태 코드만 — 본문에 수신자 주소가 실려 올 수 있습니다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"sender victim@example.com invalid"}', { status: 400 })),
    )
    const failed = await createMailer(envWith({}))!.send(reminder).catch((e: Error) => e)
    expect((failed as Error).message).toBe('메일 서비스가 거절했습니다 (400)')
    expect((failed as Error).message).not.toContain('victim')
  })

  it('닿지 못하면 열쇠 없이 그렇게만 말한다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const failed = await createMailer(envWith({}))!.send(reminder).catch((e: Error) => e)
    expect((failed as Error).message).toBe('메일 서비스에 닿지 못했습니다')
    expect((failed as Error).message).not.toContain(KEY)
  })
})
