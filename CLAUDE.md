# CLAUDE.md — 에이전트 작업 규약

이 저장소에서 코드나 문서를 다루기 전에 읽는 진입점입니다.

## 이 프로젝트

금융보안원(FSI) 주관 **2026 금융 AI Challenge** 출품작 **FinAlly**를 만듭니다.

> Fin(금융) + Ally(동행자), 그리고 *Finally*(마침내).
> 보이스피싱 피해자가 진술만 하면 **자기 사건에 맞는 절차를 찾아주고, 기한과 서류를 몇 달에 걸쳐 대신 관리**합니다.

주제와 이름 모두 확정됐습니다 → [ADR-001](decisions/001-topic-selection.md), [ADR-002](decisions/002-project-name.md).

**이름 표기:** 브랜드는 `FinAlly`, 슬러그·패키지·폴더는 `fin-ally`, 코드 식별자는 `finAlly`/`FinAlly`.
**`finally`는 JS·TS 예약어이므로 식별자나 패키지명으로 쓰지 마세요.**

## 이 서비스가 무엇이 아닌지 — 먼저 알아야 할 것

- **112를 대체하지 않습니다.** 신고 이후의 며칠~몇 달을 맡습니다. 진입은 **검색·직접 접속**을 전제합니다 — 상담 종료 후 링크 유입은 우리가 제어할 수 없어 기대하지 않습니다 ([ADR-021](decisions/021-reentry-and-identity.md)).
- **"알려주는 서비스"가 아닙니다.** 3영업일을 설명하는 글은 이미 넘칩니다 — **사건을 대신 관리**하는 것이어야 합니다. 알림 하나가 전부면 은행 앱이 흡수합니다.
- 핵심 동작은 **진입점에서 사용자의 진술을 받아 가장 적절한 매뉴얼을 고르는 것**이고, 거기서 사건 관리로 넘어갑니다.

`spec/`은 구 명칭(골든30) 시점에 기획서 v1.2에서 추출한 것이라 **30분 긴급 대응에 무게가 실려 있습니다.**
포지셔닝 전환(긴급 진입 → 사건 관리)과 제도 변경 반영이 아직 덜 됐습니다 — 각 문서의 갱신 표시를 확인하세요.

## 어디를 봐야 하나 — 정본의 위치

