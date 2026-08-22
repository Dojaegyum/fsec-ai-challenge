/**
 * transcriber — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/common/08-14-features.md `F-02` (STT 화자 분리 · OCR 대화 구조 보존)
 *       spec/common/08-16-module-names.md 층 1 · spec/common/08-16-module-boundaries.md 서버 표
 *       spec/common/08-14-api.md §3.3 (전사 결과가 화면으로 나가는 모양)
 *       spec/backend/08-16-data-model.md §3 (`evidence.transcript_masked`)
 * 근거: ADR-014(이름) · ADR-028(모듈 모양) · ADR-026(서버에 닿는 파일의 상태) ·
 *       ADR-038(기계가 읽은 값을 사람이 확인하는 자리)
 * 실측: docs/research/09-로컬모델-PII인식-실측.md — 무엇이 어떻게 깨지는지의 근거
 *
 * ## 이 자리가 왜 위험한가
 *
 * **이 모듈은 개인정보 격리 경계 「이전」입니다.** 흐름이 이렇습니다 →
 * `file-sender`(브라우저) → `pii-masker`(브라우저) → **`transcriber`(여기)** →
 * `pii-tokenizer`(경계) → `case-reader`·`slot-extractor`.
 *
 * 녹음에는 계좌번호가 음성으로 들어 있고 이체내역 캡처에는 숫자가 그대로 찍혀 있습니다.
 * `ARCHITECTURE.md` §6 이 이 자리를 **"경계의 가장 약한 고리"** 라고 적었습니다.
 *
 * **그래서 이 모듈은 제품을 고르지 않습니다.** 읽는 도구를 인터페이스로 선언해 밖에서
 * 받습니다 → ADR-028. 원격 API 를 쓸지 우리가 돌리는 모델을 쓸지는 **조립부의 결정**이고,
 * 이 파일은 그 결정을 모릅니다.
 *
 * 절대 하지 않는 것:
 *   - 저장하기 (`evidence.transcript_masked` 는 **토큰화된 것만** 받습니다 → 09-data-model.md §3)
 *   - 토큰화하기 (그건 `pii-tokenizer` 하나입니다)
 *   - 읽어낸 값을 다듬기 (「삼백만원」→「3000000」 · 「어제」→ 날짜)
 *   - 누가 사기범인지 정하기 (녹음 안에 그 근거가 없습니다)
 *   - 읽기 실패를 에러로 올리기 (덜 읽힌 것은 정상 경로입니다 → CLAUDE.md 불변 규칙 5)
 *   - 한 덩어리 문자열로 내보내기 (아래 「구조가 곧 격리입니다」)
 */

/** 09-data-model.md §3 `evidence.kind` */
export type EvidenceKind = 'audio' | 'image' | 'text'

/**
 * 08-14-api.md §3.3 `progress.phase`.
 *
 * ⬜ **정본에 있는 값은 `"stt"` 하나뿐입니다.** 예시 응답에 그것만 나옵니다.
 * `ocr` 은 이미지 경로에 이름이 필요해 여기서 붙였고, **계약에 올리려면 §3.3 을 고쳐야 합니다.**
 */
export type IngestPhase = 'stt' | 'ocr'

// ── 원본의 어디인가 ───────────────────────────────────────────────────

/**
 * 음성에서 읽은 자리. 밀리초.
 *
 * `startMs` 는 08-14-api.md §3.3 의 `start_ms` 그대로입니다.
 * `endMs` 는 계약에 없지만 **원본 조각을 들려주려면 끝이 있어야** 합니다 → ADR-038.
 */
export interface AudioAt {
  readonly kind: 'audio'
  readonly startMs: number
  readonly endMs: number
}

