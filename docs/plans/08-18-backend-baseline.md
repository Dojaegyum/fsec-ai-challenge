# 백엔드 착수 기준선 — 무엇이 서 있고, 무엇이 막혀 있나

> **은퇴(2026-09-04)** — 착수 전 순서·의존을 답하던 문서인데 착수 단계 ①~⑥ 에 전부 코드가 생기고 §2 「막힌 것」 다섯 중 셋이 닫혔습니다(2026-09-04 감사). 남은 둘(Vercel Cron 플랜 상한 · 메일 키·주기·문구)은 각자 집이 있습니다. 이제 볼 곳 — 미결은 [ARCHITECTURE §10](../../ARCHITECTURE.md) · 모듈 목록은 [module-names](../../spec/common/08-16-module-names.md)·[RFC-001](../../rfc/001-repo-structure.md) · 크론·메일은 [ADR-025](../../decisions/025-scheduled-jobs.md)·[ADR-021](../../decisions/021-reentry-and-identity.md) 「남은 것」 · 2차 탐지는 [deploy/README](../../deploy/README.md) 「2차 탐지를 켜려면」 · §5 감사 결과는 이 문서 안에 날짜와 함께 남습니다.
> 파일은 링크를 지키려 제자리에 둡니다 — 더 갱신하지 않습니다.

> **이 문서의 자리** — @kth9245 가 백엔드 모듈 초기 설계를 푸시하기 **전에**,
> 이쪽에서 확정해 둔 것과 착수 순서를 적어 둡니다. 설계가 오면 **이 문서 위에 고칩니다.**
>
> **계약을 여기서 새로 만들지 않습니다.** 정본은 `spec/`이고, 여기는 **순서와 의존**만 답합니다 —
> 무엇부터 만들 수 있고, 무엇이 무엇에 막혀 있는가.
>
> **2026-09-04 갱신** — §5 의 여덟 점검을 그날의 `main` 코드에 대해 **실제로 수행해** 근거를 달았고,
> §1-A·§2·§3·§6 을 오늘 기준으로 고쳤습니다. 닫힌 줄은 지우지 않고 ~~취소선~~ 입니다.
> 코드 자리는 `파일:줄` 로 적었습니다 — 줄 번호는 그날의 것이라 밀릴 수 있고, 파일과 함수 이름이 길을 잡아 줍니다.

**역할** — @kth9245 메인 백엔드 · @Dojaegyum 메인 프론트 + 서브 백엔드(계약 결정 권한).
미결 목록은 [ARCHITECTURE.md §10](../../ARCHITECTURE.md)이 정본입니다. 여기서 되풀이하지 않습니다.

## 1. 이미 서 있는 것 — 읽고 시작하면 됩니다

**빈칸을 채우는 작업이 아닙니다.** 아래는 확정된 계약이고, 어기면 제품이 틀립니다.

| 무엇 | 어디 |
| --- | --- |
| 테이블 14개 DDL · 슬롯 이름 · 부산물 | [09-data-model.md](../../spec/backend/08-16-data-model.md) |
| 엔드포인트 10 + 관리자 2 | [08-api.md](../../spec/common/08-14-api.md) |
| 모듈 이름·층·금지 사항 | [12-module-names.md](../../spec/common/08-16-module-names.md) · [13-module-boundaries.md](../../spec/common/08-16-module-boundaries.md) |
| PII 격리 경계 — 무엇이 어디를 넘나 | [04-pii-boundary.md](../../spec/common/08-14-pii-boundary.md) |
| 챗 한 턴의 절차 (7블록 · 모델 1회) | [11-chat-context.md](../../spec/backend/08-16-chat-context.md) |
| 기한 계산 규칙 — 영업일·초일 불산입 | [10-deadline-rules.md](../../spec/common/08-16-deadline-rules.md) |
| 완료 판정 L1·L2·L3 | [05-completion-hook.md](../../spec/backend/08-14-completion-hook.md) |
| 슬롯 티어 T0·T1·T2 | [02-slot-tiering.md](../../spec/backend/08-14-slot-tiering.md) |
| KB 조회 우선순위·시행일 분기 | [09](../../spec/backend/08-16-data-model.md) §11.2 §11.3 |
| KB 원본을 어디에 어떻게 쓰나 | [RFC-002](../../rfc/002-kb-authoring.md) |
| 에러 계약 | [14-errors.md](../../spec/backend/08-16-errors.md) |

