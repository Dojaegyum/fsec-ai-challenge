# 컴포넌트 규칙

기반은 shadcn/ui입니다. 여기에는 **shadcn이 정해주지 않는 것**만 적습니다 —
우리 도메인에서만 뜻이 있는 컴포넌트와, 기본 컴포넌트를 쓸 때 지켜야 할 제약.

## 도메인 컴포넌트 (우리가 만들 것)

| 이름(가칭) | 무엇 | 근거 | 초안 |
| --- | --- | --- | --- |
| `PiiToken` | 전사 안의 가려진 개인정보. 복원은 **클라이언트에서만** | [pii-boundary](../../common/08-14-pii-boundary.md) | 있음 |
| `ChannelBadge` | 경유 서비스 8유형 배지 | [channel-matrix](../../backend/08-14-channel-matrix.md) | 있음 |
| `DeadlineTracker` | 3영업일 D-day·2개월 공고 등 법정 기한 | 기한 계산은 **규칙**이 함, 화면은 표시만 | 있음 |
| `SlotQuestion` | 한 번에 한 문항·전부 버튼·"모름" 상시 노출 | [slot-tiering](../../backend/08-14-slot-tiering.md) | 있음 |
| `StepItem` | 실행 단계 + 부산물 표시 (완료 판정) | [completion-hook](../../backend/08-14-completion-hook.md) | 있음 |
| `EvidenceCard` | 업로드 파일과 처리 상태 | [screens S-08](../08-14-screens.md) | — |
| `SafetyRail` | T0 공통 안전 절차. 슬롯과 무관하게 **상시 노출** | [slot-tiering](../../backend/08-14-slot-tiering.md) | 있음 |
| `CaseTimeline` | 사건 전체 진행 — 지급정지→피해구제→공고→환급 | [channel-matrix 기한표](../../backend/08-14-channel-matrix.md) | 있음 |
| `Composer` | 진술 입력창. 자유 진술 + 빠른 시작 버튼 | [ADR-002](../../../decisions/002-project-name.md) 핵심 동작 | 있음 |

### 화면이 서면서 실제로 생긴 것

Claude Design 핸드오프로 들어온 화면에서 나온 것들입니다
(→ [RFC-003](../../../rfc/003-design-handoff.md)). **아직 컴포넌트로 뽑지 않았고
화면 파일 안에 있습니다** — 두 번째 화면에서 다시 쓰일 때 뽑습니다.

