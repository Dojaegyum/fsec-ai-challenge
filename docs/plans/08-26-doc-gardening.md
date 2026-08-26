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

## 1. 은퇴 문서에서 꺼낸 미결 — 제자리를 찾아야 하는 것

은퇴한 계획이 들고 있던 열린 항목입니다. 은퇴 문서는 더 안 고치므로 여기서 추적합니다. 닫히면 취소선.

| 무엇 | 어디서 왔나 | 지금 상태 (2026-08-26) | 갈 곳 |
| --- | --- | --- | --- |
| 공휴일 API 키 — 지금은 `holidays-table.ts` 2024~2035 표 | api-routes :324 | 표로 자인 (`holidays.ts:8-12`) · deadline-rules :55 「하드코딩 금지」와 충돌 | qa-readiness 또는 deadline-rules 갱신 때 함께 |
| `case.email` 칼럼 — 입력칸만 있고 저장 칼럼 없음 | api-routes :325 · service-concept :43 | migrations 0001~0005 에 없음 · Mailer 미설정(`container.ts:385`) | data-model §2 + 마이그레이션 (kth9245) |
| 발송 이력 저장 | api-routes :326 | 없음 | 위와 한 묶음 |
| `admin.message_viewed` 감사 이벤트 | api-routes :329 · api.md :1287 | `audit-logger/types.ts` 에 없음 | api.md §5 관리자 구현 때 |
| 관리자 로그인 | api-routes :330 | `src/app/api/admin` 없음, 문지기만(`gated-paths.ts:48-62`) | api.md §5 |
| 메모리 카운터의 위치 | api-routes :332 ↔ api.md :172 순환 참조 | `rate-limit.ts:39` 메모리 | api.md TODO 절에서 한쪽으로 |
| ~~`referenced_steps`·`referenced_deadlines` 용도~~ | api-routes :356 · system-prompt :314 · chat-context §5 | **#43(2026-08-26) 으로 배선됨** — 모델이 인용한 것 중 단계·기한을 가리키는 것만 골라 실음(`chat-turn.ts:97,118`) | 남은 것은 system-prompt :314 TODO 와 :202 「지시문에서 뺐다」 표기 정리 → 3절 |
| 순서 12 크론 둘 — `/api/cron/*` 라우트 · `vercel.json` crons | api-routes 순서 12 · module-names :76-80 | 라우트 없음, `gated-paths.ts:51` 만 막음 | qa-readiness Task 7 |
| 순서 13 관리자 조회 | api-routes 순서 13 | 없음 | qa-readiness Task 7 |
| 순서 14 `server-only` 표시 — 서버 모듈 26개 중 0 | api-routes 순서 14 · ADR-028 :96 | flows/lib 29파일에는 있음 | 코드 (한 PR) |
| backend-handoff 잔여 — domain-model :140 「미결」절 표제, 목업 24시간 문구 | backend-handoff 삭제 조건 | 절 안 항목은 전부 「해소됨」 | domain-model 갱신 때 절 제목만 |
| backend-baseline §2 남은 둘 — 층 4 Cron · NER | baseline (살아 있음) | `vercel.json` crons 없음 · `container.ts:375-378 ner: null` | 크론은 위와 같이, NER 은 pii-boundary :187 TODO 와 한 묶음 |

## 2. 낡음 — 코드가 앞서가 문서가 뒤처진 것, 갱신 순서

「갱신하지 않으면 **반대로** 읽히는가」로 순서를 매겼습니다. 문서별 PR 하나. `spec/backend/` 셋(②③④)은 kth9245님 판단이 필요한 자리입니다.

