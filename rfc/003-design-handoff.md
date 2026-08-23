# RFC-003. 화면 디자인은 Claude Design에서 만들어 핸드오프로 넘긴다

- 상태: **시행 중**
- 제정: 2026-08-19
- 최종 개정: 2026-08-19
- 근거: [ADR-030](../decisions/030-design-handoff.md) (정본 이동·목업 동결) ·
  [ADR-029](../decisions/029-scroll-landing.md) (첫 사례에서 드러난 것)

> 규약은 **현재형**으로 씁니다. 왜 그렇게 정했는지는 [ADR-030](../decisions/030-design-handoff.md)에 있습니다.

## 무엇에 대한 규약인가

**화면 디자인이 저장소 밖(Claude Design)에서 만들어져 들어옵니다.**
새 화면 시안을 받았을 때, 그것을 어디에 두고 무엇을 검사하고 무엇까지 고쳐야
그 작업이 끝난 것인지를 정합니다.

대상은 `spec/frontend/08-14-screens.md`의 화면들(`S-03` ~ `S-10`)입니다.

## 정본이 어디인가

| 무엇 | 어디 |
| --- | --- |
| **화면 디자인** | **Claude Design 캔버스** — 시안이 만들어지고 고쳐지는 자리 |
| 저장소에 남는 증거 | `assets/artifacts/handoff/{MM-dd-slug}/` — 넘겨받은 그대로의 스냅샷 |
| 화면이 지켜야 할 계약 | [`spec/frontend/08-14-screens.md`](../spec/frontend/08-14-screens.md) |
| 색·크기·모션의 값 | `src/app/globals.css` (뜻은 [design-system/08-16-tokens.md](../spec/frontend/design-system/08-16-tokens.md)) |
| 실행되는 화면 | `src/app/` |

**`assets/artifacts/plans/08-17-screen-mockups.html`은 동결됐습니다.**
화면 01(S-04)까지만 갱신했고, 화면 02 이후는 2026-08-17 시점의 기록입니다.
**레이아웃을 근거로 인용하지 마세요** — 설계 노트(`.decs`)만 유효합니다.

## 규칙

### 1. 핸드오프는 폴더 하나로 받습니다

```
assets/artifacts/handoff/08-19-s04-landing/
  README.md              ← 필수. 캔버스 URL · 아트보드 이름 · 대상 화면 ID · 적용 커밋
  PR.md                  ← 시안이 스스로 밝힌 적용 방법·바뀐 것·지킨 것·미결
  globals-additions.css  ← 있으면
  src/app/page.tsx       ← 적용 위치를 경로로 드러냅니다 (src/ 기준 그대로)
```

- 폴더 이름은 **`MM-dd-{화면ID}-{slug}`** — `08-19-s04-landing`.
  `MM-dd`는 **넘겨받은 날**이고, 나중에 고쳐도 바꾸지 않습니다 (→ [RFC-001](001-repo-structure.md) 「파일명 규약」).
- **화면 하나에 매이지 않는 핸드오프는 화면 ID 자리를 뺍니다** — `08-21-icons`.
  아이콘 세트·타이포처럼 **전 화면 공용 자산**이 여기 해당합니다.
  없는 화면 ID를 지어내면 `spec/frontend/08-14-screens.md` 에 없는 이름이 저장소에 남습니다.
  대신 그 폴더의 `README.md` 첫 줄에 **「화면이 아닙니다」**를 적어 무엇에 걸리는지 밝힙니다.
- **파일 경로를 `src/` 기준 그대로 둡니다.** 어디로 옮길지가 경로에 이미 적혀 있어야,
  적용할 때 판단이 끼어들지 않습니다.
- `README.md`에 **캔버스 URL이 반드시 들어갑니다.** 모르면 커밋하기 전에 물어보세요 —
  URL 없는 스냅샷은 「어느 시안이었나」를 못 답합니다.
- **캔버스 하나에 화면이 여럿 들어 있습니다.** 그래서 URL만으로는 부족하고,
  **어느 아트보드에서 나왔는지**를 함께 적습니다 (`?file=` 로 고릅니다).
  캔버스는 우리 저장소 밖이라 아트보드가 지워질 수도 있는데, 이름이라도 남으면
  핸드오프 스냅샷과 짝지을 수 있습니다.

### 2. 받은 그대로 커밋하고, 그 뒤로 고치지 않습니다

핸드오프 폴더는 **스냅샷**입니다. 코드가 나중에 바뀌어도 여기는 그대로 둡니다 —
`assets/artifacts/archived/`와 같은 성격입니다.

