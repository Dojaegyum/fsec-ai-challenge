import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 도메인 모듈 시험 설정.
 *
 * 화면(React) 시험은 아직 없습니다 — 필요해지면 environment 를 나눕니다.
 * 경로 별칭 `@/` 는 tsconfig.json 의 paths 와 같은 뜻으로 맞춰 둡니다.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['{app,lib,modules}/**/*.test.ts'],
  },
})
