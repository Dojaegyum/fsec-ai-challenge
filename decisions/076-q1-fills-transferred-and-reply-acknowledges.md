# ADR-076. 시작 화면의 답은 곧 첫 문항의 답이다 — `transferred` 를 사건과 함께 저장하고, 답변은 방금 한 말을 먼저 받아 준다

- 상태: **채택**
- 날짜: 2026-09-06
- 결정: @kth9245 (사용자 보고 — *"진술을 들은 티가 없고, 같은 것을 세 번 묻는다"*)
- 관련 문서: [API 계약](../spec/common/08-14-api.md) §3.1 · [시스템 지시문](../spec/backend/08-17-system-prompt.md) §4 「무엇을 담나」 ·
  [화면 명세](../spec/frontend/08-14-screens.md) §S-05 「Q1」 · [슬롯 티어링](../spec/backend/08-14-slot-tiering.md) T1 ·
  [데이터 모델](../spec/backend/08-16-data-model.md) §5.1 ·
  [ADR-060](060-unsure-opens-victim.md) (「모름으로 연 사건」을 나중에 못 찾는다 — 남은 것 2) ·
  [ADR-069](069-evidence-slot-extraction.md) (T1 은 사람의 답으로만) ·
  [ADR-071](071-track-questions-and-notice-date.md) (명의인에게 T1 은 없다) ·
  [ADR-046](046-case-and-plan-together.md) (사건과 플랜은 한 트랜잭션)

## 맥락

배포본에서 `/start` 의 Q1 「내 돈이 나갔어요」를 고르고 사건 화면에 첫 진술("어제 오후에 서울중앙지검 수사관이라는
사람이 전화해서 … 300만원을 보냈습니다")을 적었더니 두 가지가 어긋났습니다.

1. **답이 진술을 한 마디도 받지 않았습니다.** 「지금 바로 112에 신고해 주세요. 365일 24시간 접수됩니다. …」 —
   지시문(08-17 §4)이 `reply` 를 「지금 할 일 → 기한 → 부산물 요청」 셋으로만 짓게 해, 사용자가 방금 한 말을
   되짚을 자리가 없었습니다. 사용자는 자기 말이 읽혔는지 알 수 없었습니다.
2. **곧이어 「돈이 실제로 빠져나갔나요?」를 다시 물었습니다.** Q1 의 답은 `POST /api/cases` 에 `track` 하나로만
   실려 갔고(`start/open.ts` 의 `trackOf`), 「돈이 나갔다」는 사실은 어디에도 저장되지 않았습니다. 그래서
   `slot-checker` 의 첫 문항(`ASK_ORDER` 의 `transferred`)이 그대로 나갔습니다 — 시작 화면·사건 파일 카드·챗
   세 자리에서 같은 것을 물었습니다.

세 번째 원인도 있었지만 이 결정이 닫지는 않습니다 — 자유 진술은 `slot-extractor` 를 지나지 않습니다
([ADR-069](069-evidence-slot-extraction.md)는 자료(전사·판독)에서만 뽑습니다). "300만원" 이 `amount` 에 들어가지
않는 것은 그 때문이고, 아래 「정하지 않은 것」에 남깁니다.

## 결정

### ① Q1 「내 돈이 나갔어요」는 `transferred` 의 답이다 — 사건과 함께 저장한다

`POST /api/cases` 가 선택 항목 `transferred`(참·거짓)를 받습니다. 클라이언트(`start/open.ts` 의 `openingOf`)는
Q1 이 「내 돈이 나갔어요」일 때만 `transferred: true` 를 실어 보냅니다. 「잘 모르겠어요」는 보내지 않고(문진이
묻습니다), 「내 계좌가 갑자기 묶였어요」도 보내지 않습니다(명의인에게 그 문항은 없습니다 — ADR-071. 보내면 400).

서버(`flows/regenerate-plan.ts` 의 `openCaseWithPlan`)는 그 값을 `case_slot` 에 **`confirmed` · `source: user` ·
문진에서 그 버튼을 눌렀을 때와 같은 글자**(`lib/questions.ts` 의 `transferredAnswer`)로 적습니다. 저장은
**사건·플랜과 같은 트랜잭션**입니다(`CasePlanStore.openCase` 의 셋째 인자 — ADR-046 의 선을 그대로). 슬롯만
뒤에 따로 쓰면 그 사이의 실패가 「답했는데 다시 묻는」 상태를 남깁니다. 응답의 플랜과 첫 문항도 그 슬롯을 알고
나갑니다 — 첫 문항은 송금 수단(`channel`)입니다.

감사 기록 `case.opened` 의 `detail` 에 `transferred: true/false` 가 붙습니다 — 값이 아니라 답했다는 사실이고,
ADR-060 이 남긴 「모름으로 연 사건과 확신하고 고른 victim 을 구별 못 한다」가 이것으로 갈립니다.

### ② 답변은 방금 한 말을 한 문장으로 받아 준 뒤 절차로 간다

지시문 정본(08-17 §4 「무엇을 담나」)의 첫 항목이 **「1) 방금 한 말을 받아 준다」** 가 됩니다 — `<history>` 의
마지막 턴에 사건의 사실(누가 무엇을 사칭했는지 · 무엇을 어떻게 얼마나 보냈는지)이 새로 적혀 있으면 한 문장으로
되짚고, 그다음 지금 할 일·기한·부산물 요청으로 갑니다. 묻는 말이나 짧은 답이면 건너뜁니다. 되짚는 것은 사용자의
말에 적힌 것뿐이고 절차·판단을 보태지 않으며, **`citations` 에 적지 않습니다** — `<history>` 에는 참조 번호가
없어 인용할 수 없고, 지어낸 번호는 인용 검증에 걸립니다.

