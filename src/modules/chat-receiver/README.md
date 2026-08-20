# chat-receiver

발화를 받아 **층 2의 순서를 부릅니다.** 토큰화·조회·조립을 직접 하지 않고 부르기만
하며, 모델을 한 번 호출하고 인용 검증까지 마친 재료를 넘깁니다.

| | |
| --- | --- |
| 계약의 정본 | [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §1 §5 §6 §9 |
| 이름의 정본 | [12-module-names.md](../../../spec/common/08-16-module-names.md) 「층 2」 |
| 책임의 정본 | [ADR-022](../../../decisions/022-chat-turn-boundaries.md) 결정 하나 |
| 근거 | [ADR-015](../../../decisions/015-citation-and-reask.md) · [ADR-028](../../../decisions/028-runtime-and-module-shape.md) |

## 절대 하지 않는 것 — 이 조항이 모듈의 형태를 정합니다

[ADR-022](../../../decisions/022-chat-turn-boundaries.md)가 이름을 주면서 **함께 건 금지 조항**입니다.

- **갈래를 판정하지 않습니다.** 답변인지 1332 안내인지 슬롯 질문인지는
  `citation-checker` 가 가릅니다. 여기서는 그 판정을 **그대로 실어 넘깁니다.**
- **조회·조립·토큰화를 직접 하지 않습니다.** 부르기만 합니다.
- **응답 형태를 만들지 않습니다.** `chat-publisher` 의 일입니다.
- **저장하지 않습니다.** 감사 로그도 여기서 쓰지 않습니다 — 넣을 **건수만** 돌려줍니다.
- **판단 근거를 걸러내지 않습니다.** 여기서 지우면 `chat-publisher` 가 분리할 것이
  없어집니다. 사용자에게 못 나가게 막는 것은 그쪽 책임입니다.

> **이 조항이 없으면 반드시 비대해집니다.** 재시도 판단·감사 로그·캐싱 경계·예외 전달이
> 전부 이 자리로 몰릴 자연스러운 힘이 있고, 그렇게 되면 「순서를 부르는 얇은 자리」라는
> 정의가 거짓말이 됩니다. 그때는 이미 못 쪼갭니다. — [ADR-022](../../../decisions/022-chat-turn-boundaries.md)

## 부르는 순서

```
1. pii-tokenizer     개인정보를 토큰으로        ← 격리 경계
2. kb-finder         두 묶음으로 조회
3. prompt-builder    블록 여섯을 조립
4. 모델 1회 호출
5. citation-checker  인용 검증
```

**모델 호출은 한 번이고 모델은 도구를 부르지 않습니다.** 조회 조건은 서버가 전부
알고 있어(`case.track` · `case_channel.channel_id` · `org_id` · 서버 시각 · 현재 릴리스)
모델에게 물어볼 이유가 없습니다.

**이번 발화는 대화 이력의 마지막 턴으로 붙습니다** → §3.1. 블록을 따로 두지 않는 이유는
둘 다 매 턴 바뀌어 캐싱 이점이 없었기 때문입니다.

## 다시 부르는 경우는 하나뿐입니다

| 판정 | 어떻게 |
| --- | --- |
| `pass` | 그대로 넘김 |
| `ask_slot` | 그대로 넘김. **에러가 아닙니다** |
| `guide_1332` | 그대로 넘김. **에러가 아닙니다** |
| `retry` | **한 번 더 부릅니다.** 그래도 안 되면 `KB_CITATION_MISSING` |

**`insufficient: true` 로는 다시 부르지 않습니다.** 형식 오류가 아니라 모델이 근거가
없다고 선언한 것이라, 같은 프롬프트로 다시 물으면 같은 답이 옵니다 → §6.3.

**재시도할지는 `retry-checker` 가 정합니다.** 예외 종류로 분기하지 않고 그 판단을
그대로 따릅니다 → [10-errors.md](../../../spec/backend/08-16-errors.md) §2.

## 조회가 실패하면 챗을 멈춥니다

| | 뜻 | 동작 |
| --- | --- | --- |
| 0건 | 조회는 됐고 항목이 없다 | **계속 진행.** `kbResultEmpty` 로 넘김 |
| 실패 | 조회를 못 했다 | **멈춤.** 모델을 부르지 않습니다 |

**공통 안전 절차로 폴백할 수 없습니다.** T0 단계에도 인용이 붙어 있어
**T0 자체가 KB 항목**이기 때문입니다 → §9.

## 쓰는 법

```ts
import { createChatReceiver } from '@/modules/chat-receiver'

const chat = createChatReceiver({
  tokenizer, kb, prompts, llm, citations, retry, clock,
})

const turn = await chat.receive({ caseContext, utterance, kbVersion })
```

돌려주는 것으로 **부른 쪽이 세 가지를 합니다.**

```ts
// 1. 감사 로그 — 건수만 담습니다. 식별자도 본문도 넣지 않습니다 → §7.2
await auditLogger.record({ type: 'chat.context_built', detail: turn.counts })

// 2. 저장 → §7.1
await messages.append({
  promptMasked: turn.promptMasked,
  utteranceMasked: turn.utteranceMasked,
  kbContextRefs: turn.kbContextRefs,
  reasoningMasked: turn.reply.reasoning,
})

// 3. 응답 만들기 — issued 로 인용의 나머지를 채웁니다
chatPublisher.publish({ kind: ..., reply: ..., citations: ... })
```

## 밖에서 넣어야 하는 것

| 무엇 | 어디서 | 비고 |
| --- | --- | --- |
| `PiiTokenizer` | `pii-tokenizer` | ⬜ 미구현 — NER 논의 중 |
| `KbSource` | `kb-finder` | 있음. `KbRow` → `KbEntry` 변환이 필요합니다 |
| `PromptSource` | `prompt-builder` | 있음 |
| `LlmClient` | Grok (xAI) | ⬜ 어댑터 미구현 |
| `CitationSource` | `citation-checker` | 있음 |
| `RetryJudge` | `retry-checker` | 있음 |
| `Clock` | 서버 시계 | — |

**전부 인터페이스로 받습니다.** 토큰화가 아직 없어도 이 모듈은 완성됩니다.

## 아직 아닌 것

- ⬜ **재시도 1회가 맞는지 근거가 없습니다.** 형식 실수를 감안한 값입니다 →
  [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) 「TODO(실측 필요)」.
- ⬜ **`KbRow` 와 `KbEntry` 사이에 변환이 필요합니다.** `kb-finder` 는 표의 행을 그대로
  돌려주고(`title`·`body`는 JSONB), 프롬프트는 문자열 두 개(`label`·`body`)를 받습니다.
  **누가 옮기는지 정하지 않았습니다** — 지금은 부른 쪽입니다.

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **`citation-checker` 를 여기서 부를지** | **부른다** | 안 부르면 재시도 루프를 둘 자리가 없습니다. 모델 호출을 쥔 쪽이 다시 부를 수 있습니다. **판정은 여전히 그쪽 것**이고 여기는 결과를 옮길 뿐입니다 |
| **재시도 루프의 자리** | **여기. 판단은 위임** | [ADR-022](../../../decisions/022-chat-turn-boundaries.md)가 「재시도 판단이 몰리는 것」을 경계했습니다. 판단은 `retry-checker` 가 하고 여기는 세기만 합니다 |
| **감사 로그를 여기서 쓸지** | **안 쓴다. 건수만 돌려준다** | [ADR-022](../../../decisions/022-chat-turn-boundaries.md)가 명시적으로 경계한 항목입니다 |
| **`reasoning` 을 걸러낼지** | **그대로 둔다** | 여기서 지우면 `chat-publisher` 가 분리할 것이 없어집니다. 막는 자리를 하나로 둡니다 |
| **`retry` 판정을 밖으로 낼지** | **안 낸다** | 이 모듈 안에서 소비됩니다. 밖으로 내면 부른 쪽이 또 루프를 돌아야 합니다 |
