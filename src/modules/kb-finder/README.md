# kb-finder

KB 를 **두 묶음으로** 조회합니다. 조회 자체는 밖(`KbStore`)이 하고, 이 모듈은
**같은 단계가 여러 순위에 있을 때 무엇을 남기나**를 정합니다.

| | |
| --- | --- |
| 계약의 정본 | [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §2 · [09-data-model.md](../../../spec/backend/08-16-data-model.md) §11.2 |
| 이름의 정본 | [12-module-names.md](../../../spec/common/08-16-module-names.md) 「층 2」 |
| 책임의 정본 | [모듈 경계](../../../spec/common/08-16-module-boundaries.md) |
| 근거 | [ADR-014](../../../decisions/014-module-names.md) · [ADR-028](../../../decisions/028-runtime-and-module-shape.md) |

## 두 묶음

| 묶음 | 무엇 | 왜 |
| --- | --- | --- |
| `applied` | **이 사건에 적용되는 절차** | 실행 보드에 뜨는 것과 같은 것을 봅니다 |
| `reference` | **다른 유형의 기본 절차** | 조건 라벨을 붙여 안내할 근거입니다 |

**섞지 않습니다.** 섞으면 은행 이체 사건에서 가상자산 거래소 절차를 그냥 안내하게 됩니다
→ [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §2.3.

참고 묶음을 근거로 답할 때는 조건 라벨이 붙습니다.

```
"카카오페이로도 보내셨다면, 그때는 선불업자와 연계 은행 양쪽에 요청하셔야 합니다"
 ^^^^^^^^^^^^^^^^^^^^^^^^ 조건 라벨
```

## 우선순위 병합 — 이 모듈의 알맹이

```
1순위  org_id 일치        국민은행 전용 절차·연락처
2순위  channel_id 일치     CH-bank 유형 기본
3순위  둘 다 없음          전 유형 공통 (112 신고 등)
```

**같은 `step_key` 가 여러 순위에 있으면 높은 순위만 남깁니다.**

```
kb_entry_id             | step_key            | org_id  | 순위 | 채택
------------------------|---------------------|---------|------|------
kb-bank-freeze-request  | bank-freeze-request | kb-bank |  1   |  ✓
generic-bank-freeze     | bank-freeze-request | NULL    |  2   |  ✗
report-112              | report-112          | NULL    |  3   |  ✓
```

**병합하지 않으면 화면에 지급정지 안내가 두 번 뜹니다** →
[09-data-model.md](../../../spec/backend/08-16-data-model.md) §11.2.

**겹치지 않는 단계는 전부 남습니다.** 그래서 기관을 몰라도 유형 기본으로,
유형도 모르면 공통으로 안내가 나갑니다 — 어느 단계에서 멈춰도 사용자는 뭔가를 받습니다.

## 절대 하지 않는 것

- **참조 번호(`kb-1`·`kb-2`)를 붙이지 않습니다.** `prompt-builder` 의 일입니다
  → [11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §3.4.
- **0건을 실패로 만들지 않습니다.** 빈 묶음을 돌려줍니다. 절차를 말하지 않고 1332 를
  안내할지는 부른 쪽(`citation-checker`)이 정합니다 → [10-errors.md](../../../spec/backend/08-16-errors.md) §4.1.
- **낡은 항목을 걸러내지 않습니다.** `verified_at` 이 오래됐다고 빼면 사용자에게
  아무것도 못 내놓습니다. 재검증은 KB 운영 파이프라인(`F-11`)의 일입니다.
- **조회 조건을 모델에게 묻지 않습니다.** 전부 서버가 이미 아는 값입니다.
- **KB 에 쓰지 않습니다.** `kb_entry`·`org` 는 릴리스 파이프라인으로만 갱신됩니다
  → [RFC-002](../../../rfc/002-kb-authoring.md).

## 쓰는 법

```ts
import { createKbFinder } from '@/modules/kb-finder'

const kbFinder = createKbFinder({ store })

const { applied, reference } = await kbFinder.find({
  kbVersion: '2026.08.1',        // 현재 릴리스
  track: 'victim',               // case.track
  channelId: 'CH-bank',          // case_channel.channel_id — 없으면 null
  orgId: 'kb-bank',              // case_channel.org_id — 없으면 null
  asOf: '2026-08-20',            // 서버 시각
})
```

**`channelId` 가 `null` 이어도 조회합니다.** 슬롯 T1 미충족이라는 뜻이고,
적용 묶음에는 전 유형 공통(T0)만, 참고 묶음에는 여덟 유형 전부가 나옵니다
→ [02-slot-tiering.md](../../../spec/backend/08-14-slot-tiering.md).

## 밖에서 넣어야 하는 것

| 무엇 | 어디서 | 비고 |
| --- | --- | --- |
| `KbStore` | 데이터베이스 | ⬜ 어댑터 미구현. SQL 은 정본에 그대로 있습니다 |

**SQL 을 이 모듈에 넣지 않았습니다.** 정본이 두 쿼리를 이미 적어 두었고
([09-data-model.md](../../../spec/backend/08-16-data-model.md) §11.2 ·
[11-chat-context.md](../../../spec/backend/08-16-chat-context.md) §2.2), 여기 옮겨 적으면
두 곳이 되어 반드시 어긋납니다.

## 조회 실패와 0건은 다릅니다

| | 뜻 | 이 모듈의 동작 |
| --- | --- | --- |
| 0건 | 조회는 됐고 해당 항목이 없다 | **빈 묶음을 돌려줍니다** |
| 실패 | 조회를 못 했다. 있는지 없는지도 모른다 | **`KbUnavailableError`(503)** |

**뭉개면 KB 가 죽은 것을 「근거 없음」으로 오인해 1332 안내가 나갑니다.**
사용자는 절차가 없는 줄 압니다.

**이미 `AppError` 인 예외는 감싸지 않고 그대로 올립니다.** 감싸면 `code` 가 바뀌어
사용자에게 보일 문구와 재시도 판정이 달라집니다
→ [10-errors.md](../../../spec/backend/08-16-errors.md) §3.

## 아직 아닌 것

- ⬜ **저장소 어댑터가 없습니다.** Supabase 접속 정보가 아직 없습니다
  → [ARCHITECTURE.md](../../../ARCHITECTURE.md) §10.
- ⬜ **KB 항목이 하나도 없습니다.** `src/kb/` 에 README 만 있습니다 →
  [RFC-002](../../../rfc/002-kb-authoring.md). 이 모듈은 비어 있어도 정상 동작합니다.
- ⬜ **`step_key` 를 유형 간에 공유하는지 정해지지 않았습니다.** 참고 묶음에서
  같은 이름이 여러 유형에 나올 수 있어 병합하지 않았는데, KB 작성 규약이
  이름을 어떻게 짓기로 하느냐에 따라 다시 볼 수 있습니다.

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **참고 묶음도 병합할지** | **하지 않는다** | 서로 다른 유형의 절차라 같은 `step_key` 여도 내용이 다릅니다. 간편송금과 시중은행은 요청처가 달라, 합치면 하나를 잃습니다 |
| **순위를 저장소에 맡길지** | **여기서 다시 센다** | 쿼리의 `ORDER BY` 가 바뀌어도 병합 규칙이 조용히 깨지지 않게 합니다 |
| **SQL 을 이 모듈에 둘지** | **두지 않는다** | 정본이 이미 쿼리를 적어 두었습니다. 옮겨 적으면 두 곳이 되어 어긋납니다 |
| **0건을 예외로 할지** | **하지 않는다** | 정본이 「200 + 1332 안내」로 정했습니다. 에러가 아닙니다 |
| **조회 실패를 빈 결과로 삼킬지** | **삼키지 않는다** | 근거 없는 답변보다 멈추는 편이 낫습니다. `pii-tokenizer` 가 죽었을 때와 같은 논리입니다 |
| **낡은 항목을 거를지** | **거르지 않는다** | 빼면 사용자에게 아무것도 못 내놓습니다. 재검증은 운영 파이프라인의 일입니다 |
