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
| `OrbitRing` | 랜딩 히어로의 심볼 둘레 링·글로우. **뜻이 없습니다** | [tokens](08-16-tokens.md) `--horizon`·「장식 keyframes」 | `app/page.tsx` |
| `ScreenPreviewCard` | 화면 하나의 역할을 미니 목업 + **한 줄**로 | [screens S-04](../08-14-screens.md) 「스크롤 네 마디」③ | `app/page.tsx` |
| `StepRail` | `/start` 단계 레일 (동의 → 무슨 일 → 링크 발급) | [screens S-05](../08-14-screens.md) | `app/start/page.tsx` |
| `ConsentModal` | 동의 전문. **요약 카드 넷 + 조항별 확인** | [screens S-05](../08-14-screens.md) · [ADR-016](../../../decisions/016-retention-and-datastore.md)·[ADR-026](../../../decisions/026-raw-upload-retention.md) | `app/start/page.tsx` |
| `EvidenceSlot` | **종류별** 업로드 슬롯. 종류가 곧 안내이자 분류 | [screens S-05](../08-14-screens.md) 「자료」 | `app/start/page.tsx` |
| `IssuedLink` | 발급된 사건 주소 + 복사. **전부 보이게 줄바꿈** | [ADR-021](../../../decisions/021-reentry-and-identity.md) | `app/start/page.tsx` |
| `Bubble` | 챗 말풍선 (AI/사용자). 꼬리 반경 5px | [screens S-06](../08-14-screens.md) | `app/c/[token]/page.tsx` |
| `PendingBubble` | **스트리밍 금지의 대가** — 무엇을 하는지 문장으로 | [screens S-06](../08-14-screens.md) · [ADR-022](../../../decisions/022-chat-turn-boundaries.md) | `app/c/[token]/page.tsx` |
| `CaseFile` | 진술에서 파악한 슬롯이 채워지는 것을 보여줌 | [screens S-06](../08-14-screens.md) | `app/c/[token]/page.tsx` |
| **`WS-*` 패널 일곱** | 유형별 작업 패널. **모듈로 뽑았습니다** | [워크스페이스 패널](../08-17-workspace-panels.md) · [ADR-033](../../../decisions/033-ws-panel-placement.md) | **`modules/work-handler/panels.tsx`** |

**`WS-*` 패널만 모듈로 갔습니다.** 나머지는 화면 파일 안에 있습니다 — 「금지가 붙어 있는가」가
기준이고, 패널에는 「`WS-read` 에 체크박스 금지」·「`WS-download` 외 원문 금지」처럼
어기면 계약이 깨지는 것이 붙어 있습니다. `work-handler` 안에서도 **판정(`panel.ts`·`signal.ts`)과
렌더(`panels.tsx`)를 섞지 않습니다.**

**`/start`의 Q1은 `SlotQuestion`의 첫 사례입니다** — 한 번에 하나·전부 버튼·「모름」 상시.
컴포넌트로 뽑을 때 이 화면의 형태를 기준으로 삼습니다.

「초안」은 [진입 플로우 목업](#출처)에서 실제로 만들어 본 것이라는 뜻입니다. 코드가 아니라 형태의 참조입니다.

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
- **`CaseTimeline`에 "서면 신청"이라고 쓰지 마세요.** 2026년 7월부터 은행 앱 비대면 신청입니다
  → [channel-matrix](../../backend/08-14-channel-matrix.md)

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

## TODO

- ⬜ `poll-checker` 구현 시 로딩 문구의 정본을 어디 둘지 (지금은 컴포넌트가 직접 씁니다)

## 출처

초안: [진입 플로우 목업](../../../assets/artifacts/plans/08-16-entry-flow-mockup.html)
(랜딩 → 동의·상황 → 챗 콘솔).
