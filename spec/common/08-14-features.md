# 기능명세 (데스크톱 MVP)

> **출처** — [서비스 기획서 v1.2](../../assets/artifacts/plans/08-13-service-plan.html) §7

 요건 매핑의 ⓪①②③은 기획서 절 번호입니다
(⓪ 업로드 · ① 분석 파이프라인 · ② PII 격리 · ③ 절차 매뉴얼).

> **2026-09-04 손질 — 「상태」열을 더했습니다.** 이 문서는 F-ID 의 정의처라 은퇴하지 않고, 기능마다 코드가 어디까지 왔는지를 적습니다.
> **구현** = 흐름에 조립돼 돕니다 · **부분** = 설명의 일부만 · **미조립** = 모듈 폴더는 있으나 `src/flows/`·`src/lib/container.ts`·`src/app/`
> 어디도 부르지 않습니다(= 구현 전) · **폐기** = 하지 않기로 했습니다 · **미착수** = 코드 0. 판정 근거는 import 유무이고, 근거 파일을 함께 적었습니다.
> 설명 열은 기획서 §7 원문에 가깝게 두고, 바뀐 것만 취소선으로 표시합니다.

## P0 — 데모에 반드시 있어야 하는 것

| ID | 기능 | 설명 | 요건 | 상세 | 상태 (2026-09-04) |
| --- | --- | --- | --- | --- | --- |
| **F-01** | 사건 파일 생성·다중 업로드 | 녹음/이미지/텍스트 ~~드래그&드롭~~(파일 선택) → 하나의 사건으로 묶음. 증거 없이도 열립니다 | ⓪ | [06](../frontend/08-14-screens.md) | **구현** — `case-intake` · `POST /api/cases` · `/start` · `file-sender`(presigned 업로드) |
| **F-02** | 텍스트화 엔진 | STT(화자 분리)·OCR(대화 구조 보존) → 통합 전사 뷰 | ① | | **구현** — `transcriber` ↔ `services/transcriber`(`TRANSCRIBER_URL` · [ADR-052](../../decisions/052-stt-configuration.md)) · `transcript-viewer`. 주소가 없으면 전사만 멈추고 사건은 돕니다 |
| **F-03** | PII 스크러버 | 클라이언트 정규식 1차 + 서버 NER 2차 토큰화. 복원 매핑은 **암호문으로 서버 볼트에, 복호화 키는 클라이언트에**. 사건과 함께 파기 | ② | [04](08-14-pii-boundary.md) | **부분** — 1차 `pii-masker`·`pii-tokenizer`·볼트(`case_vault`) 구현. 2차 NER 은 배선됐으나 **기본 꺼짐**(`NER_URL` 없음 → 이름이 안 걸림 · `src/lib/config-report.ts`) |
| **F-04** | 수법 판별·위험도 | 토큰화 텍스트 기반 LLM 분석 — 수법 분류·위험도·**근거 스팬 인용** | ① | | **미조립** — `case-reader` 모듈만 있고 부르는 곳 0. 절차 분기에는 쓰이지 않습니다(분기축은 경유 서비스) |
| **F-05** | 경유 서비스 감지 + 매뉴얼 분기 | 이체내역·문진으로 경유 서비스 특정 → ~~8유형~~ **9유형** KB ~~(RAG)~~ **조건 조회**(벡터 검색 아님 → [ADR-012](../../decisions/012-kb-collection.md)) 기반 맞춤 플랜 생성 (근거·시행일 인용 강제) | ③ | [03](../backend/08-14-channel-matrix.md) | **구현** — `planner`·`kb-finder`(`src/flows/regenerate-plan.ts` · `…/plan`). 감지는 문진 + 전사문 기관명 교정([ADR-056](../../decisions/056-transcript-org-normalization.md)) |
| **F-05b** | 슬롯 체커 | T0/T1/T2 티어링 — ~~증거 자동 추출 우선~~, 미충족 시 1문항([API](08-14-api.md) §3.4 `input` — 버튼으로 담을 수 있는 것은 전부 버튼), "모름" 시 보수적 슈퍼셋 플랜, 보완 시 플랜 자동 재생성 | ①③ | [02](../backend/08-14-slot-tiering.md) | **부분** — 문진·재생성은 `slot-checker`(`src/flows/answer-slot.ts` · `PATCH …/slots/{slot_key}`) 구현. **자동 추출 `slot-extractor` 는 미조립**(부르는 곳 0) |
| **F-06** | 실행 보드 | 체크리스트 + ~~골든타임 타이머~~ + 3영업일 D-day 트래커 + ~~진행 타임라인~~(환급 3~6개월 기대치 관리) | ③ | [06](../frontend/08-14-screens.md) | **부분** — 타이머는 **폐기**(T0 는 레일로 상시 노출 → [ADR-036](../../decisions/036-t0-rail.md) · [ADR-063](../../decisions/063-chat-centered-layout.md)). D-day 는 `date-checker` + `src/flows/compute-deadlines.ts` + `deadline-viewer`/할 일 레일로 구현. 플랜 보드는 개발 경로 전용 |
| **F-06b** | 완수 검증 엔진 | 부산물 입력/업로드로 완료 판정 (L1 자동검증 / L2 증빙 / L3 자기신고). ~~통화 동반 모드 포함~~ | ③ | [05](../backend/08-14-completion-hook.md) | **부분** — L1/L2/L3 는 `completion-checker`(`POST …/steps/{step_id}/artifacts`) 구현, L1 의 뜻은 「받아 적었나」로 바뀜([ADR-057](../../decisions/057-receipt-number-l1.md)). **통화 동반 모드는 코드 0** |
| **F-07** | 대응 비서 챗 | 사건 컨텍스트 유지 Q&A, ~~통화 스크립트 생성~~ | ①③ | | **부분** — 챗은 `src/flows/chat-turn.ts`(`POST …/messages`) 구현. **통화 스크립트 생성은 코드 0** |

