/**
 * 배포본 스모크의 설정 — `npm run smoke`.
 *
 * 정본: docs/plans/08-23-qa-readiness.md Task 8 · rfc/001-repo-structure.md 「배포본 스모크」
 * 근거: ADR-053(머지가 곧 배포 — 올라간 것이 실제로 도는지는 따로 걸어야 합니다)
 *
 * **게이트가 아닙니다.** 배포 주소가 있어야 돌고, 그래서 PR 마다 못 돕니다 —
 * `code-check` 와 섞지 않고 `.github/workflows/smoke.yml` 이 배포 뒤에 따로 돕니다.
 *
 * 주소는 `SMOKE_BASE_URL` 로 줍니다. 비우면 프로덕션(`deploy/README.md` 「지금 올라가
 * 있는 것」)입니다. 로컬 빌드를 걸려면 `next start -p 3311` 을 띄우고
 * `SMOKE_BASE_URL=http://127.0.0.1:3311 npm run smoke`.
 */

import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './smoke',
  // 모델을 부르지 않는 경로만 걸으므로 한 시험이 1분을 넘기면 그 자체가 신호입니다
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // 배포 직후의 찬 시작(콜드 스타트)은 한 번 더 걸어 봅니다. 두 번 연달아 실패면 진짜입니다
  retries: process.env.CI ? 1 : 0,
  // **요청을 겹쳐 보내지 않습니다.** 몰아치면 뒤쪽이 503(`KB_UNAVAILABLE`)으로 떨어지고
  // 그건 제품 결함이 아니라 풀러 사정입니다 → qa-readiness 「몰아치면 KB_UNAVAILABLE 이 납니다」
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'smoke/report' }]]
    : [['list']],
  outputDir: 'smoke/results',
  use: {
    baseURL: process.env.SMOKE_BASE_URL ?? 'https://fin-ally-khaki.vercel.app',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
