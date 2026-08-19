# S-05 `/start` — 핸드오프 (시안 2c + 발급 1a)

| | |
| --- | --- |
| 대상 화면 | **`S-05` 동의 · 선택 제공 `/start`** → [화면 설계](../../../../spec/frontend/08-14-screens.md) |
| 넘겨받은 날 | 2026-08-19 |
| 캔버스 | [FSEC 렌더 페이지 설계](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b) — 화면 전체가 한 캔버스에 있습니다 |
| 아트보드 | [「Consent Terms」](https://claude.ai/design/p/4a2237c5-4584-4fac-aeaa-a256b3404f0b?file=Consent+Terms.dc.html) · 「Start S-05」 · 「Link Issue Options」 |
| 시안 | 「Start S-05」 **2c** + 「Link Issue Options」 **1a** |
| 상태 | **적용됨** |

## 받은 그대로입니다

| 파일 | 어디로 갔나 |
| --- | --- |
| [`PR.md`](PR.md) | — (적용 방법·바뀐 것·TODO·팀 확인 필요) |
| `src/app/start/page.tsx` | `src/app/start/page.tsx` (새 파일) |

**한 파일에 두 국면입니다** — `intake`(동의 + Q1 + 자료)와 `issued`(링크 발급).
주소는 `/start` 하나이고 화면을 옮기지 않습니다.

전역 CSS 추가분은 없습니다. 발급 국면의 글로우가 쓰는 `breathe` 는
[S-04 핸드오프](../08-19-s04-landing/)가 이미 넣어둔 것입니다.

> 이 핸드오프 폴더에는 랜딩 파일 셋(`PR.md`·`globals-additions.css`·`src/app/page.tsx`)이
> 함께 들어 있었지만, [08-19-s04-landing](../08-19-s04-landing/)에 이미 적용된 것과
> **바이트 단위로 동일**해 담지 않았습니다.

## 수용 검사 결과

[RFC-003](../../../../rfc/003-design-handoff.md) 「넣기 전에 수용 검사를 합니다」 기준입니다.

| 볼 것 | 결과 |
| --- | --- |
| 도메인 토큰만 · 빨강 없음 | **고쳐서 통과** — 아래 「고친 둘」 |
| 실제 텍스트 13px 미만 없음 | **고쳐서 통과** — 아래 |
| 장식에 뜻 없음 · `aria-hidden` | 통과 — 발급 글로우·라디오 마커·체크 배지 |
| `prefers-reduced-motion` 이 전부 멈춤 | 통과 — 새 keyframes 없음, `breathe`·`.rise` 는 `@layer base` |
| 색만으로 구분하지 않음 | 통과 — 레일 점은 옆 텍스트가, 라디오는 `●`/`○` 가 함께 말합니다 |
| PII — 복원은 브라우저에서만 | 통과 — 동의 전문이 토큰화를 명시. 서버로 원문 보내는 경로 없음 |
| 문구 — 「받을 수 있다」 없음 | 통과 |
| 화면별 금지 (S-05) | 통과 — 아래 「긴장 하나, 이렇게 정했습니다」 |
| `typecheck` · `lint` · `build` | 통과 · `/start` 정적 프리렌더 |

### 고친 둘 — 넣기 전에

1. **`text-[12px]`** (단계 레일 「시작하기」) → **13px**.
   [접근성](../../../../spec/frontend/design-system/08-16-accessibility.md) 「텍스트」가
   Tailwind `text-xs`(12px)를 콕 집어 막고 있습니다.
2. **`oklch(0.386 0.016 274 / …)` 8곳** → `oklch(0.305 0.013 267.1 / …)`.
   앞의 값은 목업 HTML의 **문서 캔버스 색**(`--doc-line`)이라 제품 팔레트 밖입니다.
   `--hairline` 의 색상값에 **알파만 올려** 팔레트 안에 두었고, 보이는 결과는 같습니다.

### 사람이 정한 것

**Q1 문진의 기본 선택을 없앴습니다** (`useState(0)` → `-1`).
시안은 첫 보기가 미리 골라진 채로 떴는데, 「하나만 골라 주세요」와 모순이고
안 고른 답이 그대로 사건 축이 됩니다. 계약으로 박았습니다 →
[screens S-05](../../../../spec/frontend/08-14-screens.md) 「Q1」 ·
[components 「지켜야 할 제약」](../../../../spec/frontend/design-system/08-16-components.md).

## 긴장 하나, 이렇게 정했습니다

**`REQUIRE_ALL_CHECKS`** (동의 전문 5조항 「확인했습니다」 체크). 핸드오프가 이것을
「관문은 동의 하나뿐」과의 긴장이라며 스위치로 남겨 두었습니다.

**체크는 동의를 얻는 방식으로 정해졌습니다** —
[ADR-031](../../../../decisions/031-consent-clause-ack.md).
다섯을 모두 확인해야 동의가 성립하고, **관문은 여전히 동의 하나**입니다.
체크는 사용자에게서 정보를 받아내지 않고, 우리가 고지한 것을 읽었다는 표시일 뿐입니다.

그래서 **스위치를 없앴습니다.** 정해진 것을 코드에서 끌 수 있게 두면 나중에 조용히
꺼지고, 그때 spec 은 안 바뀝니다. `canAgree` 가 `checkedCount === checks.length` 를
직접 봅니다.

## 해소한 것

**spec S-05의 ⚠️ 경고가 사라졌습니다.** 동의 문구가 「24시간 후 파기」로 남아 있던 것을
이 시안이 **180일**([ADR-016](../../../../decisions/016-retention-and-datastore.md)) +
**주민등록번호 미수집**([ADR-026](../../../../decisions/026-raw-upload-retention.md))으로
바로잡았습니다.

## 후속 — 코드 안 `TODO` 주석

- Q1 선택 → `POST /api/cases` (§3.1) 연결. 지금은 UI 상태만
- `CASE_URL` 상수 → 발급 응답의 실제 토큰으로. **헤더의 `사건 7fK2p` 도 같은 값이라 함께 바꿉니다**
- [저장하고 시작하기]/[이메일 없이 시작하기] → `/c/{token}` 라우팅
- 업로드 슬롯 채택 시 `POST …/evidence` 에 `kind` 필드 협의 (백엔드)
- 시안 1b의 QR(폰으로 가져가기)은 미채택 — 원하면 `qrcode` 의존성 필요
