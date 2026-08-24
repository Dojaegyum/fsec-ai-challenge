/**
 * chat-handler — 발화를 보내고 응답을 표시한다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.9 (응답) · §3.4 (`next_question`)
 *       spec/frontend/08-14-screens.md §S-06
 * 근거: ADR-022(챗 한 턴의 경계) · ADR-034(화면은 원문을 보여준다)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **인용 번호·판단 근거를 화면에 쓰기** (근거 화면은 보류 상태입니다 — ADR-022 셋)
 *  · **「모름」 없애기** — 선택지에 항상 있습니다
 *  · 응답을 스트리밍하기 (근거 검증이 끝난 뒤 한 번에 나갑니다)
 */

import type { PiiMapping } from "@/modules/pii-masker";

/** §3.4 에 정의가 하나 있고 여기서는 참조만 합니다 */
export interface NextQuestion {
  slot_key: string;
  text: string;
  /** §3.4 가 넷으로 못박았습니다 — `| string` 을 붙이면 계약이 사라집니다 */
  input: "buttons" | "text" | "date" | "amount";
  options?: readonly string[];
}

/**
 * §3.5 되묻기 — **거부 대신 확인**입니다 (ADR-041).
 *
 * ⚠️ **`found[].text` 는 원문이 아니라 서버가 붙인 이름표**입니다
 * (`flows/answer-slot.ts` 가 `one.token` 을 실어 보냅니다). 원문은 브라우저에
 * 있으므로, 화면은 **사용자가 적은 값**을 보여주고 「이게 개인정보 맞나요」를
 * 묻습니다. 서버가 원문을 되돌려 보내면 그때 원문이 한 번 더 왕복하게 됩니다.
 */
export interface PiiConfirm {
  found: readonly { kind: string; text: string }[];
  /** 문구는 **서버가 줍니다** — 화면이 다시 적지 않습니다 (§3.5) */
  text: string;
  note: string;
  options: readonly { id: "mask" | "keep"; label: string }[];
}

/** §3.5 응답 */
export interface SlotAnswerResponse {
  slot: { slot_key: string; state: string; value: string | null };
  pii_confirm?: PiiConfirm;
  plan_regenerated: boolean;
  next_question: NextQuestion | null;
}

/** §3.9 `citations[]` — `kb-` 만 법령 근거를 답니다 */
export interface Citation {
  ref: string;
  label: string;
  why?: string;
  kb_entry_id?: string;
  kb_version?: string;
  legal_basis?: string;
  source_url?: string;
  effective_from?: string;
}

export interface ChatResponse {
  message_id: string;
  reply: string;
  citations?: readonly Citation[];
  referenced_steps?: readonly string[];
  referenced_deadlines?: readonly string[];
  next_question?: NextQuestion | null;
}

/** 경계 너머로 나갈 발화 — **`content` 말고는 보내지 않습니다** */
export interface OutgoingMessage {
  /** `POST …/messages` 의 `content` 로 보낼 것 */
  content: string;
  /** 이번 발화에서 새로 생긴 매핑. **보내기 전에** 볼트에 올립니다 → API §3.11 */
  added: PiiMapping[];
  /** 다음 발화에 `MaskContext` 로 이어 넘길 전체 매핑 */
  mappings: PiiMapping[];
}

/** 화면이 그리는 한 턴 */
export interface Turn {
  message_id: string;
  /** **원문입니다** — 종류별 부분 복원을 지난 뒤 (ADR-034 · §3.9) */
  reply: string;
  question: NextQuestion | null;
  /** 「이 답변은 …를 보고 썼습니다」 한 줄. 인용 번호를 쓰지 않습니다 */
  sourceNote: string | null;
  /** 오른쪽 열을 작업으로 돌릴 단계들 */
  referencedSteps: readonly string[];
}
