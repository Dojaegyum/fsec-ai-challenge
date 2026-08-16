# 컴포넌트 규칙

> **뼈대만 작성됨.**

기반은 shadcn/ui입니다. 여기에는 **shadcn이 정해주지 않는 것**만 적습니다 —
우리 도메인에서만 뜻이 있는 컴포넌트와, 기본 컴포넌트를 쓸 때 지켜야 할 제약.

## 도메인 컴포넌트 (우리가 만들 것)

| 이름(가칭) | 무엇 | 근거 |
| --- | --- | --- |
| `PiiToken` | 전사 안의 가려진 개인정보. 복원은 **클라이언트에서만** | [pii-boundary](../../common/08-14-pii-boundary.md) |
| `ChannelBadge` | 경유 서비스 8유형 배지 | [channel-matrix](../../backend/08-14-channel-matrix.md) |
| `DeadlineTracker` | 3영업일 D-day·2개월 공고 등 법정 기한 | 기한 계산은 **규칙**이 함, 화면은 표시만 |
| `SlotQuestion` | 한 번에 한 문항·전부 버튼·"모름" 상시 노출 | [slot-tiering](../../backend/08-14-slot-tiering.md) |
| `StepItem` | 실행 단계 + 부산물 표시 (완료 판정) | [completion-hook](../../backend/08-14-completion-hook.md) |
| `EvidenceCard` | 업로드 파일과 처리 상태 | [screens S-01](../08-14-screens.md) |

## 지켜야 할 제약

- **`SlotQuestion`에는 "모름"이 항상 있습니다.** 없애는 변형을 만들지 마세요 — 정보 요구로
  사용자를 막지 않는 것이 이 서비스의 규칙입니다.
- **`DeadlineTracker`는 날짜를 계산하지 않습니다.** 계산은 서버의 규칙이 하고, 화면은 받은 값을 씁니다.
- **`PiiToken`의 원문은 서버로 가지 않습니다.** 복원 매핑을 props로 서버 컴포넌트에 넘기지 마세요.

## TODO

- TODO(정해야 함): 컴포넌트 파일 위치와 명명 (`src/components/` 아래 도메인별로 나눌지)
- TODO(정해야 함): 로딩·에러·빈 상태의 공통 처리 방식
- TODO(정해야 함): shadcn 컴포넌트를 수정할 때의 규칙 (원본 수정 vs 래핑)
