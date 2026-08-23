import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // tsconfig.json 의 paths 와 같은 별칭. 둘이 어긋나면 테스트만 조용히 깨집니다
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` 는 기본 조건에서 던지도록 만들어진 표식 패키지라
      // 테스트 실행기가 서버 모듈을 못 읽습니다. Next 가 서버에서 쓰는
      // 빈 구현으로 바꿔 둡니다.
      //
      // **경계가 헐거워지지 않습니다.** 이 표식의 실제 강제는 `next build` 가
      // 하고(브라우저에서 import 하면 빌드가 깨집니다), 그건 그대로입니다.
      // `client-only` 는 기본 조건에서 빈 구현이라 손댈 것이 없습니다.
      // 패키지가 하위 경로를 exports 로 열어두지 않아 파일을 직접 가리킵니다.
      // 경로가 바뀌면 테스트가 「모듈 없음」으로 시끄럽게 깨집니다 — 조용히
      // 통과하지 않으므로 안전한 실패입니다.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    // 도메인 모듈과 공용(lib) 테스트, 그리고 src 바로 아래 파일의 시험을 봅니다.
    // `proxy.ts` 는 Next 규약상 app/ 과 같은 층에 있어야 해서 lib/ 로 못 옮깁니다
    // → node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
    // Next 빌드 산출물(.next)은 제외됩니다
    // `.tsx` 도 봅니다 — 렌더에는 **금지 규칙**이 붙어 있고(빨강 금지 · 「모름」 안 지우기 ·
    // 화면이 날짜를 세지 않기), 그건 타입도 순수 함수 시험도 못 잡습니다.
    include: ["{lib,modules,flows,app}/**/*.test.{ts,tsx}", "*.test.ts"],
    // **jsdom 을 쓰지 않습니다.** 렌더 시험은 `react-dom/server` 의
    // `renderToStaticMarkup` 으로 HTML 문자열을 받아 봅니다 — 브라우저가 필요 없고,
    // 의존성이 늘지 않으며, 「무엇이 그려지나」를 보는 데는 그것으로 충분합니다.
    // 클릭·포커스처럼 **실제 상호작용**을 봐야 할 때 그때 jsdom 을 답니다.
    environment: "node",
  },
});
