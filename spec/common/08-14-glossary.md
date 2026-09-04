# 용어와 전제

> **출처** — [서비스 기획서 v1.2](../../assets/artifacts/plans/08-13-service-plan.html) §0 · §1 · §9
>
> **2026-09-04 손질** — 이 문서는 **개념 표**만 정본으로 남깁니다. 기획서 §0 의 전제는 [서비스 골자](08-17-service-concept.md),
> §1 의 파이프라인은 [ARCHITECTURE §4·§5](../../ARCHITECTURE.md), §9 의 기술 스택은 [ARCHITECTURE §2·§6](../../ARCHITECTURE.md)이
> 정본이라 여기서는 가리키기만 합니다 — 값을 두 곳에 적으면 한쪽이 낡습니다(실제로 여기가 낡았습니다).

## 핵심 개념

| 용어 | 뜻 | 식별자 — 테이블 · 대표 타입 |
| --- | --- | --- |
| **사건 (Case)** | 업로드된 증거·분석 결과·플랜·체크리스트·서류·기한을 묶는 최상위 단위. 이 서비스의 모든 상태는 사건에 매달립니다 | `case` · `CaseStatus`(`case-intake`) |
| **증거 (Evidence)** | 사건에 첨부된 녹음·이미지·텍스트. 다중 파일이 하나의 사건이 됩니다 | `evidence` · `EvidenceKind`(`audio`·`image`·`text`) |
| **전사 (Transcript)** | 증거를 **글자로 바꾼 결과**. 녹음은 STT로, 이미지는 OCR로 변환합니다. 화자 구분과 대화 구조를 보존합니다. **저장·전송되는 것은 항상 토큰화된 상태**입니다 → [04](08-14-pii-boundary.md) | `evidence.transcript_masked` · `TranscriptLine`(`transcript-viewer`) |
| **슬롯 (Slot)** | 플랜 생성에 필요한 정보 조각(송금 여부·수단·기관·금액·시각 등). T0/T1/T2로 티어링 → [02](../backend/08-14-slot-tiering.md) | `case_slot` · `SlotKey`·`SlotState`(`slot-checker`) — 이름 15개는 [데이터 모델 §5.1](../backend/08-16-data-model.md) |
| **경유 서비스 (Channel)** | **돈이 빠져나간 경로의 유형**(은행·간편송금·가상자산·대면편취 등 ~~8종~~ **9종** — 카드가 2026-08-26 더해졌습니다 → [ADR-055](../../decisions/055-channel-card.md)). **절차 분기의 핵심 축** — 여기에 따라 지급정지의 주체·방법·환급 가능성이 달라집니다 → [03](../backend/08-14-channel-matrix.md).<br>**통신 경로(전화·문자·앱)를 뜻하지 않습니다.** 사기범이 어떻게 연락했는지가 아니라 **돈이 어디로 갔는지**입니다.<br>`CH-facetoface`(현금 직접 전달)처럼 **금융 서비스를 거치지 않은 유형도 포함**하므로 「결제 서비스」로 좁혀 읽지 마세요. | `case_channel` · `ChannelId`(`slot-extractor`) |
| **플랜 (Plan)** | 사건 상황에 맞춰 생성된 단계별 대응 절차. KB 근거 인용을 동반합니다 | `plan_step` · `PlanStep`(`plan-viewer`) — 플랜 표는 따로 없고 재생성은 `step_key` 로 병합합니다 → [데이터 모델 §6.1](../backend/08-16-data-model.md) |
| **부산물 (Artifact)** | 절차를 실제로 수행하면 남는 것(사건접수번호·접수 문자·접수증). 완료 판정의 근거 → [05](../backend/08-14-completion-hook.md) | `artifact` · `ArtifactKind`(`completion-checker`) |
| **토큰 (PII Token)** | 개인정보를 치환한 표식. `[계좌-1]`, `[이름-1]` 형식 → [04](08-14-pii-boundary.md) | `PiiToken`(`transcript-viewer`) · 매핑 암호문은 `case_vault.restore_mapping` |
| **매뉴얼 KB** | **KB = Knowledge Base(지식베이스).** 경유 서비스별 절차 지식베이스로, 출처·시행일 메타를 갖는 버전드 데이터입니다. 원본은 `src/kb/*.json`, DB 는 사본 → [RFC-002](../../rfc/002-kb-authoring.md) · [데이터 모델 §11](../backend/08-16-data-model.md) | `kb_entry` · `KbEntry`(`chat-receiver`) — ~~`ManualKB`~~ 라는 식별자는 코드에 없습니다 |

**여기 있는 것은 「무엇」의 이름입니다.** 그것을 다루는 **동작 단위의 이름**(`transcriber`·`pii-tokenizer`·`planner` 등)은 [12-module-names.md](08-16-module-names.md)에 있고, 그쪽이 정본입니다. 옛 표기(「Ingest 서비스」·「2차 PII 스크러버」·「분석 오케스트레이터」)를 새로 쓰지 마세요.

