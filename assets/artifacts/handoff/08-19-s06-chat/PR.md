# Handoff: S-06 사건·챗 국면 + 챗 컴포넌트 + WS 패널

## Overview
FinAlly(보이스피싱 사건 관리 에이전트)의 S-06 챗 국면 화면과, 챗을 이루는 컴포넌트 상태·모션 정의, 워크스페이스(WS) 패널 7유형입니다. 대상 저장소는 `Dojaegyum/fsec-ai-challenge` (Next.js + Tailwind v4 + shadcn) — S-04 랜딩(`src/app/page.tsx`)과 S-05(`src/app/start/page.tsx`)가 이미 같은 시안 계열로 반영돼 있습니다.

## About the Design Files
이 번들의 `.dc.html` 파일들은 **HTML로 만든 디자인 레퍼런스**입니다(브라우저에서 열면 렌더됨, `support.js` 필요). 프로덕션 코드가 아니라 의도한 모양·동작의 원본입니다. 할 일은 이 디자인을 **저장소의 기존 환경(Next.js App Router, Tailwind v4, globals.css 도메인 토큰, 기존 컨벤션)으로 재구현**하는 것입니다. HTML을 그대로 옮기지 마세요.

캔버스 안내: 각 파일은 여러 시안을 나란히 놓은 캔버스입니다. **채택안은 Chat S-06 Options의 `1c`** (+ 그 아래 국면 2 카드, 로딩 카드). 1a·1b는 탈락안이니 무시하세요.

## Fidelity
**High-fidelity.** 색·타이포·간격·상태·카피 전부 확정값입니다. 픽셀 단위로 재현하되, raw oklch 값 대신 globals.css의 기존 토큰을 쓰세요 (아래 Design Tokens 매핑 참조).

## Screens / Views

### S-06 챗 국면 `/c/{token}` — 채택안 1c
- **Purpose**: 진술을 받아 매뉴얼을 고르는 핵심 화면. 첫 진입 시 챗이 주인공
- **Layout**: 헤더(56px) 아래 `grid-cols-[1fr_350px]`, min-h 화면 채움
  - 헤더: 좌측 브랜드(심볼 23px invert + FinAlly 워드마크 18px/660), 우측 칩 2개(사건 7fK2p · 주소 복사). 칩: pill, border hairline, bg `oklch(1 0 0/4%)`, 13px
  - 좌측 열: T0 요약 바 + 채팅 스트림 + 컴포저 (max-w 700px)
  - 우측 350px 열: border-left hairline, bg `oklch(1 0 0/1.5%)` — **사건 파일 패널 → WS 패널 슬롯** (아래 참조)
- **T0 안전 절차 바** (SafetyRail): pii-bg 카드(border `--pii`/40%), 한 줄 요약 "112 신고 ✓ · 1332 상담 · 추가 송금 금지 · 비행기모드 — 항상 여기 있습니다" + [펼치기 ▾]. 슬롯과 무관하게 상시 노출. 펼치면 4항목 리스트(각 항목: 21px 원형 마크 + 제목 14.4px/600 + 설명 13px icon색)
- **채팅 버블**:
  - AI: max-w 74~80%, radius `15px 15px 15px 5px`, border hairline, bg `--surface`, 14.5px/1.65
  - 사용자: max-w 64~70%, margin-left auto, radius `15px 15px 5px 15px`, bg `oklch(1 0 0/11%)`, 글자 `--ink-1`
  - AI 답변 속 PII 토큰: inline chip, padding `1px 8px`, radius 6px, bg `--pii-bg`, border `--pii`/36%, 글자 `--pii` 13px. **파란 토큰이 신뢰 장치 — 흐리지 말 것 (ADR-013)**
  - 질문 버블 하단에 "한 번에 하나만 여쭤봅니다" 13px icon색