시안을 고쳐야 하면 **캔버스에서 고쳐 새 핸드오프를 받습니다.** 폴더를 손으로 수정하지 않습니다.

**그래서 검사기가 `PR.md` 를 건너뜁니다.** 시안 설명에는 버튼 종류를 괄호로 적는 일이 흔한데
(`[서류 초안 열기](고스트)`), 마크다운 링크로 읽히면 없는 파일을 가리킵니다.
고칠 수 없는 파일이라 검사에서 뺐습니다 — **우리가 쓴 `README.md` 는 그대로 검사합니다.**

### 3. 넣기 전에 수용 검사를 합니다 — CI가 못 하는 것들

기계가 판정할 수 없어 사람이 봅니다. **하나라도 걸리면 넣기 전에 고칩니다.**

| 볼 것 | 기준 | 정본 |
| --- | --- | --- |
| 색 | **도메인 토큰만.** 임의 hex·rgb 없음. **빨강 금지** | [tokens](../spec/frontend/design-system/08-16-tokens.md) 「상태 색」 |
| 글자 크기 | **실제 텍스트에 12.5px 미만 없음** (고령 사용자 기준 · 우리가 정한 선) | [tokens](../spec/frontend/design-system/08-16-tokens.md) 「크기 사다리」 · [ADR-032](../decisions/032-text-floor.md) |
| 장식 | 뜻을 싣지 않음. **`--horizon` 그래픽은 전부 `aria-hidden`** — 글자에 쓰는 것은 「제도가 흐르는 시간」 셋을 다 만족할 때만 | [tokens](../spec/frontend/design-system/08-16-tokens.md) 「상태 색」 · [ADR-048](../decisions/048-horizon-carries-meaning.md) |
| 모션 | `prefers-reduced-motion`이 **전부** 멈춤. 새 keyframes도 포함 | [접근성](../spec/frontend/design-system/08-16-accessibility.md) 「모션」 |
| 색만으로 구분 | 상태를 색 하나로 가르지 않음 (모양·글자를 함께) | [접근성](../spec/frontend/design-system/08-16-accessibility.md) |
| 기한 | 화면이 날짜를 세지 않음 — 서버 계산값만 표시 | [기한 규칙](../spec/common/08-16-deadline-rules.md) |
| PII | 복원은 브라우저에서만. 서버로 원문을 보내는 경로 없음 | [PII 경계](../spec/common/08-14-pii-boundary.md) |
| 문구 | 「받을 수 있다」로 읽히지 않음. 112 우선 안내가 있으면 지움 없이 유지 | `CLAUDE.md` 불변 규칙 8 |
| 화면별 금지 | 그 화면의 「금지」 칸 | [화면 설계](../spec/frontend/08-14-screens.md) |

**시안이 spec과 어긋나면 임의로 맞추지 않습니다.**
코드는 시안대로 넣고, **어긋난 지점을 PR에 미결로 올려 사람이 정합니다.**
계약을 고치기로 하면 `spec/`을 고치고, 금지 항목을 뒤집는 것이면 ADR을 씁니다
(→ [ADR-020](../decisions/020-adr-threshold.md)). S-04가 그 첫 사례입니다
([ADR-029](../decisions/029-scroll-landing.md)).

### 4. 한 작업의 끝은 여기까지입니다

```
1. 핸드오프 폴더를 assets/artifacts/handoff/ 에 그대로 커밋
2. 파일을 src/ 로 적용 (경로는 핸드오프가 이미 말하고 있습니다)
3. 브랜드 자산이 필요하면 assets/brand/ → src/public/ 으로 복사
4. 검증 — npm run typecheck · npm run lint · npm run build   (src/ 에서)
5. spec 을 실제와 맞춥니다 — 아래 표의 **세 곳을 모두** 봅니다
6. python .github/scripts/doc-integrity.py
7. PR — 「지킨 것」과 「미결」을 본문에 적습니다
```

**5번을 빼면 작업이 끝난 게 아닙니다.** 계약과 구현이 갈라지는 순간
다음 사람은 어느 쪽이 정본인지 알 수 없습니다.

**그리고 5번은 화면 문서 하나가 아닙니다.** 시안은 화면만 만드는 게 아니라
**재질과 움직임도 함께 만듭니다.** 화면 절만 고치면 디자인 시스템이 조용히 낡습니다.

| 무엇이 새로 생겼나 | 어디에 적나 |
| --- | --- |
| 화면의 구조·국면·금지 | [`spec/frontend/08-14-screens.md`](../spec/frontend/08-14-screens.md) 그 화면 절 |
| **새 keyframes·모션·색 쓰임** | [`design-system/08-16-tokens.md`](../spec/frontend/design-system/08-16-tokens.md) |
| **새 컴포넌트·재질·제약** | [`design-system/08-16-components.md`](../spec/frontend/design-system/08-16-components.md) |

