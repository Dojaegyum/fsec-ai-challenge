# audit-logger

모든 기록을 **토큰화 텍스트 기준으로** 남기고, 해시 사슬로 이어 **사후 조작을 검출**합니다.

| | |
| --- | --- |
| 계약의 정본 | [09-data-model.md](../../../spec/backend/08-16-data-model.md) §10 · §10.1 · §10.2 |
| 감사 요구 | [04-pii-boundary.md](../../../spec/common/08-14-pii-boundary.md) 「감사」 |
| 근거 | [ADR-021](../../../decisions/021-runtime-and-module-shape.md) |

**서버 전용입니다.** 해시 계산에 `node:crypto`를 씁니다.

## 왜 층에 안 들어가는가

**어느 모듈이 무엇을 하든 같은 일을 합니다.** `retry-checker`와 같은 자리입니다.

## 해시 사슬

각 줄의 `hash`는 다섯 재료의 SHA-256입니다 — 앞줄의 해시, 이 줄의 식별자, 사건 종류,
상세, 기록 시각. **앞줄의 해시가 재료에 들어가므로 줄이 하나로 이어집니다.**

```
1번 줄:  prevHash = null      hash = H1
2번 줄:  prevHash = H1        hash = H2
3번 줄:  prevHash = H2        hash = H3
```

중간을 고치거나 지우면 이후 해시가 어긋납니다. `verifyChain()`이 그것을 찾아
**몇 번째 줄에서 끊겼는지** 알려줍니다.

| 조작 | 검출되나 |
| --- | --- |
| 내용을 고침 | 예 — 다시 계산한 해시가 다릅니다 |
| 중간을 지움 | 예 — 다음 줄의 앞 해시가 이어지지 않습니다 |
| 순서를 바꿈 | 예 — 같은 이유 |
| 시각을 고침 | 예 — 시각도 해시 재료입니다 |

## 키 순서에 흔들리지 않습니다

상세를 직렬화할 때 **키를 정렬합니다.** 저장소가 JSONB라 읽어올 때 키 순서가 달라질 수
있는데, 순서가 달라지면 **같은 내용인데도 해시가 어긋나 멀쩡한 사슬이 깨진 것처럼**
보입니다. 정렬해 두면 어느 쪽에서 계산해도 같은 값이 나옵니다.

중첩된 객체도 같은 규칙으로 정렬합니다.

## 개인정보 토큰을 담을 수 없습니다

`detail`에 `[계좌-1]` 꼴 토큰이 있으면 **거부하고 아무것도 쌓지 않습니다.**

정본이 "토큰이라도 넣지 않는다"고 못 박은 이유는, **볼트가 살아 있는 동안 토큰으로
원문을 얻을 수 있기** 때문입니다.

```
좋음   { kind: 'account', count: 2, layer: 2 }
나쁨   { kind: 'account', token: '[계좌-1]' }
```

거부는 `PiiBoundaryError`로 나가고, **예외 메시지에 무엇이 들어왔는지 값을 담지
않습니다** → [10-errors.md](../../../spec/backend/08-16-errors.md) 원칙 2.

> **원문 개인정보까지 잡지는 못합니다.** 형태가 뚜렷해 기계로 잡을 수 있는 것은
> 토큰뿐입니다. 상세를 만드는 쪽이 건수만 담는 규칙을 지켜야 합니다.

## 고치지도 지우지도 않습니다

`AuditStore` 인터페이스에 **`append`와 `lastHash`만 있습니다.** 수정·삭제 함수가
아예 없어서, 저장소를 어떻게 구현하든 그 경로가 생기지 않습니다.

**사건이 파기돼도 감사 로그는 남습니다.** 개인정보가 없으므로 남길 수 있습니다.

## 남기는 사건 12종

`case.opened` · `evidence.ingested` · `pii.scrubbed` · `pii.egress_blocked` ·
`pii.restore_denied` · `slot.confirmed` · `plan.generated` · `deadline.computed` ·
`chat.context_built` · `artifact.verified` · `llm.called` · `case.purged`

**여기 없는 종류를 쓰지 않습니다** — 타입으로 막혀 있습니다. 새로 필요하면
[09-data-model.md](../../../spec/backend/08-16-data-model.md) §10.2에 먼저 추가합니다.

## 쓰는 법

```ts
import { createAuditLogger, verifyChain } from '@/modules/audit-logger'

const audit = createAuditLogger({
  store,                          // append · lastHash 만 있는 저장소
  now: () => new Date().toISOString(),
  newId: () => ulid(),
})

await audit.record({
  eventType: 'chat.context_built',
  actorType: 'system',
  caseId,
  detail: { applied: 5, reference: 7, kb_version: '2026.08.1' },
})

// 사후 점검
const verdict = verifyChain(await store.allByTime(caseId))
if (!verdict.intact) alert(verdict.brokenAt)
```

**시각과 식별자를 주입받습니다.** 직접 만들면 같은 입력에 같은 결과가 나오지 않아
시험할 수 없습니다.

> 저장소의 `created_at` 기본값은 `clock_timestamp()`입니다 —
> `now()`는 트랜잭션 시작 시각이라 한 트랜잭션에서 여러 건을 남기면 시각이 전부
> 같아집니다. **사슬의 순서가 근거라 기록 시점이 구분돼야 합니다.**
> 다만 이 모듈은 시각을 주입받으므로, 실제로는 주입된 값이 저장됩니다.
