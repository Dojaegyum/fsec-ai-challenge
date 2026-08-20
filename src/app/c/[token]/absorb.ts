/**
 * 흡수 — 챗이 우하단 슬롯으로 빨려들고, 다시 뱉어져 나오는 전환.
 *
 * 정본: assets/artifacts/handoff/08-19-s08-evidence/phase-transitions.jsx
 *       (README 「② 챗+패널 → 보드 (흡수)」 · 「③ 보드 → 챗 (복귀)」)
 *
 * **왜 CSS 가 아니라 여기인가** — 끝점이 레이아웃에서 나옵니다. 시안은 1280×720
 * 고정 캔버스라 픽셀을 박아 뒀지만 우리 화면은 반응형이라, 슬롯의 실제 위치를
 * 재서 그 자리로 보내야 합니다. 그래서 곡선을 **표본으로 떠서** keyframes 를
 * 만들고 Web Animations API 로 돌립니다 — 값은 시안 그대로입니다.
 *
 * ⚠️ **감속 모드를 여기서 직접 확인합니다.** globals.css 의
 * `prefers-reduced-motion` 블록은 CSS 애니메이션만 멈추고 WAAPI 는 못 막습니다.
 */

/** 시안이 쓰는 유일한 이징 — `--motion-ease` 와 같은 곡선입니다 */
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/** 구간 [a, b] 안에서만 0 → 1 로 움직입니다 (시안의 `MOTION.move`) */
const seg = (t: number, a: number, b: number) =>
  easeInOutCubic(Math.min(1, Math.max(0, (t - a) / (b - a))));

const lerp = (a: number, b: number, m: number) => a + (b - a) * m;

/** 시안의 변형 상수 — 이 값을 바꾸면 다른 모션이 됩니다 */
const PINCH = 0.16; // 가로 핀치
const STRETCH = 0.09; // 세로 늘어짐
const SKEW = 3.2; // deg
const TILT_X = 7; // deg
const TILT_Y = -15; // deg
const PERSPECTIVE = 1400; // px
const RADIUS = 26; // px — 중간에 더해지는 둥글기

/**
 * 축별 타이밍. 총 1.5초 안에서 축이 **따로 움직여** 곡선 궤적이 됩니다.
 *
 * · 흡수 — x 가 먼저 붙고 → y 가 늦게 다이브 → 스케일이 따라붙습니다
 * · 복귀 — **역재생이 아닙니다.** y 가 먼저(위로 떠오른 뒤) → x 가 나중(왼쪽으로 펼쳐짐)
 */
const TIMING = {
  absorb: { x: [0.2, 1.35], y: [0.45, 1.55], s: [0.35, 1.5] },
  emit: { x: [0.65, 1.8], y: [0.5, 1.55], s: [0.55, 1.7] },
} as const;

const TOTAL = 1.5; // 초 — `--motion-absorb`
const SAMPLES = 30; // 표본 수. 곡선이 30등분이면 눈에 계단이 안 보입니다

/** getBoundingClientRect 에서 필요한 것만. 재서 들고 다닙니다 */
export type DOMRectLike = { x: number; y: number; w: number; h: number };
type Rect = DOMRectLike;

export type AbsorbDirection = "absorb" | "emit";

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * keyframes 를 만듭니다. **요소의 제 자리는 언제나 `from`** 이고,
 * transform 으로만 움직입니다 (레이아웃을 건드리지 않아야 그리는 비용이 안 듭니다).
 *
 * · `absorb` — 제 자리(`from`)에서 출발해 `to` 로 빨려듭니다
 * · `emit`   — **같은 곡선을 거꾸로** 읽습니다. 첫 프레임이 `to` 모습이고
 *   마지막 프레임이 제 자리입니다. 그래서 들어오는 챗 본문에 그대로 걸면
 *   슬롯에서 튀어나와 펼쳐집니다 — 인자 순서는 흡수와 똑같이 (본문, 슬롯) 입니다
 */
export function absorbKeyframes(
  from: Rect,
  to: Rect,
  direction: AbsorbDirection,
): Keyframe[] {
  const t = TIMING[direction];
  const scaleTo = to.w / from.w;
  const frames: Keyframe[] = [];

  for (let i = 0; i <= SAMPLES; i++) {
    const time = (i / SAMPLES) * TOTAL;

    // 복귀는 같은 곡선을 거꾸로 읽습니다 — 끝점이 뒤바뀔 뿐 상수는 같습니다
    const raw = (a: number, b: number) => seg(time, a, b);
    const mx = direction === "absorb" ? raw(t.x[0], t.x[1]) : 1 - raw(t.x[0], t.x[1]);
    const my = direction === "absorb" ? raw(t.y[0], t.y[1]) : 1 - raw(t.y[0], t.y[1]);
    const ms = direction === "absorb" ? raw(t.s[0], t.s[1]) : 1 - raw(t.s[0], t.s[1]);

    // 블랙홀 변형 — 중간에서 최대, 양 끝점은 0. 그래서 시작·끝이 정형입니다
    const d = Math.sin(Math.min(1, Math.max(0, ms)) * Math.PI);

    const scale = lerp(1, scaleTo, ms);
    const dx = lerp(0, to.x - from.x, mx);
    const dy = lerp(0, to.y - from.y, my);
    const sx = scale * (1 - PINCH * d);
    const sy = scale * (1 + STRETCH * d);

    frames.push({
      offset: i / SAMPLES,
      transform:
        `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) ` +
        `perspective(${PERSPECTIVE}px) ` +
        `rotateX(${(TILT_X * d).toFixed(2)}deg) rotateY(${(TILT_Y * d).toFixed(2)}deg) ` +
        `scale(${sx.toFixed(4)}, ${sy.toFixed(4)}) ` +
        `skewY(${(SKEW * d).toFixed(2)}deg) rotate(${(-2.2 * d).toFixed(2)}deg)`,
      borderRadius: `${(lerp(0, 14, ms) + RADIUS * d).toFixed(1)}px`,
    });
  }
  return frames;
}

/** 원본 챗은 축소 말미에 사라지고, 그 자리를 **진짜 미니 챗**이 이어받습니다 */
export const CROSSFADE = {
  /** 원본이 빠지는 구간 (진행률) */
  out: { start: 0.55, end: 0.9 },
  /** 미니 챗이 들어오는 구간 — 겹칩니다 */
  in: { start: 0.68, end: 1.0 },
} as const;

export const ABSORB_MS = TOTAL * 1000;

/**
 * 카드 겉모습(배경·테두리·그림자)은 **여기서 하지 않습니다** — `.ghost-card` 가 합니다.
 *
 * WAAPI 가 `oklch()` 색을 보간하지 못해 속성이 통째로 무시됐고, 유령이 투명한 채로
 * 아래 화면 위에 겹쳐 글자가 뒤엉켰습니다. CSS keyframes 는 같은 색을 문제없이 다룹니다.
 * 타이밍은 `globals.css` 의 `ghost-card` 가 이 길이에 맞춰져 있습니다.
 */

export function fadeKeyframes(kind: "out" | "in"): Keyframe[] {
  const r = CROSSFADE[kind];
  const from = kind === "out" ? 1 : 0;
  const to = kind === "out" ? 0 : 1;
  return [
    { offset: 0, opacity: from },
    { offset: r.start, opacity: from },
    { offset: r.end, opacity: to },
    { offset: 1, opacity: to },
  ];
}

export const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
};
