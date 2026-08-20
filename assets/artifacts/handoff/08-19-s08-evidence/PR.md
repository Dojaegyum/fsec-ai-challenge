# Handoff: S-08 증거함 + 국면 전환 모션 (증거함 구간 추가판)

## Overview
FinAlly `/c/{token}`의 **증거함 국면**(S-08)과, 기존 챗↔패널↔보드 모션에 **증거함 구간을 추가한 국면 전환 정본**입니다. 대상 저장소 `Dojaegyum/fsec-ai-challenge`. 선행 번들: `design_handoff_chat_s06/`(S-06·WS 패널·챗 컴포넌트) · `design_handoff_board_motion/`(보드·모션 v1 — 이 번들의 모션이 그 **상위 버전**입니다).

## About the Design Files
`.dc.html`/`.jsx`는 브라우저에서 열리는 **디자인 레퍼런스**입니다(프로덕션 코드 아님). 저장소 환경(Next.js App Router, Tailwind v4, globals.css 도메인 토큰)으로 재구현하세요. `animations-v3.jsx`·`tweaks-panel.jsx`·`support.js`는 레퍼런스 재생용 런타임입니다.

## Fidelity
**High-fidelity.** 레이아웃·색·타이포·상태·카피·모션 타이밍 전부 확정값. raw oklch → 토큰 매핑은 `design_handoff_chat_s06/README.md`와 동일.

## 채택안 — Evidence S-08 Options의 **1d**
1a(서랍 그리드)·1b(전사 전폭)·1c(파이프라인)는 탈락. **1d = 1b의 전사 중심 레이아웃 + S-06/07과 동일한 우측 350px 슬롯** — 흡수 모션 착지점(우하단 미니 챗)이 세 국면에서 같은 자리라는 것이 채택 이유입니다.

## Screens / Views — S-08 증거함 (1d)
- **헤더**: S-06/07과 동일 56px. 칩: `국민은행 계좌이체` · `증거함`(pii 칩) · 우측 `피해구제 신청까지 D-2`(앰버) + `가족에게 링크 보내기`
- **골격** `grid-cols-[1fr_350px]` — 좌측 콘텐츠가 다시 `grid-cols-[220px_1fr]`:
  - **자료 레일 (220px)**: 상단 `자료 5` + `＋ 올리기`. 행: 7px 상태 점(done=pii, processing=pii+pulse 1.6s, failed=앰버, pending=아웃라인) + 파일명 12.5px + 상태 한 줄 11.5px. 선택 행: pii 10% bg + 34% border. 하단 대시 카드: "증거가 없어도 사건은 진행됩니다. **신분증은 올리지 마세요.**"
  - **전사 본문**: 파일 헤더(32px 아이콘 박스 + 파일명 14.5px/640 + 일시 · 우측 PiiToken 칩들) / 발화 행 `grid-cols-[40px_1fr]`: 타임스탬프(모노 11.5px) + 화자 라벨 11.5px + 본문 14px/1.7 — **PII는 문장 안 인라인 파란 토큰** / **사칭 정황 구간**: 화자 라벨에 앰버 표기 + 본문 왼쪽 2px 앰버 보더 / **미확인**: 대시 앰버 언더라인 + `미확인` pill 배지 / 푸터: "파란 토큰 = 서버로 안 갔다는 뜻 — 서버가 받은 것은 이 화면 그대로입니다 · 미확인 구간은 서류에 자동으로 들어가지 않습니다"
  - **우측 350px**: 대응 비서 미니 챗 + 미니 컴포저 (S-07과 동일 문법)
- **상태 어휘**: pending·processing·done·failed (S-06 EvidenceCard와 통일). processing 중엔 "원본은 아직 이 브라우저 안에 있습니다"
- **failed 갈림길**: 주민번호 못 가림 → 그 파일만 제외, 앰버(빨강 금지), [다른 파일 올리기]/[없이 진행] — 사건은 멈추지 않음 (ADR-026)
- **API**: `POST …/evidence` §3.2 · `GET …/evidence/{id}` §3.3 · 층 C `transcript-viewer` · `file-sender`

## Interactions — 모션 추가분 (v2)
정본 `phase-transitions.jsx` — 씬: 챗 국면 2.5s → 패널 등장 2.5s → 보드 전환 3s → 보드 국면 2.5s → **증거함 전환 3s** → 챗 복귀 3s (16.5s 루프).

**④ 보드 → 증거함 (신규)** — 같은 메인 영역의 교차 전환, 챗·패널은 그대로:
- 보드 퇴장: opacity 1→0 + translateY 0→22px 역방향, 시작 +0.3s, 길이 0.7s
- 증거함 등장: opacity 0→1 + translateY 22→0, 시작 +0.5s, 길이 0.8s (겹침 — 빈 화면 없음)
- 증거함 내부: 레일 → 파일 헤더 → 발화 행들 → 푸터 순 0.08~0.15s 계단 rise
- 헤더: `증거함` 칩이 eVis로 페이드 인, D-2 칩은 보드+증거함 구간 내내 유지
- **챗 복귀는 증거함에서 출발** — 증거함 퇴장(+0.6s, 0.9s)과 챗 확장이 겹침, 미니 챗→풀 챗 크로스페이드·블랙홀 역변형은 v1과 동일
- 이징·변형 상수 전부 v1(`design_handoff_board_motion/README.md`)과 동일 — 이 번들은 **④ 구간만 추가**

## State Management
- `phase: 'chat' | 'chat_panel' | 'board' | 'evidence'` — 서버/사용자 시그널로 전이
- 증거함 데이터: `GET …/evidence` 목록 + `GET …/evidence/{id}` 전사. 전사 화면은 서버가 준 마스킹 결과 그대로 — 화면이 재마스킹하지 않음
- 업로드는 어느 국면에서든 가능 (＋ 올리기 → S-05와 같은 종류 슬롯)

## Files
- `Evidence S-08 Options.dc.html` — 시안 캔버스. **1d 채택** (1a·1b·1c 탈락)
- `Phase Transition Motion.dc.html` + `phase-transitions.jsx` — 모션 정본 v2 (증거함 구간 포함, 16.5s 루프)
- `animations-v3.jsx` · `tweaks-panel.jsx` · `support.js` — 재생용 런타임
- 관련: spec §S-08 · ADR-013(부분 복원) · ADR-026(원본 업로드) · `design_handoff_chat_s06/`의 EvidenceCard 상태 정의
