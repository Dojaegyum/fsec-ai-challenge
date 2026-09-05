# RFC-002. 매뉴얼 KB를 파일로 쓰고, 검수를 거쳐 적재한다

- 상태: **시행 중**
- 제정: 2026-08-18
- 최종 개정: 2026-09-04
- 근거: [ADR-012](../decisions/012-kb-collection.md) — 절차 지식을 버전드 KB로 분리하고 사람이 검수한다

## 무엇에 대한 규약인가

**매뉴얼(KB 항목) 한 개를 사람이 쓸 때** 펼칩니다.

**무엇을 쓰는가는 여기가 아닙니다.** 필드 구조·허용값·적재 거부 조건은
[09-data-model.md](../spec/backend/08-16-data-model.md) §11.4가 정본입니다.
이 문서는 **그 스키마를 사람이 채울 때 지키는 것**을 정합니다 — 어디에 두고, 어느 크기로 자르고,
무슨 순서로 쓰고, 적재 전에 무엇을 눈으로 봐야 하는가.

## 원본은 파일이고, DB는 사본입니다

[09-data-model.md](../spec/backend/08-16-data-model.md) §11의 제목이 이미 **「읽기 전용 사본」**입니다.
사본이라고 정한 이상 원본이 어딘가 있어야 하는데, 그 자리가 없었습니다. **`src/kb/`가 그 자리입니다.**

**`kb_entry`·`org`에 직접 INSERT 하지 않습니다.** 파일을 고치고, 검수하고, 적재기가 넣습니다.

| 왜 파일인가 | |
| --- | --- |
| **검수 대상이 diff여야 합니다** | 사람 검수는 생략 불가인데([07](../spec/backend/08-14-kb-operations.md)), DB 행을 눈으로 검수할 방법이 없습니다 |
| **릴리스가 재현돼야 합니다** | 어느 버전에 무엇이 들어갔는지가 커밋에 남습니다 |
| **DB가 날아가도 복원됩니다** | 손으로 쓴 아홉 유형 × 수십 단계를 다시 쓰는 일은 없어야 합니다 |
| **제도 변경이 코드 배포와 분리됩니다** | 파일만 고쳐 릴리스합니다 — 이게 [F-11](../spec/common/08-14-features.md)의 취지입니다 |

## 어디에 어떤 이름으로 두나

```
src/kb/
  README.md              적재기 사용법 (검사기가 읽지 않는 자리 — src/ 는 스캔 대상 밖)
  common.json            track=victim · channel_id NULL — 전 유형 공통 (112 신고 등)
  frozen-account.json    track=frozen_account · channel_id NULL — 통장묶기 (2026-09-04 · ADR-066)
  ch-bank.json           CH-bank
  ch-neobank.json        CH-neobank
  ch-easypay.json        CH-easypay
  ch-crypto.json         CH-crypto
  ch-facetoface.json     CH-facetoface
  ch-giftcard.json       CH-giftcard
  ch-carrier.json        CH-carrier
  ch-card.json           CH-card — 아홉째 유형 (ADR-055)
  org.json               기관 마스터 (§11.1) → `org`
  org-public.json        경유 서비스가 아닌 공공·수사기관 이름 → `org_public` (마이그레이션 0007 · research/05 U-35)
```

- **파일명은 `CH-xxx`를 소문자로 옮긴 것**입니다. `CH-bank` → `ch-bank.json`.
- **`CH-securities` 는 파일이 없습니다 — 의도입니다.** 절차가 표준과 같고 창구만 다른데, 창구는 `org.json` 이
  갖습니다. 유형에 파일이 없는 것은 「공통이 그대로 맞다」는 판단이고, 그 판단은 `src/kb/README.md` 에 적어 둡니다 —
  적어 두지 않으면 다음 사람이 「빠졌다」로 읽습니다 (2026-09-04 실재와 대조).
