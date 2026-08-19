# planner

**KB 를 인용해 플랜 단계를 확정합니다.** 절차 문장은 만들지 않습니다 — KB 본문을
그대로 옮기고, 이 모듈이 정하는 것은 **어느 단계가 지금 활성인가**와
**기존 상태를 어떻게 잇는가**입니다.

| | |
| --- | --- |
| 계약의 정본 | [09-data-model.md](../../../spec/backend/08-16-data-model.md) §6 §6.1 §11.4 · [02-slot-tiering.md](../../../spec/backend/08-14-slot-tiering.md) |
| 이름의 정본 | [12-module-names.md](../../../spec/common/08-16-module-names.md) 「층 3」 |
| 책임의 정본 | [모듈 경계](../../../spec/common/08-16-module-boundaries.md) |
| 근거 | `CLAUDE.md` 불변 규칙 1·5 · [ADR-014](../../../decisions/014-module-names.md) · [ADR-028](../../../decisions/028-runtime-and-module-shape.md) |

## 절대 하지 않는 것

- **근거 없는 단계를 만들지 않습니다.** `kb_entry_id`·`kb_version`·`source_url`·
  `effective_from` 중 하나라도 비면 **던집니다.** 조용히 빼면 사용자는 절차 하나가
  없어진 것을 모릅니다 → [09-data-model.md](../../../spec/backend/08-16-data-model.md) §6.
- **절차 문장을 쓰지 않습니다.** `body` 를 손대지 않고 그대로 옮깁니다.
- **날짜를 계산하지 않습니다.** 기한은 `date-checker` 가 냅니다 (불변 규칙 7).
- **완료된 단계를 덮어쓰지 않습니다.** 부산물이 끊깁니다.
- **정보가 없다고 멈추지 않습니다.** 빈 플랜도 정상입니다 (불변 규칙 5).

## 언제 단계가 켜지나

KB 항목이 자기 활성 조건을 스스로 선언합니다
→ [09-data-model.md](../../../spec/backend/08-16-data-model.md) §11.4.

```jsonc
{
  "requires_slots": ["freeze_requested_at"],   // 이 슬롯들이 confirmed 여야 함
  "after": ["bank-freeze-request"],            // 이 단계가 done_verified 여야 함
  "conditional": null                          // 슈퍼셋 플랜의 조건 라벨
}
```

**조건이 없으면 바로 켜집니다.** 사건을 만든 직후에 T0 공통 안전 절차가 붙는 자리입니다.

**`confirmed` 슬롯만 셉니다.** `extracted` 는 모델이 뽑았을 뿐 확인 전이라, 그걸로
단계를 켜면 잘못 읽은 값 때문에 엉뚱한 절차가 뜹니다
→ [09-data-model.md](../../../spec/backend/08-16-data-model.md) §5.2.

## 재생성은 삭제 후 삽입이 아닙니다

슬롯이 나중에 채워지면 플랜을 다시 만드는데, **`step_key` 기준 병합**입니다
→ [09-data-model.md](../../../spec/backend/08-16-data-model.md) §6.1.

| 기존 상태 | 결과 | 어디로 |
| --- | --- | --- |
| `not_started` | 새 내용으로 교체 | `upsert` |
| `in_progress` | 새 내용으로 교체, **상태 유지** | `upsert` |
| `done_verified` | **교체 안 함.** 부산물 보존 | `preserved` |
| `unconfirmed` | **교체 안 함.** 리마인더 추적 유지 | `preserved` |
| 새 플랜에 없음 | `skipped` 표시. **삭제 안 함** | `skipped` |

**보존되는 단계도 표시 순서(`seq`)는 갱신하세요.** 건너뛰고 매기면 단계를 하나
완료할 때마다 화면 순서가 어긋납니다. 그래서 `preserved` 가 `step_key` 만이 아니라
새 `seq` 를 함께 돌려줍니다.

## 슈퍼셋 플랜

송금 수단을 모르면(`slot-checker` 의 `needsSupersetPlan`) **참고 묶음의 조건부
단계가 함께 들어갑니다** → [02-slot-tiering.md](../../../spec/backend/08-14-slot-tiering.md).

**조건 라벨이 있는 것만 넣습니다.** 라벨 없이 넣으면 은행 이체 사건에 간편송금
절차가 조건 없이 뜹니다 — 그건 슈퍼셋이 아니라 틀린 안내입니다.