정본을 먼저 고치고 `system-prompt.ts` 가 뒤따랐습니다(08-17 의 규칙). 실측은 `npm run probe:llm` 의 「첫 진술」
상황이 봅니다.

## 근거

**같은 것을 두 번 묻는 것은 「진술만 하면」의 반대입니다.** ADR-069 가 자료에 적힌 것을 다시 묻는 자리를 닫은 것과
같은 이유입니다. Q1 은 사람이 버튼으로 준 답이라 ADR-069 의 「T1 은 사람의 답으로만」과도 맞습니다 — 추출이
아니라 답입니다.

**한 요청에 싣는 이유.** 사건을 만든 뒤 §3.5 로 한 번 더 답하면 왕복이 둘이고, 그 사이에 사건 화면이 열리면 첫
문항이 「돈이 나갔나요」로 뜹니다. 실패하면 「답했는데 저장 안 됨」이 남습니다. 사건과 같은 트랜잭션이면 둘 다
없습니다.

**답변이 진술을 받아 주어야 하는 이유.** 이 서비스의 첫 답은 「당신 말을 들었다」여야 합니다. 절차만 나가면
사용자는 정적인 안내문을 받은 것과 구별하지 못하고, 다음 턴에 같은 말을 다시 적습니다.

### 검토한 대안

| 대안 | 왜 아닌가 |
| --- | --- |
| **클라이언트가 사건을 만든 뒤 `PATCH …/slots/transferred` 를 한 번 더 부른다** | 계약은 안 늘지만 왕복이 둘이고, 그 사이·실패 시에 같은 문항이 다시 뜹니다. 값의 글자를 클라이언트가 알아야 합니다 |
| **자유 진술을 `slot-extractor` 에 넣어 `transferred`·`amount` 를 뽑는다** | ADR-069 가 T1 추출을 버렸고, 매 발화마다 모델 호출이 하나 늡니다. 이 결정의 원인 둘은 그것 없이 닫힙니다. 아래 「정하지 않은 것」 |
| **`track` 에 값을 늘린다** | ADR-060 이 버린 것과 같은 구조입니다 — KB 조회축이 그 값의 행을 모릅니다 |
| **첫 턴에만 받아 주는 문장을 서버가 붙인다**(지시문 대신 코드) | 진술의 어느 부분을 되짚을지는 말을 읽어야 정해집니다. 서버가 붙이면 「말씀 감사합니다」 같은 빈 문장이 됩니다 |

## 결과

- `spec/common/08-14-api.md` §3.1 `transferred` · `spec/backend/08-17-system-prompt.md` §4 · `spec/frontend/08-14-screens.md` §S-05 Q1 ·
  `spec/backend/08-14-slot-tiering.md` T1 · `spec/backend/08-16-data-model.md` §5.1 · `spec/common/08-21-user-journeys.md` 여정 A.
- `src/app/start/open.ts` `openingOf` · `src/app/api/cases/route.ts` `readTransferred` · `src/flows/regenerate-plan.ts` `OpenSlot`·`openCaseWithPlan` ·
  `src/lib/db-plan.ts`·`src/lib/db.ts` `upsertSlot` · `src/lib/questions.ts` `transferredAnswer` · `src/modules/prompt-builder/system-prompt.ts` ·
  `src/scripts/probe-llm.ts` 「첫 진술」.
- **화면은 바뀌지 않습니다** — 사건 화면의 첫 문항이 송금 수단으로 바뀔 뿐입니다.

## 정하지 않은 것

- **자유 진술에서 슬롯을 뽑을지.** "300만원"·"검찰 사칭"은 진술에 있는데 `amount`·`impersonated_org` 는 비어 있어 문진이
  묻습니다. ADR-069 의 추출을 챗 발화에도 걸면 닫히지만, 매 턴 모델 호출이 하나 늘고 추출을 4B 내부 모델로 옮길지가
  미정입니다([qa-readiness](../docs/plans/08-23-qa-readiness.md) 「남은 것」). 사람이 정합니다.

## 어떻게 지키나

- `src/app/start/open.test.ts` 「Q1 의 답은 곧 첫 문항의 답이다」 · `src/app/api/cases/route.test.ts` 「시작 화면의 답이 사건과 함께 저장된다」 ·
  `src/flows/regenerate-plan.test.ts` 「시작 화면의 답을 사건과 함께 저장한다」 · `src/lib/questions.test.ts` 「시작 화면의 답을 문진의 값으로」 ·
  `src/lib/db.dbtest.ts` 「사건을 열 때 아는 슬롯은 사건과 함께 들어간다」.
- `src/modules/prompt-builder/build.test.ts` 「방금 한 말을 먼저 받아 주라는 지시가 있다」 · `npm run probe:llm` 「첫 진술」(모델이 금액을 되짚는지).
