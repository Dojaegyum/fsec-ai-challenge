# chat-publisher

챗 한 턴에서 **나가는 것을 마지막으로 만지는 자리**입니다.

| | |
| --- | --- |
| 이 모듈을 세운 결정 | [ADR-022](../../../decisions/022-chat-turn-boundaries.md) |
| 응답 계약 | [08-api.md](../../../spec/common/08-14-api.md) §3.9 · §5.4 |
| 실패 처리 | [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §9 · [10-errors.md](../../../spec/backend/08-16-errors.md) §4.1 |

## 책임 셋

1. **세 갈래를 한 형태로 씌웁니다** — 답변·1332 안내·슬롯 질문
2. **판단 근거를 분리합니다**
3. **잔여 개인정보를 검사합니다** — 걸리면 `EGRESS_BLOCKED` 422

## 판정하지 않습니다

**어느 갈래인지 정하는 것은 `citation-checker`이고, 그 갈래를 형태로 옮기는 것이 여기입니다.**
판정이 이쪽으로 새면 갈래가 두 곳에서 결정됩니다.

## 세 갈래가 같은 껍데기로 나갑니다

```jsonc
{
  "message_id": "…",
  "reply": "…",
  "citations": [],           // 인용할 것이 없으면 빈 배열
  "next_question": null,     // 물을 것이 없으면 null
  "kb_result": "empty"       // 조회가 0건일 때만
}
```

**화면이 갈래를 분기하지 않게** 하려는 것입니다. 어느 갈래든 같은 키를 읽으면 됩니다.

| 갈래 | `reply` | `citations` | `next_question` | `kb_result` |
| --- | --- | --- | --- | --- |
| `answer` | 모델이 쓴 답변 | 인용 목록 | 보통 `null` | 없음 |
| `guide_1332` | **고정 문구** | `[]` | `null` | `"empty"` |
| `ask_slot` | **고정 문구** | `[]` | 슬롯 체커가 만든 질문 | 없음 |

**두 고정 문구는 정본에서 왔습니다** — 1332 안내는 [10-errors.md](../../../spec/backend/08-16-errors.md) §4.1,
되묻기 문구는 [08-api.md](../../../spec/common/08-14-api.md) §3.9입니다.

**1332 안내에서 `citations`가 비어도 위반이 아닙니다.** 절차를 말하지 않았기 때문입니다 —
연락처 안내라 인용할 것이 없습니다.

## 판단 근거는 담을 자리가 아예 없습니다

`reasoning`을 받는 입력이 계약에 **존재하지 않습니다.** 화이트리스트로 거르는 것이 아니라
애초에 담을 수 없어서, 실수로 새는 경로가 생기지 않습니다.

**왜 막아야 하는가** — 인용 검증은 최종 응답의 `citations`에만 걸립니다. 판단 근거에는
걸리지 않아서, 모델이 생각하는 도중 `"아마 은행 앱으로도 될 것이다"` 같은 문장을 쓸 수 있습니다.
그것이 화면에 뜨면 **최종 응답에서는 불변 규칙 1이 지켜지는데 판단 근거에서 새는 상태**가 됩니다.
사용자는 둘을 구분해 읽지 않습니다 → [08-api.md](../../../spec/common/08-14-api.md) §5.4.

판단 근거는 `message.reasoning_masked`에 저장되고 관리자 경로로만 봅니다.

## 잔여 개인정보 검사

**모델이나 사용자가 쓴 문자열만 봅니다** — `reply`, 인용의 `label`·`why`·`legal_basis`,
질문의 `text`·`options`.

`ref`·`kb_entry_id`·`kb_version`·`source_url`·`message_id`는 서버가 발급하거나 KB에서 온
값이라 개인정보가 들어갈 자리가 아니고, 검사에 넣으면 **식별자 숫자가 계좌로 오인될 위험만**
생깁니다.

걸리면 `EgressBlockedError`(422)를 던집니다. **통과시키고 로그만 남기는 경로를 만들지
않습니다** → [10-errors.md](../../../spec/backend/08-16-errors.md) 원칙 1.

**예외의 `detail`에는 건수만 담습니다.** 무엇이 남았는지 값으로 알려주지 않습니다 — 원칙 2.

```
detail: { counts: { resident_id: 1 } }
             ^^^^^^ 유형과 건수만. 값 없음
```

## 검사기는 주입받습니다

정규식 패턴의 정본이 아직 없어(→ [04-pii-boundary.md](../../../spec/common/08-14-pii-boundary.md) TODO)
`ResidualPiiScanner`로 받습니다. **`pii-masker`의 규칙을 재사용하는 구현을 넣으면 들어올 때와
나갈 때가 같은 기준으로 봅니다.**

## 쓰는 법

```ts
import { createChatPublisher } from '@/modules/chat-publisher'

const publisher = createChatPublisher({ residualPii: scanner })

switch (outcome.kind) {
  case 'pass':
    return publisher.publish({ kind: 'answer', messageId, reply, citations })
  case 'guide_1332':
    return publisher.publish({ kind: 'guide_1332', messageId })
  case 'ask_slot':
    return publisher.publish({ kind: 'ask_slot', messageId, nextQuestion })
}
```

## 남은 것

⬜ **공통 형태의 정본이 없습니다.** [08-api.md](../../../spec/common/08-14-api.md) §3.9가 갈래별
예시만 적고 있어, 그 셋의 합집합으로 두었습니다 → [ADR-022](../../../decisions/022-chat-turn-boundaries.md) 「남은 것」.

⬜ **판단 근거를 어떻게 분리하는지의 구체**도 §5.4가 "넣지 않는다"까지만 정했습니다.
여기서는 **받는 자리를 만들지 않는 것**으로 풀었습니다.

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **판단 근거 분리** | **받는 자리를 만들지 않는다** | 화이트리스트로 거르는 것이 아니라 애초에 담을 수 없어, 실수로 새는 경로가 생기지 않습니다 |
| **잔여 PII 검사 범위** | **모델·사용자가 쓴 문자열만** | `ref`·`kb_entry_id`·`message_id` 는 서버가 발급한 값이라, 넣으면 식별자 숫자가 계좌로 오인될 위험만 생깁니다 |
| **응답 공통 형태** | 갈래 셋의 합집합 | ⬜ 정본이 갈래별 예시만 적고 공통 형태를 정하지 않았습니다 |
