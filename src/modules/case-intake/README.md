# case-intake

**사건을 열고 파일 접수 자리를 냅니다.** 파일 자체는 다루지 않습니다 — 종류와 크기만 보고
업로드 자리를 내주며, 내용을 읽는 것은 `transcriber` 의 일입니다.

| | |
| --- | --- |
| 계약의 정본 | [08-api.md](../../../spec/common/08-14-api.md) §3.1 §3.2 §1.3 · [09-data-model.md](../../../spec/backend/08-16-data-model.md) §2 §3 |
| 이름의 정본 | [12-module-names.md](../../../spec/common/08-16-module-names.md) 「층 1」 |
| 책임의 정본 | [모듈 경계](../../../spec/common/08-16-module-boundaries.md) |
| 근거 | [ADR-016](../../../decisions/016-retention-and-datastore.md) · [ADR-026](../../../decisions/026-raw-upload-retention.md) · [ADR-028](../../../decisions/028-runtime-and-module-shape.md) |

## 절대 하지 않는 것

- **플랜을 만들지 않습니다.** [08-api.md](../../../spec/common/08-14-api.md) §3.1 의 응답에
  T0 공통 안전 절차가 딸려 나오지만, 그 절차에는 **KB 인용이 붙어야** 합니다.
  인용을 붙이는 것은 `planner` 의 일이고, 여기서 붙이면 근거 없는 절차가 이 모듈에서 나갑니다
  (`CLAUDE.md` 불변 규칙 1). **라우트가 둘을 합쳐 응답을 만듭니다.**
- **파일 내용을 보지 않습니다.** 업로드는 presigned 방식이라 파일이 API 함수를 통과하지
  않습니다. 이 모듈에 원문이 닿으면 `pii-tokenizer` 경계 밖에 텍스트가 생깁니다.
- **원문 전사를 저장하지 않습니다.** `evidence.transcript_masked` 에는 토큰화를 통과한
  문자열만 들어갑니다 → [09-data-model.md](../../../spec/backend/08-16-data-model.md) §3.
- **식별자와 업로드 자리를 직접 만들지 않습니다.** 둘 다 인터페이스로 받습니다 —
  객체 저장소 제품이 아직 미정이고([ARCHITECTURE.md](../../../ARCHITECTURE.md) §10),
  시험에서 값을 고정할 수 있어야 합니다.
- **날짜를 직접 세지 않습니다.** 보관 기한 계산은 `date-checker` 의 `addDays` 를 받아 씁니다.

## 파기 예정일을 생성 시점에 채웁니다

`purge_after` 는 **마지막 활동일부터 180일**입니다 ([ADR-016](../../../decisions/016-retention-and-datastore.md)).
사건을 열 때 채우고, **활동이 있을 때마다 다시 밉니다** — 파일을 접수할 때와 업로드 완료
통지를 받을 때가 그 자리입니다.

**생성일 기준이 아닌 이유**는 공고 후에 피해를 알고 들어온 피해자 때문입니다. 그 사람은
진입 시점에 이미 두 달이 지나 있어, 생성일 고정이면 며칠 만에 사건이 만료됩니다.

> **이 값 하나가 사건에 딸린 모든 것의 수명입니다** — 토큰화된 상태, 업로드 원본,
> 복원 매핑 암호문이 같은 날 함께 사라집니다. 수명이 다른 층을 두면 어느 하나만 남는
> 상태가 생기고, 그게 무엇인지 아무도 추적하지 못합니다.

## 사건당 상한을 여기서 잽니다

[08-api.md](../../../spec/common/08-14-api.md) §1.3 이 **사건당 파일 30개 · 합계 300MB** 로
정했고, 넘으면 `429`(`RATE_LIMITED`)입니다.

**시간창 제한(분당·시간당)은 게이트웨이가 재지만 이것은 여기서 잽니다.** 사건이 지금까지
몇 개를 받았는지는 저장소를 봐야 알 수 있고, 그 조회를 하는 곳이 이 모듈입니다.

**막을 때는 업로드 자리를 내주기 전에 막습니다.** 자리를 먼저 발급하고 거절하면 아무도
쓰지 않는 서명 URL 이 남습니다.

## 쓰는 법