| 순 | 문서 | 무엇이 뒤처졌나 (근거) | 정본이 어디로 갔나 |
| --- | --- | --- | --- |
| ① | `spec/common/08-16-deadline-rules.md` | 기산 표 :27-31 「지급정지 완료」 ↔ data-model §8.0 `relief_applied_at`(`compute-deadlines.ts:270-284`) · 공고 2개월 기점 ↔ ADR-054 `notice_started_at`·`months`(`common.json:319-323`) · `months`(민법 160조)·`owner→kind`·`starts_at` 미기재 · :33 미확인 배지 ↔ 기산점 없으면 줄 자체 없음 · :83 타이머 미구현 · :35 TODO 해소 표시 잔존 | data-model §8 · `date-checker/compute.ts` 주석 · `date-checker/README`. channel-matrix 기한 표(:36-42)도 값의 정본이 KB `body.deadline` 으로 이동 |
| ② | `spec/backend/08-16-chat-context.md` | §6.3·§9 insufficient→슬롯 질문 미배선(`chat-turn.ts:59-67` 두 갈래뿐, `publish.ts:89-95` 호출처 0) · §3 사건 상태에 기한·부산물 없음(`chat-turn.ts:142-147`) · §7.2 `chat.context_built` 기록 없음 · 재시도 1회 ↔ `receive.ts:43` 2 ↔ errors.md 2회 · :150 TODO 는 :540 에서 해소 | — |
| ③ | `spec/backend/08-14-slot-tiering.md` | :15·21 자동 추출 우선 ↔ `slot-extractor` 미배선(`read-evidence.ts:417-438`) · T2 5개 ↔ `check.ts:36-48` 11+2 · 슈퍼셋=조건 라벨 ↔ KB `conditional` 전부 null · T0 KB 항목(1332·송금금지·비행기모드) 없음 · :37 「전부 버튼」 ↔ text/amount/date · :66 TODO 해소(§5.1) 표시 잔존 | data-model §5.1 · `check.ts:76-110` |
| ④ | `spec/backend/08-16-data-model.md` | 마이그레이션에만: `uk_deadline_identity`(0005:40-42, `db.ts:753`) · `case_vault.restore_mapping` DDL 절 없음(0004:27-39) · 내부 모순 §11.4 actor↔`plan.ts:89 body.actor`, §8.2/§15 `freeze_requested_at`↔§8.0 `relief_applied_at`, §11.4.1 `call_center`↔§11.1 `report_tel` · ADR-049 부분 반영(§14 TTL·§2:117) · 정본 표기 충돌 `0001:3` 「정본은 spec」↔`db.ts:11` 「정본은 migrations」· ~~0006(actor/agency) 들어오면 §6 CHECK 또 뒤처짐~~ → #43 이 §6 과 0006 을 같은 커밋에 올림(RFC-001 「스키마를 바꾸면 마이그레이션이 함께」가 지켜진 예) | DDL 은 마이그레이션 누적본으로 동기화하고(검사기 확장 검토) 산문(§5.2·6.1·8·9·10.1·11.2·11.4·12.5·13·14)은 유지 |
| ⑤ | `spec/common/08-21-user-journeys.md` | 기준 08-21 이후 src 81커밋. :212-225 「끊기는 자리」 7행 중 4행 해소 · :47-60 여정 A 「UI만」열 전부 낡음 · :270-274 deadline null 낡음 · 새 갈림길 둘 없음(슬롯 `pii_pending` ADR-041 · 볼트 되받기 ADR-050) · 여정 B(메일 링크) 미구현 전제 | :4 「이 문서가 정본」 실효 — 기준 커밋 재기록 또는 요약으로 내림 |
| ⑥ | `spec/frontend/08-17-workspace-panels.md` | 「여덟」(WS-confirm) ↔ `work-handler/types.ts:14-31` 7종 ↔ screens·components 「일곱」 · 시그널 파이프 :87-103 ↔ `signal.ts` 를 `page.tsx:168-178` 가 안 부름 · WS-visit 빈 라벨(`panels.tsx:185-187`) · WS-download 뜻 · WS-wait 막대 하드코딩 | 4절 ② 코드 문제와 같이 |
| ⑦ | `spec/common/08-16-domain-model.md` | Analysis·Document·KbRelease 표 없음(ADR-037·045) · T2 5→15, `pii_pending` 누락 · 해소된 TODO 4건 잔존(문진 7선택지·부산물 TODO①·24시간 동의·토큰 규격) · :60 가족 계정 ↔ :176 계정 없음 · :140 「미결」 표제 | 상태·저장 경계는 data-model. 관계 트리·저장경계 표만 남김 |
| ⑧ | `spec/frontend/design-system/08-16-components.md` | 첫 표 9종 파일 0(절 단위 은퇴) · 둘째 표 6칸(PlanBoard ◇ · WaitCard 「미결」→ADR-048 · FileRail·IssuedLink 위치 · 「모듈 넷」→일곱 · 귀속표) · `ui/` 규칙 위반 2(`Icon.tsx`, `saa-s-template.tsx` 302줄 import 0) · 복사 폴백 `doc.tsx` 만 | plan-viewer·deadline-viewer README 가 앞섬 |
| ⑨ | `spec/common/08-14-glossary.md` | §전제 데스크톱 우선 · §기술스택(Whisper+Web Speech ADR-038 폐기 · Vision OCR→EasyOCR · 서버 NER 미선정 · docx ADR-037 · `ManualKB` 코드 없음) 전부 폐기된 전제 · 합성데이터 여전히 미반영 | 개념 표만 남기고 축소. 스택은 ARCHITECTURE §2·§6, 전제는 service-concept |
| ⑩ | `spec/common/08-14-features.md` | F-06 타이머(ADR-036 T0 레일로 대체) · F-04 case-reader·F-05b slot-extractor 미조립 · 통화동반·스크립트·F-10 코드 0 · `doc-filler` 폴더 없음 · F-07 표에 kb-finder·prompt-builder 누락 | F-ID 정의처(검사기 `ID_SOURCES`)라 은퇴 불가 — 상태 열(구현/폐기/미착수) 추가 |
| ~~⑪~~ | ~~`spec/common/08-16-module-boundaries.md`~~ | ~~금지 규칙은 각 `types.ts` 머리 + ARCHITECTURE:307-319 에 흡수 · :38,42 자리별 복원 ↔ pii-boundary ADR-034 **spec 끼리 충돌** · doc-filler 「완성 문서」(ADR-037) · API Gateway·Case Store 행 · :119 물리배치 TODO 해소(ADR-028)~~ | **2026-08-26 갱신 완료** — 유지하기로 판단(금지를 코드보다 먼저 설계하는 자리가 이것뿐). 표 33행만 남기고 경계 규칙·흐름도·미결 절은 걷어냄. `pii-restorer` 행은 ADR-034 대로 적고 코드 뒤처짐은 4절 ① 에. API Gateway·Case Store 행 제거, `types.ts` 의 추가 금지를 표로 흡수. **남은 것** — 표 ↔ `types.ts` 머리 대조를 검사기로 묶기(`inventory --check` 확장 후보) |

