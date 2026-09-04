# 문서 손질 백로그 — 코드보다 뒤처진 문서를 어떤 순서로 따라잡히나

> 2026-08-26 첫 손질의 결과입니다. `origin/main 2adfb62` 를 별도 워크트리에 받아 rfc·spec·plans 34편을
> `src/`·`services/`·`deploy/` 와 대조했습니다(감사관 에이전트 7개, 판정마다 file:line 근거).
> **절차는 [`.claude/skills/doc-gardening/`](../../.claude/skills/doc-gardening/SKILL.md)** 에 있고, 사람이 보는 판정표 사본은
> 아티팩트 「FinAlly 문서 드리프트 대장」입니다. 이 문서는 **남은 일**만 적습니다 — 끝난 줄은 지우지 말고 `~~취소선~~` 으로.
>
> 검사기 넷(doc-integrity · route-contract · schema-names · inventory)은 전부 통과 — 이름·링크 수준의 drift 는 0 이고,
> 아래는 전부 **역할·전제·값** 수준입니다.

## 첫 손질에서 한 것 (2026-08-26)

- 은퇴 6편 — `spec/backend/08-14-kb-operations` · `docs/plans/08-16-backend-handoff` · `08-20-api-routes` · `08-22-layer-c-transport` · `08-22-layer-c-viewers` · `08-24-oracle-account-handoff`. 규칙은 [RFC-001 「은퇴」](../../rfc/001-repo-structure.md).
- `kb-operations` 의 「소스 주소 실측」을 [research/18](../research/18-KB-소스-주소-실측.md) 로 꺼냄.
- 메타 문서의 거짓 정정 — `CLAUDE.md`(API 비어 있음 · src 스캐폴딩만 · ARCHITECTURE 뼈대만 · 저장소 미정), `spec/README`(개정 대기 배너 · 엔드포인트 10+2 · 화면 일곱 · 볼트 미결), `docs/plans/README`(「지운다」 규정).
- 해소된 TODO 닫기 — service-concept(랜딩 3초) · module-names(옛 표기 반영 절 · 층 4 이름) · completion-hook(보호자 공유) · system-prompt(이력 턴 수) · errors(ADR-021→028 오기) · RFC-003(최종 개정일 · S-11).

## 둘째 손질에서 한 것 (2026-09-04)

프론트가 「다 끝났다」고 한 날, 아래 2·3절의 문서 열여섯을 **문서 묶음별 가드너 열 개가 병렬로** 그날의 `main`
코드와 대조해 갱신했습니다(모든 판정에 file:line · 커밋은 리드가 통합). 절차는 [`.claude/skills/doc-gardening/`](../../.claude/skills/doc-gardening/SKILL.md) 그대로.

- **2절 ①~⑩ 전부 갱신** — deadline-rules(기산 표·`months`·`owner→kind`·`starts_at`) · chat-context(`ask_slot`·`context_built` 는 08-28 에 이미 배선 · 부산물 「구현 전」 표기 · 재시도 1회) · slot-tiering(자동 추출 「구현 전」 · T2 목록은 §5.1 포인터 · **트랙별 슬롯 ⬜ 신설**) · data-model(볼트 §2.1 DDL · `uk_deadline_identity` · `body.actor` · `relief_applied_at` · `report_tel` · §7 L1 ADR-057 · §7.1 이의제기 행) · user-journeys(기준 `main 3d3842b` · 갈림길 **열** · 「끊기는 자리」 재계산) · workspace-panels(「계약 8 · 화면 7」 · 배치 09-03 · WS-download 뜻) · domain-model · components(첫 표 은퇴 · 귀속표 실명) · glossary(전제·스택은 포인터로) · features(**상태 열** 신설 — 구현·부분·미조립·폐기·미착수).
- **3절 전부 닫음** — api(§1.2 env 표 합침 · §3.3 `ingest_status` · §3.8 `receipt_doc` · §3.11 400 · §3.12 60줄 · §3.4 문진 정본 = `questions.ts`) · pii-boundary(파란 토큰 정정 · NER 확정 · 2차 매핑 ADR-062) · screens(S-03 백신 절 은퇴 · S-05 층 C 칸 · TODO 셋) · tokens(「다섯 상태」 은퇴 · 전환 표 실제 값) · accessibility·README(스냅샷 표기) · channel-matrix · completion-hook · system-prompt(**전문이 코드와 달랐음** — 08-27 세 줄 반영) · RFC-002(파일 지도 · 「적재기가 읽는 것과 무시하는 것」 신설) · 모듈 README 여섯 · handoff README.
- **은퇴 1편** — [backend-baseline](08-18-backend-baseline.md): §5 여덟 점검을 실제로 수행(7 통과 · ARCHITECTURE §10 낡음 1 — 같은 날 고침).
- **메타 문서** — CLAUDE.md(갈림길 열 · 모듈 32 · 라우트 15) · spec/README(갈림길 · 합성데이터 행 정정) · ARCHITECTURE §10(볼트·메일·`org.contact`·문진 정본 넷 닫음).
- **정정** — research/21(이의제기 사유 둘→**셋** · 2호 단서) · research/19(`format_unknown` 은 ADR-057 이전 표현) · errors.md(인용 재시도 1회).