| 알고 싶은 것 | 볼 곳 | 성격 |
| --- | --- | --- |
| **이 서비스가 무엇을 약속하나** | [spec/common/08-17-service-concept.md](spec/common/08-17-service-concept.md) | **골자.** 기획서 §0을 대체 — 판단이 갈리면 여기로 거슬러 오세요 |
| **구현이 따라야 할 계약** | `spec/` (`common/`·`backend/`·`frontend/`) | **정본.** 코드를 쓰기 전 여기부터 |
| **시스템이 무엇으로 어떻게 도는가** | [ARCHITECTURE.md](ARCHITECTURE.md) | 기술 선택·모듈 배치·저장소·배포. 채워져 있습니다(2026-08-16) — 모듈 33 의 연결도는 §4 |
| **앱 밖에서 도는 것 · 그 자리를 만드는 것** | `services/` · `deploy/` | 전사·판독 서비스(Python)와 서버 준비 도구. 경계는 [RFC-001](rfc/001-repo-structure.md) 「`services/`」·「`deploy/`」 |
| **모듈 이름이 무엇이고 무엇을 맡나** | [spec/common/08-16-module-names.md](spec/common/08-16-module-names.md) | 서버 네 층 + **브라우저 층 C**. 코드 폴더가 여기 묶여 있어 CI가 강제 |
| **무엇을 어디에 둘지 · 작업 규칙** | `rfc/` | **규약.** 현재형으로 "이렇게 한다". 새 파일을 만들기 전 [RFC-001](rfc/001-repo-structure.md) |
| 왜 그렇게 정했나 | `decisions/` | 판단 근거의 이력(ADR). 과거형, 고치지 않음 |
| **절차·기한·기관의 근거** | [docs/research/](docs/research/) — 목차가 [README](docs/research/README.md) | **조사 원본 열여덟 편.** 법령 조문·기관 연락처·실측값이 전부 **출처와 확인일과 함께** 있습니다. `kb_entry`·`org` 의 `legal_basis`·`source_url` 이 여기서 나옵니다 |
| 서비스 기획 전체 그림 | `assets/artifacts/plans/08-13-service-plan.html` | 사람이 보는 원본. 다이어그램·목업 포함. **구 명칭 시점 문서** |
| **색·크기·상태를 눈으로** | `assets/artifacts/plans/08-18-design-system.html` | 팔레트·타입 사다리·대비 실측. 값의 정본은 `src/app/globals.css` |
| **화면이 어떻게 생겼나** | Claude Design 캔버스 + `assets/artifacts/handoff/` | **디자인 정본.** 받은 그대로의 스냅샷과 캔버스 URL. 절차는 [RFC-003](rfc/003-design-handoff.md) |
| 화면 목업(옛 그림) | `assets/artifacts/plans/08-17-screen-mockups.html` | **동결됨** — 화면 01(S-04)까지만 갱신. 레이아웃은 더 이상 정본이 아니고 **설계 노트만 유효**합니다 ([ADR-030](decisions/030-design-handoff.md)) |
| 절차 지식의 근거(옛 자료) | `assets/artifacts/context/08-13-aftermath-research.html` | 법령·기관 기준 사후처리 절차. **위 `docs/research/` 가 더 최신이고 정확합니다** |
| **자동화를 어디까지 하나** | [spec/common/08-20-automation-boundary.md](spec/common/08-20-automation-boundary.md) | **계약.** 넘으면 인허가가 필요한 선. 새 기능을 볼 때 여기서 대조 |
| **STT·OCR 이 실제로 얼마나 새나** | [docs/research/09](docs/research/09-로컬모델-PII인식-실측.md)·[11](docs/research/11-로컬OCR-PII인식-실측.md) | **우리가 직접 잰 값.** `transcriber`·`pii-tokenizer` 를 만들기 전에. 사람이 보는 요약은 `assets/artifacts/research/08-21-pii-measurement.html` |
| **전사를 무엇으로 어떻게 돌리나** | [ADR-052](decisions/052-stt-configuration.md) · 근거는 [14](docs/research/14-STT-전처리-실측.md)·[15](docs/research/15-STT-GPU-실측.md) | **계약.** 모델·배치·VAD 와 **토큰화 앞의 자리표기 되돌리기**. 사람이 보는 요약은 `assets/artifacts/research/08-25-stt-benchmark.html` |
| **누가 어떤 길로 지나가나** | [spec/common/08-21-user-journeys.md](spec/common/08-21-user-journeys.md) | **계약.** 갈림길 열 · 여정 열둘(2026-09-04 기준 `main` 으로 다시 셈). **`src/` 를 읽어 세운 것**이라 이 짝에서는 spec 이 정본이고 [아티팩트](assets/artifacts/plans/08-21-user-journeys.html)가 사본입니다 |
| **제도·경쟁의 최신 사실** | `assets/artifacts/archived/candidates/최종후보군-보드.html` | 아카이브. **법적 경계는 위 문서로 올라왔습니다** — 나머지 제도·경쟁 사실은 아직 여기가 최신입니다(공고문 원문 확보 후 재조사한 최종본) |
| 대회 일정·진행 상황 | `docs/context/AGENDA.md` | 배경 |
| 구현 계획 | `docs/plans/` | 무엇을 어떤 순서로 만들지. **세션이 바뀌면 [qa-readiness](docs/plans/08-23-qa-readiness.md) 부터.** 문서가 코드보다 뒤처진 자리는 [doc-gardening](docs/plans/08-26-doc-gardening.md). 끝난 계획은 지우지 않고 **은퇴** 절에 있습니다 |
| 주제 선정 과정·탈락 후보 | `assets/artifacts/archived/candidates/` | 아카이브. 판단 과정은 `decisions/001-topic-selection.md`에 있으니 근거 원문이 필요할 때만. 갱신하지 않음 |
| 코드 | `src/` | 도메인 모듈 32(`src/modules/` · 이름 33 중 `doc-filler` 는 [ADR-064](decisions/064-doc-filler-retired.md)로 폐기) · API 라우트 15(사건 13 + 크론 2) · 흐름(`src/flows/`) · 마이그레이션 0001~0009. 스캐폴딩 단계는 지났습니다 |
| **매뉴얼을 어떻게 쓰나** | [RFC-002](rfc/002-kb-authoring.md) | KB 원본은 `src/kb/`. **DB는 사본이라 직접 INSERT 하지 않습니다** |
| 로고·favicon·컴포넌트 원본 | `assets/brand/`, `assets/components/` | 원본만. 앱이 서빙하는 사본은 `src/public/` |

`src/`에는 create-next-app이 생성한 `AGENTS.md`·`CLAUDE.md`가 있습니다. `next dev`가 `AGENTS.md`를
다시 쓰므로 지우지 말고 두세요. 프로젝트 규약의 정본은 **이 파일**입니다.