**최근 확정돼 아직 못 보셨을 것들**

| 정한 것 | 백엔드에 무엇이 달라지나 |
| --- | --- |
| [ADR-021](../../decisions/021-reentry-and-identity.md) 익명 링크 토큰 | **`User` 테이블을 만들지 않습니다.** 이메일은 알림용 선택 항목입니다 |
| [ADR-024](../../decisions/024-step-action-and-url.md) `steps[].action` 일곱 + `url` | `plan_step.body`에 필드 둘이 늘었습니다. 화면 패널이 이 값으로 갈립니다 |
| [ADR-025](../../decisions/025-scheduled-jobs.md) Vercel Cron | **`pg_cron`을 쓰지 않습니다.** 층 4는 앱 라우트가 깨워집니다 |
| [ADR-026](../../decisions/026-raw-upload-retention.md) 원본 업로드 경계 | 서버에 닿는 파일은 **주민등록번호가 이미 가려진 사본**입니다. 스키마는 그대로 |
| [RFC-002](../../rfc/002-kb-authoring.md) KB 원본은 파일 | **`kb_entry`·`org`에 직접 INSERT 하지 않습니다.** `src/kb/`에서 적재합니다 |

## 1-A. 이미 만들어진 모듈 — 2026-08-18 기준 열 개

> @kth9245 의 초기 설계가 들어왔습니다. 이 절이 그 결과입니다.

| 모듈 | 층 | 만든 이 |
| --- | --- | --- |
| `pii-masker` · `pii-restorer` · `key-handler` | C | @Dojaegyum |
| `retry-checker` · `audit-logger` | 없음 | @kth9245 |
| `citation-checker` · `prompt-builder` · `chat-publisher` | 2 | @kth9245 |
| `slot-checker` · `completion-checker` | 3 | @kth9245 |

**@kth9245 쪽 일곱은 아래 순서의 ④⑤ 에 해당합니다.** 순서를 거슬러 만든 셈인데,
공통점이 **바깥 것 없이 판단만 하는 모듈**이라 KB·저장소·LLM 없이 설 수 있었기 때문입니다.
~~인용할 KB 가 없어 **아직 쓰이지는 않는 상태로 서 있습니다.**~~ → 매뉴얼 릴리스 `2026.08.20`(절차 28건 · 기관 51곳)이
적재돼 챗과 플랜이 실제로 인용합니다([deploy/README](../../deploy/README.md) 「무엇이 올라가 있나」).

시험 192개 · `src/lib/errors.ts` 에 예외 17개 · `src/lib/chat-turn.test.ts` 가 층 2 한 턴을
실제로 이어 봅니다. (2026-08-18 의 수입니다 — 그 뒤 세지 않았습니다.)

**함께 선 정본** — [13-system-prompt.md](../../spec/backend/08-17-system-prompt.md)
(시스템 지시문 전문. `grok-4.5` 로 형식 준수·인젝션 방어를 실측했습니다) ·
[ADR-028](../../decisions/028-runtime-and-module-shape.md)(언어·물리 배치·모듈 모양).

### 2026-09-04 다시 셌습니다 — 폴더 32 · 전부 `index.ts` 가 있습니다

「열 개」는 그날의 수입니다. [12-module-names](../../spec/common/08-16-module-names.md) 의 33 중 `doc-filler` 는
[ADR-064](../../decisions/064-doc-filler-retired.md) 로 폐기돼 폴더가 없고, 나머지 32 는 전부 서 있습니다.
지금 가르는 선은 「만들어졌나」가 아니라 **조립돼 도는가**입니다.

