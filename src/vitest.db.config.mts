import { defineConfig } from "vitest/config";

// `.mjs` 로 적는 것은 오타가 아닙니다 — TypeScript 는 ESM 에서 **내보낸 뒤의
// 확장자**를 요구하고(`.mts` 를 그대로 쓰면 TS5097), Vite 의 설정 로더는
// 그것을 원본 `.mts` 로 되돌려 읽습니다.
import base from "./vitest.config.mjs";

/**
 * DB 에 실제로 붙는 시험만 도는 설정 → `npm run test:db`.
 *
 * **기본 `npm test` 와 갈라 둔 이유**는 하나입니다. 풀러가 몰려서 터지는
 * 구간이 있어서(2026-08-24 실측: 찬 연결 10개 중 4개가 `08006`), 이것을
 * 1060건짜리 기본 시험판에 섞으면 **남의 인프라 사정으로 빨간불이 켜집니다.**
 * 그러면 사람이 빨간불을 안 봅니다.
 *
 * 별칭·환경은 기본 설정 그대로입니다 — 갈라진 것은 **무엇을 도느냐**뿐입니다.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["{lib,modules,flows,app}/**/*.dbtest.ts"],
    // 같은 사건 행을 여러 파일이 동시에 만지지 않게 한 줄로 돕니다.
    // 개발 DB 하나를 여럿이 나눠 쓰고, 연결도 함수당 하나입니다(`max: 1`)
    fileParallelism: false,
    // 찬 연결이 붙는 데 120~150ms, 재시도가 250ms 입니다. 기본 5초로는
    // 몰리는 구간에서 시험이 시간초과로 깨집니다 — 그건 우리 버그가 아닙니다
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
