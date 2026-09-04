/**
 * 배포본 스모크 — **실제 주소에서 한 바퀴.**
 *
 * 정본: docs/plans/08-23-qa-readiness.md Task 8 · spec/common/08-14-api.md §3.1 §3.6 §3.10 §3.11
 * 근거: ADR-053(머지가 곧 배포) · ADR-039(주소에 실리는 것은 링크 토큰) ·
 *       ADR-046(사건과 T0 를 함께 만든다) · ADR-050(볼트 되받기)
 *
 * ## 왜 `npm test` 가 아닌가
 *
 * `npm test` 는 순수 함수와 렌더 문자열을 봅니다. 여기서 보는 것은 **배포된 서버와
 * 브라우저가 실제로 왕복하는가**뿐이라 게이트와 섞지 않습니다 — 2026-08-24 의
 * `case_case_vault` 처럼 타입도 빌드도 통과한 채 런타임에서만 죽는 자리가 이 시험의 대상입니다.
 *
 * ## 무엇을 보나 — Task 8 의 다섯 + Task 9 ⑥ ⓐ 의 볼트 왕복
 *
 *   랜딩이 뜬다 · 사건이 만들어진다 · 링크로 재진입된다 · 플랜에 단계가 있다 ·
 *   잘못된 토큰이 404 다 · 볼트에 맡긴 것이 그대로 돌아온다
 *
 * **값의 내용은 안 봅니다.** 단계 제목이 무엇인지는 KB 릴리스의 일이고, 여기서 고정하면
 * 릴리스마다 시험이 깨집니다. 보는 것은 「있는가」와 「계약의 모양」입니다.
 *
 * ## 사건을 실제로 만듭니다
 *
 * 운영 DB 에 시험 사건이 남습니다. 파기일(마지막 활동일부터 180일 · ADR-016)에 함께
 * 지워지고, 사건을 지우는 API 는 계약에 없어 만들지 않습니다 —
 * `assets/datasets/08-27-qa-walk/` 의 걷기 도구와 같은 전제입니다.
 *
 * ## 모델을 부르지 않습니다
 *
 * 챗(`POST …/messages`)은 걸지 않습니다. 모델 호출은 11~25초에 꼬리가 55초를 넘고
 * (qa-readiness 「챗이 돕니다」), 그 실패는 배포가 아니라 모델 사정입니다.
 * 챗은 `qa_chat.py` 로 따로 봅니다.
 */

import { expect, test, type APIRequestContext } from '@playwright/test'

/** `link_token`·`case_id` 의 규격 — 26자 Crockford Base32 → 09-data-model.md §2 */
const CROCKFORD_26 = /^[0-9A-HJKMNP-TV-Z]{26}$/

interface Opened {
  readonly case_id: string
  readonly link_token: string
  readonly plan: { readonly steps: readonly { readonly title: string }[] }
}

/** §3.1 — 사건 하나를 열고 계약의 모양을 확인합니다 */
async function openCase(request: APIRequestContext): Promise<Opened> {
  const res = await request.post('/api/cases', { data: { track: 'victim' } })
  expect(res.status(), await res.text()).toBe(201)

  const body = (await res.json()) as Opened
  expect(body.link_token).toMatch(CROCKFORD_26)
  expect(body.case_id).toMatch(CROCKFORD_26)
  // 둘은 규격이 같아 형식으로는 못 가릅니다 — 값이 다른 것만 봅니다 (ADR-039).
  // `case_id` 를 주소에 실으면 조회가 언제나 빕니다
  expect(body.link_token).not.toBe(body.case_id)
  return body
}

test('랜딩이 뜬다 — 행동은 「지금 시작하기」 하나 (S-04)', async ({ page }) => {
  const res = await page.goto('/')
  expect(res?.status()).toBe(200)
  await expect(page.getByRole('link', { name: '지금 시작하기' })).toBeVisible()
})

test('사건이 만들어진다 — T0 가 함께 온다 (§3.1 · ADR-046)', async ({ request }) => {
  const opened = await openCase(request)
  // 슬롯이 하나도 없어도 T0 공통 안전 절차가 붙습니다 → 08-14-slot-tiering.md 「진입 자체로 충분」
  expect(opened.plan.steps.length).toBeGreaterThan(0)
})

