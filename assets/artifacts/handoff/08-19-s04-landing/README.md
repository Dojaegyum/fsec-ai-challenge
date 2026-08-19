# S-04 랜딩 — 핸드오프 (시안 1c)

| | |
| --- | --- |
| 대상 화면 | **`S-04` 랜딩 `/`** → [화면 설계](../../../../spec/frontend/08-14-screens.md) |
| 넘겨받은 날 | 2026-08-19 |
| 캔버스 | [FSEC 렌더 페이지 설계](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b) — 화면 전체가 한 캔버스에 있습니다 |
| 아트보드 | 「Landing Options」 (`?file=` 로 고릅니다) |
| 시안 | 「Landing Options」 **1c** 확정본 |
| 적용 커밋 | `358ee33` — S-04 랜딩 리디자인 |
| 상태 | **적용됨** |

## 받은 그대로입니다

아래 셋은 넘겨받은 파일이고 **손대지 않았습니다.** 고쳐야 하면 캔버스에서 고쳐
새 핸드오프를 받습니다 (→ [RFC-003](../../../../rfc/003-design-handoff.md) 「받은 그대로 커밋하고, 그 뒤로 고치지 않습니다」).

| 파일 | 어디로 갔나 |
| --- | --- |
| [`PR.md`](PR.md) | — (적용 방법·바뀐 것·지킨 것·미결이 여기 적혀 있습니다) |
| [`globals-additions.css`](globals-additions.css) | `src/app/globals.css` 의 `@layer base` 안, `.rise` 아래 |
| `src/app/page.tsx` | `src/app/page.tsx` |

브랜드 자산 하나가 함께 필요했습니다 —
`assets/brand/favicon/symbol-square-white.png` → `src/public/brand/symbol-square-white.png`.

## 수용 검사 결과

[RFC-003](../../../../rfc/003-design-handoff.md) 「넣기 전에 수용 검사를 합니다」 기준입니다.

| 볼 것 | 결과 |
| --- | --- |
| 도메인 토큰만 · 빨강 없음 | 통과 |
| 실제 텍스트 13px 미만 없음 | 통과 (와이어프레임 안 장식 칩 11px은 `aria-hidden`) |
| 장식에 뜻 없음 · `aria-hidden` | 통과 — 오비트 링·글로우 전부 |
| `prefers-reduced-motion` 이 전부 멈춤 | 통과 — 새 keyframes 넷을 `@layer base` 안에 넣음 |
| 112 우선 안내 · 환급 비보장 유지 | 통과 (자리만 히어로 → 페이지 끝으로) |
| 행동 하나 | 통과 |
| `tsc` · `lint` · `build` | 통과 |

## 계약과 어긋난 것 — 어떻게 정했나

`PR.md`가 **「S-04가 1스크린 전제라면 스크롤 발생을 계약에 반영해야 한다」**를 미결로 올렸습니다.
실제로 S-04의 금지 항목에 「기능 나열·스크롤 랜딩」이 있었습니다.

**코드는 시안대로 넣고 미결을 PR에 올린 뒤, 사람이 스크롤 랜딩으로 정했습니다** —
[ADR-029](../../../../decisions/029-scroll-landing.md). 계약은 그 결정에 맞춰 고쳤고,
목업 HTML의 화면 01도 이 시안으로 갈아끼운 뒤 동결했습니다.

## 후속

각 화면 디자인이 확정되는 대로, 랜딩 ③의 **미니 목업을 실물 렌더로 하나씩 교체**합니다.