## 쓰는 법

```ts
import { createPlanner } from '@/modules/planner'

const planner = createPlanner({ clock })

const { upsert, preserved, skipped } = planner.build({
  caseId,
  applied,                 // kb-finder 의 적용 묶음
  reference,               // kb-finder 의 참고 묶음 (슈퍼셋에서만 씀)
  slots,                   // 사건의 슬롯 상태
  existing,                // 이미 저장된 plan_step (처음이면 생략)
  superset: t1 !== 'satisfied',
})

// upsert    → 저장 (신규·교체)
// preserved → seq 만 갱신
// skipped   → state 를 'skipped' 로
```

## 밖에서 넣어야 하는 것

| 무엇 | 어디서 | 비고 |
| --- | --- | --- |
| `Clock` | 서버 시계 (`Asia/Seoul`) | `generated_at` 에만 씁니다 |

**저장소를 받지 않습니다.** 무엇을 저장할지 계산해 돌려줄 뿐, 쓰는 것은 부른 쪽입니다 —
`done_verified` 를 덮지 않는다는 규칙을 한 자리에서 지키게 하려는 것입니다.

## 아직 아닌 것 — 두 가지가 정본에 없습니다

- ⬜ **`actor` 를 채울 데이터가 KB 에 없습니다.**
  [§6](../../../spec/backend/08-16-data-model.md) 이 `plan_step.actor` 를 `NOT NULL` 로
  정했는데, [§11.4](../../../spec/backend/08-16-data-model.md) 의 본문 스키마에도
  `kb_entry` 칼럼에도 그 값이 없습니다.

  **기본값을 두지 않고 던집니다.** `victim` 으로 떨어뜨리면 채권소멸공고(금감원이
  하는 일)가 사용자 할 일로 뜨는데, [§8.3](../../../spec/backend/08-16-data-model.md) 이
  그 오인을 명시적으로 경고합니다. 지금 구현은 **`body.actor` 를 읽고, 없으면 거부**합니다 —
  정본이 자리를 정하면 그쪽으로 옮깁니다.

- ⬜ **참고 단계의 조건 라벨을 KB 가 안 쓰면 슈퍼셋에서 빠집니다.**
  유형 이름에서 문구를 만들 수도 있지만, 그러면 절차 지식을 코드에 굽는 셈입니다.

- ⬜ **모델을 부르지 않습니다.** [모듈 경계](../../../spec/common/08-16-module-boundaries.md)의
  흐름도가 `planner(LLM+KB)` 로 적고 있는데, KB 본문 스키마가 확정된 뒤로는 활성 조건·
  순서·라벨이 전부 기계적으로 정해져 모델이 할 일이 남지 않습니다.
  **모델 단계가 필요하다고 정해지면 이 위에 얹는 형태가 됩니다** — 지금 계산은 그대로 씁니다.

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **`actor` 가 없을 때** | **기본값 없이 던진다** | `victim` 으로 떨어지면 기관이 하는 일이 사용자 할 일로 뜹니다. 정본이 그 오인을 경고합니다 |
| **근거가 빈 항목** | **버리지 않고 던진다** | 조용히 빼면 절차 하나가 없어진 것을 아무도 모릅니다. 적재 시 검증이 이미 거른 것이라, 런타임에 오면 데이터가 깨진 것입니다 |
| **`extracted` 슬롯으로 켤지** | **안 켠다** | 정본이 「기한 계산은 `confirmed` 만」이라 정했고, 단계 활성도 같은 이유입니다 — 잘못 읽은 값으로 엉뚱한 절차가 뜹니다 |
| **보존 단계의 `seq`** | **갱신하도록 함께 돌려준다** | 건너뛰고 매기면 완료할 때마다 화면 순서가 어긋납니다 |
| **라벨 없는 참고 단계** | **슈퍼셋에 안 넣는다** | 조건 없이 뜨면 틀린 안내입니다. 유형 이름으로 문구를 지으면 절차 지식을 코드에 굽는 셈입니다 |
| **저장소를 받을지** | **안 받는다** | 무엇을 저장할지만 계산합니다. 「완료된 단계를 덮지 않는다」를 한 자리에서 지키게 하려는 것입니다 |