| 이름(가칭) | 무엇 | 근거 | 어디 |
| --- | --- | --- | --- |
| `OrbitRing` | 랜딩 히어로의 심볼 둘레 링 셋·글로우. **뜻이 없습니다.** 첫 렌더에 `bloom`(1.2초)으로 피어납니다 — 글자의 `rise` 와 따로 놀지 않게 | [tokens](08-16-tokens.md) `--horizon`·「장식 keyframes」 | `app/page.tsx` |
| `HorizonGlow` | 화면 바닥에 걸린 오렌지 호라이즌 — 납작한 코어 띠 + 위로 번지는 헤일로. **뜻이 없습니다.** 랜딩(문서 끝) · `/start` · 사건 화면 `/c/{token}`(둘은 뷰포트 바닥, 사건 화면은 세기 0.7) 세 곳에서 쓰여 **컴포넌트로 뽑았습니다.** 부모가 `relative isolate` 여야 글 아래에 깔립니다 | [tokens](08-16-tokens.md) `--horizon` · 시안 `assets/artifacts/plans/08-16-entry-flow-mockup.html` 「원본 glows.png 재현」 | **`components/HorizonGlow.tsx`** |
| `ScreenPreviewCard` | 화면 하나의 역할을 미니 목업 + **한 줄**로 | [screens S-04](../08-14-screens.md) 「스크롤 네 마디」③ | `app/page.tsx` |
| `StepRail` | `/start` 단계 레일 (동의 → 무슨 일 → 링크 발급). **스크롤을 따라옵니다**(`sticky`) — 문진이 길어져도 몇 걸음 남았는지가 시야에서 안 사라지게 | [screens S-05](../08-14-screens.md) | `app/start/page.tsx` |
| `ConsentModal` | 동의 전문. **요약 카드 넷 + 조항별 확인** | [screens S-05](../08-14-screens.md) · [ADR-016](../../../decisions/016-retention-and-datastore.md)·[ADR-026](../../../decisions/026-raw-upload-retention.md) | `app/start/page.tsx` |
| `EvidenceSlot` | **종류별** 업로드 슬롯. 종류가 곧 안내이자 분류 | [screens S-05](../08-14-screens.md) 「자료」 | `app/start/page.tsx` |
| `IssuedLink` | 발급된 사건 주소 + 복사. **전부 보이게 줄바꿈** | [ADR-021](../../../decisions/021-reentry-and-identity.md) | `app/start/page.tsx` |
| `Bubble` | 챗 말풍선 (AI/사용자). 꼬리 반경 5px | [screens S-06](../08-14-screens.md) | `app/c/[token]/chat.tsx` |
| `PendingBubble` | **스트리밍 금지의 대가** — 무엇을 하는지 문장으로 | [screens S-06](../08-14-screens.md) · [ADR-022](../../../decisions/022-chat-turn-boundaries.md) | `app/c/[token]/chat.tsx` |
| `CaseFile` | 진술에서 파악한 슬롯이 채워지는 것을 보여줌 | [screens S-06](../08-14-screens.md) | `app/c/[token]/page.tsx` |
| `T0Rail` | 셸 왼쪽 288px 고정 레일. **본문 밖**이라 국면이 바뀌어도 남습니다. 넓은 폭에서 접히지 않습니다 | [screens](../08-14-screens.md) 「셸은 세 열입니다」 · [ADR-036](../../../decisions/036-t0-rail.md) | `app/c/[token]/safety.tsx` |
| `MiniChat` | 본문이 챗이 아닐 때 오른쪽 열 **아래**의 대응 비서. **흡수의 착지점** — 축소 사본이 아니라 제 크기의 진짜 폼 | [screens S-07](../08-14-screens.md) | `app/c/[token]/chat.tsx` |
| `HeroStrip` | S-07 맨 위 「지금 하실 일은 하나」 + D-day. 앰버 6% / 45% | [screens S-07](../08-14-screens.md) | `app/c/[token]/plan.tsx` |
| `PlanBoard`·`StepRow` | 단계 다섯 상태(`done`·`now`·`todo`·`anytime`·`na`). **기호·라벨·색 셋이 함께.** 배지 한 칸이 **순번(숫자) 또는 상태 기호**를 겸합니다 — 세로 목록이 순서로 읽히는 것을 막습니다. `todo`·`anytime` 은 **빈 원**(글리프 없음)이고 가르는 것은 우측 태그 글자입니다. `afterStep` 슬롯이 단계 사이에 카드를 끼웁니다 | [screens S-07](../08-14-screens.md) | **`modules/plan-viewer/board.tsx`** |
| `WaitCard` | 공고 2개월 대기. **단계 행 사이에 같은 폭으로** 들어갑니다. 달력 앵커(시작·지금·만료 예정) — **D-n 도 퍼센트도 쓰지 않습니다.** 앰버 대신 `--horizon`(⬜ [tokens](08-16-tokens.md) 미결), 막대·점은 전부 `aria-hidden` | [screens S-07](../08-14-screens.md) · 시안 「wait-card」 | **`modules/deadline-viewer/wait.tsx`** |
| `DeadlineBadge`·`DeadlinePair` | 기한 배지 **셋뿐**(`user` 앰버 · `passed` 중립 · `system` 중립). **D-day 는 `user` 에만.** 본 기한과 유예를 **합치지 않고 나란히** 둡니다. 기한만 모은 목록 화면은 **만들지 않습니다** | [screens S-07](../08-14-screens.md) · 시안 「deadline-badges」 | **`modules/deadline-viewer/badges.tsx`** |
| `FileRail` | S-08 자료 레일. 7px 상태 점 + **아래 한 줄이 말로 같은 것을 말함** | [screens S-08](../08-14-screens.md) | `app/c/[token]/evidence.tsx` |
| `TranscriptView` | 전사 발화 행. **⬜ 사칭 정황·미확인 표기는 지금 없습니다** — 근거 스팬을 내는 `case-reader`(층 1)가 미구현이고 §3.3 응답에도 자리가 없습니다 | [screens S-08](../08-14-screens.md) · [ADR-034](../../../decisions/034-browser-shows-plaintext.md) | **`modules/transcript-viewer/view.tsx`** |
| `GhostView` | 전환 중 **나가는 본문**. `fixed` + `pointer-events:none` 이라 레이아웃을 밀지 않음 | [tokens](08-16-tokens.md) 「전환」 | `app/c/[token]/page.tsx` |
| `FormSection` | S-10 서식 구획 접기. 헤더에 **「n칸 · 저희가 채운 값 m」**. 서식 구획을 그대로 따라 접습니다 — 실물과 1:1 대조가 목적 | [screens S-10](../08-14-screens.md) | `app/c/[token]/doc.tsx` |
| `CopyField` | 값 한 칸 + 복사. **보이는 것은 끊고 복사되는 것은 끊지 않습니다.** 상태 넷(`confirmed`·`unread`·`unknown`·`staff`) | [screens S-10](../08-14-screens.md) · [ADR-037](../../../decisions/037-doc-guidance-not-generation.md) | `app/c/[token]/doc.tsx` |
| **`WS-*` 패널 일곱** | 유형별 작업 패널. **모듈로 뽑았습니다** | [워크스페이스 패널](../08-17-workspace-panels.md) · [ADR-033](../../../decisions/033-ws-panel-placement.md) | **`modules/work-handler/panels.tsx`** |

