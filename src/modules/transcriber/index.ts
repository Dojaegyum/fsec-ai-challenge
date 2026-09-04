/**
 * transcriber — STT(화자 분리)·OCR(대화 구조 보존) (층 1 · `F-02`)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 *
 * ⚠️ **이 모듈의 결과는 원문입니다.** `pii-tokenizer` 를 거치지 않은 것을
 * `evidence.transcript_masked` 에 저장하거나 외부 모델로 보내면
 * CLAUDE.md 불변 규칙 2 위반입니다 → spec/common/08-14-pii-boundary.md.
 */

import 'server-only'

export { createTranscriber, DEFAULT_LAYOUT } from './transcribe'
export type {
  At,
  AudioAt,
  CollectResult,
  EngineLine,
  EngineOutput,
  EnginePiece,
  EngineProgress,
  EvidenceKind,
  ImageAt,
  IngestPhase,
  LayoutRule,
  Line,
  MediaReader,
  MediaRef,
  OcrEngine,
  OcrRequest,
  Piece,
  Shortfall,
  StartResult,
  SttEngine,
  SttRequest,
  TranscribeInput,
  TranscribeResult,
  Transcriber,
  TranscriberDeps,
  TranscriptionJob,
} from './types'
