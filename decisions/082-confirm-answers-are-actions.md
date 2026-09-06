# ADR-082. 되묻기의 답은 글자가 아니라 뜻(action)으로 보낸다 — `input: "confirm"` · `action: "confirm" | "reject"`

- 상태: **채택**
- 날짜: 2026-09-06
- 결정: @kth9245 (사용자 결정 — QA 결과 「정책으로 바뀌어야 할 것」 승인)
- 관련 문서: [API 계약](../spec/common/08-14-api.md) §3.4 · §3.5 · [ADR-069](069-evidence-slot-extraction.md)(되묻기 도입 · 「글자가 곧 계약」) ·
  [ADR-061](061-question-input-kinds.md)(모름은 `action: "unknown"`) · [ADR-081](081-pii-fragment-floor.md) ·
  `src/flows/answer-slot.ts` · `src/lib/questions.ts` · `src/app/c/[token]/send.ts`

## 맥락

[ADR-069](069-evidence-slot-extraction.md) 는 자료에서 뽑은 값의 되묻기 답을 버튼 글자(「맞아요」·「아니에요, 다시 적을게요」)로
보내고 서버가 그 글자를 상수와 비교하도록 정했다(*"선택지의 앞 둘은 글자가 곧 계약"*). 2026-09-06 QA 에서 브라우저가
보내기 전에 「요」를 `[이름-5]` 로 바꿔([ADR-081](081-pii-fragment-floor.md) 의 오염) 「아니에[이름-5], 다시 적을게[이름-5]」가
도착했고, 서버는 그것을 사용자가 적은 금액으로 저장했다. 사건 파일 카드에 「피해 금액: 아니에요, 다시 적을게요」가 보였다.

「모름」은 이미 [ADR-061](061-question-input-kinds.md) 로 `action: "unknown"` 이라 글자와 무관하다. 확인·거부만 글자에 매달려 있었다.

## 결정

- 되묻기 문항은 `input: "confirm"` 으로 낸다. `options` 는 지금과 같은 세 글자(사람이 읽는 것)다.
- 브라우저는 첫 선택지를 `action: "confirm"`, 둘째를 `action: "reject"`, 셋째를 `action: "unknown"` 으로 보낸다. `value` 는 싣지 않는다.
- 서버는 `confirm` 이면 `extracted` 값을 그대로 `confirmed` 로, `reject` 면 슬롯을 비워 원래 형식으로 다시 묻는다(지금의 두 분기와 같은 동작).
- `action: "answer"` 에 글자가 오는 옛 길은 남긴다 — 배포된 화면이 바뀌기 전 요청을 막지 않는다. 다만 **두 길이 같은 함수를 지난다** —
  갈라 적으면 한쪽만 고쳐지고, 안 고쳐진 쪽이 조용히 틀리는 쪽이 된다.

## 탈락시킨 대안

- **선택지 글자만 가리기에서 제외** — 어떤 글자가 선택지인지 브라우저가 알아야 하고, 글자를 바꾸면 또 깨진다.
- **서버가 가려진 글자를 되살려 비교** — 서버는 원문을 모른다(불변 규칙 3).