### spec과 아티팩트의 관계 — 중요

`assets/artifacts/`의 HTML은 **사람이 보는 원본**이고, `spec/`의 Markdown은 **거기서 추출한 구현 계약**입니다.

- **구현 작업에는 `spec/`을 읽으세요.** HTML 기획서는 50KB가 넘고 스타일·목업 마크업이 대부분이라, 필요한 계약만 담긴 `spec/`이 정확하고 쌉니다. **아티팩트를 통째로 읽지 마세요.**
- 각 spec 문서 머리의 **출처 줄**이 원본과 절 번호를 가리킵니다. 근거가 필요하면 그걸 따라가세요.
- 둘이 어긋나면 **HTML 기획서가 상위**입니다(사람이 직접 쓴 원본). 어긋난 걸 발견하면 임의로 맞추지 말고 사람에게 알리세요.
- **단 화면 디자인은 예외입니다.** `08-17-screen-mockups.html` 은 동결됐고, 그림의 정본은 **Claude Design 핸드오프**입니다 ([RFC-003](rfc/003-design-handoff.md) · [ADR-030](decisions/030-design-handoff.md)). 시안과 `spec/` 이 어긋나면 어느 쪽도 자동으로 이기지 않습니다 — **사람이 정합니다.**
- 기획서가 개정되면 `spec/`에 반영하는 것까지가 한 작업입니다.

### 파일명 — 폴더마다 다릅니다

규약은 [RFC-001](rfc/001-repo-structure.md), 근거는 [ADR-003](decisions/003-spec-layout.md)·[ADR-006](decisions/006-artifacts-and-numbering.md)입니다.

| 폴더 | 형식 | 예 |
| --- | --- | --- |
| `rfc/` · `decisions/` | **`NNN-{slug}`** — 번호가 곧 ID | `decisions/003-spec-layout.md` → `ADR-003` |
| `spec/` · `docs/` · `assets/artifacts/{plans,context}` | **`MM-dd-{slug}`** | `spec/common/08-14-pii-boundary.md` |
| `docs/research/` | **`NN-{제목}`** — 읽는 순서가 있는 연작 | `docs/research/06-경로별-실측조사.md` |
| `assets/artifacts/archived/` · `assets/brand/` | 손대지 않음 | |

- **`MM-dd`는 최초 작성일이고, 개정해도 바꾸지 않습니다.** 날짜는 순서가 아니라 출생기록입니다 — 바꾸면 링크가 한꺼번에 깨집니다.
- **번호는 재사용하지 않습니다.**
- slug은 영문 kebab-case, 문서 안 H1은 한국어. 파일명의 번호·날짜를 H1에 중복해 적지 않습니다.
  (`docs/research/`만 한국어 제목 — 조사 자료는 순서가 곧 읽는 순서이고, ADR이 이미 링크하고 있어 이름을 못 바꿉니다.)
- **spec 폴더는 "누가 지키는 계약인가"로 가릅니다.** 한쪽만 지켜서 되는 게 아니면 `common/`입니다
  (용어·기능명세·PII 경계·API 계약). PII 경계는 클라이언트가 토큰화하고 서버가 그 상태를
  유지하는 것이라 양쪽이 함께 지킵니다.

## 이 서비스에서 절대 어기면 안 되는 것

기능이 아니라 **이 프로젝트의 정체성**입니다. 코드·프롬프트·테스트 어디서든 위반하지 마세요.