- **선택지 버튼 그리드** (SlotQuestion): `grid-cols-2 gap-2`, 각 버튼 min-h 48px, radius 12px, border hairline, bg `oklch(1 0 0/4%)`, 14.5px, lead `○` 18px. 「기억이 안 나요」는 **같은 크기·같은 자리, 글자만 ink-3**. **기본 선택 없음**. hover: border `oklch(1 0 0/25%)`
- **컴포저** (Composer): min-h 52px, radius 14px, border `--pii`/45%, bg `--surface`, ring `0 0 0 3px --pii/10%` — 저장소의 `border-beam` 래퍼(`duration={7}`)를 여기에만. placeholder "직접 적으셔도 됩니다"(ink-4), 우측 30px 흰 원형 ↑ 버튼
- **우측 「사건 파일 — 실시간」 패널**: 카드(radius 14px, border hairline/60%, bg `--stage`), 헤더 "진술에서 파악한 것" + pulse 점. 행: `justify-between` 13.5px — 라벨(icon색)/값(ink-1 580). 채워진 값·PII토큰·현재 질문 행(앰버 bg 6% + "지금 여쭤보는 중")·미래 행(opacity .55, "모름이어도 진행"). 푸터: "채워지는 만큼 절차가 정확해집니다. 모름도 답입니다"
- **국면 2 (WS 패널이 붙은 상태)**: 같은 슬롯이 WS 패널로 교체됨. 헤더 우측 칩이 D-day(앰버)로. 슬롯 하단 각주: "패널은 챗이 가리킨 단계를 따라 바뀝니다. 언급이 없으면 닫지 않고 그대로"
- **참고**: WS 패널이 S-06 챗 국면에 붙는 것은 제품 결정 확정 — `spec/frontend/08-14-screens.md`·`08-17-workspace-panels.md`에 반영 필요 (원문은 S-09 소속으로 기술됨)

### WS 패널 7유형 (`WS Panels.dc.html`)
공통 골격(1a 카드가 정의): ① 유형 눈썹(11.5px/620, letter-spacing .13em — **한글만, WS-* 코드는 화면에 노출 금지**) ② 제목 16px/640 ③ 상태 칩(타이머=pii, D-day=앰버) ④ 유형별 콘텐츠 ⑤ 부산물 입력 ⑥ 주 행동 버튼 1개(흰색, min-h 44px) ⑦ 「나중에」 고스트 버튼 상시.
- 액티브 유형(통화·외부이동·받아적기·제출·받기): border `--pii`/34%, bg `linear-gradient(180deg, oklch(0.245 0.02 268), oklch(0.2 0.012 268))`
- 수동 유형(기다리기·읽기): border hairline, bg `--surface` 평면
- 불변 규칙: 완료는 부산물 판정 / 패널은 한 번에 하나 / 언급 없으면 닫지 않음 / 형식 검증은 관문 아님(틀려도 저장, 「확인 필요」 표시) / **PII 전체 복원은 「받기」(WS-download)에서만** / 앰버는 사용자 기한에만(기관 대기 금지)
- 각 유형 콘텐츠는 캔버스 1b~1h 카드가 정본 (대본+받아적기 / 들고 올 것+외부 링크 / 입력+저장 / 드롭존+스크러버 설명 / 원문 프리뷰+.docx / 진행률+기다림 정상 / 설명+근거 각주·버튼 없음)

### 챗 컴포넌트 상태 (`Chat Components Spec.dc.html`)
**1a 내 메시지 수명주기**
- 보내는 중: 버블 opacity 0.6 + 우하단 "보내는 중" 12.5px + pulse 점
- 전송 실패: 버블 유지 + border 앰버/45%, 아래 "전송되지 않았습니다 — 내용은 지워지지 않았어요"(앰버) + [다시 보내기] 앰버 pill 칩(시각 32px, `data-hit`로 44px). **빨강 금지**
- 인터럽트 마크: 새 메시지 전송 시 준비 중 답변 자동 취소 → 전사에 헤어라인+가운데 라벨 "답변 준비를 중단했습니다". 부분 답변 미표시 (ADR-022)

**1b AI 펜딩** — 스켈레톤·점3개·타자기 금지
- 2초 미만: AI 버블 모양 한 줄 "진술을 확인하고 있습니다" + pulse 점
- 2초 이상: 같은 버블이 3단계 체크리스트로 확장(①이 ②의 첫 줄 → 레이아웃 안 튐): 완료 ✓(pii)/진행 중(pulse 링+ink-1)/대기(opacity .55). 푸터 "상태는 서버(poll-checker) 값 그대로"
- 최소 표시 600ms. 답변 도착 시 같은 자리에서 본문으로 교체(추가 rise 없음)

**1c 파일 업로드 (EvidenceCard)** — 상태 어휘 pending·processing·done·failed (S-08과 통일)
- processing: 파일행(34px 썸네일 박스+이름 13.5px/580) + "가리는 중 74% — 이름·계좌를 찾고 있습니다"(pii색) + 4px pii 진행바 + "원본은 아직 이 브라우저 안에 있습니다"
- done: ✓ 썸네일(pii 14% bg) + PiiToken 칩 나열 + "가려진 뒤 전송됨 · 증거함에 보관"
- failed: 앰버 카드 "주민등록번호를 가리지 못했습니다 / 이 파일만 빼고 진행합니다 — 사건은 멈추지 않습니다" + [다른 파일 올리기][없이 진행]. 재시도를 관문으로 만들지 않음 (ADR-026)

