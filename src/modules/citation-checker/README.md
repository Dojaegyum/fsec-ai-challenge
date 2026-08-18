# citation-checker

모델이 답변에 붙인 인용을 확인하고, **근거가 없을 때 에러로 끝낼지 되묻기로 넘길지**를 가릅니다.

| | |
| --- | --- |
| 계약의 정본 | [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §6.1 · §6.2 · §6.3 |
| 에러 처리 | [10-errors.md](../../../spec/backend/08-16-errors.md) §4.1 · §4.2 |
| 이름의 정본 | [12-module-names.md](../../../spec/common/08-16-module-names.md) 「층 2」 |
| 근거 | [ADR-015](../../../decisions/015-citation-and-reask.md) · [ADR-028](../../../decisions/028-runtime-and-module-shape.md) |

**이 모듈이 `CLAUDE.md` 불변 규칙 1(LLM은 절차를 창작하지 않는다)을 실제로 집행하는 자리입니다.**

## 확인하는 것 셋

| # | 확인 | 어기면 |
| --- | --- | --- |
| 1 | `ref` 가 이번 턴에 발급한 번호인가 | `unknown_ref` — 지어낸 참조 |
| 2 | 각 항목의 `why` 가 비어 있지 않은가 | `why_empty` — 형식 위반 |
| 3 | `insufficient` 가 `true` 인가 | 되묻기로 (아래) |

**3번을 가장 먼저 봅니다.** 모델이 근거 없음을 밝혔다면 형식을 따질 일이 아니라 되묻기로 가야 합니다 —
같은 프롬프트로 다시 불러도 같은 답이 옵니다.

> **2026-08-18 「인용 바꿔치기」 검사가 사라졌습니다.** 모델이 `kb_entry_id`·`kb_version` 을
> 아예 받지 않게 되어(→ [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §5)
> **바꿔칠 대상이 없어졌습니다.** 검사로 잡던 것을 구조로 막은 것입니다.
> 서버가 `ref` 로 그 값들을 찾아 채웁니다.

## 판정 넷 — 어느 갈래로도 에러가 나가지 않는 것이 둘입니다

| 결과 | 뜻 | 호출자가 할 일 |
| --- | --- | --- |
| `pass` | 통과 | 응답을 그대로 200으로 내보냅니다 |
| `retry` | 형식 위반 | **같은 프롬프트로 다시 생성**합니다. 최대 2회, 대기 없음 → `retry-checker` |
| `guide_1332` | KB 조회가 0건 | 절차를 말하지 않고 1332 안내. **200입니다** |
| `ask_slot` | 근거를 못 찾음 | `slot-checker` 로 넘겨 질문 한 문항을 냅니다. **200입니다** |

**`ask_slot` 에서 질문을 새로 만들지 않습니다.** 슬롯 체커가 이미 만드는 `next_question` 을 그대로 씁니다 —
문구·버튼·「모름」 선택지가 그 구조에 이미 있어, 챗에서 나갈 때도 같은 모양입니다
→ [08-api.md](../../../spec/common/08-14-api.md) §3.4.

## 절대 하지 않는 것

- **「이번 답변이 절차를 말했는가」를 판정하지 않습니다.** 절차만 검사하면 두 가지가 샙니다 —
  없는 계좌번호를 지어내는 것이 안 걸리고, `"그 계좌는 국민 ****7890입니다"` 같은 정상 응답이
  위반이 됩니다(인용할 절차 항목이 없으므로) → §6.1.
- **인용이 비었다고 에러를 내지 않습니다.** 그러면 인사말에도 발동합니다.
- **`why` 의 내용이 맞는지 보지 않습니다.** 비었는지만 봅니다 → §5.1.
- **조회하거나 저장하지 않습니다.** 판단에 필요한 것을 전부 입력으로 받습니다.

## 못 막는 것

**정확성까지 보장하는 것으로 읽으면 안 됩니다** → §6.4.

| | |
| --- | --- |
| **막습니다** | 없는 절차를 지어내는 것 · 이 사건에 해당하지 않는 절차를 근거 없이 끌어 쓰는 것 |
| **못 막습니다** | **맞는 항목을 인용해 놓고 본문에 내용을 틀리게 옮기는 것** |
| | 그럴듯하게 지어 쓴 `why` |

뒤쪽에서 가장 위험한 것은 날짜인데, **그건 이 모듈이 아니라 프롬프트 조립이 막습니다.**
날짜는 서버가 계산해 넣고 모델은 계산하지 않습니다 → §3.3 · `CLAUDE.md` 불변 규칙 7.

## 쓰는 법

```ts
import { createCitationChecker } from '@/modules/citation-checker'

const citationChecker = createCitationChecker()

const outcome = citationChecker.check({
  reply: { insufficient: modelReply.insufficient, citations: modelReply.citations },
  issued: refsIssuedThisTurn,   // prompt-builder 가 붙인 번호 전부 (문자열 배열)
  kbResultEmpty: applied.length === 0 && reference.length === 0,
})

switch (outcome.kind) {
  case 'pass':        return ok(modelReply)
  case 'retry':       throw new KbCitationMissingError('인용 검증 실패', {
                        violations: outcome.violations,   // 감사 로그용
                      })
  case 'guide_1332':  return guide1332()
  case 'ask_slot':    return askNextSlot()
}
```

**`retry` 를 예외로 올리는 것은 호출자의 몫입니다.** 이 모듈은 판단만 하고 던지지 않습니다 —
재시도 횟수와 대기는 `retry-checker` 가 정합니다.

**`violations` 를 감사 로그에 남기세요.** 무엇을 어겼는지가 남아야 모델이 어떤 형식을 자주 틀리는지
알 수 있습니다. 다만 `detail` 은 응답 본문에 넣지 않습니다 → [10-errors.md](../../../spec/backend/08-16-errors.md) §3.
