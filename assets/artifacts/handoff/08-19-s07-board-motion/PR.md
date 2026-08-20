# Handoff: 사건 화면(보드 국면) + 국면 전환 모션

## Overview
FinAlly `/c/{token}` 사건 화면의 **보드 국면**(스펙 ID S-07)과, LLM 시그널에 따른 **국면 전환 모션**(챗 ↔ 패널 ↔ 보드)입니다. 대상 저장소 `Dojaegyum/fsec-ai-challenge` — S-06 챗 국면은 `design_handoff_chat_s06/` 번들이 선행 자료이고, 이 화면은 같은 `/c/{token}` 경로의 다른 상태입니다(내비게이션이 아니라 국면 전환).

## About the Design Files
`.dc.html`/`.jsx` 파일은 **HTML로 만든 디자인 레퍼런스**입니다(브라우저에서 열면 렌더·재생됨). 프로덕션 코드가 아닙니다 — 저장소의 기존 환경(Next.js App Router, Tailwind v4, globals.css 도메인 토큰)으로 재구현하세요. 모션은 Framer Motion 또는 CSS transition으로 아래 스펙 값 그대로 옮기면 됩니다. `animations-v3.jsx`·`tweaks-panel.jsx`·`support.js`는 레퍼런스 재생용 런타임일 뿐, 구현과 무관합니다.

## Fidelity
**High-fidelity.** 보드 레이아웃·색·타이포·카피, 모션의 타이밍·이징·변형량 전부 확정값.

## 채택안
- **보드 골격 = `Board S-07 Options.dc.html`의 1c** (S-06과 같은 2열: 콘텐츠 + 350px 우측 슬롯) **+ 1b의 히어로 스트립**("지금 하실 일은 하나" + D-day). 모션 레퍼런스가 이 결합형을 그대로 재생하고 있으며, 국면 전환 연속성이 채택 이유입니다. 1a(3열)는 탈락.
- 1b 카드 아래 **공고 대기 국면 카드**도 계약의 일부: 보드는 비지 않고, 진행률 + 통지 해독 안내를 보여줍니다 (앰버 금지 — 사용자 기한이 아님).

## Screens / Views — 보드 국면
- **헤더** (S-06과 동일 56px): 브랜드 + 칩들 — `국민은행 계좌이체`(ChannelBadge) · `지급정지 완료`(pii 칩) · 우측 `피해구제 신청까지 D-2`(앰버, tabular-nums 24px) · `가족에게 링크 보내기`(고스트 칩 — 공유 UI는 이것 하나)
- **히어로 스트립**: 앰버 6% bg + 45% border 카드. D-day 박스(26px/700) + "지금 하실 일은 하나입니다"(13px icon) + 할 일 한 줄(21px/660) + 보조("넘기면 9월 3일 유예") + [지금 하기](흰 버튼) [서류 초안 열기](고스트)
- **본문 2열** `grid-cols-[1fr_350px]`:
  - 좌측: 사건 진행 레일(200px, done=pii 점·now=앰버 링 점·todo=ink-4 점, 12px 보조) + 단계 리스트(행: 21px 마크 + 라벨 13.5px + 우측 태그, 현재 행만 앰버 8% bg) + 각주 "기한은 서버가 계산한 값 — 완료는 부산물(◆)이 판정합니다"
  - 우측 350px 슬롯: WS 패널(외부 이동, D-2) 위 + 대응 비서 미니 챗 아래 + 미니 컴포저 — S-06과 같은 자리·같은 문법
- **단계 상태 어휘**: 증빙됨(✓ pii + ◆ 부산물 줄) · 진행중(→ 앰버) · 미시작 · 언제든 · 해당 없음(opacity .5 — 지우지 않음)
- **금지**: 빨강, 화면에서 날짜 계산, "서면 신청" 표현, 빈 보드

## Interactions & Behavior — 국면 전환 모션 스펙
정본: `phase-transitions.jsx` (레퍼런스 `Phase Transition Motion.dc.html` 재생 = 최종 승인 상태).

**공통**: 이징 easeInOutCubic = `cubic-bezier(0.65, 0, 0.35, 1)`. 모두 장식 — `prefers-reduced-motion`에서 즉시 완료. 트리거는 서버/LLM 시그널(국면 판정)이며 화면 전환이 아니라 같은 화면의 상태 전이.

**① 챗 → 챗+패널 (패널 등장)**
- 패널: 오른쪽 밖(+8px 드리프트 포함)에서 x −300px 슬라이드 인, **0.9s**, 지연 0.15s
- 챗 폭: 1280 → 980 (패널과 같은 진행률로 좁아짐 — 별도 트윈 아님)