**1d WS 패널 모션** — 전부 장식, reduced-motion 즉시 완료
- 등장: 패널 rise 0.5s + 내부 요소 60ms 계단
- 교체: 빈 슬롯 금지 — 새 패널 준비 후 이전 fade-out 0.2s → 새 패널 rise 0.35s
- 사건 파일 행 채움: 새/변경 행에 row-flash 1.2s ease-out (`--pii`/12% → transparent). 행 단위만 이동, 표 재정렬·스크롤 점프 금지
- border-beam은 컴포저 전용 — 패널 금지

## Interactions & Behavior
- 스트리밍 없음: 답변은 검증(citation-checker) 후 한 번에 (ADR-022)
- 선택지 클릭 = 답변 전송. 자유 입력 병행 허용
- WS 패널 열림: 서버 시그널(referenced_steps → 미완료 최소 seq 하나)이 정함. 모델이 패널을 고르지 않음
- 「나중에」는 어느 패널에서도 막지 않음 — 단계는 미확인으로 남아 기한 추적
- T0 펼치기/접기 토글. 첫 진입 세션은 펼침 기본 권장
- 헤더 [주소 복사]: clipboard 복사 + "복사됨 ✓" 2s

## State Management
- `messages[]` (역할·본문·상태: sending|sent|failed|interrupted)
- `pendingStatus` — poll-checker 응답 그대로 (단계 배열 + 현재 인덱스). 화면이 추측·계산하지 않음
- `caseFile` 슬롯 맵 (파악된 값·현재 질문 슬롯·미확인 슬롯)
- `activePanel` — 서버가 내려준 단계 ref + 유형. null이어도 마지막 패널 유지
- `uploads[]` — EvidenceCard 상태 머신 (pending→processing→done|failed)

## Design Tokens
기존 globals.css 토큰을 그대로 사용 (raw 값 → 토큰 매핑):
- `oklch(0.697 0.16 258.2)` → `--pii` · `oklch(0.231 0.047 259.1)` → `--pii-bg`
- `oklch(0.77 0.117 70.9)` → `--deadline-urgent` (실패·D-day·현재 질문 행)
- `oklch(0.305 0.013 267.1/52%)` → `--hairline` · `oklch(0.231 0 89.9)` → `--surface` · `oklch(0.16 0.004 285.9)` → `--stage`
- ink 사다리: `#fff`→`--ink-1`, `oklch(0.845…)`→`--ink-2`, `oklch(0.714…)`→`--ink-3`, `oklch(0.65 0 89.9)`→`--ink-4`, `oklch(0.609…)`→`--icon`

신규 모션 토큰 (globals.css `@layer base`에 추가):
```css
/* 챗·패널 모션 — 전부 장식. reduced-motion 블록이 함께 끕니다 */
@keyframes row-flash { from { background: oklch(0.697 0.16 258.2 / 12%); } to { background: transparent; } }
/* rise-in·pulse-dot은 기존 것 재사용 */
```
- 패널 등장: `rise-in 0.5s cubic-bezier(0.22,0.61,0.36,1)` + 60ms/요소 계단
- 패널 교체 들어오기: 0.35s 동일 이징 · 나가기 fade 0.2s
- pulse: 1.6s ease-in-out 무한 (챗 안) — 기존 pulse-dot(2.6s)보다 빠른 변형, duration만 다르게
- 보내는 중 버블: opacity 0.6
- radius: 버블 15px(꼬리 5px) · 패널 14px · 내부 카드 10~11px · 버튼 10~12px · 칩 999px
- 최소 폰트 13px (12.5px 각주는 aria 보조 텍스트 — 가능하면 13px로 올려도 됨)

## Assets
- `brand/symbol-mark.png` — 저장소 `src/public/brand/symbol-mark.png`에 이미 있음 (invert 필터로 사용)
- 아이콘 없음 — 유니코드(○ ● ✓ ↑ ＋ ▾)와 CSS 도형만 사용. 아이콘 폰트 추가 금지

## Files
- `Chat S-06 Options.dc.html` — 화면 시안. **1c + 국면 2 카드 + 로딩 카드가 채택안** (1a·1b 탈락)
- `WS Panels.dc.html` — 1a 공통 골격 + 1b~1h 유형별 정본 (350px 슬롯 실척)
- `Chat Components Spec.dc.html` — 상태·모션 정의 4벌 (카드 하단 모노 줄 = 토큰 값)
- `support.js` — 레퍼런스 HTML 렌더용 런타임 (구현과 무관, 열어볼 때만 필요)
- 관련 스펙: `spec/frontend/08-14-screens.md` §S-06 · `08-17-workspace-panels.md` · `design-system/08-16-components.md`(SlotQuestion·SafetyRail·PiiToken·로딩 규칙) · ADR-013·022·024·026
