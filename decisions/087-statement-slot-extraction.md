# ADR-087. 자유 진술에서도 슬롯을 뽑는다 — 자료와 같은 추출기, 같은 되묻기

- 상태: **채택** ([ADR-076](076-q1-fills-transferred-and-reply-acknowledges.md) 「정하지 않은 것」의 셋째 항목을 닫음)
- 날짜: 2026-09-06
- 결정: @kth9245
- 관련 문서: [ADR-069](069-evidence-slot-extraction.md) · [ADR-076](076-q1-fills-transferred-and-reply-acknowledges.md) ·
  [슬롯 티어링](../spec/backend/08-14-slot-tiering.md) · [API 계약](../spec/common/08-14-api.md) §3.9 ·
  `src/flows/extract-slots.ts` · `src/flows/chat-turn.ts`

## 맥락

[ADR-069](069-evidence-slot-extraction.md) 는 금액·시각·상대 계좌를 **자료에서만** 뽑기로 했다. 2026-09-06 QA 에서 사용자가
첫 진술에 「국민은행 [계좌-1] 로 300만원을 보냈습니다」라고 적었는데 금액은 「모름」으로 남았고, 뒤에 올린 사기 문자에서 뽑은
32,000,000원을 되물었다. 답변은 「300만원을 보내셨군요」라고 받아 주면서([ADR-076](076-q1-fills-transferred-and-reply-acknowledges.md))
사건 파일은 모르는 상태였다.

## 결정

챗 턴이 저장된 뒤 같은 추출기(`slot-extractor`)를 **가려진 발화**에 돌려 `extracted` 로 두고,
되묻기([ADR-069](069-evidence-slot-extraction.md))를 거쳐 확정한다.
`source_ref` 는 message_id. 이미 `confirmed` 인 슬롯은 건드리지 않는다(자료 추출과 같은 규칙).
응답 뒤(`after()`)에 돌아 챗 지연에 더해지지 않는다.

## 탈락시킨 대안

- **답변 모델이 슬롯도 함께 내게 한다** — 출력 계약이 커지고, 인용 검증과 섞인다([ADR-015](015-citation-and-reask.md)).
  추출기는 따로 두는 것이 맞다.

## 결과

**얻는 것**

- 사용자가 말로 적은 금액·시각·상대 계좌가 사건 파일에 남는다. 답변이 받아 준 말과 사건 파일이 어긋나지 않는다.
- 자료와 진술이 **한 추출기·한 그물**을 지난다 — 확신도 0.7 · 모양 검사(`lib/extracted-value.ts`) · `confirmed` 보호가
  두 경로에 같이 걸린다. 한쪽만 고쳐지는 자리가 없다.

**잃는 것**

- 턴마다 모델 호출이 하나 더 붙는다(응답 뒤). 되묻기 답·짧은 답이면 추출기가 아무것도 못 뽑고 끝난다 — 비용은 그 한 번이다.
- 뽑힌 값은 **그 턴의 응답에는 안 실린다.** 되묻기 문항은 다음 번들에서 나온다.

## 정하지 않은 것

- 슬롯 문항의 답(`PATCH /slots`)은 이 길을 지나지 않는다 — 그쪽은 사람이 직접 고른 값이라 뽑을 것이 없다.
- 발화가 짧을 때 모델을 아예 안 부르는 기준(글자 수·물음표 여부)은 두지 않았다. 빈 발화만 건너뛴다.

## 어떻게 지키나

- `src/flows/extract-slots.test.ts` — `source_ref` 가 메시지 번호 · `confirmed` 보호 · 가려진 발화만 나감 · 실패가 안 던짐.
- `src/lib/chat-turn.test.ts` 「진술에서도 슬롯을 뽑는다」 — 턴 안에서는 안 돌고, `deferred` 를 부르면 돈다.
- `src/app/api/cases/[case_token]/messages/route.test.ts` — 라우트가 그 일을 `after` 에 건넨다.
