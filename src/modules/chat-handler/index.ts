/**
 * chat-handler — 발화를 보내고 응답을 표시한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-022(챗 한 턴의 경계) · ADR-023(층 C) · ADR-028(층 C 는 client-only) ·
 *       ADR-034(화면은 원문)
 *
 * 판정은 `turn.ts`, 렌더는 `stream.tsx` 입니다. **둘을 섞지 마세요.**
 */

import "client-only";

export { outgoing, toTurn, sourceNote } from "./turn";
export { AnswerBubble, QuestionButtons } from "./stream";
export type {
  ChatResponse,
  Citation,
  NextQuestion,
  OutgoingMessage,
  Turn,
} from "./types";
