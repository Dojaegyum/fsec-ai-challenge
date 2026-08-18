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

「초안」은 [진입 플로우 목업](#출처)에서 실제로 만들어 본 것이라는 뜻입니다. 코드가 아니라 형태의 참조입니다.

## 공통 재질 — 칩

배지·선택 버튼·입력 필드가 **같은 재질**을 씁니다. 알약 모양에 반투명 흰색과 inset 하이라이트.

- 불투명 배경색으로 바꾸지 마세요. 어느 표면 위에 얹혀도 같아 보이게 하려는 것입니다.
- 선택된 상태는 **색을 바꾸지 않고 불투명도와 테두리를 올려** 표현합니다 → [tokens](08-16-tokens.md)

## 지켜야 할 제약

- **`SlotQuestion`에는 "모름"이 항상 있습니다.** 없애는 변형을 만들지 마세요 — 정보 요구로
  사용자를 막지 않는 것이 이 서비스의 규칙입니다.
- **정보 입력 화면에는 「건너뛰고 바로 시작」이 같은 화면에 보입니다.** 폼을 통과해야 다음으로
  가는 구조는 [slot-tiering](../../backend/08-14-slot-tiering.md)의 "모달로 정보를 강제 입력받는
  UI 금지"에 걸립니다. 동의(법적 필수)만 관문이 될 수 있습니다.
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

## TODO

- ~~TODO(정해야 함): 컴포넌트 파일 위치와 명명~~ → **위 「파일을 어디에 두나」로 확정**
  ([ADR-023](../../../decisions/023-frontend-module-names.md)). 파일 **명명 규칙**은 아직입니다 → TODO(미정).
- TODO(정해야 함): 로딩·에러·빈 상태의 공통 처리 방식. `poll-checker`가 상태를 내주므로 **그 모듈과 함께 정합니다**
- TODO(정해야 함): shadcn 컴포넌트를 수정할 때의 규칙 (원본 수정 vs 래핑)
- TODO(정해야 함): 칩 높이가 접근성 권장 터치 목표(44px)에 미달 → [접근성](08-16-accessibility.md)

## 출처

초안: [진입 플로우 목업](../../../assets/artifacts/plans/08-16-entry-flow-mockup.html)
(랜딩 → 동의·상황 → 챗 콘솔).
