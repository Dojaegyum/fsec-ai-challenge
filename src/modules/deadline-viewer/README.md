# deadline-viewer

기한을 표시합니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | `GET /api/cases/{token}/deadlines` ([API](../../../spec/common/08-14-api.md) §3.7) |
| 내놓는 것 | D-day · 유예 · `info` |
| 절대 하지 않는 것 | **날짜 계산** · 지난 기한 지우기 · 환급을 카운트다운으로 만들기 |

## 왜 D-day 가 안 뜨나

`days_left` 가 응답에 없으면 **일부러 안 그립니다.** `due_at` 에서 화면이 직접 세면
사용자 기기의 날짜가 틀렸을 때 기한을 놓칩니다 — 기준 시계는 서버입니다
([기한 규칙](../../../spec/common/08-16-deadline-rules.md)).

`days_left` 는 **아직 §3.7 에 없습니다** →
[계획 Task 1](../../../docs/plans/08-22-layer-c-viewers.md).

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **`days_left` 가 없을 때** | 배지를 **아예 안 그립니다** (`null`) | 「D-?」 같은 자리표시를 두면 나중에 그걸 채우려고 화면이 세게 됩니다 |
| **모르는 `kind`** | `primary` 로 둡니다 | 버리면 기한 목록이 조용히 비고, 사용자는 놓친 줄도 모릅니다 |
| **지난 기한** | 목록에 남깁니다 | 본 기한을 넘겨도 유예 14일이 남아 있습니다 |
| **`days_left === 0`** | 「오늘」 | `D-0` 은 읽는 사람이 오늘인지 지났는지 모릅니다 |
| **앰버를 어디에** | `primary` 카운트다운에만 | `info` 까지 앰버면 두 달짜리 공고가 급한 일로 보입니다. **빨강은 어디에도 안 씁니다** |

## 아직 아닌 것

- ⬜ **`DeadlineList` 가 놓일 자리.** 기한만 모아 보여주는 화면의 **시안이 없습니다.**
  지금은 `plan-viewer` 가 단계 옆에 기한 문자열을 다는 것이 전부입니다 —
  독립 목록을 둘지는 **사람이 정합니다** ([RFC-003](../../../rfc/003-design-handoff.md)).
- ⬜ **히어로 스트립의 D-day 박스.** S-07 맨 위 `D-2` 는 아직 `plan.tsx` 의 상수입니다.
  `days_left` 가 계약에 들어오면 그 자리가 `DeadlineBadge` 가 됩니다.

## 파일

| | |
| --- | --- |
| `group.ts` | 갈래 나누기 · D-day 문자열 · 카운트다운 여부 |
| `list.tsx` | `DeadlineList` · `DeadlineBadge` (렌더만) |
| `types.ts` | `Deadline` · `DeadlineKind` · `DeadlineGroups` |
| `group.test.ts` | 10건. `npm test` |
