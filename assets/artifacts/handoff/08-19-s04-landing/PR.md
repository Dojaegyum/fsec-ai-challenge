# PR: S-04 랜딩 리디자인 — 센터 히어로 + 화면 소개 섹션 (시안 1c)

브랜치 제안: `feat/landing-redesign-1c`
커밋 메시지 제안: `feat(landing): 센터 히어로 오비트 링 + 화면 소개 섹션 (시안 1c)`

## 적용 방법
1. `handoff/src/app/page.tsx` → `src/app/page.tsx` 교체
2. `handoff/globals-additions.css` 의 keyframes 4개를 `src/app/globals.css` 의 `@layer base` 안(rise-in 아래)에 추가
3. `public/brand/symbol-square-white.png` 이 없으면 `assets/brand/favicon/symbol-square-white.png` 에서 복사

## 무엇이 바뀌나
- **히어로**: 좌우 2단 → 심볼 중심 센터 정렬. 브랜드 심볼 둘레에 오비트 링(파랑 --pii · 앰버 --horizon 스윕)과 오렌지 가우시안 글로우. 전부 장식 — 의미 없음, `aria-hidden`
- **서브카피**: 대시 문장 → 2행 개행(「…기한이 며칠 남았는지. / 몇 달 동안 대신 챙깁니다.」)
- **하는 일 3단계**: 히어로 아래 3열 카드 그리드로 이동
- **신규 섹션 「링크 하나로 이어지는 화면들」**: /start · 챗 · 보드 · 증거함·서류 4개 화면의 역할을 미니 목업 + 한 줄 소개로 안내
- **112 안내 + 환급 고지**: 점선 카드 → 페이지 하단 한 줄로 통합 (문구 동일)

## 지킨 것
- 행동은 [지금 시작하기] 하나, 메뉴·링크 없음
- 112 우선 안내, 환급 비보장 고지 유지 (CLAUDE.md 불변 규칙 8)
- 도메인 토큰만 사용 (--pii, --horizon, --deadline-urgent, ink/surface 사다리). 빨강 없음
- 실제 텍스트 13px 미만 없음 (와이어프레임 내부 장식 칩 제외 — aria-hidden)
- 모션: rise + 장식 회전. prefers-reduced-motion 이 전부 정지

## 스펙 확인 필요
- `spec/frontend/08-14-screens.md` — S-04 가 1스크린 전제라면, 「화면 소개 섹션 추가로 스크롤 발생」을 계약에 반영해야 합니다
- 목업 정본(08-17-screen-mockups.html)과 달라진 레이아웃이므로, 채택 시 목업 갱신 여부 결정

## 후속 (별도 PR)
- 각 화면 디자인 확정 시, 미니 목업을 실물 렌더로 하나씩 교체