- **컴포넌트로 뽑지 않았어도 적습니다.** 화면 파일 안에 있는 채로 「어디에 있다」까지
  적어두면, 두 번째 화면에서 다시 쓸 때 찾을 수 있습니다.
- **새 keyframes 는 반드시 tokens 「모션」에 등록합니다.** 등록되지 않은 애니메이션은
  다음 사람이 감속 모드 확인 없이 복사해 씁니다.

### 5. 새 keyframes·전역 CSS는 `globals.css`의 `@layer base`에 넣습니다

`prefers-reduced-motion` 블록이 **같은 레이어 안에 있어야** 함께 멈춥니다.
컴포넌트 파일이나 인라인 `<style>`에 애니메이션을 두지 않습니다.

### 6. 구조 게이트는 이 폴더 안쪽을 보지 않습니다

핸드오프가 하나 들어올 때마다 폴더가 늘어나므로,
`repo-structure-gate.yml`의 `EXCLUDE`가 `assets/artifacts/handoff/` **안쪽**을 뺍니다.
`src/`·`.github/`·`.claude/`와 같은 이유입니다 —
**폴더 자체가 생기거나 사라지는 것은 그대로 감시합니다.**

## 하지 않는 것

- **목업 HTML(`08-17-screen-mockups.html`)을 갱신하지 않습니다.** 동결됐습니다.
  화면 그림이 필요하면 핸드오프를 보세요.
- **핸드오프 폴더를 나중에 손으로 고치지 않습니다.** 스냅샷입니다.
- **캔버스 URL 없이 커밋하지 않습니다.** 근거를 못 대는 스냅샷은 자리만 차지합니다.
- **검증 없이 넣지 않습니다.** 시안 코드는 이 저장소에서 한 번도 안 돌아본 코드입니다.
- **핸드오프 안의 `src/`를 앱이 읽게 하지 않습니다.** `assets/`는 원본이고,
  빌드에 들어가지 않습니다 (→ [RFC-001](001-repo-structure.md) 「`assets/`」).

## 이 규약을 바꾸려면

1. 이 문서를 고친다 (현행 규약이므로).
2. 아래 「개정 이력」에 한 줄 적는다. 왜 바꿨는지는 커밋 메시지에 남는다.
3. 영향받는 문서를 같이 고친다 — `CLAUDE.md` 「정본의 위치」 · [RFC-001](001-repo-structure.md).

**ADR은 이 규약을 뒤집을 때만 씁니다** (→ [ADR-020](../decisions/020-adr-threshold.md)).

## 개정 이력

| 날짜 | 무엇 | 근거 |
| --- | --- | --- |
| 2026-08-19 | 제정 — 화면 디자인 정본을 Claude Design으로 옮기고 핸드오프 절차를 세움 | [ADR-030](../decisions/030-design-handoff.md) |
| 2026-08-19 | 수용 검사의 글자 크기 하한을 13px → **12.5px** 로. 근거 없이 굴러온 숫자였고, WCAG 요건이 아님을 함께 표기 | [ADR-032](../decisions/032-text-floor.md) |
| 2026-08-19 | 핸드오프 README 에 **아트보드 이름**을 추가 — 캔버스 하나에 화면이 여럿이라 URL 만으로는 어느 시안인지 못 가립니다 | 커밋 메시지 |
| 2026-08-19 | 「한 작업의 끝」 5번을 화면 문서 하나에서 **spec 세 곳**으로 넓힘 — S-04 때 keyframes 넷과 새 컴포넌트가 디자인 시스템 문서에 한 줄도 안 남았습니다 | 커밋 메시지 |
| 2026-08-20 | 검사기가 **핸드오프 `PR.md` 를 건너뜁니다** — 고칠 수 없는 원문인데 시안 설명의 괄호가 깨진 링크로 잡혔습니다 | 규칙 2 |
| 2026-08-21 | 폴더 이름에서 **화면 ID 를 뺄 수 있게** 함 — 아이콘 34종처럼 전 화면 공용 자산이 들어왔고, 없는 화면 ID 를 지어내는 것보다 낫습니다 | 규칙 1 · `08-21-icons` |
| 2026-08-23 | 수용 검사의 「`--horizon` 은 장식 전용」을 **그래픽에 한정**함 — 글자에 쓰는 길이 조건부로 열렸습니다 | [ADR-048](../decisions/048-horizon-carries-meaning.md) · `08-23-s07-wait-and-badges` |