| | 모듈 | 근거 |
| --- | --- | --- |
| **조립돼 도는 서버 모듈 16** | 층 1 `case-intake`·`transcriber`·`pii-tokenizer` · 층 2 `chat-receiver`·`kb-finder`·`prompt-builder`·`citation-checker`·`chat-publisher` · 층 3 `slot-checker`·`planner`·`date-checker`·`completion-checker` · 층 4 `reminder-sender`·`case-purger` · 층 없음 `audit-logger`·`retry-checker` | `src/lib/container.ts:94-125` 가 import 해 조립합니다 |
| **브라우저 층 C 11** | `pii-masker`·`pii-restorer`·`key-handler`·`case-opener`·`poll-checker`·`file-sender`·`transcript-viewer`·`plan-viewer`·`deadline-viewer`·`chat-handler`·`work-handler` | `src/app/`·`src/components/` 가 열하나를 전부 import 합니다 |
| **서 있으나 부르는 곳 없음 5** | 층 1 `case-reader`·`slot-extractor` · 층 3 `doc-builder` · 층 4 `kb-collector`·`kb-reviewer` | `src/flows/`·`container.ts` 에 import 0. 유일한 참조는 `src/lib/questions.ts:39` 의 **타입** import. `container.caseRead` 는 이 모듈이 아니라 `lib/db.ts:1126` 의 DB 읽기입니다 |

### 정본 두 곳이 어긋나 있습니다

**챗 흐름을 조립할 때 반드시 정해져야 합니다.**

| 어디 | 「슬롯을 다 채웠는데도 근거를 못 찾음」의 처리 |
| --- | --- |
| [11-chat-context.md](../../spec/backend/08-16-chat-context.md) §6.3 | `KB_CITATION_MISSING` (502 에러) |
| [14-errors.md](../../spec/backend/08-16-errors.md) §9 | 200 + 1332 안내 |

`citation-checker` 는 이 판단을 하지 않아(그 갈래는 `slot-checker` 결과를 받은 뒤에 갈립니다)
당장 막히지는 않습니다.

> **2026-09-04 확인** — 두 문서가 이제 그 줄에서는 같은 말을 합니다: 「슬롯을 다 채웠는데도 근거를 못 찾음」
> → `KB_CITATION_MISSING`(11 §6.3 :436 · 14 §9 :505). 다만 11 의 §9 표(:535)는 아직 「200 + 1332」로 남아
> **한 문서 안에서** 어긋나고, `insufficient → 슬롯 질문` 갈래는 코드에 배선되지 않았습니다 →
> [doc-gardening §2 ②](08-26-doc-gardening.md). 두 spec 은 다른 세션이 고치는 중이라 여기서 닫지 않습니다.

## 2. 막혀 있는 것 — 무엇이 풀어야 하나

**막힌 것과 안 막힌 것을 가르는 게 이 문서의 요점입니다.** 2026-08-18 에는 다섯이 대기 중이었습니다.
**2026-09-04 다시 봤습니다** — 셋은 풀렸고, 하나는 절반, 하나는 「막힘」이 아니라 「준비됐는데 켤지 사람이 정하는 중」입니다.