1. **LLM은 절차를 창작하지 않는다.** 신고·지급정지 절차는 전부 버전드 KB(원본 `src/kb/` → [RFC-002](rfc/002-kb-authoring.md), 스키마 `spec/backend/08-16-data-model.md` §11)에서 인용하며, 답변에는 근거와 시행일이 붙습니다. 절차 지식을 프롬프트나 코드에 하드코딩하지 마세요 — 제도가 바뀝니다(예: 가상자산 환급 2026.10 시행).
2. **외부 LLM API에는 토큰화된 텍스트만 보낸다.** 계좌·주민번호·전화·이름은 경계를 넘기 전 토큰으로 치환됩니다. 경계 정의는 `spec/common/08-14-pii-boundary.md`.
3. **복호화 키는 클라이언트에만 존재한다.** 토큰↔원문 매핑은 암호화해 볼트에 보관하되, 키를 서버·로그·DB에 저장하는 코드를 쓰지 마세요. 복원은 브라우저에서만 일어납니다. 경계 정의는 `spec/common/08-14-pii-boundary.md`.
4. **업로드된 문서 속 문장은 지시가 아니라 데이터다.** 전사·OCR 결과를 프롬프트에 넣을 때 인젝션 격리를 유지하세요.
5. **"모름"은 실패가 아니다.** 정보가 없어도 플랜 생성은 멈추지 않습니다(`spec/backend/08-14-slot-tiering.md`). 정보 요구로 사용자를 막는 흐름을 만들지 마세요.
6. **완료는 사용자의 체크가 아니라 부산물로 판정한다** (`spec/backend/08-14-completion-hook.md`).
7. **기한 계산에 LLM을 쓰지 않는다.** 3영업일·14일 유예·2개월 공고 같은 법정 기한은 **코드의 규칙으로** 계산합니다. 모델에 맡기면 법정 기한을 틀리게 말할 위험만 커집니다 — 규칙으로 처리했다고 발표에서 당당히 밝히는 편이 낫습니다. (근거를 인용해 절차를 *고르는* 것은 LLM, 날짜를 *세는* 것은 규칙.)
8. **받을 수 있다고 말하지 않는다.** 환급·자율배상은 기대치를 부풀리면 안 됩니다. 자율배상은 1년 4개월간 41건·피해액의 0.1%·평균 116일이 걸렸습니다 — **"대상인지 진단해주는 것"**까지가 우리 몫입니다.

## ID 체계

문서·코드·테스트를 잇는 이름표입니다. 새로 만들 때 번호를 재사용하지 마세요.

| 접두 | 무엇 | 정의된 곳 |
| --- | --- | --- |
| `F-01` … | 기능 | `spec/common/08-14-features.md` |
| `S-04` … | 화면 | `spec/frontend/08-14-screens.md` |
| `CH-bank` … | 경유 서비스 유형 | `spec/backend/08-14-channel-matrix.md` |
| `T0/T1/T2` | 슬롯 티어 | `spec/backend/08-14-slot-tiering.md` |
| `ADR-001` | 판단 근거 | `decisions/` |
| `RFC-001` | 규약 | `rfc/` |

커밋 메시지와 코드 주석에서 이 ID로 참조하세요 (예: `F-05b 슬롯 체커 구현`).

## 다섯 폴더의 역할 — 헷갈리면 여기

```
바깥 세상의 사실                     결정할 일이 생김
   ↓ 조사                              ↓ 논의
docs/research/  무엇이 사실인가       decisions/  왜 그렇게 정했나
(출처·확인일 · 정정하며 쌓음)          (과거형 · 이력 · 고치지 않음)
   │                                     ├→ rfc/   그래서 지킬 작업 규칙
   └────────── 근거를 대 준다 ─────────→  ├→ spec/  그래서 만들 제품 계약
                                         └→ src/   구현
```

| 물음 | 폴더 |
| --- | --- |
| 이 파일을 어디에 둬야 하나? 파일명은? | `rfc/` |
| 왜 이렇게 하기로 했더라? | `decisions/` |
| 제품이 무엇을 해야 하나? | `spec/` |
| **이 값의 근거가 뭐지? 이미 조사됐나?** | **`docs/research/`** |

- **`docs/research/` 는 「사실」이고 나머지 넷은 「우리가 정한 것」입니다.** 법정 기한·기관
  연락처·실측값처럼 **바깥에서 와서 우리 마음대로 못 바꾸는 것**이 여기 있고, 전부 출처와
  확인일이 붙어 있습니다. **틀린 것이 발견되면 정정하며 쌓습니다** — ADR 과 달리 고칩니다.

- **`spec/`과 `rfc/`의 경계는 "어기면 무엇이 깨지나"입니다.** 제품이 잘못 동작하면 `spec/`, 저장소가 어질러지면 `rfc/`.
- **규약이 바뀌면 `rfc/` 문서를 고치고, 그 문서의 「개정 이력」에 한 줄 적습니다**(현행이므로).
  왜 바꿨는지는 커밋 메시지에 남습니다.
- **ADR은 변경 이력이 아닙니다.** 제품이 사용자에게 하는 약속이 바뀌거나, 되돌리는 데 마이그레이션이
  필요하거나, 탈락시킨 대안이 나중에 필요할 때만 씁니다 (→ [ADR-020](decisions/020-adr-threshold.md)).
  파일 위치·이름·검사기처럼 `git mv` 한 번이면 되돌아가는 변경에는 **쓰지 마세요.** 애매하면 쓰는 쪽으로.
