# 아이콘 34종 v1 — 핸드오프 (시안 1a)

| | |
| --- | --- |
| 대상 | **화면 하나가 아닙니다** — 전 화면 공용 아이콘 세트 |
| 넘겨받은 날 | 2026-08-21 |
| 캔버스 | [FSEC 렌더 페이지 설계](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b) |
| 아트보드 | [「FinAlly Icons」](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b?file=FinAlly+Icons.dc.html) — 옵션 `1a` **채택** (단일안) |
| 상태 | **적용됨** — `src/public/icons.svg` · `src/components/ui/Icon.tsx` · `globals.css` |

## 이것은 화면이 아닙니다 — 기존 상태 마크를 **대체하지 않습니다**

**상태 마크(`✓`·`◆`·`○`·`!`)는 지금 규칙 그대로 둡니다.** 아이콘이 맡는 것은 **사물과 행동**뿐입니다.
[components](../../../../spec/frontend/design-system/08-16-components.md) 「`StepList`」가
기호·라벨·색 셋을 함께 쓰도록 정해 뒀고, 그 자리에 선 아이콘을 끼워 넣으면
**색만으로 구분하지 않는다**는 규칙이 흔들립니다.

## 받은 그대로입니다

| 파일 | 무엇 |
| --- | --- |
| [`PR.md`](PR.md) | 시안이 밝힌 문법·이름 34종·적용 방법·매핑 예 (받은 `README.md` 를 이 이름으로 옮긴 것뿐입니다) |
| `public/icons.svg` | 스프라이트. `<symbol id="i-{name}">` 34개 |
| `src/components/ui/Icon.tsx` | 타입드 컴포넌트. 적용 위치가 경로에 적혀 있습니다 |
| `globals-additions.css` | `icon-spin` keyframe 하나 |
| `FinAlly Icons.dc.html` · `support.js` | 레퍼런스. 구현 무관 |

## 수용 검사 결과 — **전부 통과**

[RFC-003](../../../../rfc/003-design-handoff.md) 「넣기 전에 수용 검사를 합니다」 기준입니다.
화면이 아니라 자산이므로 기한·PII·문구 항목은 해당 사항이 없습니다.

| 볼 것 | 결과 |
| --- | --- |
| 색 — 임의 hex·rgb 없음, **빨강 금지** | **통과** — 하드코딩 색 **0곳**. 34개 전부 `stroke="currentColor"` |
| 글자 크기 12.5px 하한 | **해당 없음** — 아이콘에 글자가 없습니다 |
| 장식은 뜻을 싣지 않음 · `aria-hidden` | **통과** — `Icon` 이 `aria-hidden="true"` 를 **기본값**으로 박습니다 |
| 모션이 감속 모드에서 **전부** 멈춤 | **통과** — 실측 아래 |
| 색만으로 구분하지 않음 | **통과** — 「항상 글자와 함께」가 시안의 문법이고, 아이콘 단독을 금지합니다 |
| 기한 · PII · 문구 | **해당 없음** |

### 문법이 34개 전부에서 지켜졌나 — 실측

| 볼 것 | 결과 |
| --- | --- |
| `<symbol>` 수 · `id="i-*"` 수 | **34 · 34** |
| `viewBox="0 0 24 24"` | **34** |
| `stroke="currentColor"` | **34** |
| `fill="none"` | **34** |
| `stroke-width="1.5"` | **34** |
| `stroke-linecap="round"` | **33** — `i-dots` 만 없습니다. 점 셋이 `fill="currentColor" stroke="none"` 이라 끝점이 없습니다 (정상) |
| 24 격자 밖으로 나간 도형 | **0** — 잘리는 아이콘이 없습니다 |
| `ICON_NAMES` ↔ 스프라이트 | **34 ↔ 34, 차집합 양쪽 0** |

> **안전영역 2px 을 두 개가 살짝 넘습니다** — `i-spark` 가 오른쪽으로 **0.05px**,
> `i-working` 이 **0.5px**(스트로크 바깥 절반까지 포함해 잰 값). **격자 24 안이라 잘리지 않고**,
> 16px 로 줄이면 `i-working` 의 초과분이 **0.33px** 입니다. 고치지 않았습니다.

## 실측으로 확인한 것

`/dev/icons`(개발 전용 확인 화면)를 puppeteer 로 재고 찍었습니다.

| 무엇 | 결과 |
| --- | --- |
| **외부 스프라이트가 실제로 붙나** | `<svg>` 44개 중 **빈 것 0** — `<use href="/icons.svg#i-*">` 가 전부 그려집니다 |
| 34종 전부 렌더 | ✓ (7열 격자 · 34칸) |
| 크기 단계 16 · 18 · 20 · 24 | ✓ |
| **`currentColor` 가 글자 토큰을 따라오나** | ✓ — `ink-3` · `pii` · `deadline-urgent` · `ink-1` 넷이 **서로 다른 색**으로 계산됨 |
| `spin` 이 실제로 도나 (보통) | ✓ — `animation-duration: 1.4s`, 250ms 뒤 `transform` 이 바뀜 |
| **`spin` 이 멈추나 (감속)** | ✓ — `1e-05s` · `transform: none` · 250ms 뒤 변화 **없음** |
| `tsc --noEmit` · `lint` · `build` | 통과 |

**감속 모드에서 멈추는 것은 인라인 `style` 인데도 됩니다** — `globals.css` 의 감속 블록이
`animation-duration: 0.01ms !important` 라 인라인을 이깁니다. `Icon` 이 애니메이션을
`style` 로 주는 형태여서 이 한 줄이 없으면 안 멈춥니다.

## 적용하면서 바꾼 것

| 무엇 | 왜 |
| --- | --- |
| 받은 `README.md` → **`PR.md`** | [RFC-003](../../../../rfc/003-design-handoff.md) 규칙 1 — `README.md` 자리는 **우리가 쓰는 것**입니다 |
| `icon-spin` 에 **주석을 붙여** `globals.css` `@layer base` 에 | `spin-slow` 와 **몸통이 바이트 단위로 같습니다.** 합치지 않은 이유(장식 링 20초대 ↔ 진행 표시 1.4초)를 안 적어 두면 다음 사람이 합칩니다 |
| `src/app/dev/icons/page.tsx` **신설** | 외부 스프라이트는 경로가 틀리면 **조용히 빈칸**이 됩니다. 눈으로 볼 자리가 필요했습니다. **제품 경로가 아닙니다** |

`Icon.tsx` 와 `icons.svg` 는 **한 글자도 고치지 않았습니다.**

## ⬜ 미결 — 아직 안 한 것

| 무엇 | 왜 남았나 |
| --- | --- |
| **기존 화면에 실제로 꽂는 일** | `PR.md` 「매핑 예」의 유니코드 → 아이콘 치환입니다. **이번 작업에는 없습니다** — 자산을 세우는 것과 화면을 고치는 것을 한 커밋에 섞지 않았습니다 |
| `/dev/icons` 의 수명 | 개발 전용 화면이 `app/` 에 남습니다. 배포에서 빼는 규칙이 아직 없습니다 |
| `--color-icon` 과의 관계 | 토큰에는 「아이콘 선」 색이 따로 있는데, 이 세트는 **감싸는 글자 색**을 따라옵니다. 어느 쪽이 기본인지 [tokens](../../../../spec/frontend/design-system/08-16-tokens.md) 에 적었습니다 |
