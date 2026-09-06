import { describe, expect, it } from 'vitest'
import { createContainer } from './container'
import { readEnv } from './env'
import { handleRoute } from './request'

describe('라우트가 헤더를 실을 수 있다 — Set-Cookie 자리 (API §7.1)', () => {
  it('body 옆의 headers 가 응답에 붙고, 계측 헤더는 그대로다', async () => {
    const res = await handleRoute(
      new Request('http://x/api/ping'),
      async () => ({ body: { ok: true }, headers: { 'Set-Cookie': 'a=b; Path=/' } }),
      { container: createContainer(readEnv({})) },
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toBe('a=b; Path=/')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
