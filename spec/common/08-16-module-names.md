# 12 · 모듈 명칭

> **기획서 추출이 아닌 명칭 규약입니다.** 사람과 사람, 사람과 에이전트가 같은 것을 같은 말로
> 부르기 위해 정했습니다 → [ADR-014](../../decisions/014-module-names.md).

용어와 도메인 개념은 [00-glossary.md](08-14-glossary.md)를 따릅니다. 이 문서는 **동작 단위의 이름**을 정합니다.

## 이 이름을 씁니다

**여기 정한 이름이 정본입니다.** 새로 쓰는 문서·코드·커밋 메시지·발표 자료에서 같은 대상을 다른 말로 부르지 마세요.

- 「Ingest 서비스」·「2차 PII 스크러버」·「분석 오케스트레이터」 같은 **옛 표기를 새로 쓰지 않습니다.** 아래 [08-api.md 「서버 구성 요소」와의 대응](#08-apimd-서버-구성-요소와의-대응)에서 대응하는 이름을 찾으세요.
- 여기 없는 동작 단위에 이름이 필요하면 **지어 쓰지 말고 이 문서에 먼저 추가**하세요. 명명 원칙은 아래에 있습니다.
- 이 문서를 고칠 때는 [ADR-014](../../decisions/014-module-names.md)도 함께 갱신합니다. 왜 그렇게 정했는지가 거기 있습니다.

## 이 문서가 정하는 것

| 정합니다 | 정하지 않습니다 |
| --- | --- |
| 각 동작 단위를 부르는 이름 | 배포 단위·프로세스 분리 |
| 그 단위가 무엇을 맡는지 | 새 ID 접두 — `F` `S` `CH` 외에 만들지 않습니다 |
| 언제 도는지 (네 층) | `src/modules/` **밖**의 코드 배치 (공용 유틸·UI·라우트) |

> 2026-08-16 [ADR-019](../../decisions/019-module-code-sync.md)로 **코드 폴더 구조가 이 이름에 묶였습니다.**
> 이전에는 "코드 폴더 구조 — 구현 시 자유롭게"였습니다.
> **도메인 모듈 코드는 `src/modules/{여기 정한 이름}/`에 둡니다.** 이름이 코드에 닿지 않으면
> "슬롯 체커에서 막혔다"고 말해도 열어볼 파일이 없어, 이 문서가 장식이 됩니다.
> **정본에 없는 이름으로 폴더를 만들면 CI가 막습니다.**

**용어집입니다.** 이름이 폴더명이나 클래스명과 일치할 의무는 없습니다. 문서·대화·커밋 메시지에서 같은 것을 같은 말로 부르는 것이 목적입니다.

## 명명 원칙

1. **영어 한 층만 씁니다.** 한국어 별칭 표를 따로 두지 않습니다. 발표에서도 같은 이름을 쓰고 뜻은 말로 풉니다.
2. **하는 일이 이름에 드러나되, 어려운 단어를 피합니다.**
3. **도메인 명사와 형태로 구분합니다.** 모듈은 `-er`·`-checker` 꼴, 도메인 개념은 명사(`Case`·`Slot`·`Plan`). "플래너가 플랜을 만든다"처럼 소리 내어 말해도 구분됩니다.
4. **`-er`이 어색한 곳은 두 단어를 허용합니다** — `case-intake`.

---

## 왜 층으로 나누는가

[00-glossary.md](08-14-glossary.md)의 파이프라인 도식과 [02-slot-tiering.md](../backend/08-14-slot-tiering.md)의 흐름도는 **한 번 흘러서 끝나는 그림**입니다. 실제 동작은 다릅니다.

- 전사·토큰화는 **증거가 들어올 때만** 돕니다.
- 챗은 [11-chat-context.md](../backend/08-16-chat-context.md)가 정의한 대로 **사용자가 말할 때마다** 전체 절차를 다시 돕니다.
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

   chat-receiver ─ 순서를 부르는 자리
        └ pii-tokenizer → kb-finder → prompt-builder → [ 모델 1회 호출 ]
              → citation-checker → chat-publisher ─ 나가는 것을 마지막으로 만지는 자리
                    → (브라우저) pii-restorer


【층 3】 사건 상태가 바뀔 때

   slot-checker → planner → date-checker
   completion-checker → date-checker · planner 재호출


【층 4】 하루 1회

   kb-collector → kb-reviewer → 버전 릴리스


【층 C】 브라우저 — 서버가 대신할 수 없는 것

   case-opener  ── URL 토큰으로 사건을 연다 (계정이 없어 이 자리가 인증을 대신함)

   나가는 길    pii-masker → file-sender → (서버)
   들어오는 길  (서버) → poll-checker → pii-restorer ← key-handler
   보여주는 곳  transcript-viewer · plan-viewer · deadline-viewer
                chat-handler · work-handler · doc-filler
```

**층 C만 「언제 도는가」가 아니라 「무엇을 책임지는가」로 묶습니다.** 브라우저는 화면이 열려 있는 동안
여러 가지가 동시에 도는 자리라, 시간축으로 가르면 대부분이 한 칸에 몰려 이름 체계의 목적(어디서 막혔나를
한마디로 지목하는 것)이 사라집니다. **가르는 실질 기준은 「절대 하지 않는 것」이 다른가**입니다.

---

## 층 1 · 증거가 들어올 때만

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `case-intake` | 사건을 생성하고 파일을 접수한다 | `F-01` [08](08-14-api.md) §3.1 §3.2 |
| `transcriber` | STT(화자 분리)·OCR(대화 구조 보존) | `F-02` |
| `pii-tokenizer` | 개인정보를 토큰으로 치환한다. **격리 경계** | `F-03` [04](08-14-pii-boundary.md) |
| `case-reader` | 수법과 위험도를 판정하고 근거 스팬을 낸다 | `F-04` |
| `slot-extractor` | 전사·OCR 결과에서 슬롯 값을 추출한다 | `F-05b` [02](../backend/08-14-slot-tiering.md) |

**`pii-tokenizer`를 거치지 않은 텍스트는 외부 LLM으로 나갈 수 없습니다.** 이 모듈만이 경계이며, 우회 경로를 만드는 것은 [04-pii-boundary.md](08-14-pii-boundary.md) 위반입니다.

**`case-reader`의 산출물은 절차 분기에 쓰이지 않습니다.** 분기축은 경유 서비스 하나입니다 → [03](../backend/08-14-channel-matrix.md). 이 모듈의 결과는 화면 표시([06](../frontend/08-14-screens.md))와 관리자 조회([08](08-14-api.md) §5)에서 소비됩니다.

**`slot-extractor`와 `slot-checker`는 다른 모듈입니다.** 값을 뽑는 것은 LLM이 하고(층 1), 충분한지 판정하고 다음 질문을 고르는 것은 규칙이 합니다(층 3). 한 이름으로 묶으면 LLM을 쓰는 곳과 쓰지 않는 곳의 경계가 이름에서 사라집니다.

## 층 2 · 사용자가 말할 때마다

[11-chat-context.md](../backend/08-16-chat-context.md)가 정의한 절차입니다.

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `chat-receiver` | 발화를 받아 아래 셋을 순서대로 부르고 모델을 1회 호출한다 | 서버 | [ADR-022](../../decisions/022-chat-turn-boundaries.md) 결정 하나 |
| `pii-tokenizer` | 입력을 토큰화한다 (층 1과 같은 모듈) | 서버 | [04](08-14-pii-boundary.md) |
| `kb-finder` | KB를 `applied`·`reference` 두 묶음으로 조회한다 | 서버 | [11](../backend/08-16-chat-context.md) §2 |
| `prompt-builder` | 7블록을 순서대로 조립하고 비신뢰 블록에 격리 태그를 씌운다 | 서버 | [11](../backend/08-16-chat-context.md) §3 §4 |
| `citation-checker` | 인용 네 가지를 확인하고, 비었으면 **되묻기로 넘길지** 판정한다 | 서버 | [11](../backend/08-16-chat-context.md) §6 |
| `chat-publisher` | 세 갈래를 한 형태로 씌우고, 판단 근거를 분리하고, 잔여 PII를 검사한다 | 서버 | [ADR-022](../../decisions/022-chat-turn-boundaries.md) 결정 둘 |
| `pii-restorer` | 복원해도 되는 토큰인지 검사하고 되돌린다 | **브라우저** | [11](../backend/08-16-chat-context.md) §8 |

**`chat-receiver`는 부르기만 합니다.** [ADR-022](../../decisions/022-chat-turn-boundaries.md)가 금지를 셋 걸었습니다 —
**갈래를 판정하지 않고**(그건 `citation-checker`), **조회·조립·토큰화를 직접 하지 않고**,
**응답 형태를 만들지 않습니다**(그건 `chat-publisher`).
**이 조항이 없으면 반드시 비대해집니다** — 재시도 판단·감사 로그·캐싱 경계가 이 자리로 몰릴 힘이 있습니다.

**`chat-publisher`의 이름은 전송 방식을 뜻하지 않습니다.** `receiver`와 대칭을 이루려고 고른 말이고,
실제로 하는 일은 HTTP 응답 본문을 만드는 것입니다 — 구독·푸시·발행과 무관합니다.
**여기가 「판단 근거 분리」와 「잔여 PII 검사」의 주인입니다** — ADR-022 이전에는 규칙만 있고 주인이 없었습니다.

**`citation-checker`와 `chat-publisher`의 경계** — 어느 갈래인지 **판정**하는 것은 `citation-checker`,
그 갈래를 **형태로 옮기는** 것은 `chat-publisher`입니다. 판정이 뒤로 새면 갈래가 두 곳에서 결정됩니다.

**모델 호출은 한 번이고 모델은 도구를 부르지 않습니다.** 조회 조건은 서버가 전부 알고 있습니다 → [11](../backend/08-16-chat-context.md) §1.

> ⚠️ **`pii-restorer`는 이 표에서 유일하게 서버 모듈이 아닙니다.** 복원 여부 검사도, 실제 복원도 브라우저에서 일어납니다. 서버는 토큰 상태 그대로 내려보내고 끝입니다 — 복호화 키가 없어 복원 자체가 불가능합니다 → [04](08-14-pii-boundary.md) · [ADR-009](../../decisions/009-restore-mapping-location.md).
>
> **서버에 복원 함수를 만들면 규칙 위반입니다.** 이 이름이 다른 서버 모듈과 같은 표에 있다는 이유로 서버 구현으로 오해하지 마세요.

**`citation-checker`는 대조만 하는 것이 아닙니다.** 인용이 비었을 때 에러로 끝낼지 되묻기로 넘길지를 여기서 가릅니다 → [11](../backend/08-16-chat-context.md) §6.3 · [ADR-015](../../decisions/015-citation-and-reask.md). 조회 결과가 0건이면 1332 안내로 가고, 조회는 됐는데 인용을 못 붙인 경우에는 `slot-checker`로 넘겨 질문 한 문항을 내보냅니다. **이 경로에서는 에러가 아니라 질문이 나갑니다.**

## 층 3 · 사건 상태가 바뀔 때

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `slot-checker` | T1 충족 여부를 판정하고 다음 질문 1문항을 고른다 | `F-05b` [02](../backend/08-14-slot-tiering.md) |
| `planner` | KB를 인용해 `plan_step`을 확정한다 | `F-05` [03](../backend/08-14-channel-matrix.md) |
| `date-checker` | 법정 기한을 **규칙으로** 계산하고 잔여일을 추적한다 | `F-06` [09](../backend/08-16-data-model.md) §8 |
| `completion-checker` | `artifact`로 완료를 판정한다 (L1·L2·L3) | `F-06b` [05](../backend/08-14-completion-hook.md) |
| `doc-builder` | 신청서 초안을 만든다 | `F-08` (P1) |

**`date-checker`에 LLM을 쓰지 않습니다.** 3영업일·14일 유예·2개월 공고·5영업일은 전부 코드의 규칙입니다 → `CLAUDE.md` 불변 규칙 7.

**`planner`는 근거 없는 단계를 저장할 수 없습니다.** `kb_entry_id`·`kb_version`·`source_url`·`effective_from`이 비면 적재가 거부됩니다 → [09](../backend/08-16-data-model.md) §6.

**`completion-checker`는 사용자의 체크만으로 완료 판정을 내지 않습니다.** L3(자기 신고)는 `unconfirmed`로 남아 리마인더 추적 대상이 됩니다 → [05](../backend/08-14-completion-hook.md).

> `doc-builder`는 [08-api.md](08-14-api.md)에 엔드포인트 계약이 아직 없습니다.
> 구현 시 **서버가 완성 문서를 내려주는 구조는 금지**입니다 → [04](08-14-pii-boundary.md) 규칙 6.

## 층 4 · 하루 1회

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `kb-collector` | 감시 소스에서 원문을 가져와 스냅샷으로 보관한다 | `F-11` [07](../backend/08-14-kb-operations.md) |
| `kb-reviewer` | 변경분을 사람이 검수·승인하고 버전을 릴리스한다 | `F-11` [09](../backend/08-16-data-model.md) §12 |

**`kb-reviewer`의 승인은 사람이 합니다.** LLM은 영향 분석까지이고 릴리스 판단은 사람의 몫입니다 → [07](../backend/08-14-kb-operations.md).

## 층 없음 · 항상

**어느 기능에도 묶이지 않고 모든 층에서 도는 것들입니다.**

| 이름 | 맡는 일 | 관련 |
| --- | --- | --- |
| `audit-logger` | 모든 LLM 호출을 토큰화 텍스트 기준으로 기록한다 | [09](../backend/08-16-data-model.md) §10 |
| `retry-checker` | 예외의 `retryable` 값을 보고 다시 시킬지 중단할지 판단한다 | [10](../backend/08-16-errors.md) §2 |

**`retry-checker`가 층에 안 들어가는 이유**는 어떤 모듈이 실패를 던지든 같은 판단을 하기 때문입니다. 예외의 종류를 분기하지 않고 `retryable` 값 하나만 봅니다 → [10](../backend/08-16-errors.md) §2.

> ⚠️ **[08-api.md](08-14-api.md)의 「분석 오케스트레이터」와 다른 것입니다.** 그쪽은 수법 판별과 플랜 생성의 실행 순서를 조율하는 자리로, 이 체계에서는 `case-reader`·`slot-extractor`·`planner` 셋으로 갈려 사라집니다. `retry-checker`는 실행 순서와 무관하게 **실패 처리만** 맡습니다.
>
> 두 문서가 같은 「오케스트레이터」라는 말을 서로 다른 뜻으로 쓰고 있었습니다. **그래서 이 이름에 `orchestrator`를 쓰지 않습니다** — 없어질 것을 가리키는 이름이 됩니다.

## 층 C · 브라우저에서 도는 것

**서버가 대신할 수 없는 것들입니다** → [ADR-023](../../decisions/023-frontend-module-names.md).
복호화 키가 클라이언트에만 있고, 사건의 열쇠가 URL이며, 원문이 여기서만 펼쳐지기 때문입니다.

> `pii-restorer`는 **층 2에 이미 있습니다.** 챗 한 턴의 마지막 단계라 거기 두었고, 여기 다시 적지 않습니다
> — 한 모듈이 두 표에 있으면 인벤토리가 두 번 셉니다.

### 원문을 다루는 자리

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `pii-masker` | 나가기 전 정규식으로 계좌·주민번호·카드·전화를 가린다 | 브라우저 | [04](08-14-pii-boundary.md) |
| `key-handler` | 복호화 키를 세션에 보관하고 볼트 암호문을 복호한다 | 브라우저 | [ADR-009](../../decisions/009-restore-mapping-location.md) |

**`pii-masker`와 `pii-restorer`는 방향이 반대입니다.** 나갈 때 가리고, 들어올 때 되돌립니다.
서버의 `pii-tokenizer`가 2차이고 이쪽이 1차입니다 — **1차를 건너뛴 전송 경로를 만들면 규칙 위반입니다.**

**`key-handler`는 동작이 아니라 보관이라 흡수하고 싶어지는 자리입니다.** 그래도 이름을 두는 이유는
「키를 서버·로그·DB로 보내지 않는다」는 불변 규칙을 **붙일 자리가 필요하기 때문**입니다.

### 사건에 접속하는 자리

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `case-opener` | URL 토큰으로 사건을 열고, 발급 직후 복사·공유를 제공한다 | 브라우저 | [ADR-021](../../decisions/021-reentry-and-identity.md) |

**계정이 없어 이 자리가 인증을 통째로 대신합니다.** `key-handler`의 「키」와 헷갈리지 마세요 —
이쪽은 **URL에 박혀 돌아다니는 사건 토큰**이고, 저쪽은 **절대 클라이언트를 떠나지 않는 복호화 키**입니다.

### 서버와 이야기하는 자리

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `poll-checker` | `poll_after_ms`를 보고 다시 묻는다. 실패를 재시도·표시로 가른다 | 브라우저 | [08](08-14-api.md) §3.3 · [10](../backend/08-16-errors.md) §2 |

**스트리밍·웹소켓을 쓰지 않습니다** → [ADR-022](../../decisions/022-chat-turn-boundaries.md).
서버의 `retry-checker`와 짝이며, 같은 규칙(`retryable` 하나만 본다)을 따릅니다.

### 재료를 넣고 보는 자리

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `file-sender` | 파일을 받아 `pii-masker`를 태워 올리고 처리 상태를 추적한다 | 브라우저 | `F-01` [08](08-14-api.md) §3.2 §3.8 |
| `transcript-viewer` | 전사·OCR 결과를 보여준다. 여기서는 **전체 복원**이 허용된다 | 브라우저 | `F-02` [11](../backend/08-16-chat-context.md) §8 |

**`file-sender`는 증거와 부산물을 함께 맡습니다.** 엔드포인트는 다르지만
(`/evidence`·`/steps/{id}/artifacts`) 클라이언트 동작이 같습니다 — 가리고, 올리고, 상태를 추적합니다.

**`transcript-viewer`는 OCR을 하지 않습니다.** 전사는 서버 `transcriber`의 일이고 여기는 표시만 합니다.
`file-sender`와 **PII 규칙이 정반대**입니다 — 하나는 가리고 하나는 펼칩니다.

### 사건을 보여주는 자리

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `plan-viewer` | 타임라인·단계·상태 배지를 그린다. T0 안전 절차를 상시 노출한다 | 브라우저 | `F-06` [02](../backend/08-14-slot-tiering.md) |
| `deadline-viewer` | 기한을 표시한다. `primary`·`grace`·`info`를 구분한다 | 브라우저 | `F-06` [기한 규칙](08-16-deadline-rules.md) |
| `chat-handler` | 발화를 보내고 응답을 표시한다. 슬롯 질문을 버튼으로 렌더한다 | 브라우저 | `F-07` [08](08-14-api.md) §3.9 |

**`deadline-viewer`를 `plan-viewer`에서 가른 이유는 「날짜를 계산하지 않는다」입니다.**
합치면 그 금지가 갈 곳이 없어집니다. 표시 규칙이 일곱이고 그중 넷이 금지이며,
카드 부정사용 보상 60일처럼 **과거를 향해 세는 기한**까지 있습니다 → [research/06](../../docs/research/06-경로별-실측조사.md) §2.2.

**`chat-handler`는 인용 번호·판단 근거를 화면에 쓰지 않습니다** — 근거 화면은 보류 상태입니다
→ [ADR-022](../../decisions/022-chat-turn-boundaries.md) 결정 셋.

### 작업하는 자리

| 이름 | 맡는 일 | 어디서 도나 | 관련 |
| --- | --- | --- | --- |
| `work-handler` | 어느 단계를 할 차례인지 판정하고, 그 유형의 패널을 렌더한다 | 브라우저 | [워크스페이스 패널](../frontend/08-17-workspace-panels.md) |
| `doc-filler` | 서류 초안을 받아 **브라우저에서** 원문을 채워 완성한다 | 브라우저 | `F-08` (P1) [04](08-14-pii-boundary.md) |

**`work-handler`는 판정과 렌더를 함께 맡습니다.** 나누는 안을 검토하고 합쳤습니다
→ [ADR-023](../../decisions/023-frontend-module-names.md). **대신 모듈 안에서 판정을 렌더와 섞지 않습니다** —
섞이면 "왜 이 패널이 떴나"를 짚을 수 없습니다 → [모듈 경계](08-16-module-boundaries.md).

**`doc-filler`는 서버가 만든 완성 문서를 받지 않습니다.** 초안에 원문을 채우는 것은 브라우저의 일이고,
서버가 완성본을 내려주는 구조는 [04](08-14-pii-boundary.md) 위반입니다.

---

## 도메인 용어 — 하나도 바꾸지 않습니다

`Case` · `Evidence` · `Slot` · `Channel` · `Plan` · `Artifact` · `PII Token` · `KB` → [00-glossary.md](08-14-glossary.md)

### `Channel` 개명을 검토했다가 철회했습니다

`Channel`(경유 서비스)을 `payment-service`로 바꾸는 안이 나왔습니다. 영어 `channel`이 통신 경로·알림 채널로 읽혀 뜻이 전달되지 않는다는 것이 이유였습니다. **이 지적 자체는 사실이지만 대안이 더 나빠서 철회했습니다** → [ADR-014](../../decisions/014-module-names.md).

**결정적인 이유는 8유형 중 둘이 결제 서비스가 아니라는 것입니다.** `CH-facetoface`(대면편취)는 **어떤 서비스도 거치지 않고 현금을 사람에게 직접 건넨** 유형이고, `CH-giftcard`(상품권 핀번호 전달)도 결제 서비스로 부르기 어렵습니다. `payment-service`라고 부르면 이 둘이 이름 밖으로 밀려납니다. `CH-facetoface`는 2023년 11월부터 환급 대상이 됐고 계좌이체를 막자 사기범들이 옮겨간 수법이라 비중이 작지 않습니다 → [03](../backend/08-14-channel-matrix.md).

그 외에 **반만 바꾸면 안 바꾸느니만 못하다**는 문제도 있었습니다. ID 접두 `CH-`를 남긴 채 용어만 바꾸면 `payment_service_id = "CH-bank"` 같은 상태가 되어, "왜 payment_service인데 값이 CH로 시작하나"라는 질문이 새로 생깁니다.

### 대신 정의문에서 오해를 없앴습니다

[00-glossary.md](08-14-glossary.md)의 「경유 서비스 (Channel)」 정의에 두 문장이 추가됐습니다.

- **통신 경로(전화·문자·앱)를 뜻하지 않습니다.** 사기범이 어떻게 연락했는지가 아니라 돈이 어디로 갔는지입니다.
- `CH-facetoface`처럼 **금융 서비스를 거치지 않은 유형도 포함**하므로 「결제 서비스」로 좁혀 읽지 마세요.

이 과정에서 기존 정의문의 "돈이 지나간 **금융 서비스** 유형"이라는 표현 자체가 부정확했다는 것이 드러났습니다 — 대면편취를 담지 못합니다. **이름을 바꾸는 대신 정의를 고쳤습니다.**

### `channel`이 박혀 있는 곳 (참고)

개명을 검토할 때 조사한 목록입니다. 나중에 같은 논의가 나오면 이 범위를 먼저 보세요.

| 어디 | 무엇 |
| --- | --- |
| ID 접두 | `CH-bank` · `CH-easypay` |
| 칼럼명 | `case_channel.channel_id` · `kb_entry.channel_id` · `org.channel_id` |
| 테이블·인덱스 | `case_channel` · `idx_case_channel_case` · `idx_org_channel` |
| **슬롯 키** | `channel` (T1 슬롯) |
| 감사 로그 페이로드 | `{"slot_key":"channel"}` |
| 파일명 | `spec/backend/08-14-channel-matrix.md` |

**슬롯 키 `channel`이 가장 무겁습니다.** `kb_entry.body`의 `requires_slots`가 이 이름을 참조하고, KB 적재 검증이 슬롯 이름 목록과 대조해 없으면 릴리스를 거부합니다 → [09](../backend/08-16-data-model.md) §11. 이름을 바꾸면 지식베이스 데이터와 코드가 동시에 움직여야 하고, 어긋나는 순간 KB 릴리스가 막힙니다.

> **`Artifact`는 뜻이 겹칩니다.** 소프트웨어에서 빌드 산출물이라는 뜻으로 굳어져 있어, 사건접수번호·접수 문자·접수증을 가리킨다는 것이 이름만으로는 전달되지 않습니다. `proof`·`receipt`를 검토했으나 이미 `artifact` 테이블([09](../backend/08-16-data-model.md) §7)과 여러 문서에 박혀 있어 **현행 유지**로 정했습니다 → [ADR-014](../../decisions/014-module-names.md).
>
> 처음 듣는 사람에게 설명할 때는 **"절차를 실제로 마치면 남는 것 — 접수번호·접수증"**이라고 풉니다.

### 약어

`KB`는 knowledge base입니다. `kb-finder`·`kb-collector`·`kb-reviewer`가 이 접두를 씁니다. 저장소 전체가 이미 `KB`를 쓰고 있어 그대로 두되, **처음 보는 사람이 있는 자리에서는 한 번 풀어서 말합니다.**

---

## 08-api.md 「서버 구성 요소」와의 대응

[08-api.md](08-14-api.md)의 표는 이 문서보다 먼저 작성됐습니다. 대응은 이렇습니다.

| 08-api.md 표기 | 이 문서 |
| --- | --- |
| API Gateway | **모듈이 아닙니다** — 진입 경로라서 이 목록에 넣지 않았습니다 |
| Ingest 서비스 | `transcriber` |
| 2차 PII 스크러버 | `pii-tokenizer` |
| 분석 오케스트레이터 | **셋으로 갈립니다** — `case-reader`(F-04) · `slot-extractor`(F-05b) · `planner`(F-05) |
| 슬롯 체커 | `slot-checker` |
| Case Store | **모듈이 아닙니다** — 저장소라서 넣지 않았습니다 → [09](../backend/08-16-data-model.md) |
| 감사 로그 | `audit-logger` |

**「분석 오케스트레이터」를 나누는 이유**는 하나로 묶인 셋이 하는 일도 실패 처리도 다르기 때문입니다. `case-reader`의 실패는 화면 배지가 안 뜨는 것으로 끝나지만, `planner`의 실패는 사용자가 절차를 못 받는 것입니다. `slot-extractor`의 실패는 [10](../backend/08-16-errors.md) §4가 정한 대로 **에러가 아니라 질문 경로로 흘러갑니다.** 한 이름으로 부르면 이 셋을 구분해 말할 수 없습니다.

---

## 기존 문서 반영은 별도 작업입니다

이 문서를 작성한 시점에 `spec/`의 다른 문서들은 아직 「Ingest 서비스」·「2차 PII 스크러버」 같은 옛 표기를 쓰고 있었습니다. 같은 파일들을 여러 작업이 동시에 고치고 있어 일괄 반영을 미뤘습니다.

**2026-08-16 반영이 지시됐습니다.** 도메인 용어는 하나도 바뀌지 않았으므로 대상은 **모듈 이름뿐**이고, 각 문서의 담당이 자기 파일만 고칩니다.

| 무엇 | 어디 |
| --- | --- |
| 「서버 구성 요소」 표를 새 이름으로 | [08](08-14-api.md) |
| 「2차 PII 스크러버」 → `pii-tokenizer` | [04](08-14-pii-boundary.md) [08](08-14-api.md) [10](../backend/08-16-errors.md) |
| 층 2 모듈 이름을 절 제목에 대응 | [11](../backend/08-16-chat-context.md) §2 §3 §4 §6 §8 |
| 이 문서 링크 추가 | [00-glossary.md](08-14-glossary.md) |

**`spec/backend/08-16-errors.md`는 반영을 마쳤습니다** — 재시도를 판단하는 자리를 `retry-checker`로 부른다고 명시했습니다.

## TODO

- ~~TODO(미정): 화면·프론트 구성의 명칭~~ → **2026-08-17 층 C로 확정** ([ADR-023](../../decisions/023-frontend-module-names.md)).
  화면 자체의 명칭(`S-xx`)은 [화면 설계](../frontend/08-14-screens.md)가 정합니다 — 여기는 **동작 단위**만 다룹니다.
- ~~TODO(미정): `chat-receiver`·`chat-publisher` 등재~~ → **2026-08-18 층 2에 등재 완료.**
  [ADR-022](../../decisions/022-chat-turn-boundaries.md)의 결정을 옮겨 적은 것이라 새 판단은 없습니다.
- TODO(미정): **`chat-receiver`가 얇게 유지되는지 볼 방법.** 지금은 금지 조항뿐이고 강제하는 검사기가 없습니다
  → [ADR-022](../../decisions/022-chat-turn-boundaries.md) 「남은 것」. `work-handler`도 같은 상태입니다.
- TODO(미정): 리마인더 발송과 파기 실행을 맡을 이름. 층 4에 자리가 비어 있습니다 —
  선행 조건이던 재진입·연락처([ADR-021](../../decisions/021-reentry-and-identity.md))와
  상시 배치([ADR-016](../../decisions/016-retention-and-datastore.md)의 `pg_cron`)가 **둘 다 풀렸습니다.**

### 상태·등급의 호칭은 정하지 않기로 했습니다

`plan_step.state` 다섯 가지, 완료 판정 `L1`·`L2`·`L3`, 슬롯 티어 `T0`·`T1`·`T2`는 **이미 각 문서가 일관된 한국어 표기를 쓰고 있어 새로 정할 것이 없었습니다.** 다만 조사 중에 두 가지가 나왔습니다.

- **「미확인」이 서로 다른 두 대상에 쓰이고 있습니다.** [05](../backend/08-14-completion-hook.md)에서는 **단계** 상태(`unconfirmed` — 행동은 했다는데 증빙이 없는 것)이고, [02](../backend/08-14-slot-tiering.md)·[06](../frontend/08-14-screens.md)에서는 **슬롯** 배지(아직 모르는 정보)입니다. 둘 다 화면에 배지로 뜨므로 **화면 문구를 정할 때 갈라야 합니다.**
- **[05](../backend/08-14-completion-hook.md)의 상태 그림에 `skipped`가 빠져 있습니다.** [09](../backend/08-16-data-model.md) §6의 `ENUM`은 다섯인데 그림에는 넷만 있습니다.
