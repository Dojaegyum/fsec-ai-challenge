import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json 의 paths 와 같은 별칭. 둘이 어긋나면 테스트만 조용히 깨집니다
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    // 도메인 모듈 테스트만 봅니다. Next 빌드 산출물은 제외
    include: ["modules/**/*.test.ts"],
    environment: "node",
  },
});