### 문서로는 안 닫히는 것 — 코드 후속 (가드너들이 찾은 것)

전부 **코드 주석·오류 문구·죽은 파일**이고 동작이 아닙니다. 한 PR 로 묶어 정리합니다.

| 어디 | 무엇 |
| --- | --- |
| `src/lib/db.ts:11` | 「스키마의 정본은 `src/migrations`」 — ADR-019 는 spec DDL 이 정본 |
| `src/lib/kb-load.ts:74-80` · `:273` · `:290` | ⬜ 「정본끼리 어긋남」 주석(data-model §11.4 로 닫힘) · 오류 문구 「여섯 밖」(ACTORS 7) · 「일곱 밖」(ACTIONS 8) |
| `src/modules/retry-checker/retry.ts:31` | `KB_CITATION_MISSING: [0, 0]` — 실제 상한은 `receive.ts` 의 재시도 1회. `[0]` 으로 |
| `src/modules/case-purger/purge.ts:7,91` · `types.ts:29` | 「만료로 이미 없을 수 있음」 — ADR-049 뒤 볼트에 TTL 없음 |
| `src/lib/container.ts:169,180,189` | 「⬜ 미선정」(NER·STT·OCR) — ARCHITECTURE §10 · ADR-052 로 정해짐 |
| `src/modules/date-checker/README.md:93-94,107` · `types.ts:23` | 「`months` 가 없다」(있음 · 08-26) · 「값의 정본은 매트릭스」(KB) |
| `src/modules/prompt-builder/build.ts:2` · `system-prompt.ts:8` | 「7블록」(여섯) · 시험 파일명 `index.test.ts`(실제 `build.test.ts`) |
| `src/modules/slot-extractor/index.ts:17-19` · `pii-tokenizer/README.md:39,69` | 「8유형」(아홉) · 「org.json 비어 있음」(51곳) |
| `src/app/api/cases/[case_token]/messages/route.ts:49-50` | 「정본에 아직 값이 없다(§3.12 TODO)」 — 이제 60줄로 있음. `MAX_TURNS` 는 줄 수 |
| `src/.env.example:41-43` | BLOB_TOKEN 「볼트 제품이 정해질 때」 — ADR-049 로 끝남, 남은 것은 이름 하나 |
| `src/app/globals.css:55,137-138,177,278,297` | 라이트 모드 「미정」 · `--horizon` 「장식 전용」 · 13px · rise 0.5s · 「아래 넷」 — **프론트 소유** |
| `src/components/ui/saa-s-template.tsx` (302줄 · import 0) · `border-beam.tsx`(import 0) | 죽은 파일 — **프론트 소유** |
| `src/lib/kb-load.test.ts:199-207` · `workspace.test.tsx:87-92` | 시험 제목이 낡음(「일곱」 · 「늘 있다」) |

### 판단이 필요한 것 — 사람

