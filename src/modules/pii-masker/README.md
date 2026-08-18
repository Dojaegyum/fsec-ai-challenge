# pii-masker

**나가기 전 계좌·주민번호·카드·전화를 가립니다.** 층 C — 브라우저에서만 돕니다.

계약은 [PII 격리 경계](../../../spec/common/08-14-pii-boundary.md)와
[모듈 경계](../../../spec/common/08-16-module-boundaries.md)이고, 근거는
[ADR-023](../../../decisions/023-frontend-module-names.md)(층 C 신설)·
[ADR-026](../../../decisions/026-raw-upload-retention.md)(파일까지 책임 확대)입니다.

```ts
import { maskText, assertNoLeak } from "@/modules/pii-masker";

const r = maskText("110-123-456789 로 300만원 보냈어요");
// r.masked   → "[계좌-1] 로 300만원 보냈어요"
// r.mappings → [{ token: "[계좌-1]", kind: "계좌", seq: 1, original: "110-123-456789" }]

assertNoLeak(r.masked, r.mappings); // 나가기 직전에
```

## 절대 하지 않는 것

- **마스킹 전 원문을 네트워크로 보내기.** 이 모듈에는 `fetch`·XHR·WebSocket이 없습니다.
- **매핑을 서버로 그대로 보내기.** 암호화는 `key-handler`의 일입니다 →
  [ADR-009](../../../decisions/009-restore-mapping-location.md).
- **복원하기.** 되돌리는 것은 `pii-restorer`입니다. 방향이 반대인 모듈입니다.

## 이어서 부를 때는 `mappings`를 넘기세요

```ts
const first  = maskText("110-123-456789 로 보냈어요");
const second = maskText("220-456-789012 도 있어요", first);  // → [계좌-2]
```

안 넘기면 일련번호가 1로 리셋돼, **서로 다른 발화의 `[계좌-1]`이 다른 계좌를 가리킵니다.**

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **대표번호 15xx·16xx·18xx** | **가리지 않습니다** | 개인을 식별하지 않고, 「어느 기관에 전화했나」는 절차 분기의 입력입니다 → [ADR-011](../../../decisions/011-pii-boundary-hardening.md) |
| **카드번호** | **Luhn 을 통과할 때만** | 없으면 계좌·주문번호를 카드로 오인합니다 |
| **붙여 쓴 13자리** | **주민번호로 봅니다** | 형태만으로 못 가립니다. 계좌를 주민번호로 보면 부분 복원이 안 될 뿐이지만, 반대면 **생년월일이 화면에 뜹니다** |
| **날짜·금액** | **가리지 않습니다** | 토큰화 제외 목록에 있습니다. 하이픈 계좌는 총 10자리 이상, 붙여 쓴 숫자는 뒤에 화폐 단위가 없을 때만 |
| **이름** | **1차에서 안 만듭니다** | 정규식으로 한국 이름을 잡으면 오탐이 폭발합니다. `pii-tokenizer`(NER 2차)의 몫입니다 |

## 아직 아닌 것

- ⬜ **파일 마스킹.** [ADR-026](../../../decisions/026-raw-upload-retention.md)으로 책임이 파일까지 넓어졌지만,
  **이미지·음성에서 주민등록번호를 검출하는 방법이 미결**입니다. 지금은 텍스트만입니다.

## 파일

| | |
| --- | --- |
| `patterns.ts` | **정규식 패턴 목록의 정본.** 늘릴 때는 테스트를 함께 |
| `mask.ts` | 마스킹 엔진 · 누출 검사 |
| `types.ts` | `PiiKind` · `PiiMapping` · `MaskResult` |
| `mask.test.ts` | 24건. `npm test` |