**층 C 모듈이 선 것부터 옮겨 갑니다.** 위 표에서 굵게 표시된 넷(`work-handler`·`plan-viewer`·
`deadline-viewer`·`transcript-viewer`)이 그렇고, 나머지는 아직 화면 파일 안에 있습니다 —
「금지가 붙어 있는가」가
기준이고, 패널에는 「`WS-read` 에 체크박스 금지」·「`WS-download` 외 원문 금지」처럼
어기면 계약이 깨지는 것이 붙어 있습니다. `work-handler` 안에서도 **판정(`panel.ts`·`signal.ts`)과
렌더(`panels.tsx`)를 섞지 않습니다.**

**`/start`의 Q1은 `SlotQuestion`의 첫 사례입니다** — 한 번에 하나·전부 버튼·「모름」 상시.
컴포넌트로 뽑을 때 이 화면의 형태를 기준으로 삼습니다.

「초안」은 [진입 플로우 목업](#출처)에서 실제로 만들어 본 것이라는 뜻입니다. 코드가 아니라 형태의 참조입니다.

### 복사는 실패할 수 있습니다 — 조용히 넘어가지 않습니다

**`navigator.clipboard` 는 문서에 포커스가 없거나 비보안 컨텍스트면 거부합니다.**
값을 옮기는 것이 전부인 화면에서 눌렀는데 아무 일도 안 일어나면, 사용자는 이유를 모릅니다.

```
① navigator.clipboard.writeText      실패하면
② textarea + document.execCommand    그것도 실패하면
③ 값을 selection 으로 골라 주고 「이 브라우저가 복사를 막았습니다」
```

**③이 핵심입니다.** 실패를 알리는 것으로 끝내지 않고 **다음 행동을 할 수 있는 상태**로
만들어 둡니다 — 아래 「에러 — 다음 행동을 반드시 함께」와 같은 원칙입니다.

### 기기에 남기는 것은 `useSyncExternalStore` 로 읽습니다

`localStorage` 를 effect 안에서 읽어 `setState` 로 심지 마세요.
서버가 그린 빈 값과 어긋나고, `react-hooks/set-state-in-effect` 가 그 패턴을 막습니다.

```
useSyncExternalStore(subscribe, () => read(key), () => "빈 값")
                                                    ↑ 서버 스냅샷
```

- **메모리 사본을 한 겹 둡니다.** `getSnapshot` 이 매번 새 객체를 돌려주면 무한 렌더가 되고,
  저장이 막힌 기기(사파리 프라이빗)에서도 **이번 화면에서는 표시돼야** 합니다.
- `storage` 이벤트를 함께 구독하면 **다른 탭에서 한 일이 따라옵니다.** 사건 하나를
  여러 탭에 열어 두는 것이 이 서비스에서는 흔합니다 — 은행 창을 옆에 띄우니까요.
- 첫 사례는 S-10 의 「어디까지 옮겼는지」입니다 (`app/c/[token]/doc.tsx`).
- ⬜ **`case-purger` 밖입니다.** 기기에 남는 넷째 자리이고, 파기 대상에 안 들어 있습니다
  → [ADR-016](../../../decisions/016-retention-and-datastore.md).

## 공통 재질 — 아이콘

`src/components/ui/Icon.tsx` · 스프라이트 `src/public/icons.svg` (`<symbol id="i-{name}">` 34개).
시안은 [08-21-icons 핸드오프](../../../assets/artifacts/handoff/08-21-icons/).

```tsx
<Icon name="copy" size={16} />        // 16 칩 · 18 행(기본) · 20 버튼 · 24 패널 머리
<Icon name="working" spin />          // working 전용 · icon-spin 1.4초
<Icon name="dots" pulse />            // dots 전용 · pulse-dot 1.6초
```

- **아이콘은 사물과 행동만 맡습니다.** 상태 마크(`✓`·`◆`·`○`·`!`)는 지금 규칙 그대로입니다 —
  아래 `StepList` 가 기호·라벨·색 셋을 함께 쓰도록 정해 뒀고, 그 자리를 아이콘으로 바꾸면
  **색만으로 구분하지 않는다**는 규칙이 흔들립니다.
- **아이콘 단독으로 쓰지 않습니다.** 항상 글자 옆이고, 그래서 `aria-hidden="true"` 가 기본값입니다.
  아이콘만 있는 버튼을 만들어야 하면 그건 아이콘 문제가 아니라 **라벨이 빠진 것**입니다.
- **색을 직접 주지 않습니다.** 전부 `currentColor` — 감싸는 글자의 토큰이 정합니다
  (→ [tokens](08-16-tokens.md)). 기본 `ink-3` · 가려짐·보호 `--pii` · 기한·재시도 `--deadline-urgent` ·
  버튼 위 `ink-1`.
- **`spark`·`thinking`·`working`·`verify`·`maskwork`·`dots`·`retry`·`stop` 여덟은 AI 인터랙션용인데,
  스켈레톤·타자기의 대체가 아닙니다.** 「무엇을 하고 있는지」는 여전히 **문장**이 말하고
  (아래 「로딩」), 아이콘은 그 문장 옆의 보조입니다 →
  [ADR-022](../../../decisions/022-chat-turn-boundaries.md).
- 이름 34종은 핸드오프 [`PR.md`](../../../assets/artifacts/handoff/08-21-icons/PR.md) 에 뜻과 함께 있습니다.
- `src/app/dev/icons/page.tsx` 가 **개발 전용 확인 화면**입니다. 제품 경로가 아닙니다 —
  외부 스프라이트 `<use>` 는 경로가 틀리면 **조용히 빈칸**이 되므로 눈으로 볼 자리를 둡니다.

## 공통 재질 — 칩

배지·선택 버튼·입력 필드가 **같은 재질**을 씁니다. 알약 모양에 반투명 흰색과 inset 하이라이트.

- 불투명 배경색으로 바꾸지 마세요. 어느 표면 위에 얹혀도 같아 보이게 하려는 것입니다.
- 선택된 상태는 **색을 바꾸지 않고 불투명도와 테두리를 올려** 표현합니다 → [tokens](08-16-tokens.md)

## 지켜야 할 제약

- **`SlotQuestion`에는 "모름"이 항상 있습니다.** 없애는 변형을 만들지 마세요 — 정보 요구로
  사용자를 막지 않는 것이 이 서비스의 규칙입니다.
- **"모름"을 `ink-3`보다 더 낮추지 않고, 크기와 자리도 다른 선택지와 같게 둡니다.**
  고르기 부끄러운 선택지로 만들면 없앤 것과 같습니다.
- **문항에 기본 선택을 두지 않습니다.** 미리 골라두면 화면이 답을 유도하고,
  그 답이 그대로 사건의 축이 됩니다 → [screens S-05](../08-14-screens.md) 「Q1」.
- **정보 입력 화면에는 「건너뛰고 바로 시작」이 같은 화면에 보입니다.** 폼을 통과해야 다음으로
  가는 구조는 [slot-tiering](../../backend/08-14-slot-tiering.md)의 "모달로 정보를 강제 입력받는
  UI 금지"에 걸립니다. 동의(법적 필수)만 관문이 될 수 있습니다.
- **「관문으로 둘 수 있나」는 방향으로 가릅니다** (→ [ADR-031](../../../decisions/031-consent-clause-ack.md)).

  | 무엇을 하는가 | 관문 |
  | --- | --- |
  | 사용자에게서 **정보를 받아낸다** (진술·증거·이메일·연락처) | **금지.** 모름이 답일 수 있는 것을 막으면 안 됩니다 |
  | 우리가 **고지한 것을 확인받는다** (동의 조항) | **허용.** 새로 얻어가는 데이터가 없습니다 |

  그래서 `/start` 의 동의 전문은 **조항 다섯을 모두 확인해야 동의가 성립합니다.**
  관문은 여전히 동의 하나이고, 체크는 그걸 통과하는 절차입니다.
- **`DeadlineTracker`는 날짜를 계산하지 않습니다.** 계산은 서버의 규칙이 하고, 화면은 받은 값을 씁니다.
- **`PiiToken`의 원문은 서버로 가지 않습니다.** 복원 매핑을 props로 서버 컴포넌트에 넘기지 마세요.
- **`CaseTimeline`·`StepList`·히어로가 제출처를 단정하지 않습니다.** "서면 신청"도
  "앱에서 신청"도 쓰지 마세요 — **기관마다 다르고**, 값은 `org.contact.submit` 배열에 있습니다.
  **배열 순서가 곧 권장 순서라 화면이 정렬하지 않습니다** ([ADR-042](../../../decisions/042-submit-paths.md)).
  비어 있으면 **그 카드를 아예 그리지 않습니다** — 「모른다」를 「없다」로 그리지 않기 위해서입니다.

## 외부 컴포넌트

| 무엇 | 어디 | 규칙 |
| --- | --- | --- |
| `border-beam` | npm (MIT) | `src/components/ui/border-beam.tsx` 래퍼 경유 |

**`border-beam`은 진술 입력창에만 씁니다.** 시선을 한 곳으로 모으려고 쓰는 장치라, 여러 곳에
붙이면 아무 데도 모이지 않습니다. `duration={7}`로 늦추고, 색은 기본(`colorful`)을 씁니다.

패키지에 `"use client"`가 없는데 훅을 쓰므로 **래퍼에서 클라이언트 경계를 세웁니다.**
서버 컴포넌트에서 직접 import하면 런타임에 실패합니다.

## 어느 모듈의 것인가

**컴포넌트는 모듈이 아닙니다.** 아래는 각 컴포넌트가 **어느 모듈의 화면을 이루는지**입니다
→ [모듈 명칭](../../common/08-16-module-names.md) 층 C · [ADR-023](../../../decisions/023-frontend-module-names.md).

| 컴포넌트 | 모듈 |
| --- | --- |
| `PiiToken` | `pii-restorer` (표시 전 복원 심사) |
| `Composer` · `SlotQuestion` | `chat-handler` |
| `CaseTimeline` · `StepItem` · `ChannelBadge` · `SafetyRail` | `plan-viewer` |
| `DeadlineTracker` | `deadline-viewer` |
| `EvidenceCard` | `file-sender` (올리기) · `transcript-viewer` (전사 표시) |
| **워크스페이스 패널 `WS-*` 7종** | `work-handler` → [워크스페이스 패널](../08-17-workspace-panels.md) |

## 파일을 어디에 두나

- **도메인 모듈 코드는 `src/modules/{모듈 이름}/`** 입니다. 폴더 이름이 정본과 글자 그대로 같아야 하고,
  **정본에 없는 이름으로 만들면 CI가 막습니다** → [ADR-019](../../../decisions/019-module-code-sync.md).
- **shadcn 컴포넌트와 공용 UI 조각은 `src/components/`** 입니다. 모듈이 아닙니다.
- **가르는 기준은 「절대 하지 않는 것」이 붙어 있는가**입니다. 금지가 걸린 자리는 모듈이고,
  버튼·카드처럼 어디에나 쓰이는 조각은 컴포넌트입니다.

> `PiiToken`이 헷갈리는 예입니다. **컴포넌트는 `src/components/`** 에 두되,
> **복원해도 되는 자리인지 판정하는 코드는 `src/modules/pii-restorer/`** 에 있습니다.
> 판정을 컴포넌트 안에 넣으면 [PII 격리 경계](../../common/08-14-pii-boundary.md)의 규칙이 UI에 흩어집니다.

## 파일 이름

| 무엇 | 어디 | 이름 |
| --- | --- | --- |
| 우리 컴포넌트 | `src/components/` | **PascalCase** — `PiiToken.tsx` |
| shadcn 원본 | `src/components/ui/` | **kebab-case** — 손대지 않으므로 원본 그대로 |
| 모듈 코드 | `src/modules/{모듈}/` | **kebab-case** — `restore-policy.ts` |

**shadcn 원본의 이름을 우리 규칙에 맞추지 마세요.** `npx shadcn add`가 다시 받을 때
같은 자리에 덮어써야 합니다.

## shadcn을 고쳐야 할 때

**원칙은 래핑입니다.** `src/components/ui/`의 원본을 고치지 않고 감쌉니다 —
고치면 다시 받을 때 조용히 사라지거나 충돌합니다.

| 상황 | 어떻게 |
| --- | --- |
| 우리 토큰·크기를 입힌다 | **래퍼** — `border-beam.tsx`가 이미 그 예입니다 |
| 기본값만 바꾼다 | **래퍼**에서 props 기본값을 잡습니다 |
| **접근성 결함이 있다** | **원본을 고칩니다.** 왜 고쳤는지 파일 맨 위에 주석으로 남기고, 재설치 시 다시 확인 |

## 로딩 · 에러 · 빈 상태

### 로딩 — 무엇을 하고 있는지 문장으로

**스켈레톤을 기본으로 쓰지 않습니다.** 회색 상자가 흔들리는 것은 「기다리라」는 말일 뿐인데,
이 서비스에서는 **AI가 뭘 하고 있는지 보이는 것 자체가 신뢰 장치**입니다 →
[screens S-08](../08-14-screens.md).

- 진행 상태를 **말로** 씁니다 — 「전사 중 74%」·「가리는 중」.
- 상태는 `poll-checker`가 내줍니다. 컴포넌트가 스스로 추측하지 않습니다.
- 스켈레톤은 **레이아웃이 튀는 것을 막을 때만** 곁들입니다.

### 에러 — 다음 행동을 반드시 함께

문구·코드 계약은 [14-errors.md](../../backend/08-16-errors.md)가 정본입니다. 화면 쪽 규칙만 여기 둡니다.

- **무엇이 잘못됐는지 + 지금 뭘 할 수 있는지**를 한 덩어리로 보여줍니다.
- **막다른 에러를 만들지 않습니다.** 되돌아갈 곳이 없으면 최소한 T0 안전 절차로 보냅니다.
- 사과문을 늘리지 않습니다. 패닉 상태에서 읽히는 것은 **다음 한 줄**입니다.

### 빈 상태 — 빈 화면이 없습니다

**「할 일이 없음」과 「아직 아무것도 없음」은 다릅니다.**

| 상황 | 무엇을 보여주나 |
| --- | --- |
| 사건을 막 열었다 | T0 공통 안전 절차 (`SafetyRail`) — **슬롯과 무관하게 상시** |
| 증거를 안 올렸다 | 빈 목록이 아니라 **「없어도 진행됩니다」** |
| 지금 할 일이 없다 (공고 대기) | **`WS-wait`.** 카운트다운을 만들지 않습니다 → [워크스페이스 패널](../08-17-workspace-panels.md) |

## 칩과 터치 목표

**칩은 시각적으로 24~36px이라 권장 터치 목표 44px에 미달합니다.**
크기를 키우면 밀도가 무너지므로, **히트 영역만 넓힙니다** — `[data-hit]`이
가상 요소로 44px 영역을 만듭니다 → [토큰 「히트 영역」](08-16-tokens.md).

칩끼리 붙여 놓을 때는 **히트 영역이 겹치지 않게** 간격을 둡니다.

> **2026-08-22 — `[data-hit]` 이 그때까지 아무 데도 안 붙어 있었습니다.**
> 장치는 `globals.css` 에 있는데 **사용처가 0곳**이라, 실측하니 보내기 버튼이
> 26~30px 로 그대로 나왔습니다. 지금은 **컴포저와 미니 챗의 보내기 버튼 둘**이
> 첫 사용처입니다 (`app/c/[token]/chat.tsx`).

**어디에 `data-hit` 을 쓰고 어디에 실제 크기를 키우나** — 손가락이 무엇을 하느냐로 가릅니다.

| | 어떻게 | 왜 |
| --- | --- | --- |
| 눌러서 끝나는 것 (버튼·칩) | **`data-hit`** | 밀도를 지키면서 히트 영역만 넓힙니다 |
| **안에 커서를 두는 것 (입력칸)** | **실제 높이를 `var(--size-touch)` 로** | 눌러서 끝이 아니라 **그 안에서 타이핑**합니다. 히트 영역만 넓히면 글자가 여전히 좁은 칸에 갇힙니다 |

**작은 글리프는 `aria-hidden` 으로 감쌉니다.** 버튼 이름은 `aria-label` 이 갖고,
안의 `↑` 같은 것은 장식입니다 — 그래야 [12.5px 하한](08-16-tokens.md)의 「실제 텍스트」에서 빠집니다.

> ⚠️ **뜻이 있는 글자에는 이 수법을 쓰지 마세요.** `StepList` 의 순번은 사용자가
> **읽는 숫자**라 `aria-hidden` 으로 덮으면 안 됩니다 — 배지를 24px 로 키우고
> 숫자를 12.5px 로 올렸습니다 ([ADR-032](../../../decisions/032-text-floor.md)).

## TODO

- ⬜ `poll-checker` 구현 시 로딩 문구의 정본을 어디 둘지 (지금은 컴포넌트가 직접 씁니다)

## 출처

초안: [진입 플로우 목업](../../../assets/artifacts/plans/08-16-entry-flow-mockup.html)
(랜딩 → 동의·상황 → 챗 콘솔).
