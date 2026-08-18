import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // 도메인 모듈 테스트만 봅니다. Next 빌드 산출물은 제외
    include: ["modules/**/*.test.ts"],
    environment: "node",
  },
});
