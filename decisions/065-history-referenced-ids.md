# 답이 가리킨 단계·기한을 이력에 남긴다 — 되짚지 않고 저장하며, 재검증은 화면 몫

- 상태: **채택**
- 날짜: 2026-09-03
- 결정: @kth9245 (제안 @Dojaegyum · GitHub #41)
- 관련 문서: [API 계약](../spec/common/08-14-api.md) §3.9 · §3.12 (이 결정으로 개정) ·
  [데이터 모델](../spec/backend/08-16-data-model.md) §9 · §9.4 (신설) ·
  [마이그레이션 0009](../src/migrations/0009_message_referenced.sql) ·
  [ADR-050](050-history-and-vault-read.md) (대화 이력을 되받는 경로) ·
  [ADR-015](015-citation-and-reask.md) (`citations` 를 남기는 결정) ·
  [워크스페이스 패널](../spec/frontend/08-17-workspace-panels.md) (`referenced_steps` 가 패널을 고르는 자리)

## 맥락

[§3.9](../spec/common/08-14-api.md) 응답에는 `referenced_steps`(·`referenced_deadlines`)가 있습니다.
서버가 모델의 인용 중 **이 사건의 단계를 가리키는 것**만 발급 기록으로 되짚어 고르고, 화면은
그 값으로 작업 패널을 엽니다 — `send.ts` 가 넘기고 `todo.tsx` 의 `pickStep` 이 받습니다.

그런데 **[§3.12](../spec/common/08-14-api.md) 대화 이력에는 이 칸이 없었습니다.** 그래서
`history.ts` 는 `referencedSteps: []` 를 하드코딩할 수밖에 없었고, **새로고침·재방문 뒤에는
같은 대화인데 챗↔단계 연결이 사라졌습니다.** 저장 쪽도 같습니다 — `message` 표에
`citations`·`insufficient` 는 있는데 `referenced_steps` 칼럼이 없어 **내릴 값 자체가 저장되지
않았습니다.**

[ADR-050](050-history-and-vault-read.md) 이 이력을 되받는 경로를 만들 때 `citations` 는 §3.9 와
같은 모양으로 되돌려주도록 했는데, 같은 턴에서 함께 나간 `referenced_steps` 는 빠져 있었습니다.

## 결정

1. **§3.12 의 `assistant` 행에 `referenced_steps`·`referenced_deadlines` 를 §3.9 와 같은 모양으로 싣습니다.**
   없으면 **빈 배열**입니다 — 칸을 빼지 않습니다(§3.6 `after` 와 같은 이유: 「모른다」와 「없다」가
   갈립니다). `user` 행에는 붙지 않습니다.
2. **§3.9 를 만들 때 확정된 값을 그대로 저장했다가 돌려줍니다.** `message` 표에 `referenced_steps`·
   `referenced_deadlines` JSONB 두 칼럼을 더합니다([0009](../src/migrations/0009_message_referenced.sql)).
   `chat-turn` 이 한 번 센 값을 응답과 저장에 **같이** 씁니다 — 따로 세면 라이브에서 본 것과
   새로고침 뒤 본 것이 갈립니다.
3. **되읽을 때 재검증하지 않습니다.** 이력 속 `step_id` 는 그 사이 플랜이 다시 생성돼
   ([§6.1](../spec/backend/08-16-data-model.md)) 지금 플랜에 없을 수 있습니다. 서버는 저장된 값
   그대로 내리고, **모르는 id 는 화면(`pickStep`)이 무시합니다.** 외래키도 걸지 않습니다.
4. **`referenced_deadlines` 도 함께 갑니다.** 화면이 지금 쓰는 것은 `referencedSteps` 뿐이지만,
   §3.9 와 같은 모양이라는 약속을 반쪽으로 두면 나중에 마이그레이션이 한 번 더 필요합니다.
   저장 비용은 같은 INSERT 의 칸 하나입니다.

## 근거

**`citations` 에서 역산할 수 없습니다.** `case-N` 은 그 턴 프롬프트가 발급한 일련번호라 다음 턴에는
다른 것을 가리킵니다([§9.3](../spec/backend/08-16-data-model.md) 「`ref` 번호는 그 턴 안에서만
유효합니다」). 저장된 `citations` 로는 어느 단계였는지 복원할 수 없습니다 — **그래서 `citations` 를
남길 때도 `kb_entry_id` 로 남겼습니다**(ADR-015). 같은 이유로 단계는 `step_id` 로 남깁니다.

**이력은 「그때 무엇을 가리켰나」입니다.** 서버가 지금 플랜과 대조해 없는 id 를 걸러 내면 이력이
사실과 달라지고, 관리자 조회(§9.2)가 「왜 그 답이 나갔나」를 재현할 수 없게 됩니다. 「지금 무엇이
유효한가」는 화면이 플랜을 들고 있으니 화면이 압니다 — 라이브 턴에서도 `pickStep` 이 그 일을 합니다.

## 탈락한 대안

| 대안 | 왜 탈락 |
| --- | --- |
| `citations` 의 `case-` ref 에서 역산 | ref 가 턴마다 발급되는 번호라 **불가능**합니다 |
| 저장하지 않고 라이브 턴에서만 쓴다 (현상 유지) | 새로고침 한 번에 연결이 사라집니다. 「가족에게 링크 보내기」로 연 사람은 처음부터 못 봅니다 |
| 되읽을 때 지금 플랜에 있는 것만 남긴다 | 이력이 사실과 달라지고, 판정이 두 곳(서버·`pickStep`)에 생깁니다 |
| `referenced_steps` 만 저장 | 「§3.9 와 같은 모양」이 반쪽이 되고, `deadlines` 를 쓰게 되면 마이그레이션이 한 번 더 옵니다 |
| 별도 표(`message_step`)로 정규화 | 열쇠가 ULID 문자열 배열이고 조회가 「그 줄의 배열」뿐이라 표를 나눌 이유가 없습니다. `citations` 와 같은 자리(JSONB)가 맞습니다 |

## 결과

- `message` 표에 칼럼 둘([0009](../src/migrations/0009_message_referenced.sql)). **이 칼럼이 생기기 전
  행은 `NULL`** 이고, 읽는 쪽이 빈 배열로 내립니다.
- `MessageStore.write` 가 두 배열을 받고, `turns()` 가 되돌려줍니다. `history()`(프롬프트용)는
  그대로입니다 — 모델에게 단계 번호를 보여줄 이유가 없습니다.
- `GET …/messages` 의 `assistant` 행에 두 칸이 붙습니다. 화면 `history.ts` 는 하드코딩 한 줄을
  응답 값으로 바꿉니다. **이력을 불러올 때 마지막 `assistant` 행으로 패널을 열지는 화면이 따로
  정합니다** — 이 결정의 범위 밖입니다.

## 재검토 트리거

- 화면이 이력 로드 시 패널을 여는 쪽으로 가면 **「마지막 행」이 무엇인지**(되묻기 턴은 빈 배열)를
  §3.12 에 한 줄 더 적습니다.
- 플랜 재생성이 단계 id 를 바꾸지 않고 **`step_key` 로 이어 붙이는 구조**가 되면, 이력의 열쇠를
  `step_key` 로 바꿀지 다시 봅니다. 지금은 `step_id` 가 §3.9 의 열쇠라 그대로 갑니다.