## 전제 (기획서 §0)

**정본은 [서비스 골자](08-17-service-concept.md)입니다.** 여기는 개념 표를 읽는 데 필요한 전제만 짚습니다.

- **입력 가정** — 피해자 또는 돕는 가족이 녹음(m4a/mp3), 스크린샷(문자·카톡·이체내역), 텍스트 붙여넣기 중 **하나 이상**을 제공할 수 있다. 다만 **증거는 관문이 아닙니다** — 하나도 없어도 사건은 열립니다 → [서비스 골자 「증거는 관문이 아니다」](08-17-service-concept.md).
- **당사자 본인 녹음은 합법** (통신비밀보호법상 당사자 녹음).
- ~~**데스크톱 웹 우선** — 사무 작업형 UX · 가족이 함께 · 심사 데모 환경(노트북·빔프로젝터). 모바일 반응형은 P1.~~ → **폐기.** 하나의 반응형 웹서비스이고 국면마다 주로 쓰이는 폭이 다를 뿐입니다. 심사가 빔프로젝터 시연이 아니라 배포 주소 접속이라 근거 ③이 사라졌습니다 → [서비스 골자 「기기」](08-17-service-concept.md).
- **사용자는 패닉 상태**라고 가정합니다. 정보를 못 주는 것이 정상입니다.
- **데이터** — ~~「한국어 보이스피싱 공개 데이터 0건 → 합성 불가피」~~ 는 사실이 아닙니다([research/07](../../docs/research/07-학습데이터-조사.md)): 금감원 체험관 텍스트·「그놈 목소리」 음성·AI Hub 대조군이 있고, **슬롯 추출 정답만** 합성입니다. 별개로 **개발·데모에서 국외 GPU 에 올리는 것은 합성 데이터만**이고, PII 실측의 평가셋도 전부 합성입니다 → [ADR-043](../../decisions/043-gpu-hosting.md) · [research/09](../../docs/research/09-로컬모델-PII인식-실측.md).

## 파이프라인 (기획서 §1)

~~업로드 → 텍스트화 → PII 스크러버 → LLM 분석 → 매뉴얼 분기 → 실행 보드~~ — 기획서의 한 줄 그림은 더 이상 구조가 아닙니다.
**정본은 [ARCHITECTURE §4 「모듈」· §5 「데이터 흐름」](../../ARCHITECTURE.md)입니다** — 모듈은 「언제 도는가」로 층 넷(증거가 들어올 때 · 매 턴 ·
사건 상태가 바뀔 때 · 하루 1회)과 브라우저 층 C 로 묶이고, 1차 PII 가림은 **브라우저**(`pii-masker`)에서, 2차는 서버(`pii-tokenizer`)에서
일어납니다. 「실행 보드」는 챗 중심 화면의 할 일 레일로 바뀌었습니다 → [ADR-063](../../decisions/063-chat-centered-layout.md).

각 단계가 UI에서 **보이는 것**이 설계 의도라는 점은 그대로입니다(전사가 흐르고, PII가 토큰으로 바뀌고, 경유 서비스가 배지로 뜸).

## 기술 스택 (기획서 §9)

**정본은 [ARCHITECTURE §2 「기술 스택」· §6 「외부 의존」](../../ARCHITECTURE.md)입니다.** 여기 있던 표는 기획서 시점의 것이라 걷어냈습니다 —
그중 **지금은 틀린 줄**만 남겨, 이 문서를 보고 옛 값을 다시 쓰지 않게 합니다.

- ~~STT: Whisper급 + 브라우저 Web Speech 폴백~~ → 브라우저 디코더는 폐기([ADR-038](../../decisions/038-transcript-confirm.md)), 모델·배치는 [ADR-052](../../decisions/052-stt-configuration.md).
- ~~OCR: Vision 입력~~ → [research/11](../../docs/research/11-로컬OCR-PII인식-실측.md) · [16](../../docs/research/16-OCR-GPU-실측.md).
- ~~PII: 클라이언트 정규식 + 서버 NER (미선정)~~ → 모델은 확정됐고 배포본은 기본 꺼짐 → [ARCHITECTURE §10](../../ARCHITECTURE.md) · `src/lib/config-report.ts`.
- ~~문서: docx 생성~~ → 만들지 않습니다 → [ADR-037](../../decisions/037-doc-guidance-not-generation.md).
- ~~백신 모드 음성: TTS + WebRTC~~ → F-09 는 코드 0 → [기능명세](08-14-features.md).

프론트(Next.js) · LLM(Grok, 도구 호출 없음) · KB 조건 조회 · Vercel 은 그대로입니다 — 값은 ARCHITECTURE §2 에서 읽으세요.

## 표기 주의

기획서와 목업에 나오는 전화번호·금액·기관명·확률(88% 등)은 **전부 예시**입니다.
실제 값은 KB 구축 시 출처와 함께 확인해야 합니다 — 그대로 코드에 넣지 마세요.
