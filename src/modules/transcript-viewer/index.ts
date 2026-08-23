/**
 * transcript-viewer — 전사·OCR 결과를 보여준다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-028(층 C 는 client-only) · ADR-034(화면은 원문을 보여준다)
 *
 * 판정은 `read.ts`, 렌더는 `view.tsx` 입니다. **둘을 섞지 마세요.**
 */

import "client-only";

export { readTranscript, countTokens } from "./read";
export { TranscriptView } from "./view";
export type { TranscriptViewProps } from "./view";
export type { PiiToken, RawLine, TokenCount, TranscriptLine } from "./types";