test('링크로 재진입된다 — 플랜이 그대로 있다 (§3.10 · ADR-021)', async ({ page, request }) => {
  const opened = await openCase(request)

  const again = await request.get(`/api/cases/${opened.link_token}`)
  expect(again.status(), await again.text()).toBe(200)
  const bundle = (await again.json()) as Opened
  expect(bundle.case_id).toBe(opened.case_id)
  expect(bundle.plan.steps.length).toBe(opened.plan.steps.length)

  // 브라우저로도 — `/c/{token}` 이 §3.10 을 한 번 부르고 단계 제목을 그립니다.
  // 제목의 내용은 KB 의 것이라 고정하지 않고, **서버가 준 그 제목**이 보이는지만 봅니다
  const first = bundle.plan.steps[0].title
  await page.goto(`/c/${opened.link_token}`)
  await expect(page.getByText(first).first()).toBeVisible({ timeout: 30_000 })
})

test('플랜에 단계가 있고 단계마다 근거가 붙어 있다 (§3.6 · 불변 규칙 1)', async ({ request }) => {
  const opened = await openCase(request)
  const res = await request.get(`/api/cases/${opened.link_token}/plan`)
  expect(res.status(), await res.text()).toBe(200)

  const plan = (await res.json()) as {
    kb_version: string | null
    steps: readonly {
      title: string
      citation: { kb_version?: string; source_url?: string; effective_from?: string } | null
    }[]
  }
  expect(plan.steps.length).toBeGreaterThan(0)
  expect(plan.kb_version).toBeTruthy()
  for (const step of plan.steps) {
    // 근거 없는 단계는 만들지 않습니다 — 인용이 빠진 채 200 이 나가면 그게 결함입니다
    expect(step.citation?.kb_version, step.title).toBeTruthy()
    expect(step.citation?.source_url, step.title).toBeTruthy()
    expect(step.citation?.effective_from, step.title).toBeTruthy()
  }
})

test('없는 토큰은 404, 모양이 틀린 토큰은 400 (§3.10 · ADR-039)', async ({ request }) => {
  // 규격은 맞지만 없는 값 — 열거 방어(IP당 분당 10회)가 세는 자리입니다
  const missing = await request.get('/api/cases/ZZZZZZZZZZZZZZZZZZZZZZZZZZ')
  expect(missing.status()).toBe(404)
  const notFound = (await missing.json()) as { error: { code: string; message: string } }
  expect(notFound.error.code).toBe('CASE_NOT_FOUND')
  // 파기된 것과 없는 것을 가르지 않습니다 — 문구 하나가 둘 다 설명합니다 (lib/errors.ts)
  expect(notFound.error.message).toContain('180일')

  // 규격이 틀린 값은 왕복을 안 태우고 앞에서 거릅니다
  const malformed = await request.get('/api/cases/not-a-token')
  expect(malformed.status()).toBe(400)
  const bad = (await malformed.json()) as { error: { code: string } }
  expect(bad.error.code).toBe('BAD_REQUEST')
})

test('볼트 왕복 — 맡긴 암호문이 그대로 돌아온다 (§3.11 · ADR-050)', async ({ request }) => {
  const opened = await openCase(request)
  const base = `/api/cases/${opened.link_token}/vault`

  // 서버는 이 값을 읽을 수 없습니다 — 그래서 아무 base64 나 됩니다. 보는 것은 왕복뿐입니다
  const entries = [
    { token: '[계좌-1]', ciphertext: 'c21va2UtY2lwaGVydGV4dC0x' },
    { token: '[이름-1]', ciphertext: 'c21va2UtY2lwaGVydGV4dC0y' },
  ]
  const put = await request.post(base, { data: { entries } })
  expect(put.status(), await put.text()).toBe(200)
  expect(((await put.json()) as { stored: number }).stored).toBe(2)

  const got = await request.get(base)
  expect(got.status(), await got.text()).toBe(200)
  const back = (await got.json()) as { entries: typeof entries; issued: string[] }
  expect(back.entries).toEqual(expect.arrayContaining(entries))
  // 서버가 붙인 이름표까지 — 브라우저가 다음 번호를 잇는 근거입니다 (§3.11 「issued」)
  expect(back.issued).toEqual(expect.arrayContaining(['[계좌-1]', '[이름-1]']))
})