## 3. 살아 있는 문서에 남은 낡은 표시 — 첫 손질에서 못 닫은 것

근거는 확정됐지만 **다른 세션이 고치는 중인 파일**이라 손대지 않았습니다(api · screens · data-model · pii-boundary · components · tokens · qa-readiness). 그 작업이 머지된 뒤 닫습니다.

| 문서 | 닫을 표시 |
| --- | --- |
| `spec/common/08-14-api.md` | :557·575·577 「서버 미구현」→ `api-deadlines.ts:70-92` · :629 fixtures 문구 · :932-944 「경로 파라미터 미정」→ ADR-039(같은 문서 :197 과 자기모순) · :1061 「BAD_REQUEST 없음」→ errors.md:302 · §1.2 env 표 `DIRECT_URL`·`LLM_*` 누락, 인용 블록이 표를 가름 · §3.3 `ingest_status`·`shortfalls` · §3.8 `receipt_doc` · §3.11 빈 entries 400 · §3.12 상한 60 |
| `spec/common/08-14-pii-boundary.md` | :180-183 「파란 토큰 = 전송 안 됨」(`page.tsx:15` 「이제 사실 아님」) · :187 NER TODO ↔ ARCHITECTURE:486 「확정」 · :188-193 2차 매핑 TODO 과소(전사 경로는 1차도 서버, `tokenize.ts:9-13`) |
| `spec/frontend/08-14-screens.md` | §S-07 ⬜ 공고 시작일 → 해소(api.md:575, `plan.tsx:214`) · §S-03 백신 절 은퇴(라우트 없음) · 폐기 표 :15-25 와 §S-09 절 중복 · 층 C 칸 3곳(S-05 pii-masker·file-sender, S-10 doc-filler) · TODO 「라우팅·상태 미정」 · 날짜 마커 8곳 |
| `spec/frontend/design-system/08-16-tokens.md` | 「다섯 상태」절(:175-185) 은퇴 · `--horizon` 뜻 ↔ `globals.css:164` · 다크 전용 「확정」 ↔ css:132 「미정」 · `row-flash`·border-beam 사용 0 · 헤더 08-18 뒤 08-23 개정 미표기 |
| `spec/frontend/design-system/08-16-accessibility.md` · `README.md` | :363 「다섯」→여섯 · :366 `[계좌번호]`→`[계좌-1]` · README:30 「눈으로 보는 정본」(`08-18-design-system.html` 이 css 와 어긋남 — 스냅샷 표기 또는 재생성) |
| `spec/backend/08-14-channel-matrix.md` | :36-42 기한 표 → KB 로 정본 이동 표기 · :82 TODO 은행 19곳 해소(비은행 미확인) · 5유형 KB 파일 없음 표기 |
| `spec/backend/08-14-completion-hook.md` | L1 OCR 대조 미구현·포맷 체크 항상 `format_unknown` 표기 |
| `spec/backend/08-17-system-prompt.md` | :314 `referenced_*` 용도 TODO → #43 으로 배선됨(응답 §3.9 에 실림) · :202 「지시문에서 뺐다」는 여전히 맞는지 #43 뒤 확인 |
| `rfc/001` · `rfc/002` | RFC-001 「모듈 골격」 33 중 32 준수(`doc-filler` 만 `.gitkeep`) · RFC-002 :34-46 파일 11개 vs 실재 5, `kb:load` 적재기·`body.actor/action`·`_note/_todo`(`kb-load.ts:396` 이 RFC-002 근거로 인용하나 본문 없음), `src/kb/README.md:13` 없는 `frozen-account.json` |
| 모듈 README | `chat-handler:53-56` · `case-opener:45-47` · `transcript-viewer:26-27` · `work-handler:61-63` · `src/modules/README.md:6,13` · `assets/artifacts/handoff/README.md:19` |
| `docs/plans/08-23-qa-readiness.md` | :180 date-checker 호출(구현됨) · :610 org.json(채워짐) · 「27건」→51 · `seed:deadline` 「지운다」인데 package.json 잔존 · Task1 표 BLOB_TOKEN vs Supabase |

