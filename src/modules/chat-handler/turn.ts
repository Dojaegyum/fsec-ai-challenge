import { maskText } from "@/modules/pii-masker";
import type { MaskContext } from "@/modules/pii-masker";
import { restore } from "@/modules/pii-restorer";
import type { RestorableMapping } from "@/modules/pii-restorer";
import type { ChatResponse, Citation, OutgoingMessage, Turn } from "./types";

/**
 * 발화를 경계 너머로 보낼 모양으로 만듭니다. 전송 자체는 부른 쪽이 하지만,
 * **부칠 것은 반드시 이 함수의 `content` 여야 합니다** — 여기를 지나지 않은 발화를
 * 네트워크에 태우면 **불변 규칙 2 위반**입니다.
 *
 * **순서가 계약입니다** — `added` 매핑을 볼트에 먼저 올리고(§3.11) 그 다음에 발화를
 * 보냅니다. 거꾸로 하면 브라우저가 못 푸는 토큰이 사건에 남습니다.
 */
export function outgoing(utterance: string, ctx?: MaskContext): OutgoingMessage {
  const r = maskText(utterance, ctx);
  return { content: r.masked, added: r.added, mappings: r.mappings };
}

/**
 * 「모름」 선택지인가 — **글자색만 내리는 자리**이자 **`unknown` 으로 보낼 자리**입니다
 * (§S-06 「같은 크기·같은 자리」 · §3.5).
 *
 * ⬜ **계약에 표시가 없어 문구로 알아봅니다.** §3.4 의 `options` 는 문자열 배열이라
 * 「어느 것이 모름인가」를 담을 칸이 없습니다. 못 알아봐도 **선택지가 사라지지는
 * 않습니다** — 그 값이 `answer` 로 나갈 뿐입니다. 칸을 둘지는 사람이 정합니다.
 *
 * **판정이 여기 하나여야 합니다.** 렌더(색)와 전송(`action`)이 서로 다른 규칙을
 * 쓰면 흐린 글씨로 그려 놓고 값으로 보내는 일이 생깁니다.
 */
export function isDontKnow(option: string): boolean {
  return option.includes("모름") || option.includes("기억");
}

/**
 * 이 답변이 무엇을 보고 쓰였는지 한 줄.
 *
 * **`kb-` 만 셉니다** — 사건 정보(`case-`)와 전사(`t-`)는 지식베이스 항목이 아니라
 * 법령 근거로 표시하면 안 됩니다 (§3.9).
 *
 * **`ref` 번호와 `why` 를 화면에 쓰지 않습니다** — 인용 번호는 서버가 이번 턴
 * 프롬프트에 발급한 내부 번호이고, `why` 는 판단 근거라 사용자 응답에 넣지 않습니다
 * (ADR-022 결정 셋 · API §5.4).
 */
export function sourceNote(citations: readonly Citation[]): string | null {
  const labels = citations
    .filter((c) => c.ref.startsWith("kb-"))
    .map((c) => c.label)
    .filter((label) => label.length > 0);

  return labels.length > 0 ? labels.join(" · ") : null;
}

/**
 * 한 턴을 화면이 쓰는 모양으로 옮깁니다.
 *
 * **`site: "chat-answer"` 는 종류별 부분 복원입니다** — 계좌는 `국민 ****7890`,
 * 주민번호는 복원하지 않습니다. 인젝션으로 값을 캐내려는 시도를 막는 자리입니다
 * (§3.9 「`reply` 안의 토큰은 종류별로 부분 복원됩니다」).
 */
export function toTurn(
  response: ChatResponse,
  mappings: readonly RestorableMapping[],
): Turn {
  return {
    message_id: response.message_id,
    reply: restore(response.reply, [...mappings], { site: "chat-answer" }),
    question: response.next_question ?? null,
    sourceNote: sourceNote(response.citations ?? []),
    referencedSteps: response.referenced_steps ?? [],
  };
}