- **T0 가 코드 상수**(`src/app/c/[token]/safety.tsx`)인 것은 불변 규칙 1(절차 하드코딩 금지)과 긴장 관계 — 「KB 밖 유일한 절차」를 명시한 ADR 이 없습니다. T0 에 **1394**(통합대응단 대표번호 · research/05 U-03) 를 둘지도 같은 자리.
- 넓은 폭에서 T0 가 접히는지(screens.md :72 ↔ :92 자기모순) · 좁은 폭의 열 순서(코드가 챗 먼저).
- `org.json` 해피머니 — 공식 사이트 첫 화면이 「상품권 채권접수 조회」 한 장이라 `ch-giftcard.json` 의 핀 사용정지 안내가 헛걸음일 수 있음(PR #52 `caution`).

## 1. 은퇴 문서에서 꺼낸 미결 — 제자리를 찾아야 하는 것

은퇴한 계획이 들고 있던 열린 항목입니다. 은퇴 문서는 더 안 고치므로 여기서 추적합니다. 닫히면 취소선.

| 무엇 | 어디서 왔나 | 지금 상태 (2026-08-26) | 갈 곳 |
| --- | --- | --- | --- |
| 공휴일 API 키 — 지금은 `holidays-table.ts` 2024~2035 표 | api-routes :324 | 표로 자인 (`holidays.ts:8-12`) · deadline-rules :55 「하드코딩 금지」와 충돌 | qa-readiness 또는 deadline-rules 갱신 때 함께 |
| ~~`case.email` 칼럼 — 입력칸만 있고 저장 칼럼 없음~~ | api-routes :325 · service-concept :43 | **2026-09-01 닫힘** — `case.notify_email`(마이그레이션 0008 · §3.13 `PUT …/contact`). Mailer 는 여전히 미설정(발송 수단 미정 → ADR-021) | ~~data-model §2 + 마이그레이션 (kth9245)~~ |
| ~~발송 이력 저장~~ | api-routes :326 | **2026-09-01 닫힘** — `reminder_sent`(§8.4 · `db-reminder.ts` `createSentLog`) | ~~위와 한 묶음~~ |
| `admin.message_viewed` 감사 이벤트 | api-routes :329 · api.md :1287 | `audit-logger/types.ts` 에 없음 | api.md §5 관리자 구현 때 |
| 관리자 로그인 | api-routes :330 | `src/app/api/admin` 없음, 문지기만(`gated-paths.ts:48-62`) | api.md §5 |
| 메모리 카운터의 위치 | api-routes :332 ↔ api.md :172 순환 참조 | `rate-limit.ts:39` 메모리 | api.md TODO 절에서 한쪽으로 |
| ~~`referenced_steps`·`referenced_deadlines` 용도~~ | api-routes :356 · system-prompt :314 · chat-context §5 | **#43(2026-08-26) 으로 배선됨** — 모델이 인용한 것 중 단계·기한을 가리키는 것만 골라 실음(`chat-turn.ts:97,118`) | 남은 것은 system-prompt :314 TODO 와 :202 「지시문에서 뺐다」 표기 정리 → 3절 |
| ~~순서 12 크론 둘 — `/api/cron/*` 라우트 · `vercel.json` crons~~ | api-routes 순서 12 · module-names :76-80 | **닫힘** — 알림 `GET /api/cron/reminders`(09-01) · 파기 `GET /api/cron/purge`(09-03) · `src/vercel.json` crons 둘. KB 수집 크론만 없음(`kb-collector` 미조립) | ~~qa-readiness Task 7~~ |
| 순서 13 관리자 조회 | api-routes 순서 13 | 없음 — QA 범위 밖으로 **뺐음**(2026-08-27) | qa-readiness Task 7 → 사람 판단 |
| ~~순서 14 `server-only` 표시 — 서버 모듈 26개 중 0~~ | api-routes 순서 14 · ADR-028 :96 | **2026-09-04 닫힘** — 서버 모듈 21개(층 1~4 + 층 없음 둘)의 `index.ts` 에 표식. 브라우저 모듈 열하나는 대상이 아님. `tsx` 스크립트(`kb:load`·`migrate`·`probe:*`)는 `--conditions=react-server` 로 표식을 비웁니다 | ~~코드 (한 PR)~~ |
| ~~backend-handoff 잔여 — domain-model :140 「미결」절 표제, 목업 24시간 문구~~ → 2026-09-04 닫힘(표제 「미결이었던 것 — 어떻게 결정됐나」 · 24시간 → 180일) | backend-handoff 삭제 조건 | 절 안 항목은 전부 「해소됨」 | domain-model 갱신 때 절 제목만 |
| ~~backend-baseline §2 남은 둘 — 층 4 Cron · NER~~ | baseline (살아 있음) | **2026-09-04 갱신** — 크론은 섰고, NER 은 서버가 준비됐으나 `NER_URL` 을 일부러 안 켠 상태(deploy/README 「2차 탐지를 켜려면」). baseline §2·§5 를 그날 코드로 다시 셈 | ~~크론은 위와 같이, NER 은 pii-boundary :187 TODO 와 한 묶음~~ |

## 2. 낡음 — 코드가 앞서가 문서가 뒤처진 것, 갱신 순서

「갱신하지 않으면 **반대로** 읽히는가」로 순서를 매겼습니다. 문서별 PR 하나. `spec/backend/` 셋(②③④)은 kth9245님 판단이 필요한 자리입니다.

| 순 | 문서 | 무엇이 뒤처졌나 (근거) | 정본이 어디로 갔나 |
| --- | --- | --- | --- |
| ~~①~~ | `spec/common/08-16-deadline-rules.md` | 기산 표 :27-31 「지급정지 완료」 ↔ data-model §8.0 `relief_applied_at`(`compute-deadlines.ts:270-284`) · 공고 2개월 기점 ↔ ADR-054 `notice_started_at`·`months`(`common.json:319-323`) · `months`(민법 160조)·`owner→kind`·`starts_at` 미기재 · :33 미확인 배지 ↔ 기산점 없으면 줄 자체 없음 · :83 타이머 미구현 · :35 TODO 해소 표시 잔존 | data-model §8 · `date-checker/compute.ts` 주석 · `date-checker/README`. channel-matrix 기한 표(:36-42)도 값의 정본이 KB `body.deadline` 으로 이동 |
| ~~②~~ | `spec/backend/08-16-chat-context.md` | §6.3·§9 insufficient→슬롯 질문 미배선(`chat-turn.ts:59-67` 두 갈래뿐, `publish.ts:89-95` 호출처 0) · §3 사건 상태에 기한·부산물 없음(`chat-turn.ts:142-147`) · §7.2 `chat.context_built` 기록 없음 · 재시도 1회 ↔ `receive.ts:43` 2 ↔ errors.md 2회 · :150 TODO 는 :540 에서 해소 | — |
| ~~③~~ | `spec/backend/08-14-slot-tiering.md` | :15·21 자동 추출 우선 ↔ `slot-extractor` 미배선(`read-evidence.ts:417-438`) · T2 5개 ↔ `check.ts:36-48` 11+2 · 슈퍼셋=조건 라벨 ↔ KB `conditional` 전부 null · T0 KB 항목(1332·송금금지·비행기모드) 없음 · :37 「전부 버튼」 ↔ text/amount/date · :66 TODO 해소(§5.1) 표시 잔존 | data-model §5.1 · `check.ts:76-110` |
| ~~④~~ | `spec/backend/08-16-data-model.md` | 마이그레이션에만: `uk_deadline_identity`(0005:40-42, `db.ts:753`) · `case_vault.restore_mapping` DDL 절 없음(0004:27-39) · 내부 모순 §11.4 actor↔`plan.ts:89 body.actor`, §8.2/§15 `freeze_requested_at`↔§8.0 `relief_applied_at`, §11.4.1 `call_center`↔§11.1 `report_tel` · ADR-049 부분 반영(§14 TTL·§2:117) · 정본 표기 충돌 `0001:3` 「정본은 spec」↔`db.ts:11` 「정본은 migrations」· ~~0006(actor/agency) 들어오면 §6 CHECK 또 뒤처짐~~ → #43 이 §6 과 0006 을 같은 커밋에 올림(RFC-001 「스키마를 바꾸면 마이그레이션이 함께」가 지켜진 예) | DDL 은 마이그레이션 누적본으로 동기화하고(검사기 확장 검토) 산문(§5.2·6.1·8·9·10.1·11.2·11.4·12.5·13·14)은 유지 |
| ~~⑤~~ | `spec/common/08-21-user-journeys.md` | 기준 08-21 이후 src 81커밋. :212-225 「끊기는 자리」 7행 중 4행 해소 · :47-60 여정 A 「UI만」열 전부 낡음 · :270-274 deadline null 낡음 · 새 갈림길 둘 없음(슬롯 `pii_pending` ADR-041 · 볼트 되받기 ADR-050) · 여정 B(메일 링크) 미구현 전제 | :4 「이 문서가 정본」 실효 — 기준 커밋 재기록 또는 요약으로 내림 |
| ~~⑥~~ | `spec/frontend/08-17-workspace-panels.md` | 「여덟」(WS-confirm) ↔ `work-handler/types.ts:14-31` 7종 ↔ screens·components 「일곱」 · 시그널 파이프 :87-103 ↔ `signal.ts` 를 `page.tsx:168-178` 가 안 부름 · WS-visit 빈 라벨(`panels.tsx:185-187`) · WS-download 뜻 · WS-wait 막대 하드코딩 | 4절 ② 코드 문제와 같이 |
| ~~⑦~~ | `spec/common/08-16-domain-model.md` | Analysis·Document·KbRelease 표 없음(ADR-037·045) · T2 5→15, `pii_pending` 누락 · 해소된 TODO 4건 잔존(문진 7선택지·부산물 TODO①·24시간 동의·토큰 규격) · :60 가족 계정 ↔ :176 계정 없음 · :140 「미결」 표제 | 상태·저장 경계는 data-model. 관계 트리·저장경계 표만 남김 |
| ~~⑧~~ | `spec/frontend/design-system/08-16-components.md` | 첫 표 9종 파일 0(절 단위 은퇴) · 둘째 표 6칸(PlanBoard ◇ · WaitCard 「미결」→ADR-048 · FileRail·IssuedLink 위치 · 「모듈 넷」→일곱 · 귀속표) · `ui/` 규칙 위반 2(`Icon.tsx`, `saa-s-template.tsx` 302줄 import 0) · 복사 폴백 `doc.tsx` 만 | plan-viewer·deadline-viewer README 가 앞섬 |
| ~~⑨~~ | `spec/common/08-14-glossary.md` | §전제 데스크톱 우선 · §기술스택(Whisper+Web Speech ADR-038 폐기 · Vision OCR→EasyOCR · 서버 NER 미선정 · docx ADR-037 · `ManualKB` 코드 없음) 전부 폐기된 전제 · 합성데이터 여전히 미반영 | 개념 표만 남기고 축소. 스택은 ARCHITECTURE §2·§6, 전제는 service-concept |
| ~~⑩~~ | `spec/common/08-14-features.md` | F-06 타이머(ADR-036 T0 레일로 대체) · F-04 case-reader·F-05b slot-extractor 미조립 · 통화동반·스크립트·F-10 코드 0 · `doc-filler` 폴더 없음 · F-07 표에 kb-finder·prompt-builder 누락 | F-ID 정의처(검사기 `ID_SOURCES`)라 은퇴 불가 — 상태 열(구현/폐기/미착수) 추가 |
| ~~⑪~~ | ~~`spec/common/08-16-module-boundaries.md`~~ | ~~금지 규칙은 각 `types.ts` 머리 + ARCHITECTURE:307-319 에 흡수 · :38,42 자리별 복원 ↔ pii-boundary ADR-034 **spec 끼리 충돌** · doc-filler 「완성 문서」(ADR-037) · API Gateway·Case Store 행 · :119 물리배치 TODO 해소(ADR-028)~~ | **2026-08-26 갱신 완료** — 유지하기로 판단(금지를 코드보다 먼저 설계하는 자리가 이것뿐). 표 33행만 남기고 경계 규칙·흐름도·미결 절은 걷어냄. `pii-restorer` 행은 ADR-034 대로 적고 코드 뒤처짐은 4절 ① 에. API Gateway·Case Store 행 제거, `types.ts` 의 추가 금지를 표로 흡수. **남은 것** — 표 ↔ `types.ts` 머리 대조를 검사기로 묶기(`inventory --check` 확장 후보) |

## 3. 살아 있는 문서에 남은 낡은 표시 — 첫 손질에서 못 닫은 것

근거는 확정됐지만 **다른 세션이 고치는 중인 파일**이라 손대지 않았습니다(api · screens · data-model · pii-boundary · components · tokens · qa-readiness). 그 작업이 머지된 뒤 닫습니다.

| 문서 | 닫을 표시 |
| --- | --- |
| ~~`spec/common/08-14-api.md`~~ | :557·575·577 「서버 미구현」→ `api-deadlines.ts:70-92` · :629 fixtures 문구 · :932-944 「경로 파라미터 미정」→ ADR-039(같은 문서 :197 과 자기모순) · :1061 「BAD_REQUEST 없음」→ errors.md:302 · §1.2 env 표 `DIRECT_URL`·`LLM_*` 누락, 인용 블록이 표를 가름 · §3.3 `ingest_status`·`shortfalls` · §3.8 `receipt_doc` · §3.11 빈 entries 400 · §3.12 상한 60 |
| ~~`spec/common/08-14-pii-boundary.md`~~ | :180-183 「파란 토큰 = 전송 안 됨」(`page.tsx:15` 「이제 사실 아님」) · :187 NER TODO ↔ ARCHITECTURE:486 「확정」 · :188-193 2차 매핑 TODO 과소(전사 경로는 1차도 서버, `tokenize.ts:9-13`) |
| ~~`spec/frontend/08-14-screens.md`~~ | §S-07 ⬜ 공고 시작일 → 해소(api.md:575, `plan.tsx:214`) · §S-03 백신 절 은퇴(라우트 없음) · 폐기 표 :15-25 와 §S-09 절 중복 · 층 C 칸 3곳(S-05 pii-masker·file-sender, S-10 doc-filler) · TODO 「라우팅·상태 미정」 · 날짜 마커 8곳 |
| ~~`spec/frontend/design-system/08-16-tokens.md`~~ | 「다섯 상태」절(:175-185) 은퇴 · `--horizon` 뜻 ↔ `globals.css:164` · 다크 전용 「확정」 ↔ css:132 「미정」 · `row-flash`·border-beam 사용 0 · 헤더 08-18 뒤 08-23 개정 미표기 |
| ~~`spec/frontend/design-system/08-16-accessibility.md` · `README.md`~~ | :363 「다섯」→여섯 · :366 `[계좌번호]`→`[계좌-1]` · README:30 「눈으로 보는 정본」(`08-18-design-system.html` 이 css 와 어긋남 — 스냅샷 표기 또는 재생성) |
| ~~`spec/backend/08-14-channel-matrix.md`~~ | :36-42 기한 표 → KB 로 정본 이동 표기 · :82 TODO 은행 19곳 해소(비은행 미확인) · 5유형 KB 파일 없음 표기 |
| ~~`spec/backend/08-14-completion-hook.md`~~ | L1 OCR 대조 미구현·포맷 체크 항상 `format_unknown` 표기 |
| ~~`spec/backend/08-17-system-prompt.md`~~ | :314 `referenced_*` 용도 TODO → #43 으로 배선됨(응답 §3.9 에 실림) · :202 「지시문에서 뺐다」는 여전히 맞는지 #43 뒤 확인 |
| ~~`rfc/001` · `rfc/002`~~ | RFC-001 「모듈 골격」 33 중 32 준수(`doc-filler` 만 `.gitkeep`) · RFC-002 :34-46 파일 11개 vs 실재 5, `kb:load` 적재기·`body.actor/action`·`_note/_todo`(`kb-load.ts:396` 이 RFC-002 근거로 인용하나 본문 없음), `src/kb/README.md:13` 없는 `frozen-account.json` |
| ~~모듈 README~~ | `chat-handler:53-56` · `case-opener:45-47` · `transcript-viewer:26-27` · `work-handler:61-63` · `src/modules/README.md:6,13` · `assets/artifacts/handoff/README.md:19` |
| ~~`docs/plans/08-23-qa-readiness.md`~~ | :180 date-checker 호출(구현됨) · :610 org.json(채워짐) · 「27건」→51 · `seed:deadline` 「지운다」인데 package.json 잔존 · Task1 표 BLOB_TOKEN vs Supabase |

## 4. 문서 정리로 안 닫히는 것 — 코드·판단

| 무엇 | 근거 | 성격 |
| --- | --- | --- |
| ~~① **ADR-034 「모든 자리 전체 복원」을 코드가 안 따름**~~ | ~~pii-boundary :131-138 은 ADR-034. 코드는 구규칙~~ → **2026-09-03 닫힘** (PR #45). `scopeOf` 가 일곱 자리 전부 `full`, `partial` 은 타입에서 제거, chat-context §8.1 도 개정 | ~~**제품 약속.** spec 이 앞서고 코드가 뒤처진 유일한 자리~~ |
| ~~② **WS-read·WS-wait 에 부산물 입력이 무조건 붙음**~~ → **2026-09-04 코드에서 닫힘** — `workspace.tsx` 가 `panelRule(panel).hasCompletion` 일 때만 `ArtifactSlot` 을 그리고(read·wait 는 false), `workspace.test.tsx` 가 read·wait 에 입력이 없음을 봅니다. 옛 「늘 있다」 시험은 `call` 단계에서 돌아 계약과 안 부딪힘(제목만 낡음) | workspace-panels :46·:178·:45 ↔ `workspace.tsx:271-309` ArtifactSlot 을 모든 패널에 삽입(`panels.tsx:298,314`). `workspace.test.tsx:88-92` 가 「늘 있다」로 고정 | 계약 위반을 테스트가 보호 |
| ③ **`frozen_account` 트랙이 어느 spec 에도 없음** | 0001:27-28 CHECK · `start/open.ts:27` · `start/page.tsx:58` 선택 가능 ↔ ~~`src/kb/frozen-account.json` 없음 → 선택해도 `common.json` 지급정지 안내~~ → **2026-09-04 KB 가 생겼습니다**(ADR-066 · research/21). ~~지급정지 안내~~가 아니라 **빈 플랜**이었습니다(조회축이 `track` 이라 victim 행이 안 붙음). 남은 공백 — **트랙별 슬롯·문진**(slot-tiering ③ 과 한 묶음) · S-07 레일의 `step_key` 넷이 victim 것 | 계약 공백 절반 — channel-matrix 「통장묶기」 절은 갱신됨 |
| ④ **층 1 후반·층 4 트리거가 통째로 미조립인데 문서 넷이 현재형** | NER(`container.ts`) · `case-reader`·`slot-extractor`·`kb-collector`·`kb-reviewer`·`doc-builder`·`doc-filler` import 0 — features·pii-boundary·module-boundaries·module-names. <br>~~크론 라우트·`vercel.json` crons 없음~~ → **둘 다 섰습니다**(리마인더 2026-09-01 · 파기 2026-09-03). ~~`casePurger` 호출자 0~~ → `/api/cron/purge`. ~~ReminderSource unconfigured~~ → `db-reminder.ts`. **Mailer 는 여전히 미설정**(발송 수단 미정 → ADR-021) | 문서에 「구현 전」 표시가 없어 생긴 것 → ⑩ 상태 열로 |
| ~~⑤ **같은 값을 세 문서가 다르게 적음 — 정본 지정 필요**~~ → **2026-09-04 전부 가름** — 재시도: 코드(`receive.ts` `MAX_ATTEMPTS=2` = 재시도 1회)가 정본, errors.md 를 맞췄고 `retry-checker` 의 `[0,0]` 만 코드 후속 · WS 수: 「계약 8 · 구현 7 · WS-confirm 구현 전」으로 명시 · 애니메이션 속도: tokens 표가 정본(accessibility 는 가리킴) · 다크 전용·`--horizon`: **값은 CSS, 뜻은 tokens 문서**(CSS 주석이 낡은 쪽 — 코드 후속) · `referenced_*`: 서버가 인용에서 채움(ADR-065) 으로 셋 다 같은 말 | 재시도 횟수(chat-context 1 · errors 2 · `receive.ts:43` 2) · WS 유형 수(8 · 7 · 코드 7) · 장식 애니메이션(accessibility 「7초 이상」 · tokens 1.6/2.6s) · 다크 전용(tokens 「확정」 · css 「미정」) · `--horizon`(tokens ADR-048 「의미」 · css:164 「장식 전용」) · `referenced_*`(system-prompt 「뺐다」 · chat-context §5 · api §3.9) | 어느 쪽이 이기는지 정해야 닫힘 |

## 진행 방법

- 손질은 `.claude/skills/doc-gardening/` 절차로, **`origin/main` 을 별도 워크트리에 받아** 합니다 — 공유 워킹트리는 남의 작업 중입니다.
- 2절은 문서별 PR. 1·3절은 해당 파일의 진행 중 작업이 머지된 뒤 묶어서.
- 4절은 코드 PR 또는 결정 — 문서 손질 PR 에 섞지 않습니다.
- 끝난 줄은 지우지 말고 취소선. 이 문서의 역할이 끝나면 은퇴시킵니다.
