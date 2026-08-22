# Handoff: FinAlly 아이콘 세트 v1 (34종)

## Overview
FinAlly 전 화면 공용 아이콘 34종 — 사물·행동 26 + AI 인터랙션 8. 대상 저장소 `Dojaegyum/fsec-ai-challenge`. 지금까지 유니코드(○ ● ✓ ↑ ＋ ▾)와 CSS 도형만 쓰던 자리를 대체하는 것이 아니라 **보완**합니다 — 상태 마크(✓·◆·○·!)는 기존 규칙 그대로 두고, 아이콘은 사물·행동만 맡습니다.

## 캔버스와 아트보드 — 채택 표시
캔버스 파일: `FinAlly Icons.dc.html` (이 폴더, 브라우저로 열면 렌더 · `support.js` 필요)

| 아트보드 | 옵션 id | 상태 |
|---|---|---|
| icons-v1 (34종 + 원칙 + 상태색 + 쓰임새) | 1a | ✅ **채택** |

## 문법 (전부 확정값)
- 24×24 그리드 · 안전영역 2px · 스트로크 1.5 · 끝 둥글게(round cap/join) · fill 없음(점 제외)
- **currentColor** — 색은 감싸는 글자의 토큰이 정함. 아이콘에 색을 직접 주지 않음
- **항상 글자와 함께** — 아이콘 단독 금지, 전부 `aria-hidden`
- 크기 단계: **16 칩 · 18 행 · 20 버튼 · 24 패널 머리**
- 색 용법: 기본 `ink-3`/`icon` · 파랑 `--pii`(가려짐·보호: masked·shield·maskwork) · 앰버 `--deadline-urgent`(기한·재시도: clock·alert-c·retry) · 흰색(버튼 위)
- 모션: `working` 회전 1.4s linear · `dots` 맥동 1.6s — 장식, reduced-motion 정지. **스트리밍 없음 원칙 그대로** — AI 아이콘은 「무엇을 하고 있는지」 문장 카피 옆의 보조이지 스켈레톤·타자기 대체가 아님

## 이름 34종
사물·행동: key(사건 열쇠) copy chat(대응 비서) board evidence doc write(받아적기) upload download(받기—PII 전체 복원 자리) external phone clock calendar wait(기다리기) masked(가려진 값) shield read(읽기·해석) check-c help-c(모름·물어보기) alert-c(확인해 주세요·앰버 전용) send(가족 공유) mail x chevron trash(파기) bank
AI 인터랙션: spark(비서 표시) thinking(생각 중) working(진행 중·회전) verify(근거 확인 중) maskwork(가리는 중·파랑 전용) dots(보내는 중·맥동) retry(다시 보내기·앰버 전용) stop(준비 중단)

## 적용 방법
1. `public/icons.svg` → 저장소 `public/icons.svg`
2. `src/components/ui/Icon.tsx` → 경로 그대로 (이름 union 타입 포함)
3. `globals-additions.css` 의 `icon-spin` keyframe 을 globals.css `@layer base` 에 추가 (pulse-dot 은 기존 재사용)
4. 사용: `<Icon name="copy" size={16} />` · `<Icon name="working" spin />` — 반드시 글자 옆에

## 매핑 예 (기존 화면의 유니코드 → 아이콘, 선택 적용)
- 헤더 [주소 복사] 칩 → `copy` 16 · [가족에게 링크 보내기] → `send` 16
- WS 패널 「국민은행 앱 열기 ↗」 → `external` 18 · D-day 칩 → `clock` 16
- 컴포저 ↑ 원형 버튼은 **그대로** (이미 확립된 형태)
- EvidenceCard 「가리는 중」 → `maskwork` 16 파랑 · 실패 [다시 보내기] → `retry` 16 앰버
- 펜딩 체크리스트 진행 중 → `working` 16 spin
- T0 레일 항목: phone(112·1332) — 상태 마크는 기존 ✓·○·! 유지

## Files
- `public/icons.svg` — 스프라이트 34 symbol (id: `i-{name}`)
- `src/components/ui/Icon.tsx` — 타입드 컴포넌트 (spin/pulse 포함)
- `globals-additions.css` — icon-spin keyframe
- `FinAlly Icons.dc.html` + `support.js` — 디자인 레퍼런스 (구현 무관)