| 막힌 것 (2026-08-18) | 무엇에 막혔었나 | 2026-09-04 |
| --- | --- | --- |
| ~~`src/kb/org.json`~~ | 기관 연락처 **실값**. 자동 판독이 두 번 서로 다르게 읽어 한 줄도 쓰지 않았습니다 | **해소.** 51곳 · `contact.report_tel` 42곳 · 51곳 전부 `source_url`·`verified_at` 있음. 출처는 [research/04](../research/04-기관정보.md), 넣는 절차는 [org-materialization 스킬](../../.claude/skills/org-materialization/SKILL.md) — 「출처를 요약해 읽으면 이름이 밀린다」가 그 사고에서 나온 규칙입니다. 아직 없는 여섯은 파일의 `_note` 「아직 없는 것」에 이유와 함께 있습니다 |
| ~~`org.contact` 키 구조~~ | 위와 같이 정해야 합니다. 값을 모른 채 키만 정하면 다시 바꿉니다 | **해소.** [09 §11.1](../../spec/backend/08-16-data-model.md) 「`org.contact` 키 — 다섯이고 전부 선택」. 실제 파일의 키도 그 다섯(`report_tel`·`report_hours`·`submit`·`report_steps`·`caution`)입니다 |
| ~~문진 선택지의 정본~~ | [핸드오프 ⑤](08-16-backend-handoff.md)가 아직 답이 없습니다 | **해소 — A(코드 상수)로 확정 (2026-08-20).** `src/lib/questions.ts` 머리말이 근거입니다. ⚠️ 이 결정이 `spec/` 에는 없습니다 — [02](../../spec/backend/08-14-slot-tiering.md)가 지나가며 한 번 언급할 뿐 → §5 ⑧ |
| 층 4 실행 | Vercel Cron 플랜별 빈도·타임아웃 미확인 | **절반.** 크론 둘이 섰습니다 — `src/vercel.json` `crons` · `/api/cron/reminders`(2026-09-01) · `/api/cron/purge`(2026-09-03). 남은 것 둘: ① 플랜별 빈도·타임아웃은 여전히 `TODO(근거 필요)`(`api/cron/reminders/route.ts` 머리말 · [ADR-025](../../decisions/025-scheduled-jobs.md) 「남은 것」) ② **Mailer 미설정** — 수단은 Brevo 로 정해졌는데(`src/lib/mailer.ts` 2026-09-01 · [08 §1.2](../../spec/common/08-14-api.md)) 열쇠·발신자가 비어 `unconfigured`(`container.ts:449-451`)이고, 주기·문구의 정본도 없습니다([ADR-021](../../decisions/021-reentry-and-identity.md) 「남은 것」) |
| `pii-tokenizer` 2차 스크러빙 | NER 모델·서비스 미선택. **경계 그 자체라 우선순위가 높습니다** | **준비됨 · 미가동(판단 대기).** 「막힘」이 아닙니다. 모델은 gemma3:4b([research/09](../research/09-로컬모델-PII인식-실측.md) R-1 — 누출 0%·과차단 0%), 서버는 2026-08-31 에 `/ner` 까지 올라갔고([deploy/README](../../deploy/README.md) 「2차 탐지를 켜려면」), 앱은 `NER_URL` 이 있으면 붙고 없으면 `null` 로 1차 정규식만 돕니다(`container.ts:253-254`). **비워 둔 것은 의도입니다** — 지금 서버가 CPU 라 발화당 10.7~12.3초(`container.ts:262-266`)이고, 경계라 못 가리면 챗·슬롯·부산물 쓰기가 503 으로 멈춥니다. 켤지는 사람이 정합니다 |