## P1 — 데모 여력이 되면

| ID | 기능 | 설명 | 요건 | 상태 (2026-09-04) |
| --- | --- | --- | --- | --- |
| **F-08** | 서류 기재 안내 | 피해구제신청서·자율배상 신청에 **무엇을 어느 칸에 적는지** 항목과 값을 짝지어 보여준다. 값 복원은 브라우저에서만. **`.docx` 생성은 P2** → [ADR-037](../../decisions/037-doc-guidance-not-generation.md) | ②③ | **부분** — 화면 S-10 `src/app/c/[token]/doc.tsx` 는 서 있으나 §3.4 `slots[]` 로 채울 수 있는 칸만 채웁니다(`GET …/doc-guide` 계약 없음). 서버 `doc-builder` 는 **미조립**(부르는 곳 0). `doc-filler` 는 **폐기**([ADR-064](../../decisions/064-doc-filler-retired.md)) |
| **F-09** | 피싱 백신 (부가 모드) | 가족 동의 기반 블라인드 모의훈련(웹 음성 링크·랜덤 시점) + 대응 리허설 평가 + 취약 패턴 리포트 | 부가 | **미착수** — 코드 0 · `/vaccine` 라우트 없음 |
| **F-10** | 명의도용 점검 | 어카운트인포·엠세이퍼 원클릭 이동 + 점검 체크리스트 | ③ | **구현(KB 단계)** — `src/kb/common.json` 의 `identity-check`(2026-08-27 검증)가 어카운트인포·엠세이퍼로 `visit` 시킵니다. 전용 모듈·체크리스트 코드는 없음 |

## P2

| ID | 기능 | 설명 | 요건 | 상태 (2026-09-04) |
| --- | --- | --- | --- | --- |
| **F-11** | 매뉴얼 KB 운영 파이프라인 | Watcher(법령 API·보도자료·기관 공지) → 변경 감지 → LLM 영향 분석 → 사람 검수 승인 → 버전 릴리스. Staleness Guard(90일 재검증). **MVP는 수동 구축 + 파이프라인 시연** | ③ | **부분** — 「수동 구축」은 `src/kb/*.json` + `npm run kb:load`([RFC-002](../../rfc/002-kb-authoring.md))로 구현. Watcher·영향 분석·검수(`kb-collector`·`kb-reviewer`)는 **미조립**(부르는 곳 0), Staleness Guard 는 계획에 없음 |