- **ADR은 지우지도 고치지도 않습니다.** 뒤집을 때는 새 번호를 쓰고 기존 것을 `대체됨`으로 표시합니다.
- **번호는 RFC·ADR 모두 재사용하지 않습니다.**

새 문서·폴더를 만들기 전에 [RFC-001 저장소 구조 규약](rfc/001-repo-structure.md)의 결정 트리를 따르세요.
어디에도 안 걸리면 임의로 만들지 말고 물어보세요.

## 작업 규칙

- **`spec/`을 고치기 전에 `decisions/`와 `rfc/`를 먼저 읽으세요.** 이미 결정된 것을 모르고 고치면
  ADR과 spec이 어긋나고, 어느 쪽이 정본인지 알 수 없게 됩니다. 결정에 어긋나는 변경은
  **새 ADR 없이 하지 않습니다** — 뒤집을 이유가 생겼다면 새 ADR을 쓰고 기존 것을 `대체됨`으로 표시하세요.
- **spec을 근거로 코드를 쓸 때도 같습니다.** 관련 ADR·RFC를 먼저 확인하고, 답변·커밋 메시지에
  근거가 된 `ADR-xxxx`·`RFC-xxxx`를 함께 적으세요. 근거를 못 찾으면 지어내지 말고 사람에게 물으세요.
- **모르는 절차·수치를 지어내지 마세요.** 이 서비스는 잘못된 안내가 곧 피해자의 금전 손실입니다. 근거가 없으면 `TODO(근거 필요)`로 남기고 사람에게 물으세요.
- **근거가 필요한 값을 찾기 전에 [`docs/research/`](docs/research/) 를 먼저 보세요.**
  법정 기한·기관 연락처·경로별 절차는 **이미 조사돼 있을 확률이 높고**, 없더라도
  **「어디서 확인해야 하는지」와 「무엇을 시도했다가 막혔는지」가 적혀 있습니다.**
  거기 있는 것을 모르고 다시 찾으면 시간을 버리고, 더 나쁘게는 **조사가 이미 정정해 둔
  틀린 값을 다시 씁니다**(예: 사건사고사실확인원 온라인 발급 → [04 §0](docs/research/04-기관정보.md)).
  <br>실제로 있었던 일 — 기관 사전의 출처를 찾겠다고 등록부를 한참 뒤졌는데,
  [04 §8.1](docs/research/04-기관정보.md) 이 *"이들은 각 사업자 공식 페이지에서
  확인해야 합니다"* 라고 이미 적어 두고 있었습니다.
- spec의 `TODO` 표시는 "아직 정해지지 않은 것"입니다. 임의로 채우지 말고 확인하세요.
- 목업·기획서에 등장하는 전화번호·금액·기관명은 **전부 예시**입니다. 실제 연락처는 KB 구축 시 출처와 함께 확인해야 합니다.
- 문서는 한국어로 씁니다. 코드 식별자는 영문.
- **문서를 만들거나 옮겼으면 끝내기 전에 검사기를 돌리세요** (→ [ADR-017](decisions/017-doc-integrity-ci.md)).
  링크·앵커·ID·파일명·번호·목차 등록·ADR 불변성을 봅니다. 설치는 필요 없습니다.

  ```
  python .github/scripts/doc-integrity.py
  ```

  같은 검사가 PR과 `main` 푸시에서도 돕니다 — **여기서 걸리면 CI에서도 걸립니다.**
- **역할이 끝난 문서는 지우거나 옮기지 말고 은퇴시키세요** (→ [RFC-001 「은퇴」](rfc/001-repo-structure.md)).
  문서가 코드와 어긋났는지 감사하고 은퇴시키는 절차는 `.claude/skills/doc-gardening/` 스킬에 있습니다.
- **기관 사전(`src/kb/org.json`)에 무언가를 넣기 전에** `.claude/skills/org-materialization/`
  스킬을 보세요 (→ [ADR-018](decisions/018-inventory-skill.md) 의 스킬 규약).
  **출처를 요약시켜 읽으면 이름이 밀립니다** — 「한국산업은행」이 「국민은행」으로 붙은
  사고가 실제로 있었습니다. 방향을 뒤집어 **아는 이름이 원문에 있는지**만 대조합니다.

## 아직 정해지지 않은 것

- 대회 공식 일정·제출물 규격 (`docs/context/AGENDA.md`의 `확인 필요` 항목)
- 코드보다 뒤처진 spec 의 갱신 순서와, 같은 값을 세 문서가 다르게 적은 자리의 정본 지정 → [docs/plans/08-26-doc-gardening.md](docs/plans/08-26-doc-gardening.md)
