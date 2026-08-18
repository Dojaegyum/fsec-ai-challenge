# completion-checker

**완료를 사용자의 체크가 아니라 부산물로 판정합니다.**

| | |
| --- | --- |
| 계약의 정본 | [05-completion-hook.md](../../../spec/backend/08-14-completion-hook.md) |
| 저장 구조 | [09-data-model.md](../../../spec/backend/08-16-data-model.md) §7 |
| 응답 형태 | [08-api.md](../../../spec/common/08-14-api.md) §3.8 |
| 근거 | [ADR-021](../../../decisions/021-runtime-and-module-shape.md) |

## 왜 이 모듈이 있나

**체크리스트는 "체크는 됐는데 행위는 안 된 상태"를 막지 못합니다.** 그리고 은행·경찰
시스템에 조회 API가 없어 완수를 직접 확인할 수도 없습니다.

그런데 모든 공식 절차는 마치면 **부산물**을 남깁니다 — 112 신고는 사건접수번호를,
지급정지는 은행 접수 문자를, 피해구제 신청은 접수증을. 그 부산물을 완료 조건이자
**다음 단계의 필수 입력**으로 삼으면, 인위적 잠금이 아니라 **절차 자체의 의존관계**로
완수가 강제됩니다.

`CLAUDE.md` 불변 규칙 6이 이것입니다.

## 낸 형태가 곧 검증 레벨입니다

| 사용자가 낸 것 | 레벨 | 결과 | 단계 상태 |
| --- | --- | --- | --- |
| 접수번호를 직접 입력 | **L1** | 형식이 맞으면 `passed` | `done_verified` |
| | | 틀리거나 형식을 모르면 `failed` | `in_progress` |
| 캡처·서류를 올림 | **L2** | `passed` | `done_verified` |
| 했다고만 말함 | **L3** | `not_applicable` | **`unconfirmed`** |

## L3만으로 완료가 되지 않습니다

**이 규칙이 무너지면 이 모듈의 존재 이유가 사라집니다.** 그래서 시험 하나를 따로 두어,
어떤 설정으로 만들어도 자기 신고가 `done_verified`가 되지 않는지 확인합니다.

`unconfirmed`는 **종결 상태가 아닙니다.** 리마인더 추적 대상으로 남습니다.

`verifyResult`가 `not_applicable`인 것은 실패가 아니라 **검증할 것이 없었다**는 뜻입니다.
사용자는 할 수 있는 것을 다 했으므로 다음 선택지를 내밀지 않습니다.

## L1이 실패해도 길을 막지 않습니다

실패하면 단계가 `in_progress`로 남고(뒤로 가지 않습니다), **다음 길을 함께 냅니다.**

```
{ level: 'L2', label: '접수 문자 캡처를 올려주세요' }
{ level: 'L3', label: '번호 없이 접수했다고 표시' }
```

**막다른 길을 만들지 않는 것**이 규칙입니다. 패닉 상태의 사용자를 막아 세우면 이탈합니다.

## 형식을 모를 때

기관별 접수번호 형식의 정본이 아직 없습니다
(→ [05-completion-hook.md](../../../spec/backend/08-14-completion-hook.md) TODO).
그래서 형식을 이 모듈이 갖지 않고 `ReceiptNumberFormat`으로 물어봅니다.

**모르면 `undefined`를 돌려주세요.** `false`(틀렸다)와 구분합니다.

| 응답 | 뜻 | 결과 |
| --- | --- | --- |
| `true` | 형식에 맞다 | `passed` |
| `false` | 형식과 다르다 | `failed` · `format_mismatch` |
| `undefined` | **그 기관의 형식을 아직 모른다** | `failed` · `format_unknown` |

**모른다고 통과시키지 않습니다.** 그러면 아무 숫자나 넣어도 완료가 됩니다. 대신 이유를
나눠 두어, 나중에 「형식을 아직 못 넣은 기관」을 셀 수 있습니다.

## 검증 상세에 개인정보를 담지 않습니다

`verifyDetail`에는 `reason` 하나만 들어갑니다. 사용자가 입력한 값은 개인정보일 수 있고,
업로드 식별자도 담지 않습니다 → [09-data-model.md](../../../spec/backend/08-16-data-model.md) §7.

## 이 모듈이 하지 않는 것

- **다음 단계가 열렸는지 계산하지 않습니다.** 응답의 `unlocked_steps`는 플랜 구조를
  알아야 해서 이 모듈 밖입니다.
- **접수증 OCR 대조를 하지 않습니다.** 정본의 L1은 포맷 체크와 OCR 대조 둘인데,
  OCR 경로(`transcriber`)가 아직 없습니다. **지금은 포맷 체크까지입니다.**
- **저장하지 않습니다.** 판정만 돌려줍니다.

## 쓰는 법

```ts
import { createCompletionChecker } from '@/modules/completion-checker'

const checker = createCompletionChecker({ receiptFormat })

const verdict = checker.verify({
  submission: { kind: 'receipt_no', value: '2026-1234567' },
})
// { verifyLevel: 'L1', verifyResult: 'passed', stepState: 'done_verified' }
```
