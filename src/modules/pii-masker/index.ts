/**
 * pii-masker — 나가기 전 계좌·주민번호·카드·전화를 가린다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md · spec/common/08-14-pii-boundary.md
 * 근거: ADR-023(층 C 신설) · ADR-026(파일까지 책임 확대)
 */

export { maskText, assertNoLeak } from "./mask";
export { findHits, foldForDetection, passesLuhn } from "./patterns";
export type {
  Hit,
  MaskContext,
  MaskResult,
  PiiKind,
  PiiMapping,
} from "./types";
