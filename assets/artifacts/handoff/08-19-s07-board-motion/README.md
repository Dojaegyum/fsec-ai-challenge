# S-07 플랜 + 국면 전환 모션 — 핸드오프

| | |
| --- | --- |
| 대상 화면 | **`S-07` 사건 · 플랜 `/c/{token}`** → [화면 설계](../../../../spec/frontend/08-14-screens.md) |
| 넘겨받은 날 | 2026-08-19 |
| 캔버스 | [FSEC 렌더 페이지 설계](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b) — ⬜ **TODO(확인 필요)**: S-06 과 같은 캔버스로 적었습니다. 다른 캔버스면 알려주세요 |
| 아트보드 | 「Board S-07 Options」 **1c 골격 + 1b 히어로** · 「Phase Transition Motion」 v1 |
| 상태 | **적용됨** — 아래 「이번에 안 한 것」 |

## 받은 그대로입니다

`.dc.html`·`.jsx` 는 **디자인 레퍼런스**입니다(브라우저로 열면 렌더·재생). 프로덕션 코드가
아니라 의도한 모양의 원본이고, 저장소 환경으로 **재구현**했습니다.

| 파일 | 무엇 |
| --- | --- |
| [`PR.md`](PR.md) | 시안이 밝힌 레이아웃·모션·토큰 매핑 (원문 README) |
| `Board S-07 Options.dc.html` | 보드 시안. **1c 골격 + 1b 히어로 결합 채택** (1a 3열 탈락) |
| `Phase Transition Motion.dc.html` + `phase-transitions.jsx` | 모션 정본 **v1** (13.5s 루프) |

`support.js`·`animations-v3.jsx`·`tweaks-panel.jsx`(레퍼런스 재생용 런타임)와
`brand/symbol-mark.png`(이미 `src/public/brand/` 에 있음)는 담지 않았습니다 —
[S-06 핸드오프](../08-19-s06-chat/README.md)와 같은 기준입니다.

**모션은 v2 가 상위입니다.** 증거함 구간(④)이 더해진 판이
[08-19-s08-evidence](../08-19-s08-evidence/README.md) 에 있고, 구현은 **그쪽을 따랐습니다.**

## 어디로 갔나

| 무엇 | 어디 |
| --- | --- |
| S-07 본문 | `src/app/c/[token]/plan.tsx` |
| 셸·두 축·전환 오케스트레이션 | `src/app/c/[token]/page.tsx` |
| 흡수 곡선 (블랙홀 변형) | `src/app/c/[token]/absorb.ts` |
| 미니 챗 | `src/app/c/[token]/chat.tsx` 의 `MiniChat` |
| 새 keyframes·모션 토큰 | `src/app/globals.css` `@layer base` |

## 고친 것 — 수용 검사에서 걸린 것들

| 무엇 | 시안 | 넣은 것 | 왜 |
| --- | --- | --- | --- |
| 표면 hue | `oklch(0.16 0.004 **285.9**)` | `--stage` (hue **268**) | 저채도 표면은 268 로 모읍니다 → [tokens](../../../../spec/frontend/design-system/08-16-tokens.md) |
| 작은 글씨 | `11.5px` · `12px` 여러 곳 | **12.5px** | 텍스트 하한 → [ADR-032](../../../../decisions/032-text-floor.md) |
| 낱말 | 「보드 국면」 | **「플랜」**(`focus: "plan"`) | [ADR-035](../../../../decisions/035-screen-state-axes.md) |
| 픽셀 좌표 | 1280×720 고정 | **재서 씁니다** | 우리는 반응형입니다. 곡선·상수만 가져오고 끝점은 `getBoundingClientRect` |

## 이번에 안 한 것

- **모션 루프 재생기**(`CompositionStage`)는 옮기지 않았습니다 — 시연용 장치입니다.
- **전환 트리거가 서버 시그널이 아닙니다.** 지금은 화면 위 개발용 스위치로 축을 옮깁니다.
  `referenced_steps` → `side`, 플랜 생성·재방문 → `focus` 배선이 남았습니다.
- 「지금 하기」·「서류 초안 열기」는 **아직 아무 데도 가지 않습니다.**
