# 12 · 모듈 명칭

> **기획서 추출이 아닌 명칭 규약입니다.** 사람과 사람, 사람과 에이전트가 같은 것을 같은 말로
> 부르기 위해 정했습니다 → [ADR-0008](../decisions/0008-모듈-명칭-체계.md).

용어와 도메인 개념은 [00-glossary.md](00-glossary.md)를 따릅니다. 이 문서는 **동작 단위의 이름**을 정합니다.

## 이 문서가 정하는 것

| 정합니다 | 정하지 않습니다 |
| --- | --- |
| 각 동작 단위를 부르는 이름 | 코드 폴더 구조 — 구현 시 자유롭게 |
| 그 단위가 무엇을 맡는지 | 배포 단위·프로세스 분리 |
| 언제 도는지 (네 층) | 새 ID 접두 — `F` `S` `CH` 외에 만들지 않습니다 |

**용어집입니다.** 이름이 폴더명이나 클래스명과 일치할 의무는 없습니다. 문서·대화·커밋 메시지에서 같은 것을 같은 말로 부르는 것이 목적입니다.

## 명명 원칙

1. **영어 한 층만 씁니다.** 한국어 별칭 표를 따로 두지 않습니다. 발표에서도 같은 이름을 쓰고 뜻은 말로 풉니다.
2. **하는 일이 이름에 드러나되, 어려운 단어를 피합니다.**
3. **도메인 명사와 형태로 구분합니다.** 모듈은 `-er`·`-checker` 꼴, 도메인 개념은 명사(`Case`·`Slot`·`Plan`). "플래너가 플랜을 만든다"처럼 소리 내어 말해도 구분됩니다.
4. **`-er`이 어색한 곳은 두 단어를 허용합니다** — `case-intake`.

---

## 왜 층으로 나누는가

[00-glossary.md](00-glossary.md)의 파이프라인 도식과 [02-slot-tiering.md](02-slot-tiering.md)의 흐름도는 **한 번 흘러서 끝나는 그림**입니다. 실제 동작은 다릅니다.

- 전사·토큰화는 **증거가 들어올 때만** 돕니다.
- 챗은 [11-chat-context.md](11-chat-context.md)가 정의한 대로 **사용자가 말할 때마다** 전체 절차를 다시 돕니다.
- 플랜·기한·완료 판정은 **상태가 바뀔 때** 돕니다. 슬롯이 뒤늦게 채워지면 플랜이 재생성됩니다.

**언제 도는지가 다르면 다른 층입니다.** 층을 이름 체계에 넣어두면 "어디서 문제가 났나"를 한마디로 지목할 수 있습니다.

```
【층 1】 증거가 들어올 때만 (한 번)

   transcriber
        ↓
   pii-tokenizer  ← 격리 경계
        ↓
   ├ case-reader
   └ slot-extractor


【층 2】 사용자가 말할 때마다 (매 턴)

   pii-tokenizer → kb-finder → prompt-builder
        → [ 모델 1회 호출 ] → citation-checker → pii-restorer


【층 3】 사건 상태가 바뀔 때

   slot-checker → planner → date-checker
   completion-checker → date-checker · planner 재호출


【층 4】 하루 1회

   kb-collector → kb-reviewer → 버전 릴리스
```

---

## 층 1 · 증거가 들어올 때만

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `case-intake` | 사건을 생성하고 파일을 접수한다 | `F-01` [08](08-api.md) §3.1 §3.2 |
| `transcriber` | STT(화자 분리)·OCR(대화 구조 보존) | `F-02` |
| `pii-tokenizer` | 개인정보를 토큰으로 치환한다. **격리 경계** | `F-03` [04](04-pii-boundary.md) |
| `case-reader` | 수법과 위험도를 판정하고 근거 스팬을 낸다 | `F-04` |
| `slot-extractor` | 전사·OCR 결과에서 슬롯 값을 추출한다 | `F-05b` [02](02-slot-tiering.md) |

**`pii-tokenizer`를 거치지 않은 텍스트는 외부 LLM으로 나갈 수 없습니다.** 이 모듈만이 경계이며, 우회 경로를 만드는 것은 [04-pii-boundary.md](04-pii-boundary.md) 위반입니다.

**`case-reader`의 산출물은 절차 분기에 쓰이지 않습니다.** 분기축은 경유 서비스 하나입니다 → [03](03-channel-matrix.md). 이 모듈의 결과는 화면 표시([06](06-screens.md))와 관리자 조회([08](08-api.md) §5)에서 소비됩니다.

**`slot-extractor`와 `slot-checker`는 다른 모듈입니다.** 값을 뽑는 것은 LLM이 하고(층 1), 충분한지 판정하고 다음 질문을 고르는 것은 규칙이 합니다(층 3). 한 이름으로 묶으면 LLM을 쓰는 곳과 쓰지 않는 곳의 경계가 이름에서 사라집니다.

## 층 2 · 사용자가 말할 때마다

