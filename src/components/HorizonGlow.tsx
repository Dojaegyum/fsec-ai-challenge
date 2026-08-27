/**
 * 오렌지 호라이즌 — 배경 장식. 토큰은 `--horizon`.
 *
 * 08-16 진입 플로우 시안(`assets/artifacts/plans/08-16-entry-flow-mockup.html`
 * 「원본 glows.png 재현」)을 옮긴 것입니다 — **가로로 납작한 밝은 코어 띠** 위로
 * 넓게 번지는 헤일로, 그 바깥의 옅은 번짐. 시안에서는 카드 상단에 걸린 일출이었고
 * 여기서는 화면 아래에 걸린 일몰입니다(띠가 아래 가장자리, 번짐이 위로).
 *
 * 랜딩 하나에만 있던 것이 `/start`·사건 화면(`/c/{token}`)에서 다시 쓰이게 되어 컴포넌트로 뽑았습니다
 * → spec/frontend/design-system/08-16-components.md 「화면이 서면서 실제로 생긴 것」
 *
 * 규칙
 *  · **뜻을 싣지 않습니다** (tokens 「--color-horizon」). `aria-hidden` · `pointer-events-none`
 *  · **부모가 `relative isolate` 여야 합니다.** 글 아래(z-index −1)에 깔리려면 부모가
 *    쌓임 맥락을 만들어야 합니다 — 없으면 본문 위로 떠서 글자를 덮습니다
 *  · 부모에 `overflow-hidden` 을 두지 마세요 — `/start` 의 단계 레일이 `sticky` 라
 *    그 순간 붙지 않게 됩니다. 글로우는 상자 밖으로 안 나가게 그려져 있어 잘라낼 것이 없습니다
 *  · 감속 모드는 globals.css 가 `.appear` 를 함께 끕니다
 */

/** 색은 전부 `--horizon` 계열입니다 — 앰버(--deadline-urgent)와 섞지 마세요 */
const HORIZON = [
  // 밝은 코어 — 가로로 눌린 띠. 아래 가장자리에 걸려 위쪽 반만 보입니다
  "radial-gradient(ellipse 34% 5% at 50% 100%, oklch(0.811 0.14 66.9 / 95%) 0%, oklch(0.78 0.15 62 / 55%) 46%, oklch(0.75 0.15 58 / 0%) 74%)",
  // 위로 퍼지는 헤일로
  "radial-gradient(ellipse 54% 34% at 50% 100%, oklch(0.76 0.15 58 / 42%) 0%, oklch(0.70 0.15 52 / 16%) 42%, oklch(0.66 0.14 50 / 0%) 72%)",
  // 바깥의 옅은 번짐
  "radial-gradient(ellipse 42% 52% at 50% 100%, oklch(0.86 0.10 72 / 18%) 0%, oklch(0.82 0.11 68 / 0%) 68%)",
].join(",");

export function HorizonGlow({
  attach = "page",
  opacity = 0.6,
}: {
  /**
   * `page` — 부모의 아래 끝(문서 끝)에 놓입니다. 스크롤해 내려가면 나타납니다.
   * `viewport` — 화면 아래에 붙어 스크롤과 무관하게 늘 보입니다
   */
  attach?: "page" | "viewport";
  /**
   * 세기 0~1. 오래 머무는 화면(사건 화면)은 더 낮춥니다.
   *
   * **2026-08-27 에 전부 40% 연하게 낮췄습니다** — 기본 1 → 0.6, 사건 화면
   * 0.7 → 0.42. 눌러 보니 바닥이 너무 셌습니다. 둘의 관계(사건 화면이 7할)는
   * 그대로 두었습니다.
   *
   * inline `opacity` 가 아니라 `--appear-to` 로 넘기는 이유는 globals.css 의 `appear` 참고
   */
  opacity?: number;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none inset-x-0 bottom-0 -z-10 h-[44vh] appear ${
        attach === "viewport" ? "fixed" : "absolute"
      }`}
      style={
        {
          background: HORIZON,
          filter: "blur(12px)",
          "--appear-to": opacity,
        } as React.CSSProperties
      }
    />
  );
}