/**
 * 이미지에서 읽은 자리. **좌상단 기준 픽셀**입니다.
 *
 * ⬜ **정본에 좌표를 담을 칸이 없습니다.** ADR-038 이 직접 적었습니다 —
 * *"원본 조각을 화면에 띄우려면 좌표가 필요합니다. (…) 데이터 모델에 좌표 칸이 없습니다.
 * **미결입니다.**"*
 *
 * 그래서 **단위를 여기서 못 박습니다** — 픽셀·좌상단 기준·정규화 없음.
 * 제품마다 좌표 형식이 다르므로(4점 폴리곤 · 정규화 좌표 · 좌하단 기준) 변환은
 * 어댑터가 하고, 이 모듈 안쪽은 한 가지만 압니다. 스키마가 정해질 때 이 단위를 그대로 씁니다.
 */
export interface ImageAt {
  readonly kind: 'image'
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type At = AudioAt | ImageAt

// ── 읽어낸 것 ─────────────────────────────────────────────────────────

/**
 * 읽어낸 조각 하나 — **낱말(음성)이나 줄 조각(이미지)** 단위.
 *
 * **이 단위가 있어야 ADR-038 의 확인 화면이 돕니다.** 그 결정이 고칠 수 있는 것을
 * **명사와 숫자뿐**(기관명·계좌번호·금액·일시)으로 못 박았으므로, 전사문 전체에
 * 숫자 하나를 붙이는 것으로는 그 화면을 열 수 없습니다.
 */
export interface Piece {
  /** 읽어낸 글자 그대로. **다듬지 않습니다** */
  readonly text: string
  /**
   * 원본의 어디에서 읽었나. 엔진이 자리를 안 주면 `null`.
   *
   * **자리가 없다고 글자를 버리지 않습니다.** 글자가 이 모듈의 산출물이고 자리는
   * 그것을 확인시키기 위한 것이라, 자리 때문에 글자를 버리면 주객이 뒤집힙니다
   * → CLAUDE.md 불변 규칙 5. 대신 `shortfalls` 에 `no_anchors` 가 실려,
   * ADR-038 의 확인 화면이 **원본 조각을 못 띄운다는 사실**을 알 수 있습니다.
   */
  readonly at: At | null
  /**
   * **판독** 신뢰도 0~1. 음성이면 음향, 이미지면 광학입니다.
   *
   * **`case_slot.confidence` 와 다른 축입니다** — 아래 「신뢰도가 셋입니다」.
   * 엔진이 안 주면 `null` 입니다. **0 으로 채우지 않습니다** — 「신뢰도가 0」과
   * 「신뢰도를 모른다」가 같은 값이 되면 확인 화면이 전부 열립니다.
   */
  readonly confidence: number | null
}

/**
 * 읽어낸 한 줄 — 08-14-api.md §3.3 의 `transcript[]` 한 항목이 됩니다.
 *
 * ## 구조가 곧 격리입니다
 *
 * **한 덩어리 문자열로 내보내지 않는 것이 이 타입의 존재 이유입니다.**
 * 업로드된 내용은 지시가 아니라 자료이고(CLAUDE.md 불변 규칙 4),
 * `prompt-builder` 가 `{ speaker, text }` 를 받아 비신뢰 블록으로 감싸며 꺾쇠를 막습니다
 * → 08-17-system-prompt.md 「자료 블록의 모양」 · prompt-builder/xml-renderer.ts.
 *
 * 한 덩어리로 내면 화자 구분이 사라져 그 블록이 **누가 한 말인지 알 수 없는 글**이 되고,
 * 사기범이 통화 중에 읽어 준 문장과 피해자의 진술이 한 줄에 섞입니다.
 *
 * **그래서 이 모듈은 꺾쇠를 직접 escape 하지 않습니다.** 그건 `prompt-builder` 의 일이고,
 * 두 곳에서 하면 화면에 `&lt;` 가 그대로 보입니다.
 */
export interface Line {
  /**
   * 누가 말했나. `"A"` · `"B"` … **먼저 말한 쪽이 `A`** 입니다.
   *
   * ⚠️ **누가 사기범인지는 정하지 않습니다.** 수신 통화인지 발신 통화인지에 따라
   * 먼저 말한 쪽이 뒤집히는데, **녹음 파일 안에 그 근거가 없습니다.**
   * 여기서 정하면 근거 없는 판정이 됩니다.
   *
   * 화자를 못 갈랐으면 `null` 입니다 — 그때 `shortfalls` 에 `no_speakers` 가 들어갑니다.
   */
  readonly speaker: string | null
  /**
   * 이 줄을 이 화자가 말한 것이 맞는가. 0~1.
   *
   * **판독 신뢰도와 다릅니다** — 잘 들었는지가 아니라 **누구였는지**입니다.
   * 계좌번호를 사기범이 불러 준 것인지 피해자가 확인차 되읊은 것인지가
   * 슬롯의 뜻을 바꾸므로 따로 냅니다. 엔진이 안 주면 `null`.
   */
  readonly speakerConfidence: number | null
  /**
   * 이 줄의 글자.
   *
   * ⚠️ **원문입니다. 토큰화되지 않았습니다.** `evidence.transcript_masked` 에 이 값을
   * 그대로 넣으면 칼럼 이름과 어긋나고 09-data-model.md §3 위반입니다 —
   * *"`transcript_masked` 에 `pii-tokenizer` 를 통과한 문자열만 저장합니다."*
   */
  readonly text: string
  /**
   * 이 줄을 원본의 어디에서 읽었나. 엔진이 자리를 안 주면 `null`.
   *
   * ⚠️ **음성에서 `null` 이면 08-14-api.md §3.3 의 `start_ms` 를 채울 수 없습니다.**
   * 계약이 그 칸을 필수로 두었으므로, 그 상태를 부르는 쪽이 알아야 합니다 —
   * `shortfalls` 의 `no_anchors` 가 그 신호입니다.
   */
  readonly at: At | null
  /**
   * 이 줄을 이루는 조각들.
   *
   * **비어 있을 수 있습니다** — 엔진이 낱말 단위를 안 주면 그렇습니다.
   * 그때 `shortfalls` 에 `no_pieces` 가 들어가고, **ADR-038 의 확인 화면은
   * 줄 단위로만 열립니다.**
   */
  readonly pieces: readonly Piece[]
}

/**
 * 못 한 것. **에러가 아닙니다.**
 *
 * CLAUDE.md 불변 규칙 5 가 *"「모름」은 실패가 아니다"* 로 정했습니다.
 * 덜 읽혔다고 던지면 사건 진행이 막히는데, 08-16-errors.md §2 는 전사 실패를
 * *"배경 작업이라 여유가 있습니다"* 로 두었습니다 — **막을 이유가 없습니다.**
 *
 * **대신 무엇을 못 했는지는 숨기지 않습니다.** `pii-tokenizer` 가 판별 모델이
 * 안 붙었다는 사실을 `nerApplied` 로 실어 내는 것과 같은 규칙입니다.
 */
export type Shortfall =
  /** 읽어낸 줄이 하나도 없다 */
  | 'empty'
  /** 화자를 못 갈랐다. 모든 `speaker` 가 `null` 이다 */
  | 'no_speakers'
  /** 판독 신뢰도를 못 받았다. ADR-038 의 「신뢰도 낮은 필드」를 못 고른다 */
  | 'no_confidence'
  /** 낱말·줄 조각 단위를 못 받았다. 확인 화면이 줄 단위로만 열린다 */
  | 'no_pieces'
  /**
   * 원본의 자리를 못 받았다. **원본 조각을 나란히 못 띄웁니다.**
   *
   * ADR-038 이 *"「이 값이 맞나요?」만 묻는 화면은 사용자가 판단할 근거가 없어
   * 전부 「맞아요」를 누릅니다"* 라고 적었습니다 — 이 상태에서 확인 화면을 열면
   * 그 화면이 됩니다.
   */
  | 'no_anchors'
  /** 이미지의 대화 구조(말풍선 좌·우)를 못 세웠다 */
  | 'no_layout'
  /** 이 종류는 이 모듈이 읽을 것이 없다 (`kind: 'text'`) */
  | 'not_applicable'

export interface TranscribeResult {
  /** 무엇을 읽었나. 08-14-api.md §3.3 의 `progress.phase` 와 같은 값을 씁니다 */
  readonly phase: IngestPhase | null
  /** 읽어낸 줄들. **비어 있는 것이 정상일 수 있습니다** */
  readonly lines: readonly Line[]
  /** 몇 사람으로 갈렸나. 못 갈랐으면 0 */
  readonly speakerCount: number
  /** 무엇을 못 했나. 비어 있으면 다 됐다는 뜻입니다 */
  readonly shortfalls: readonly Shortfall[]
  /**
   * 엔진이 냈지만 버린 줄의 수. **값은 담지 않습니다.**
   *
   * 글자가 비었거나, 자리 정보가 숫자가 아니거나, 시각이 거꾸로인 것.
   * **왜 안 읽혔는지**를 밖에서 볼 수 있어야 어댑터를 고칠 단서가 생깁니다
   * — `slot-extractor` 의 `dropped` 와 같은 규칙입니다.
   */
  readonly dropped: number
  /**
   * 무엇으로 읽었나. 엔진이 스스로 밝힌 이름 그대로.
   *
   * **감사와 재현을 위한 것입니다** — 오독을 나중에 되짚을 때 어느 모델이 읽은
   * 결과인지 알아야 합니다. 엔진이 안 밝히면 `null`.
   */
  readonly engine: string | null
}

// ── 이 모듈이 밖에 요구하는 것 ────────────────────────────────────────

/** 무엇을 읽어 달라는 것인가 */
export interface MediaRef {
  /** 객체 저장소 경로. `evidence.object_key` → 09-data-model.md §3 */
  readonly objectKey: string
  readonly kind: EvidenceKind
  readonly mimeType: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — **읽기용 임시 주소**를 내는 자리.
 *
 * ⚠️ **파일 바이트가 이 모듈을 통과하지 않습니다.** Vercel 함수는 요청·응답 본문에
 * 크기 제한이 있고, 업로드가 presigned 방식인 이유가 바로 그것입니다
 * → 08-14-api.md §3.2 · ARCHITECTURE.md §2. 서버가 녹음을 받아 엔진에 중계하면
 * 그 제한에 다시 걸립니다.
 *
 * ⬜ **`case-intake` 의 `UploadSlotSource` 에는 `issue()`(쓰기)만 있습니다.**
 * 읽기용 주소를 내는 자리가 저장소 어디에도 없어 여기서 새로 선언합니다.
 */
export interface MediaReader {
  /** 유효기간이 있는 읽기 전용 주소를 낸다 */
  readUrl(objectKey: string): Promise<string>
}

/**
 * 읽는 도구에 물어본 결과.
 *
 * **기다리지 않고 물어보는 모양인 이유** — 전사는 몇 분 걸리는데 앱은 Vercel
 * 함수 위에서 돌고 그렇게 오래 못 삽니다. 그리고 계약이 이미 폴링입니다:
 * 업로드 완료에 `202 처리 중` 을 돌려주고 화면이 다시 물어봅니다
 * → 08-14-api.md §3.2 3단계 · §3.3.
 */
export type EngineProgress =
  | { readonly status: 'running'; readonly percent: number }
  | { readonly status: 'done'; readonly output: EngineOutput }
  /** **짧은 표시값입니다.** 예외 문구를 담지 않습니다 — 파일 내용이 섞여 올 수 있습니다 */
  | { readonly status: 'failed'; readonly reason: string }

/** 엔진이 낸 조각 하나. **믿지 않고 검사합니다** — 아래 `EngineLine` 참고 */
export interface EnginePiece {
  readonly text?: unknown
  readonly startMs?: unknown
  readonly endMs?: unknown
  readonly box?: unknown
  readonly confidence?: unknown
}

/**
 * 엔진이 낸 줄 하나.
 *
 * **칸이 전부 `unknown` 인 이유** — 엔진은 우리 프로세스 밖의 서비스이고, 그 응답은
 * 네트워크를 건너온 JSON 입니다. 어댑터가 잘못 짜였거나 서비스가 형식을 바꾸면
 * 타입 선언은 아무것도 막지 못합니다. `slot-extractor` 가 모델 응답을 같은 이유로
 * `unknown` 으로 받습니다.
 *
 * **못 읽은 줄은 버리고 셉니다. 던지지 않습니다.**
 */
export interface EngineLine {
  readonly text?: unknown
  /** 엔진이 매긴 화자 구분값. 무엇이든 됩니다 — 이 모듈이 `A`·`B` 로 다시 붙입니다 */
  readonly speaker?: unknown
  readonly speakerConfidence?: unknown
  /** 음성일 때 */
  readonly startMs?: unknown
  readonly endMs?: unknown
  /** 이미지일 때. `[x, y, width, height]` — 좌상단 기준 픽셀 */
  readonly box?: unknown
  readonly confidence?: unknown
  readonly pieces?: unknown
}

export interface EngineOutput {
  readonly lines?: unknown
  /** 무엇으로 읽었는지 엔진이 밝히면 */
  readonly engine?: unknown
}

export interface SttRequest {
  /** 읽기용 임시 주소 */
  readonly url: string
  readonly mimeType: string
  /**
   * 나올 법한 낱말들 — 기관명 사전 등.
   *
   * ⬜ **효과가 검증되지 않았습니다.** 전사 모델에 미리 어휘를 알려 주면 그쪽으로
   * 기울어 받아쓴다고 알려져 있고, 실측 보고서가 **기관명 36건 중 10건이 전사에서
   * 손상**되는 것을 확인했습니다("신한은행"→"시나는행")
   * → docs/research/09-로컬모델-PII인식-실측.md §5.6.
   *
   * 다만 그 보고서가 시험한 것은 일반 지시문 한 줄이었고 **어휘 목록은 넣어 본 적이
   * 없습니다.** 그래서 자리만 두고 값은 조립부가 정합니다 — 붙이든 안 붙이든
   * 이 모듈은 안 바뀝니다.
   */
  readonly vocabulary?: readonly string[]
}

export interface OcrRequest {
  readonly url: string
  readonly mimeType: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 음성을 글로 옮기는 도구.
 *
 * **두 걸음입니다.** 맡기고(`submit`), 나중에 물어봅니다(`poll`).
 * 한 번에 끝나는 모양이면 앱의 함수가 전사가 끝날 때까지 살아 있어야 하는데,
 * 그럴 수 없습니다.
 */
export interface SttEngine {
  /** 맡긴다. 돌려주는 것은 나중에 물어볼 때 쓸 번호뿐입니다 */
  submit(request: SttRequest): Promise<string>
  poll(jobId: string): Promise<EngineProgress>
}

/** 이 모듈이 밖에 요구하는 것 — 이미지에서 글자를 읽는 도구. `stt` 와 같은 모양입니다 */
export interface OcrEngine {
  submit(request: OcrRequest): Promise<string>
  poll(jobId: string): Promise<EngineProgress>
}

/**
 * 말풍선 좌·우로 화자를 가르는 규칙의 값들.
 *
 * ⬜ **정본에 임계값이 없습니다.** `F-02` 가 "OCR(대화 구조 보존)"이라고만 적었고
 * 어떻게 보존하는지는 정해진 적이 없습니다. 아래 기본값은 **근거가 아니라 출발점**이고,
 * 실제 캡처로 재 보고 고쳐야 합니다.
 */
export interface LayoutRule {
  /** 이 줄 수보다 적으면 좌·우를 가르지 않는다 */
  readonly minLines: number
  /**
   * 두 무리의 중심이 전체 너비의 이 비율보다 멀어야 갈린다.
   *
   * **애매하면 안 가릅니다.** 틀린 화자를 붙이는 것이 화자를 안 붙이는 것보다
   * 나쁩니다 — 사기범이 한 말이 피해자가 한 말로 기록되면 판정이 통째로 뒤집힙니다.
   */
  readonly minGapRatio: number
}

export interface TranscriberDeps {
  readonly media: MediaReader
  /**
   * ⬜ 제품 미선정.
   *
   * **없어도 되는 자리로 두지 않았습니다.** 이 자리가 비면 음성 경로가 아무것도
   * 못 하는데, 그것은 「덜 읽혔다」가 아니라 **「아직 없다」**입니다. 둘을 같은
   * 코드로 내면 `Retry-After` 가 붙어 사용자가 헛되이 다시 누릅니다
   * → lib/not-configured.ts · 08-16-errors.md §2.
   *
   * 그래서 미설정은 이 모듈이 아니라 **조립부가 표현합니다** — 부르면 즉시 터지는
   * 대역을 끼우고, 그 사실이 설정 현황에 한 줄로 나옵니다.
   * `pii-tokenizer` 의 판별 모델이 `null` 인 것과 다릅니다 — 그쪽은 없어도 1차
   * 정규식으로 경계가 서지만, 여기는 대신할 것이 없습니다.
   */
  readonly stt: SttEngine
  /** ⬜ 제품 미선정. `stt` 와 같은 이유로 없어도 되는 자리가 아닙니다 */
  readonly ocr: OcrEngine
  readonly layout?: Partial<LayoutRule>
}

export interface TranscribeInput {
  readonly media: MediaRef
  /** 전사 모델에 미리 알려 줄 낱말들 → `SttRequest.vocabulary` */
  readonly vocabulary?: readonly string[]
}

/**
 * 맡겨 둔 일 하나.
 *
 * **부르는 쪽이 이걸 들고 있어야 합니다.** `evidence` 한 줄에 붙여 두었다가
 * 화면이 물어볼 때 다시 넘깁니다.
 *
 * ⬜ **이 값을 담을 칸이 스키마에 없습니다** → 09-data-model.md §3.
 * `ingest_status` 는 있는데 「어느 작업인가」는 없습니다.
 */
export interface TranscriptionJob {
  readonly jobId: string
  readonly phase: IngestPhase
  readonly kind: EvidenceKind
}

/** 맡긴 결과. **옮길 것이 없으면 맡기지 않고 바로 답합니다** */
export type StartResult =
  | { readonly started: true; readonly job: TranscriptionJob }
  | { readonly started: false; readonly result: TranscribeResult }

/** 물어본 결과 */
export type CollectResult =
  | { readonly status: 'running'; readonly phase: IngestPhase; readonly percent: number }
  | { readonly status: 'done'; readonly result: TranscribeResult }
  /** **에러로 올리지 않습니다** — 부르는 쪽이 `ingest_status` 를 `failed` 로 적으면 됩니다 */
  | { readonly status: 'failed'; readonly reason: string }

export interface Transcriber {
  /**
   * 읽어 달라고 맡긴다. **결과를 기다리지 않습니다.**
   *
   * @throws IngestError 맡기는 것 자체가 실패했을 때 → 08-16-errors.md §2
   *         (`INGEST_FAILED` · 422 · 재시도 1회 · 대기 2s).
   * @throws AppError 도구나 저장소가 **아직 안 붙었을 때** 그대로 올립니다 —
   *         미설정을 전사 실패로 덮지 않습니다. 아래 `TranscriberDeps.stt`.
   */
  start(input: TranscribeInput): Promise<StartResult>

  /**
   * 맡긴 일이 어떻게 됐는지 물어본다. 끝났으면 정리해서 낸다.
   *
   * **덜 읽힌 것으로 던지지 않습니다.** 한 줄도 못 읽어도, 화자를 못 갈라도,
   * 신뢰도를 못 받아도 결과가 나가고 `shortfalls` 에 그 사실이 실립니다
   * → CLAUDE.md 불변 규칙 5.
   *
   * @throws AppError 도구가 아직 안 붙었을 때. 위와 같습니다.
   */
  collect(job: TranscriptionJob): Promise<CollectResult>
}