```ts
import { createCaseIntake } from '@/modules/case-intake'
import { createDateChecker } from '@/modules/date-checker'

const dates = createDateChecker({ holidays, clock })

const caseIntake = createCaseIntake({
  ids,        // ULID 발급
  clock,      // 서버 시계
  dates,      // date-checker — addDays 만 씁니다
  store,      // 사건 저장소
  uploads,    // presigned URL 발급
})

const opened = await caseIntake.open({ track: 'victim' })
// { caseId, track, status: 'intake', openedAt, purgeAfter }
// ↑ 플랜이 없습니다. 라우트가 planner 를 불러 붙입니다

const slot = await caseIntake.acceptEvidence(opened.caseId, {
  kind: 'audio',
  mimeType: 'audio/m4a',
  byteSize: 4_210_553,
})
// 클라이언트가 slot.uploadUrl 로 직접 PUT 한 뒤
await caseIntake.completeUpload(opened.caseId, slot.evidenceId)   // → 'processing'
```

## 밖에서 넣어야 하는 것

| 무엇 | 어디서 | 비고 |
| --- | --- | --- |
| `IdSource` | ULID 구현 | ⬜ 라이브러리 미선정 |
| `Clock` | 서버 시계 (`Asia/Seoul`) | 클라이언트 시계를 믿지 않습니다 |
| `DateShifter` | `date-checker` 의 `addDays` | 그대로 넘기면 됩니다 |
| `CaseStore` | 데이터베이스 | ⬜ Supabase 접속 정보 미정 |
| `UploadSlotSource` | 객체 저장소 | ⬜ 제품 미정 → [ARCHITECTURE.md](../../../ARCHITECTURE.md) §10 |

## MIME 값을 목록으로 막지 않습니다

`kind`(`audio`·`image`·`text`)는 목록으로 검증하지만 `mime_type` 은 **비었는지만** 봅니다.

같은 녹음을 기기마다 다른 이름으로 보냅니다 — `audio/m4a` · `audio/x-m4a` · `audio/mp4` 가
전부 같은 파일입니다. 목록으로 막으면 정상 파일이 거부되는데, **피해 직후의 사용자에게
그건 상한을 넘기는 것보다 나쁩니다.** 실제 판독 가능 여부는 `transcriber` 가 파일을 열어
보고 판단하고, 실패하면 `INGEST_FAILED` 로 돌아옵니다.

## 아직 아닌 것

- ⬜ **업로드 자리 발급 어댑터가 없습니다.** 객체 저장소 제품이 미정입니다.
- ⬜ **`org_name_raw` 를 받지 않습니다.** 기관 표기는 `case_channel` 에 들어가는데
  ([09-data-model.md](../../../spec/backend/08-16-data-model.md) §4), 그 행을 만드는 것은
  슬롯이 채워진 뒤라 이 모듈의 일이 아닙니다.
- ⬜ **`session_key_id` 를 채우지 않습니다.** 세션키는 브라우저의 `key-handler` 가 만들고,
  서버는 식별자만 받아 적습니다. 그 경로가 아직 없습니다.

## 판단이 필요했던 자리

| 무엇 | 어떻게 | 왜 |
| --- | --- | --- |
| **T0 플랜을 여기서 붙일지** | **붙이지 않는다** | 절차에는 KB 인용이 붙어야 하고 인용은 `planner` 의 일입니다. 여기서 붙이면 근거 없는 절차가 나가는 경로가 하나 생깁니다 |
| **30개·300MB 를 어디서 재나** | **여기서 잰다** | 사건별 누적이라 게이트웨이가 알 수 없습니다. 저장소를 보는 곳이 여기뿐입니다 |
| **상한 초과에 어떤 예외를** | **`RateLimitedError`** | [08-api.md](../../../spec/common/08-14-api.md) §1.3 이 `429`·`RATE_LIMITED` 로 정해 뒀습니다. 누적 한도지만 코드는 그쪽입니다 |
| **자리 발급과 한도 검사 순서** | **검사가 먼저** | 발급 후 거절하면 아무도 안 쓰는 서명 URL 이 남습니다 |
| **MIME 값을 목록으로 막을지** | **막지 않는다** | 같은 파일이 기기마다 다른 이름으로 옵니다. 정상 파일 거부가 상한 초과보다 나쁩니다 |
| **보관 기한 날짜 셈을 어디서** | **`date-checker` 에 맡긴다** | 여기서 `Date` 로 더하면 서버 위치에 따라 하루가 어긋납니다. 날짜 산술은 한 모듈에 모읍니다 |
| **접수·완료 통지에 파기일을 미룰지** | **민다** | 「마지막 활동일 기준」이라 활동이 무엇인지 정해야 하는데, 파일을 올리는 것은 명백히 활동입니다 |