[11-chat-context.md](11-chat-context.md)가 정의한 절차입니다.

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `pii-tokenizer` | 입력을 토큰화한다 (층 1과 같은 모듈) | 서버 | [04](04-pii-boundary.md) |
| `kb-finder` | KB를 `applied`·`reference` 두 묶음으로 조회한다 | 서버 | [11](11-chat-context.md) §2 |
| `prompt-builder` | 7블록을 순서대로 조립하고 비신뢰 블록에 격리 태그를 씌운다 | 서버 | [11](11-chat-context.md) §3 §4 |
| `citation-checker` | 인용이 허용 집합 안에 있는지 대조한다 | 서버 | [11](11-chat-context.md) §6 |
| `pii-restorer` | 어느 토큰을 되돌릴지 **심사**하고, 되돌리기를 **수행**한다 | **심사는 서버 · 수행은 브라우저** | [11](11-chat-context.md) §8 |

**모델 호출은 한 번이고 모델은 도구를 부르지 않습니다.** 조회 조건은 서버가 전부 알고 있습니다 → [11](11-chat-context.md) §1.

> ⚠️ **`pii-restorer`만 실행 위치가 둘로 갈립니다.** 어느 토큰을 되돌려도 되는지 판정하는 것은 서버가 하지만, **실제 복원은 브라우저에서만 일어납니다.** 서버는 복호화 키를 갖지 않아 복원 자체가 불가능합니다 → [04](04-pii-boundary.md) · [ADR-0003](../decisions/0003-복원-매핑-보관-위치.md).
>
> **서버에 복원 함수를 만들면 규칙 위반입니다.** 이 이름이 다른 서버 모듈과 같은 표에 있다는 이유로 서버 구현으로 오해하지 마세요.

## 층 3 · 사건 상태가 바뀔 때

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `slot-checker` | T1 충족 여부를 판정하고 다음 질문 1문항을 고른다 | `F-05b` [02](02-slot-tiering.md) |
| `planner` | KB를 인용해 `plan_step`을 확정한다 | `F-05` [03](03-channel-matrix.md) |
| `date-checker` | 법정 기한을 **규칙으로** 계산하고 잔여일을 추적한다 | `F-06` [09](09-data-model.md) §8 |
| `completion-checker` | `artifact`로 완료를 판정한다 (L1·L2·L3) | `F-06b` [05](05-completion-hook.md) |
| `doc-builder` | 신청서 초안을 만든다 | `F-08` (P1) |

**`date-checker`에 LLM을 쓰지 않습니다.** 3영업일·14일 유예·2개월 공고·5영업일은 전부 코드의 규칙입니다 → `CLAUDE.md` 불변 규칙 7.

**`planner`는 근거 없는 단계를 저장할 수 없습니다.** `kb_entry_id`·`kb_version`·`source_url`·`effective_from`이 비면 적재가 거부됩니다 → [09](09-data-model.md) §6.

**`completion-checker`는 사용자의 체크만으로 완료 판정을 내지 않습니다.** L3(자기 신고)는 `unconfirmed`로 남아 리마인더 추적 대상이 됩니다 → [05](05-completion-hook.md).

> `doc-builder`는 [08-api.md](08-api.md)에 엔드포인트 계약이 아직 없습니다.
> 구현 시 **서버가 완성 문서를 내려주는 구조는 금지**입니다 → [04](04-pii-boundary.md) 규칙 6.

## 층 4 · 하루 1회

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `kb-collector` | 감시 소스에서 원문을 가져와 스냅샷으로 보관한다 | `F-11` [07](07-kb-operations.md) |
| `kb-reviewer` | 변경분을 사람이 검수·승인하고 버전을 릴리스한다 | `F-11` [09](09-data-model.md) §12 |

**`kb-reviewer`의 승인은 사람이 합니다.** LLM은 영향 분석까지이고 릴리스 판단은 사람의 몫입니다 → [07](07-kb-operations.md).

## 층 없음 · 항상

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `audit-logger` | 모든 LLM 호출을 토큰화 텍스트 기준으로 기록한다 | [09](09-data-model.md) §10 |

---

## 도메인 용어

### 바꾸는 것 — 하나

| 지금 표기 | 바꿈 | 이유 |
| --- | --- | --- |
| `Channel` (경유 서비스) | **`payment-service`** | 영어 `channel`은 통신 경로·알림 채널로 읽혀 "돈이 지나간 금융 서비스"라는 뜻이 전달되지 않습니다 |

#### 바뀌는 것은 사람이 읽는 말뿐입니다 — 식별자는 전부 그대로 둡니다

**이 개명은 문서 서술과 대화에만 적용됩니다.** 코드·스키마·데이터의 식별자는 하나도 바꾸지 않습니다.

| 그대로 두는 것 | 예 |
| --- | --- |
| ID 접두 | `CH-bank` · `CH-easypay` |
| 칼럼명 | `case_channel.channel_id` · `kb_entry.channel_id` · `org.channel_id` |
| 테이블명 | `case_channel` |
| 키·인덱스 | `case_channel_id` · `idx_channel` |
| **슬롯 키** | `channel` (T1 슬롯) |
| 감사 로그 페이로드 | `{"slot_key":"channel"}` |
| 파일명 | `spec/03-channel-matrix.md` |