→ 상세: ~~[07](../backend/08-14-kb-operations.md)~~(2026-08-26 은퇴) → [RFC-002](../../rfc/002-kb-authoring.md) · [데이터 모델 §11·§12](../backend/08-16-data-model.md)

## 어느 모듈이 맡나

기능은 **모듈 여럿에 걸칩니다.** 특히 화면 쪽은 [ADR-023](../../decisions/023-frontend-module-names.md)으로
갈렸습니다 → [모듈 명칭](08-16-module-names.md).

| 기능 | 서버 | 브라우저 (층 C) |
| --- | --- | --- |
| F-01 사건 생성·업로드 | `case-intake` | `file-sender` · `pii-masker` · `case-opener` |
| F-02 텍스트화 | `transcriber` | `transcript-viewer` |
| F-03 PII 스크러버 | `pii-tokenizer` | `pii-masker`(1차) · `key-handler` · `pii-restorer` |
| F-04 수법 판별 | `case-reader`(미조립) | `plan-viewer` |
| F-05 매뉴얼 분기 | `planner` · `kb-finder` | `plan-viewer` |
| F-05b 슬롯 체커 | `slot-extractor`(미조립) · `slot-checker` | `chat-handler` |
| **F-06 실행 보드** | `date-checker` | **`plan-viewer` · `deadline-viewer` · `work-handler`** |
| F-06b 완수 검증 | `completion-checker` · `reminder-sender` | `work-handler` · `file-sender` |
| F-07 대응 비서 챗 | `chat-receiver` · `pii-tokenizer` · `kb-finder` · `prompt-builder` · `citation-checker` · `chat-publisher` | `chat-handler` |
| F-08 서류 기재 안내 | `doc-builder` | **셸 화면 `doc.tsx`** — 복원은 `pii-restorer`, 브라우저에서만 ([ADR-064](../../decisions/064-doc-filler-retired.md)) |
| F-11 KB 운영 | `kb-collector` · `kb-reviewer`(둘 다 미조립) | — |

**F-06이 브라우저에서 셋으로 갈린 것이 가장 큰 변화입니다.** 「실행 보드」 한 덩어리였던 것이
진행 표시(`plan-viewer`) · 기한 표시(`deadline-viewer`) · 작업 패널(`work-handler`)로 나뉘었습니다.

**F-07은 서버에서 다섯을 지납니다** — `chat-receiver`가 순서를 부르고
(`pii-tokenizer` → `kb-finder` → `prompt-builder` → 모델 1회), `citation-checker`가 갈래를 판정하고,
`chat-publisher`가 한 형태로 씌워 내보냅니다 → [ADR-022](../../decisions/022-chat-turn-boundaries.md).

## 구현 시 주의

- **F-04는 근거 스팬 인용이 필수**입니다. 판정만 내고 근거를 못 대는 응답은 스펙 위반입니다.
- **F-05의 플랜 생성은 KB 인용 없이 절차를 생성할 수 없습니다.** 모델이 아는 절차를 쓰게 두지 마세요.
- **F-08의 PII 복원은 클라이언트에서만** 일어납니다. 서버에서 완성된 문서를 만들어 내려주는 구조는 [04](08-14-pii-boundary.md) 위반입니다.
- **F-08은 서류를 만들어 주지 않습니다** ([ADR-037](../../decisions/037-doc-guidance-not-generation.md)). 별지 제1호서식 원본이 미확인(`U-17`)이고 파일 제출 경로도 미확인(`U-25`)이라, **우리가 조판한 문서는 법정 서식이 아닙니다.** 틀린 서류는 반려되고, 반려는 3영업일을 놓치는 것입니다.
- **F-09 백신 모드는 실제 전화망을 쓰지 않습니다** (사전 동의된 웹 링크 기반). 훈련 종료 즉시 "훈련이었습니다" 해제 고지가 필수입니다.

## TODO

- TODO(미정): 각 기능의 완료 판정 기준(acceptance criteria) — 구현 착수 시 기능별로 작성
- TODO(미정): F-09 가족 동의 획득·철회 흐름의 상세
