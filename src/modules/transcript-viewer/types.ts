/**
 * transcript-viewer — 전사·OCR 결과를 보여준다 (층 C · 브라우저)
 *
 * 계약: spec/frontend/08-14-screens.md §S-08 · spec/common/08-14-api.md §3.3
 * 근거: ADR-034(화면은 원문을 보여준다) · ADR-023(층 C)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **복원된 원문을 서버로 되돌려 보내기**
 *  · OCR·전사를 여기서 하기 (그건 서버 `transcriber` 의 일입니다)
 */

/** §3.3 `transcript[]` — **토큰화된 상태로 내려옵니다** */
export interface RawLine {
  speaker: string;
  text: string;
  start_ms: number;
}

/** 화면에 그리는 한 줄. `text` 는 **원문**입니다 (ADR-034) */
export interface TranscriptLine {
  speaker: string;
  text: string;
  start_ms: number;
  /** 이 줄에서 펼치지 못한 토큰. 다른 기기에서 열었을 때 생깁니다 */
  unresolved: readonly string[];
}

/** §3.3 `pii_tokens[]` */
export interface PiiToken {
  token: string;
  kind: string;
}

/** 헤더의 「서버로는 이름 1 · 계좌 1 을 가려서 보냈습니다」 */
export interface TokenCount {
  kind: string;
  count: number;
}