**연락처가 막혀도 KB는 절반 이상 진행됩니다.**
[§11.4.3](../../spec/backend/08-16-data-model.md#1143-연락처가-없을-때)이 「연락처가 없으면 절차만 안내한다」고
이미 정해 뒀습니다. `common.json`과 `ch-*.json`은 연락처 없이 쓸 수 있고, ~~`org.json`만 대기합니다~~ →
2026-09-04 채워졌습니다. 그 규칙은 여전히 살아 있습니다 — 아직 없는 여섯(고팍스·북앤라이프·신세계상품권·구글·애플·KG모빌리언스)이 그 갈래로 갑니다.

## 3. 착수 순서 — 막힌 것을 비켜 갑니다

```
①  DDL 적용 + src/migrations/ 체계          막는 것 없음 · 다른 전부의 선행
      ↓
②  date-checker                             막는 것 없음 · KB·LLM 무관
      ↓
③  층 1  case-intake → pii-tokenizer        NER 은 2차. 1차 정규식으로 먼저 선다
      ↓  → case-reader · slot-extractor
      ↓
④  층 3  slot-checker → planner             KB 필요 — common.json 부터
      ↓
⑤  층 2  챗 한 턴 (모델 1회 + citation)     ④ 가 서야 인용할 것이 생긴다
      ↓
⑥  층 4  reminder-sender · case-purger      Vercel Cron 확인 후
```

> **2026-09-04** — ①~⑥ 전부 코드가 있습니다(마이그레이션 0001~0009 · `date-checker` · 층 1~4 조립 · 크론 둘).
> 남은 것은 ③의 `case-reader`·`slot-extractor` **배선**(모듈은 있는데 부르는 곳이 없음 → §1-A)과
> ⑥의 **발송 설정**(→ §2)입니다. 순서 자체는 역할을 마쳤습니다.

**① 을 먼저 하는 이유** — [ADR-019](../../decisions/019-module-code-sync.md)가 DDL 변경에
`src/migrations/` 동반을 CI로 강제합니다. 체계가 없는 상태로 스키마를 손대면 그때부터 게이트에 걸립니다.

**② date-checker 를 두 번째에 두는 이유** — 셋입니다.
**KB에도 LLM에도 의존하지 않고**, 규칙이 [어제 확정](../../spec/common/08-16-deadline-rules.md)됐으며,
**테스트가 결정적**이라 백엔드에서 가장 먼저 완결되는 조각입니다. 법정 기한을 규칙으로 처리한 것은
발표에서 밝힐 지점이기도 합니다 (`CLAUDE.md` 불변 규칙 7).

**③ 에서 NER을 기다리지 않습니다.** [04-pii-boundary.md](../../spec/common/08-14-pii-boundary.md)의
1차 정규식만으로 경계가 섭니다. NER은 2차 방어라 나중에 끼워 넣어도 구조가 안 바뀝니다 —
**다만 그 전에는 외부 모델에 실데이터를 보내지 않습니다.**

**⑤ 를 늦추는 이유** — 챗은 인용할 KB가 있어야 의미가 있습니다.
KB가 비면 [citation-checker](../../spec/backend/08-16-chat-context.md)가 전부 되묻기로 보냅니다.

## 4. 부딪히지 않게 나누기

| | @kth9245 | @Dojaegyum |
| --- | --- | --- |
| 코드 | `src/modules/` 층 1~4 · 라우트 · 배포 | `src/modules/` **층 C** · `src/app/` 화면 · `src/components/` |
| 데이터 | DDL 적용 · `src/migrations/` | **`src/kb/`** 매뉴얼 원본 |
| 문서 | [ARCHITECTURE.md](../../ARCHITECTURE.md) §2·§3·§8·§10 | `spec/` · `rfc/` · `decisions/` |

**같은 파일을 동시에 안 여는 것이 목표입니다.** 겹치는 자리는 `spec/common/`과
`ARCHITECTURE.md` 둘인데, **구현 선택은 `ARCHITECTURE.md`, 계약은 `spec/`**이라
[ADR-007](../../decisions/007-architecture-doc.md)이 이미 갈라 뒀습니다.

**계약을 바꿔야 하면 코드보다 문서가 먼저입니다.** 스펙을 안 고치고 구현을 바꾸면
어느 쪽이 정본인지 알 수 없게 됩니다 (`CLAUDE.md` 작업 규칙).

## 5. 설계가 오면 확인할 것

**CI가 잡는 것은 넘어갑니다.** 아래는 게이트가 못 보는 자리입니다.

> **2026-09-04 에 여덟을 실제로 점검했습니다.** 표시는 그날 읽은 코드의 `파일:줄` 이 근거이고,
> 짐작으로 체크한 줄은 없습니다. 일곱은 통과, 여덟째는 반만 맞아 열어 둡니다.

- [x] `pii-tokenizer` 를 **거치지 않고** 외부 모델로 나가는 경로가 없는가 (불변 규칙 2)
  <br>**2026-09-04 확인** — 외부 모델을 부르는 자리는 `src/lib/llm.ts` 하나이고 조립은 `container.ts:445` 한 번입니다. 소비자 둘:
  ① 챗 — `chat-receiver/receive.ts:82` 가 `tokenize()` 한 뒤 `:164` 에서 부르고, 맥락은 전부 가려진 칼럼에서만 옵니다
  (`transcript_masked` `db.ts:1462` · `content_masked` `:1438` · `value_masked` `:653` → `flows/chat-turn.ts:453-466`).
  ② 전사문 기관 교정([ADR-056](../../decisions/056-transcript-org-normalization.md)) — `flows/read-evidence.ts:185` `maskLines` **뒤**
  `:212` `repairOrgs` → `:453` `completeText`. `case-reader/read.ts:170`·`slot-extractor/extract.ts:218` 도 `llm.complete` 를 부르지만
  호출자가 0 입니다(§1-A). 로그에는 모델명·상태·시간만 남습니다(`llm.ts:147-149`). 자체 호스팅 STT·OCR·NER(`lib/inference.ts`·`lib/ner.ts`)은
  토큰화 **이전** 원문을 받는 자리라 외부 API 가 아니고 **주소가 곧 정책**입니다([ADR-043](../../decisions/043-gpu-hosting.md)).
  `src/scripts/probe-*.ts` 는 합성·실측 데이터셋만 씁니다(`probe-org-repair.ts:22-23`).
- [x] 복호화 키가 서버·로그·DB에 닿는 코드가 없는가 (불변 규칙 3)
  <br>**2026-09-04 확인** — `key-handler` 를 import 하는 곳은 `"use client"` 파일 둘(`app/c/[token]/history.ts:1,51` · `send.ts:1,56`)과
  층 C 모듈뿐이고 `src/lib`·`src/flows`·`src/app/api`·`src/scripts` 에는 0 입니다. 볼트 라우트는 `ciphertext` 만 받아 저장하고
  그대로 내보냅니다(`api/cases/[case_token]/vault/route.ts:52-57,68` · `db.ts:1611`). 서버 측 `crypto.subtle`·`decrypt`·`openMapping` 0건.
  `pii-tokenizer` 가 `pii-masker` 에서 가져오는 것은 순수 함수(`tokenize.ts:22` `findHits` · `transcript-digits.ts:69`)로 키가 아닙니다 —
  [04](../../spec/common/08-14-pii-boundary.md) 「1차 정규식은 NER 없이도 서버에서 돕니다」가 허용한 그것입니다.
- [x] 기한 계산에 모델이 끼어들지 않았는가 — `date-checker` 밖에서 날짜를 세는 곳 (불변 규칙 7)
  <br>**2026-09-04 확인** — `flows/compute-deadlines.ts:120,160,205` 는 `dates.compute` 를 부르기만 하고, `date-checker` 안에 LLM import 는 0 입니다.
  밖에서 날을 더하거나 세는 곳은 전부 **주입된 date-checker** 입니다 — `case-intake/intake.ts:89` `dates.addDays`(← `container.ts:633-634`) ·
  `api/cases/[case_token]/contact/route.ts:87` `dateChecker.addDays` · `reminder-sender/send.ts:144` `dates.daysLeft`(← `container.ts:690`).
  **판단 하나** — `lib/deadline-view.ts:47` `daysLeft` 는 표에 적힌 `due_at` 과 오늘 사이 **달력일**을 표시용으로 셉니다. 법정 기한을
  만들지 않고(그건 date-checker 가 이미 `deadline` 표에 적음) 파일 머리(:13-20)가 그 경계를 적어 두어 **허용**으로 봅니다 — 규칙 7 이
  금지한 것은 세는 일이 아니라 **모델에 맡기는 일**입니다. 나머지 산술은 기한이 아닙니다(`storage.ts:188` 업로드 URL 만료 ·
  `llm.ts:354` 타임아웃 · `kb-collector/collect.ts:72` 수집 주기). 브라우저는 세지 않습니다(`deadline-viewer/label.ts:7`).
- [x] `kb_entry`·`org` 에 **직접 INSERT** 하는 코드가 없는가 ([RFC-002](../../rfc/002-kb-authoring.md))
  <br>**2026-09-04 확인** — `INSERT INTO kb_entry|org` 는 `src/scripts/load-kb.ts:224,271`(과 `:295` `org_public`)에만 있습니다.
  `src/lib/db.dbtest.ts:463` 는 시험 픽스처. `services/`·`deploy/` 0건.
- [x] 전사·OCR 결과를 프롬프트에 넣을 때 **격리 태그**가 유지되는가 (불변 규칙 4)
  <br>**2026-09-04 확인** — 챗: `prompt-builder/build.ts` 가 `case_talk`(:166)·`history`(:182)를 `trusted:false`, KB(:119)·`case_state`(:146)를
  `trusted:true` 로 가르고, `xml-renderer.ts:43-50` 가 `<`·`&`·`"` 를 이스케이프해 전사에 심은 `</case_talk>` 로 블록을 못 닫게 합니다.
  전사에서 자동으로 뽑힌 기관명(`extracted`)은 사용자가 확정하기 전엔 `case_state` 에 안 들어갑니다(`chat-turn.ts:457` — `confirmed` 만).
  **주의(위반은 아님)** — ADR-056 기관 교정 경로는 `<transcript><line>` 로 감싸되(`lib/org-repair.ts:148-150`) **이스케이프가 없고**
  격리 문구를 **의도적으로** 뺐습니다(`:34-38`). 출력이 JSON 한 덩어리이고 `verifyOrgRepair`(`:206-244`)가 「전사문에 실재하는 표기 +
  사전 정확 일치」만 통과시켜 자유 문장이 사용자에게 갈 자리가 없다는 판단인데, 파일 자신이 「전제가 깨지면 다시 넣는다」고 적어 두었습니다.
  이 경로에 자유 문장 출력이 생기면 이 줄을 다시 봅니다.
- [x] 정보가 없다고 **플랜 생성이 멈추는** 흐름이 없는가 (불변 규칙 5)
  <br>**2026-09-04 확인** — `slot-checker/check.ts:8-9` 「어떤 입력에도 예외를 던지지 않습니다」 — 파일에 `throw` 0. 슬롯이 없으면 슈퍼셋
  (`flows/regenerate-plan.ts:27-28,406` · `planner/plan.ts:159-164`), 「모름」은 `state:'unknown'` 정상 경로(`flows/answer-slot.ts:75-88`),
  표에 없는 슬롯 문구는 `undefined` 로 넘어갑니다(`lib/questions.ts:26-31`). 던지는 자리는 정보 부족이 아니라 **KB 무결성·조회 실패**
  (`plan.ts:192,200` 근거 네 칸 빈 KB 항목 · `regenerate-plan.ts:357-358` `KbUnavailableError`)와 **입력 검증**(`case-intake/intake.ts:77,176-188`
  목록 밖 값 · `:110,117` 속도 제한)입니다 — 불변 규칙 1 이 요구하는 멈춤이고 규칙 5 의 밖입니다.
- [x] `User` 테이블·로그인이 슬쩍 들어오지 않았는가 ([ADR-021](../../decisions/021-reentry-and-identity.md))
  <br>**2026-09-04 확인** — 마이그레이션 0001~0009 의 `CREATE TABLE` 18개에 `user`·`session`·`account` 표가 없습니다. 사람을 가리키는 칼럼은
  `case.notify_email` 하나(0008:25)이고 ADR-021 이 허용한 선택 항목입니다([04](../../spec/common/08-14-pii-boundary.md) 「예외 — 알림용 이메일 하나」).
  라우트 15개 중 `/api/admin` 은 없고(폴더 자체가 없음) 로그인 라우트도 없습니다. `lib/session-cookie.ts` 는 §5.1 의 **관리자 계정 하나**용이며
  비밀번호 확인 경로를 의도적으로 안 만들었습니다(:26-34); 쓰는 곳은 문지기 `proxy.ts:38,95` · `lib/request.ts:37` 뿐이고, 막는 경로도
  `/api/admin/*`·`/api/cron/*` 둘(`proxy.ts:50`)입니다.
- [ ] [ARCHITECTURE.md §10](../../ARCHITECTURE.md)에서 채워진 항목이 `spec/`에도 반영됐는가
  <br>**2026-09-04 확인 — 반은 맞고 반은 아닙니다.** 채워진 항목 「NER 모델」(§10 「채우면 되는 것」)은 [08 §1.2](../../spec/common/08-14-api.md)
  (`NER_URL` 행과 그 앞 인용 블록)에 반영됐지만, [04](../../spec/common/08-14-pii-boundary.md) 「TODO」 절에 `TODO(미정): NER 모델·서비스 선택` 이
  그대로입니다. 반대 방향의 낡음이 더 큽니다 — §10 「구조에 걸리는 것」 다섯 중 **넷은 이미 정해졌는데 표가 안 지웠습니다**:
  볼트 제품 → [ADR-049](../../decisions/049-vault-in-postgres.md)(2026-08-24, ARCHITECTURE §8 자신이 인용) · 메일 발송 수단 → Brevo
  ([08 §1.2](../../spec/common/08-14-api.md) `MAILER_API_KEY` 행 · `lib/mailer.ts`) · `org.contact` 키 → [09 §11.1](../../spec/backend/08-16-data-model.md) ·
  문진 선택지 → `lib/questions.ts:8` A 확정(은퇴한 핸드오프 ⑤ 를 가리킴 — **이 결정은 어느 spec 에도 없습니다**). 진짜 미결은 Vercel Cron
  제약 하나. 고칠 곳이 ARCHITECTURE 와 spec 둘이라 이 문서에서 닫지 않고 [doc-gardening](08-26-doc-gardening.md) 백로그로 넘깁니다.

## 6. 이 문서는 언제 지우나

**지우지 않습니다 — 은퇴시킵니다** ([RFC-001 「은퇴」](../../rfc/001-repo-structure.md)).
[ADR-040](../../decisions/040-write-path-boundary.md) 과 `src/modules/pii-tokenizer/README.md` 가 이 파일을 가리키고 있어 옮기지도 않습니다.

~~@kth9245 의 초기 설계가 들어오고, 위 §2의 다섯이 다 풀리면 지웁니다.~~ → 설계는 2026-08-18 에 들어왔고, §2 는 2026-09-04 기준
셋이 풀렸습니다. 남은 셋(Vercel Cron 제약 · Mailer 설정 · NER 가동 여부)은 각자 제자리가 있습니다 —
[ADR-025](../../decisions/025-scheduled-jobs.md) 「남은 것」 · [08 §6](../../spec/common/08-14-api.md) + [ADR-021](../../decisions/021-reentry-and-identity.md) 「남은 것」 ·
[deploy/README](../../deploy/README.md) 「2차 탐지를 켜려면」. 이 문서가 그것들을 대신 들고 있을 이유는 없습니다.

**은퇴 조건은 하나입니다** — 위 셋을 [doc-gardening §1](08-26-doc-gardening.md) 백로그 행이 넘겨받았는지. 넘겨받았으면
배너를 붙이고 `docs/plans/README.md` 「은퇴」 절로 내립니다. 순서·의존은 그때 의미가 없어지고, 남는 것은 `spec/`과
`ARCHITECTURE.md`입니다. §5 의 감사 기록은 그날의 스냅샷으로 남습니다.

[핸드오프 문서](08-16-backend-handoff.md)는 ~~⑤ 하나만 남아 있어 아직 못 지웁니다~~ → 2026-08-26 은퇴했습니다(⑤는 위 §2 로 닫힘).
