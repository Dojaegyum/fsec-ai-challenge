# slot-checker

지금 아는 정보가 충분한지 판정하고, **다음에 물을 한 문항**을 고릅니다.

| | |
| --- | --- |
| 계약의 정본 | [02-slot-tiering.md](../../../spec/backend/08-14-slot-tiering.md) |
| 질문 구조 | [08-api.md](../../../spec/common/08-14-api.md) §3.4 — **`next_question` 의 정의는 그 절 하나입니다** |
| 슬롯 이름·상태 | [09-data-model.md](../../../spec/backend/08-16-data-model.md) §5.1 · §5.2 |
| 근거 | [ADR-014](../../../decisions/014-module-names.md) · [ADR-015](../../../decisions/015-citation-and-reask.md) · [ADR-028](../../../decisions/028-runtime-and-module-shape.md) |

## 이 모듈은 사용자를 막지 않습니다

**설계 원칙이 「미확정 슬롯이 있어도 절대 멈추지 않는다」입니다.** 그래서 이 모듈은
**어떤 입력에도 예외를 던지지 않습니다.** 슬롯이 하나도 없어도, 물을 것이 없어도
정상 결과를 돌려줍니다.

`nextQuestion` 이 `null` 이어도 실행 보드는 열립니다. 슬롯 미충족을 이유로 진입을 막는
흐름을 만들지 마세요 — T0 공통 안전 절차가 있는 이유가 그것입니다.

## 무엇을 채워진 것으로 세나

| 상태 | 채워진 것으로 세나 | 다시 묻나 |
| --- | :---: | :---: |
| `confirmed` 사용자가 확인·입력 | **예** | 아니오 |
| `extracted` LLM이 뽑았고 확인 전 | **예** | 아니오 |
| `unknown` 「모름」 선택 | **아니오** | **아니오** |
| `empty` 아직 없음 | 아니오 | **예 — 질문 대상은 이것뿐** |

**`extracted` 를 세는 이유**는 흐름이 「자동 추출 → T1 충족?」 순서이기 때문입니다.
뽑힌 값이 있으면 플랜을 만들 수 있습니다.

**`unknown` 은 값이 아니지만 다시 묻지도 않습니다.** 실패가 아니라 정상 상태이고,
사용자가 이미 모른다고 답했으니 또 물으면 막아 세우는 것이 됩니다. 대신 슈퍼셋 플랜으로
갑니다 — **낫게 안내하지 못할 바에 넓게 안내합니다.**

## 티어 판정

- `satisfied` — 그 티어가 전부 채워짐
- `partial` — 일부만
- `unsatisfied` — 하나도 없음

**`needsSupersetPlan` 은 T1 이 `satisfied` 가 아닐 때 참입니다.** 「모름」으로 확정된
경우도 포함합니다.

> **T2 는 웬만해선 `satisfied` 가 되지 않습니다.** 정본 §5.1 의 T2 열한 개를 모두 세는데,
> 그중 `counterpart_account`·`freeze_requested_at` 같은 것은 증거와 부산물에서 오기 때문입니다.
> T2 상태는 「얼마나 정밀해졌는가」의 눈금으로 읽으세요.

## 묻는 순서

```
transferred → channel        T1. 분기 자체를 결정한다
org_name → amount → occurred_at → elapsed_hint → contact_method    T2
```

**한 번에 하나만 묻습니다.** 순서는 플랜을 가장 크게 바꾸는 것부터입니다.

`transferred` 가 `channel` 보다 앞인 것은, 보냈는지를 알아야 무엇으로 보냈는지가
뜻을 갖기 때문입니다.

**나머지 T2 는 묻지 않습니다.** `counterpart_account`·`freeze_requested_at`·
`relief_applied_at`·`report_filed_at`·`objection_submitted_at`·`impersonated_org` 는
증거·부산물에서 오는 값이라 문진 대상이 아닙니다.

> ⬜ **T2 안의 순서에 정본이 없습니다.** 기관 전용 KB 항목을 고르는 `org_name` 이 조회
> 범위를 가장 크게 좁히고, `amount` 는 서류 필수 기재, `occurred_at` 은 기한 기산점이라는
> 판단으로 두었습니다. 근거가 정해지면 정본으로 옮깁니다.

## 「모름」 선택지는 구조적으로 보장됩니다

버튼 질문에 「모름·기억 안 남」이 없으면 **스펙 위반**입니다. 문구를 주는 쪽이 빠뜨려도
이 모듈이 붙여 주므로, 위반이 일어날 수 없습니다. 이미 있으면 중복해 붙이지 않습니다.

## 질문 문구는 이 모듈이 갖지 않습니다

**문구와 선택지의 정본이 아직 없습니다.** 코드 상수인지, 슬롯 정의 테이블인지, KB 인지가
정해지지 않았습니다 → [백엔드 핸드오프](../../../docs/plans/08-16-backend-handoff.md) ⑤.

그래서 `QuestionSource` 인터페이스로 받습니다. **정해지면 그 구현만 바뀌고 이 모듈은
그대로입니다.** 문구를 주지 않는 슬롯은 물을 수 없으니 조용히 건너뜁니다.

## 쓰는 법

```ts
import { createSlotChecker } from '@/modules/slot-checker'

const slotChecker = createSlotChecker({ questions: questionSource })

const { t1, t2, nextQuestion, needsSupersetPlan } = slotChecker.check({
  slots: await loadSlots(caseId),
})
```

**챗에서도 같은 모듈이 질문을 만듭니다.** 모델이 근거를 못 찾아 `citation-checker` 가
되묻기로 넘길 때, 질문을 새로 만들지 않고 여기서 만든 `nextQuestion` 을 그대로 씁니다 —
사용자에게는 같은 질문이고 실제로 같은 코드가 만듭니다
→ [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §6.3.