**슬롯 키 `channel`이 특히 중요합니다.** `kb_entry.body`의 `requires_slots`가 이 이름을 참조하고, KB 적재 시 검증이 슬롯 이름 목록과 대조해 없으면 릴리스를 거부합니다 → [09](09-data-model.md) §11. 이름을 바꾸면 지식베이스 데이터와 코드가 동시에 움직여야 하고, 어긋나면 KB 릴리스가 막힙니다.

**ID는 재사용·재정렬 금지 대상이기도 합니다** → `CLAUDE.md`.

그러니 이렇게 읽으면 됩니다 — **말할 때는 `payment-service`, 코드에 쓰는 이름은 `channel` 계열 그대로.**

### 그대로 두는 것

`Case` · `Evidence` · `Slot` · `Plan` · `Artifact` · `PII Token` · `KB` → [00-glossary.md](00-glossary.md)

> **`Artifact`는 뜻이 겹칩니다.** 소프트웨어에서 빌드 산출물이라는 뜻으로 굳어져 있어, 사건접수번호·접수 문자·접수증을 가리킨다는 것이 이름만으로는 전달되지 않습니다. `proof`·`receipt`를 검토했으나 이미 `artifact` 테이블([09](09-data-model.md) §7)과 여러 문서에 박혀 있어 **현행 유지**로 정했습니다 → [ADR-0008](../decisions/0008-모듈-명칭-체계.md).
>
> 처음 듣는 사람에게 설명할 때는 **"절차를 실제로 마치면 남는 것 — 접수번호·접수증"**이라고 풉니다.

### 약어

`KB`는 knowledge base입니다. `kb-finder`·`kb-collector`·`kb-reviewer`가 이 접두를 씁니다. 저장소 전체가 이미 `KB`를 쓰고 있어 그대로 두되, **처음 보는 사람이 있는 자리에서는 한 번 풀어서 말합니다.**

---

## 08-api.md 「서버 구성 요소」와의 대응

[08-api.md](08-api.md)의 표는 이 문서보다 먼저 작성됐습니다. 대응은 이렇습니다.

| 08-api.md 표기 | 이 문서 |
| --- | --- |
| API Gateway | **모듈이 아닙니다** — 진입 경로라서 이 목록에 넣지 않았습니다 |
| Ingest 서비스 | `transcriber` |
| 2차 PII 스크러버 | `pii-tokenizer` |
| 분석 오케스트레이터 | **셋으로 갈립니다** — `case-reader`(F-04) · `slot-extractor`(F-05b) · `planner`(F-05) |
| 슬롯 체커 | `slot-checker` |
| Case Store | **모듈이 아닙니다** — 저장소라서 넣지 않았습니다 → [09](09-data-model.md) |
| 감사 로그 | `audit-logger` |

**「분석 오케스트레이터」를 나누는 이유**는 하나로 묶인 셋이 하는 일도 실패 처리도 다르기 때문입니다. `case-reader`의 실패는 화면 배지가 안 뜨는 것으로 끝나지만, `planner`의 실패는 사용자가 절차를 못 받는 것입니다. `slot-extractor`의 실패는 [10](10-errors.md) §4가 정한 대로 **에러가 아니라 질문 경로로 흘러갑니다.** 한 이름으로 부르면 이 셋을 구분해 말할 수 없습니다.

---

## 기존 문서 반영은 별도 작업입니다

이 문서를 작성한 시점에 `spec/`의 다른 문서들은 아직 `Channel`·`PII 스크러버` 표기를 쓰고 있습니다. **일괄 개명은 이 작업에 포함하지 않았습니다** — 같은 파일들을 다른 작업이 동시에 고치고 있었기 때문입니다.

- TODO: `Channel` → `payment-service` 표기 반영 ([03](03-channel-matrix.md) [08](08-api.md) [09](09-data-model.md) [11](11-chat-context.md))
- TODO: 「2차 PII 스크러버」 → `pii-tokenizer` 표기 반영 ([04](04-pii-boundary.md) [08](08-api.md) [10](10-errors.md))
- TODO: [00-glossary.md](00-glossary.md)에 이 문서 링크 추가

## TODO

- TODO(미정): **재시도 조율 단위의 이름.** [10-errors.md](10-errors.md) §2가 "오케스트레이터는 `retryable` 값만 보고 판단한다"고 정해 재시도 책임을 가진 단위가 실재하는데, 이름이 없습니다. `orchestrator`는 어려운 단어라 보류했습니다. **[08](08-api.md)의 「분석 오케스트레이터」와는 다른 것입니다** — 그쪽은 `case-reader`·`slot-extractor`·`planner`로 갈렸고, 이것은 그 셋을 순서대로 돌리며 실패를 처리하는 자리입니다.
- TODO(미정): **상태·등급의 호칭.** `plan_step.state` 다섯 가지, 완료 판정 L1·L2·L3, 슬롯 티어 T0·T1·T2를 대화에서 뭐라 부를지. 값은 이미 정의돼 있으므로 호칭만 정하면 됩니다.
- TODO(미정): 화면·프론트 구성의 명칭 — 이번 범위에서 제외했습니다 ([06](06-screens.md)).