- **`src/` 안이라 `MM-dd-{slug}` 규약이 적용되지 않습니다** — 코드 폴더입니다 ([RFC-001](001-repo-structure.md) 「파일명 규약」).
- **파일 하나 = 조회 우선순위([§11.2](../spec/backend/08-16-data-model.md#112-조회-우선순위--기관별이-유형-기본을-덮어씁니다))의 한 칸**입니다.
  「이 유형에 무엇이 있나」를 파일 하나로 봅니다.
- 기관 전용 항목(`org_id`가 있는 것)은 **그 기관이 속한 유형 파일**에 둡니다. 기관별 파일을 만들지 않습니다.

파일 하나의 형태는 항목 배열입니다.

```jsonc
// src/kb/ch-bank.json
{
  "_note": "사람이 보는 메모 — 적재기가 읽지 않는다 (아래 「적재기가 읽는 것과 무시하는 것」)",
  "channel_id": "CH-bank",     // 이 파일의 모든 항목에 적용. 항목마다 반복하지 않는다
  "track": "victim",
  "entries": [ /* 항목들 */ ]
}
```

## 무엇을 파일에 쓰고 무엇을 쓰지 않나

**버전은 파일에 쓰지 않습니다.** 릴리스가 찍습니다 — 파일에 박으면 항목을 고칠 때마다
버전 문자열까지 손대야 하고, 그걸 빠뜨리면 릴리스가 조용히 어긋납니다.

| 사람이 파일에 쓴다 | 적재기가 찍는다 |
| --- | --- |
| `kb_entry_id` · `step_key` · `step_seq` | **`kb_version`** |
| `channel_id` · `org_id` · `track` | **`released_at`** |
| `title` · `body` | |
| `legal_basis` · `source_url` | |
| `effective_from` · `effective_until` | |
| `verified_at` — **사람이 근거를 눈으로 본 날** | |

### 적재기가 읽는 것과 무시하는 것

적재는 `npm run kb:load -- --version <버전>` 입니다 — `src/scripts/load-kb.ts` 가 파일과 DB 를 만지고,
**판정은 `src/lib/kb-load.ts`** 가 합니다(그래야 `npm test` 가 봅니다). 사용법은 `src/kb/README.md`.
파일에는 스키마 밖의 것도 적을 수 있고, 적재기는 아래 규칙으로 읽습니다.

| 규칙 | 무엇 |
| --- | --- |
| **`_` 로 시작하는 칸은 사람이 보는 메모입니다** | 파일 머리의 `_note`, 항목의 `_todo`, `body` 안의 `_*` — **적재기가 무시하고 DB 로 옮기지 않습니다**(`kb-load.ts` 의 `strip`). 근거를 아직 못 본 자리, 다음 사람에게 남기는 말을 여기 적습니다. 검증 대상도 아닙니다 |
| **`body.actor` — 이 단계를 누가 하나** | `victim`·`police`·`bank`·`prosecutor`·`carrier`·`issuer`·`agency` 일곱 중 하나. **비면 적재 거부** — 기본값을 두면 기관이 할 일이 「당신이 해야 할 것」으로 그려집니다. ⚠️ §11.4 는 「주체는 칼럼」이라 적었지만 `kb_entry` 에 `actor` 칼럼이 없어(§11.1) `planner` 가 `body.actor` 를 읽습니다 — **돌아가는 코드가 이 규칙이고**, 정본 사이의 모순은 data-model 쪽에서 정리합니다 |
| **`body.action` — 그 단계에서 사용자가 하는 일 하나** | 아래 여덟 중 하나. 화면이 어느 작업 패널을 열지 **이것으로만** 정합니다(API §3.6 · ADR-024) — `actor`·`channel`·`required_artifact` 로 추론하지 않습니다. **비면 적재 거부** — 없으면 그 단계는 워크스페이스에 아무것도 안 그립니다. `steps[].action` 의 첫 줄로 대신할 수 없습니다 — 서류 제출은 `download` 로 시작해 `visit` 로 끝나고, 핵심은 제출입니다 |
| **`body.steps[].action` — 줄마다의 행동** | `call`·`visit`·`write`·`upload`·`download`·`confirm`·`wait`·`read` 여덟([§11.4.6](../spec/backend/08-16-data-model.md#1146-stepsaction--사용자가-무슨-행동을-하나)). `channel` 은 `call`·`visit` 에서만 값을 가집니다(§11.4.5 「행동·채널 어긋남」) |
| **`deadline.owner` 가 `deadline.kind` 를 정합니다** | `user`·`bank`·`agency`. `user` 만 사용자 기한(`primary`·`grace`)이고 나머지는 안내용 `info` 입니다([§11.4.2](../spec/backend/08-16-data-model.md#1142-기한의-주인을-명시합니다)). 없으면 통장묶기 5영업일이 사용자 기한으로 나갑니다 |

**검증에 하나라도 걸리면 파일 전체를 거부합니다.** 절반만 실으면 절반이 최신이고 절반이 옛것입니다.

## 한 항목의 크기 — 어디서 자르나

**기준은 하나입니다 — 완료 증거(`required_artifact`)가 하나 나오면 항목 하나입니다.**
완료 판정이 증거로 이뤄지므로([05](../spec/backend/08-14-completion-hook.md)), 증거 단위가 곧 절차 단위입니다.

| 상황 | 어떻게 |
| --- | --- |
| 증거가 **둘** 나온다 | **둘로 자릅니다.** 접수번호와 접수증은 다른 단계입니다 |
| 증거가 **없는 안내** | **앞 단계에 붙입니다.** 독립 항목으로 만들지 않습니다 — 화면에 체크할 것 없는 칸이 생깁니다 |
| **창구만 다르고 결과가 같다** | **한 항목의 `steps[]` 두 줄**입니다. 앱으로 하든 영업점에서 하든 나오는 증거가 같습니다 |
| 기관마다 **방법**이 다르다 | 유형 기본 항목 하나 + 기관 전용 항목으로 덮습니다 ([§11.2](../spec/backend/08-16-data-model.md#112-조회-우선순위--기관별이-유형-기본을-덮어씁니다)) |
| 시행일 전후로 **답이 다르다** | **같은 `step_key`로 항목 둘**, `effective_from`/`effective_until`로 가릅니다 ([§11.3](../spec/backend/08-16-data-model.md#113-시행일-분기가-여기서-일어납니다)) |

**자르는 쪽으로 기울지 마세요.** 단계가 잘게 쪼개지면 화면이 할 일 목록처럼 보이고,
「몇 달을 대신 관리한다」는 약속이 체크리스트로 축소됩니다 →
[서비스 골자](../spec/common/08-17-service-concept.md).

## 쓰는 순서 — 근거가 먼저입니다

**본문부터 쓰면 지어내게 됩니다.** 순서를 뒤집지 마세요.

1. **근거를 찾는다** — `source_url` · `legal_basis` · `effective_from`.
   못 찾으면 **거기서 멈춥니다.** 항목을 만들지 않습니다.
2. **사실을 옮긴다** — 기한 숫자, 기한의 주인(`deadline.owner`), 필요한 서류.
   근거에 없는 숫자는 쓰지 않습니다.
3. **식별자를 정한다** — `step_key` · `kb_entry_id` · `step_seq`.
4. **본문을 쓴다** — `title` · `body.summary` · `body.steps[]`.
5. **`verified_at`을 오늘로 적는다** — 1을 실제로 눈으로 본 날입니다.

## 적재 전 자기점검 — 검사기가 못 잡는 것

[§11.4.5](../spec/backend/08-16-data-model.md#1145-적재-시-검증)의 검증은 **형식**만 봅니다.
아래는 **사람만 볼 수 있는 것**이고, 이걸 놓치면 형식은 통과한 채 틀린 안내가 나갑니다.

| 보는 것 | 무엇이 틀리나 |
| --- | --- |
| **근거가 살아 있나** | 링크가 죽었거나 페이지가 개편돼 다른 내용이 됐습니다 |
| **그 근거가 이 절차를 말하나** | 링크는 맞는데 본문이 다른 조문을 말합니다 — 가장 자주 나는 실수입니다 |
| **공포일과 시행일을 헷갈리지 않았나** | `effective_from`은 **시행일**입니다. 조문마다 다를 수 있습니다 ([07](../spec/backend/08-14-kb-operations.md)) |
| **기한 숫자가 근거에 있나** | 3영업일·14일·2개월을 기억으로 쓰지 않습니다 |
| **`deadline.owner`가 맞나** | 기관 기한을 사용자 기한으로 적으면 불필요한 불안을 줍니다 ([§11.4.2](../spec/backend/08-16-data-model.md#1142-기한의-주인을-명시합니다)) |
| **`caveat`가 필요한 자리인가** | 환급·자율배상·사각지대에서 `caveat`가 비어 있으면 기대치를 부풀립니다 |
| **`action`이 실제 행동과 맞나** | `wait`으로 적었는데 사용자 기한이 붙어 있는 단계가 있습니다 ([§11.4.6](../spec/backend/08-16-data-model.md#1146-stepsaction--사용자가-무슨-행동을-하나)) |
| **`action: read`를 레일 `step_key`에 얹으면 그 국면이 「해당 없음」으로 그려진다** | `freeze-request`·`relief-apply`·`relief-documents`·`debt-extinction-notice`에 걸린 항목이 전부 `read`면 S-07 레일이 그 칸을 「해당 없음」으로 흐립니다([S-07](../spec/frontend/08-14-screens.md)). 「이 유형에는 없습니다」류 덮개([ADR-058](../decisions/058-crypto-not-applicable-overrides.md))에는 맞는 그림이지만, **진짜 정보 단계**(사각지대 고지처럼 읽을 내용이 있는 `read`)를 그 자리에 얹으면 있는 정보가 「해당 없음」이 됩니다 |

## 하지 않는 것

- **`step_key`를 바꾸지 않습니다.** `plan_step`이 그 키로 붙어 있어, 바꾸면 **이미 열린 사건의 진행이 끊깁니다.**
  단계를 없앨 때도 키를 지우지 말고 `effective_until`로 닫습니다.
- **번호·주소를 본문에 쓰지 않습니다** ([§11.4.1](../spec/backend/08-16-data-model.md#1141-연락처를-본문에-직접-쓰지-않습니다) · [§11.4.7](../spec/backend/08-16-data-model.md#1147-url도-본문에-직접-쓰지-않습니다)). 검증이 잡지만, 애초에 쓰지 않습니다.
- **근거 없는 수치를 채우지 않습니다.** `TODO(근거 필요)`로 두고 사람에게 묻습니다.
- **「받을 수 있습니다」로 쓰지 않습니다.** 진단까지가 우리 몫입니다 (`CLAUDE.md` 불변 규칙 8).
- **LLM에게 절차를 물어 채우지 않습니다.** 모델은 **근거를 찾는 데**까지 쓰고, 답을 옮겨 적지 않습니다 (불변 규칙 1).
- **통화 스크립트 문안을 매뉴얼에 넣지 않습니다.** KB 필드가 아직 없고, 스크립트는
  [F-07](../spec/common/08-14-features.md)이 사건 맥락으로 생성합니다.
- **검수 없이 적재하지 않습니다.** 파일을 고친 사람과 검수한 사람이 같아도, 적재는 별도 단계입니다.
- **`archived/`처럼 파일을 지우지 않습니다.** 폐지된 항목은 `effective_until`로 닫고 파일에 남깁니다 —
  과거 시점 재현이 KB의 존재 이유입니다.

## 수집 파이프라인과 어디서 만나나

**[ADR-012](../decisions/012-kb-collection.md)와 어긋나 보이지만 어긋나지 않습니다.**
파이프라인은 세 구간이고, 파일은 마지막 구간에 있습니다.

```
1. 수집   source_snapshot   (2026-09-06 배선 · ADR-072)   자동 · 하루 1회      ← ADR-012 가 정한 것
2. 검수   source_change     사람 — 무엇이 바뀌었나
3. 반영   src/kb/*.json     사람 — 승인된 변경을 파일에 옮긴다   ← 여기가 이 규약
   릴리스 kb_entry          적재기 — kb_version 을 찍는다
```

**ADR-012가 버린 것은 「수집한 원문을 파일에 두는 것」입니다.** `source_snapshot`은 서버리스가
자동으로 쓰는 것이라 저장소에 커밋하는 경로가 필요하고, 검수 상태(`pending`/`approved`)를
파일로 관리하기 어렵습니다. **손으로 쓰는 매뉴얼에는 그 문제가 없습니다** — 사람이 커밋합니다.

**파이프라인이 `kb_entry`를 직접 쓰지 않습니다.** 승인이 곧 반영이 되면 무엇이 어떻게 바뀌었는지가
어디에도 남지 않고, 「사람 검수 생략 불가」([07](../spec/backend/08-14-kb-operations.md))가
승인 버튼 한 번으로 축소됩니다. **검수의 산출물은 diff입니다.**

## genlab 매뉴얼 템플릿에서 가져온 것

기존 CS 매뉴얼 구조를 참고했으나 **스키마는 우리 것을 유지합니다.**

| 가져온 발상 | 우리 쪽 자리 |
| --- | --- |
| `step_manual[].category` — 매뉴얼을 갈래로 나눔 | `channel_id` · `track` (파일 경계) |
| `blueprints[].graph.slots` — 채워야 할 값 | `body.requires_slots` ([02](../spec/backend/08-14-slot-tiering.md)) |
| `blueprints[].graph.edges` — 선행 관계 | `body.after` |
| `response_template` — 상황별 문안 | **가져오지 않았습니다.** 문안은 KB가 아니라 F-07이 만듭니다 |

**우리에게만 있는 것**은 근거 셋(`legal_basis`·`source_url`·`effective_from`)과 시행일 분기입니다.
CS 매뉴얼은 회사가 정하면 그만이지만, **절차 지식은 제도가 정하고 시점에 따라 달라집니다.**

## 이 규약을 바꾸려면

1. 이 문서를 고칩니다(현행 규약이므로).
2. 아래 「개정 이력」에 한 줄 적습니다. 왜 바꿨는지는 커밋 메시지에 남습니다.
3. 영향받는 곳을 같이 고칩니다 — [RFC-001](001-repo-structure.md) 폴더 지도, `src/kb/README.md`.

**필드 구조를 바꾸는 것은 여기가 아닙니다** — [09-data-model.md](../spec/backend/08-16-data-model.md) §11.4이고,
DDL이 바뀌면 마이그레이션이 함께 옵니다 ([ADR-019](../decisions/019-module-code-sync.md)).

## 개정 이력

| 날짜 | 무엇 | 근거 |
| --- | --- | --- |
| 2026-08-18 | 제정 — KB 원본을 `src/kb/`에 JSON으로 두고, 유형 하나를 파일 하나로 가름 | |
| 2026-08-18 | 수집 파이프라인과의 경계를 명시 — 파이프라인은 `kb_entry`를 직접 쓰지 않는다 | [ADR-012](../decisions/012-kb-collection.md) |
| 2026-09-01 | 자기점검에 한 줄 — 레일 `step_key`에 얹은 `action: read`는 S-07이 「해당 없음」으로 그린다 | [ADR-058](../decisions/058-crypto-not-applicable-overrides.md) |
| 2026-09-04 | 파일 지도를 실재에 맞춤 — `ch-card`·`org-public` 추가, `ch-securities` 는 의도적 부재로 표기, `frozen-account` 신설 반영. 「적재기가 읽는 것과 무시하는 것」 신설 — `_` 메모 칸, `body.actor`·`body.action`·`steps[].action`·`deadline.owner` 허용값. `kb-load.ts` 가 이 규약을 근거로 인용하는데 본문이 없었습니다 | [ADR-055](../decisions/055-channel-card.md) · [ADR-066](../decisions/066-track-fixed-new-case.md) · [문서 손질 백로그](../docs/plans/08-26-doc-gardening.md) |
