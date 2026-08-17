# retry-checker

예외를 보고 **다시 시킬지 중단할지 판단합니다.** 기다리거나 다시 부르지는 않습니다 —
판단만 돌려주고 실제 대기·재호출은 부른 쪽이 합니다.

| | |
| --- | --- |
| 계약의 정본 | [10-errors.md](../../../spec/backend/08-16-errors.md) §2 · §2.1 |
| 이름의 정본 | [12-module-names.md](../../../spec/common/08-16-module-names.md) 「층 없음 · 항상」 |
| 책임의 정본 | [모듈 경계](../../../spec/common/08-16-module-boundaries.md) |
| 근거 | [ADR-014](../../../decisions/014-module-names.md) · [ADR-021](../../../decisions/021-runtime-and-module-shape.md) |

## 왜 층에 안 들어가는가

**어떤 모듈이 실패를 던지든 같은 판단을 하기 때문입니다.** `audit-logger` 와 같은 자리입니다.

## 절대 하지 않는 것

- **예외 종류로 분기하지 않습니다.** `retryable` 값 하나만 보고 재시도 여부를 정합니다.
  `if (error instanceof LlmError)` 같은 코드를 쓰지 마세요 → [10-errors.md](../../../spec/backend/08-16-errors.md) §2.
- **스스로 기다리지 않습니다.** `setTimeout` 을 이 모듈 안에서 부르지 않습니다.
- **대기 값을 여기서 바꾸지 않습니다.** 숫자를 고쳐야 하면 정본을 먼저 고칩니다.

> **"분기하지 않는다"와 "예외마다 대기가 다르다"가 부딪히지 않는 이유** — 판단이 두 단계라서입니다.
> **재시도할 것인가**는 `retryable` 하나로 정하고(여기서 분기가 없습니다), 재시도가 정해진 뒤
> **얼마나 기다릴 것인가**만 `code` 로 표를 조회합니다. 조회는 분기가 아닙니다 —
> 새 예외가 생겨도 `if` 가 늘지 않고 표에 한 줄이 늘 뿐입니다.

## 표에 없는 예외는 재시도하지 않습니다

`retryable: true` 인데 `DELAYS_MS` 에 `code` 가 없으면 **`no_policy` 로 중단합니다.**

[10-errors.md](../../../spec/backend/08-16-errors.md) §1이 *"예외 종류마다 반드시 값을 정한다"*고
못 박고 있어, 표에 없다는 것은 정본에 값을 안 적었다는 뜻입니다. **그 자리에서 기본값을 지어내
재시도하면 근거 없는 동작이 조용히 생깁니다.** 멈추고 `no_policy` 를 감사 로그에 남기는 편이,
무엇을 빠뜨렸는지 드러나서 낫습니다.

## `KB_CITATION_MISSING` 이 여기 오는 경우

**`ref` 검증 위반일 때만입니다.** 모델이 `insufficient: true` 로 근거 없음을 밝힌 경우는
예외가 아니라 200 응답 + 슬롯 질문으로 나가므로 이 모듈에 도달하지 않습니다
→ [10-errors.md](../../../spec/backend/08-16-errors.md) §4.2 · [ADR-015](../../../decisions/015-citation-and-reask.md).

## 쓰는 법

```ts
import { createRetryChecker } from '@/modules/retry-checker'

const retryChecker = createRetryChecker()

const startedAt = Date.now()
let attempts = 0

for (;;) {
  try {
    attempts += 1
    return await callGrok(payload)
  } catch (error) {
    if (!(error instanceof AppError)) throw error

    const verdict = retryChecker.decide({
      error,
      attempts,
      elapsedMs: Date.now() - startedAt,
      lane: 'interactive',
    })

    if (!verdict.retry) throw error   // 그 시점의 예외를 그대로 올린다 → §2.1
    await sleep(verdict.delayMs)
  }
}
```

**중단할 때 그 시점의 예외를 그대로 던집니다.** 새 예외로 감싸지 않습니다 —
`code` 가 바뀌면 사용자에게 보일 문구와 `Retry-After` 판정이 달라집니다
→ [10-errors.md](../../../spec/backend/08-16-errors.md) §3 · §3.1.

## 시험할 때

`random` 을 넣어 흔들림을 고정합니다.

```ts
const checker = createRetryChecker({ random: { next: () => 0.5 } })
// next() === 0.5 이면 흔들림이 0이라 표의 값이 그대로 나옵니다
```
