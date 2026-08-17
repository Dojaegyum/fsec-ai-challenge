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

      // 두 패키지는 잘못된 런타임에서 import 되면 오류를 던집니다 (ADR-021 다섯).
      // 시험은 Node 에서 도는데 브라우저 모듈도 시험해야 하므로 빈 모듈로 바꿉니다.
      // next build 에서는 그대로 작동해 경계를 강제합니다.
      'server-only': fileURLToPath(
        new URL('./test-support/runtime-guard-noop.ts', import.meta.url),
      ),
      'client-only': fileURLToPath(
        new URL('./test-support/runtime-guard-noop.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['{app,lib,modules}/**/*.test.ts'],
  },
})