**② 챗+패널 → 보드 (흡수)** — 총 1.5s 안에 축별 타이밍 분리
- x 이동(0 → 우측 슬롯): 시작 +0.2s, 길이 1.15s
- y 이동(46 → 388): 시작 +0.45s, 길이 1.1s — **x보다 늦게 다이브** (곡선 궤적)
- 스케일(1 → 0.306): 시작 +0.35s, 길이 1.15s
- WS 패널 높이: 풀컬럼 → 340px (y와 동일 진행률)
- 보드 콘텐츠: opacity 0→1 + translateY 22→0, 시작 +0.6s, 길이 1.0s; 내부 요소 0.12s 계단
- **블랙홀 변형** (진행률 p=스케일 트윈 기준, d = sin(p·π) — 중간 최대·양끝 0):
  - scaleX ×(1 − 0.16d) · scaleY ×(1 + 0.09d) (가로 핀치 + 세로 늘어짐)
  - skewY 3.2d° · rotate −2.2d°
  - **perspective 1400px + rotateX 7d° + rotateY −15d°** (판이 기울며 앞 모서리가 먼저 딸려 들어감)
  - borderRadius 0→14px 베이스에 +26d px
  - transform-origin: top left 고정 (끝점 위치 정확성)
- **크로스페이드**: 원본 챗 opacity 1→0 (p 0.55→0.90), 그 자리에 **실제 미니 챗 폼**(대응 비서 라벨+컴팩트 버블+미니 컴포저, 자연 크기) opacity 0→1 (p 0.68→1.0). 축소된 스케일 사본을 남겨두지 않음
- 헤더 D-day 칩: 보드 등장 진행률로 페이드 인

**③ 보드 → 챗 (복귀)** — 역재생이 아니라 겹침 재설계
- 챗 확장: y 먼저(+0.5s, 1.05s) → x 나중(+0.65s, 1.15s) → 위로 떠오른 뒤 왼쪽으로 펼쳐짐. 변형 d 곡선 동일(뱉어내듯 펴짐)
- 보드 퇴장: opacity 1→0, 시작 +0.6s, 길이 0.9s — **챗이 그 위로 확장하는 동안 아래서 사라짐 (메인 영역 공백 금지)**
- 패널 퇴장: +1.5s에 시작, 0.8s 슬라이드 아웃

**구현 힌트**: Framer Motion이면 layoutId 없이 축별 transform 트윈(위 지연·길이)으로; CSS면 transition-property를 left/top/transform 분리 + transition-delay. 미니 챗은 별도 노드로 두고 opacity만 교차.

## State Management
- `phase: 'chat' | 'chat_panel' | 'board'` — 서버 시그널이 전이 트리거 (referenced_steps → 패널, 플랜 생성/재방문 → 보드)
- 전이 중 인터랙션 잠금 불필요 — 트윈은 pointer-events 유지, 미니 챗은 페이드 완료 후 활성
- 보드 데이터: `GET …/plan` §3.6 · `GET …/deadlines` §3.7 — D-day·기한 문자열은 서버 값 그대로 표시

## Design Tokens
`design_handoff_chat_s06/README.md`의 토큰 매핑과 동일 (pii/deadline-urgent/hairline/surface/stage/ink 사다리). 모션 추가분:
- `--motion-panel-in: 0.9s` · `--motion-absorb: 1.5s`(축별 오프셋 위 표) · `--motion-ease: cubic-bezier(0.65,0,0.35,1)`
- 변형 상수: pinch 0.16 · stretch 0.09 · skew 3.2° · tilt 7°/−15° · perspective 1400px

## Assets
`brand/symbol-mark.png` (저장소에 이미 있음). 아이콘 없음 — 유니코드·CSS 도형만.

## Files
- `Board S-07 Options.dc.html` — 보드 시안 캔버스. **1c 골격 + 1b 히어로 결합이 채택** (1b 아래 공고 대기 카드 포함, 1a 탈락)
- `Phase Transition Motion.dc.html` + `phase-transitions.jsx` — 모션 정본 (13.5s 루프, 타임라인 재생 가능)
- `animations-v3.jsx` · `tweaks-panel.jsx` · `support.js` — 레퍼런스 재생용 런타임 (구현 대상 아님)
- 관련: `design_handoff_chat_s06/`(S-06·WS 패널·챗 컴포넌트) · spec §S-07 · 08-16-components.md(CaseTimeline·StepItem·DeadlineTracker)