## 4. 문서 정리로 안 닫히는 것 — 코드·판단

| 무엇 | 근거 | 성격 |
| --- | --- | --- |
| ① **ADR-034 「모든 자리 전체 복원」을 코드가 안 따름** | pii-boundary :131-138 은 ADR-034. 코드는 구규칙 — `pii-restorer/policy.ts:33-47` chat-answer 부분 복원·plan-text 없음, `chat-handler/turn.ts:57,67`, ARCHITECTURE:183,395. module-boundaries :38,42 도 구규칙 | **제품 약속.** spec 이 앞서고 코드가 뒤처진 유일한 자리 |
| ② **WS-read·WS-wait 에 부산물 입력이 무조건 붙음** | workspace-panels :46·:178·:45 ↔ `workspace.tsx:271-309` ArtifactSlot 을 모든 패널에 삽입(`panels.tsx:298,314`). `workspace.test.tsx:88-92` 가 「늘 있다」로 고정 | 계약 위반을 테스트가 보호 |
| ③ **`frozen_account` 트랙이 어느 spec 에도 없음** | 0001:27-28 CHECK · `start/open.ts:27` · `start/page.tsx:58` 선택 가능 ↔ `src/kb/frozen-account.json` 없음 → 선택해도 `common.json` 지급정지 안내 | 계약 공백 — channel-matrix :57-63 만 언급 |
| ④ **층 1 후반·층 4 트리거가 통째로 미조립인데 문서 넷이 현재형** | NER(`container.ts:375-378`) · `case-reader`·`slot-extractor`·`kb-collector`·`kb-reviewer`·`doc-builder` import 0 · 크론 라우트·`vercel.json` crons 없음 · Mailer·ReminderSource unconfigured · `casePurger` 호출자 0 — features·pii-boundary·module-boundaries·module-names | 문서에 「구현 전」 표시가 없어 생긴 것 → ⑩ 상태 열로 |
| ⑤ **같은 값을 세 문서가 다르게 적음 — 정본 지정 필요** | 재시도 횟수(chat-context 1 · errors 2 · `receive.ts:43` 2) · WS 유형 수(8 · 7 · 코드 7) · 장식 애니메이션(accessibility 「7초 이상」 · tokens 1.6/2.6s) · 다크 전용(tokens 「확정」 · css 「미정」) · `--horizon`(tokens ADR-048 「의미」 · css:164 「장식 전용」) · `referenced_*`(system-prompt 「뺐다」 · chat-context §5 · api §3.9) | 어느 쪽이 이기는지 정해야 닫힘 |

## 진행 방법

- 손질은 `.claude/skills/doc-gardening/` 절차로, **`origin/main` 을 별도 워크트리에 받아** 합니다 — 공유 워킹트리는 남의 작업 중입니다.
- 2절은 문서별 PR. 1·3절은 해당 파일의 진행 중 작업이 머지된 뒤 묶어서.
- 4절은 코드 PR 또는 결정 — 문서 손질 PR 에 섞지 않습니다.
- 끝난 줄은 지우지 말고 취소선. 이 문서의 역할이 끝나면 은퇴시킵니다.
