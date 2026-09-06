/**
 * 마스킹 엔진.
 *
 * 계약: spec/common/08-14-pii-boundary.md
 *   · 토큰 형식은 `[계좌-1]` — 종류별 일련번호
 *   · 1차는 브라우저에서 돈다. 원문이 네트워크를 타기 전
 *
 * 이 파일에 네트워크 호출이 없어야 합니다 — 있으면 모듈 경계 위반입니다.
 */

import { findHits } from "./patterns";
import type { Hit, MaskContext, MaskResult, PiiKind, PiiMapping } from "./types";

/**
 * 아는 이름을 그 이름표로 바꿀 때의 최소 길이 → ADR-081.
 *
 * 「요」 한 글자가 문맥에 들어오면 **「요」가 든 모든 글이 가려 나갑니다** —
 * 2026-09-06 배포본에서 실제로 「지급정지는 오늘 오전에 했어[이름-5]」가 서버에 남았습니다.
 */
export const MIN_KNOWN_NAME_CHARS = 2;

/**
 * 누출 검산이 대조하는 원문의 최소 길이 → ADR-081.
 *
 * 3자리 이하 숫자는 날짜·금액·순번에 늘 들어 있어 **검산의 근거가 못 됩니다.**
 * 「8」이 대응표에 있으면 8월·2026 이 든 글이 전부 막힙니다 — 네트워크 호출도 없이.
 */
export const MIN_LEAK_CHECK_CHARS = 4;

/** 같은 원문은 같은 토큰을 씁니다. 값 기준으로 찾습니다 */
function findExisting(
  mappings: PiiMapping[],
  kind: PiiKind,
  original: string,
): PiiMapping | undefined {
  return mappings.find((m) => m.kind === kind && m.original === original);
}

function nextSeq(mappings: PiiMapping[], kind: PiiKind): number {
  let max = 0;
  for (const m of mappings) {
    if (m.kind === kind && m.seq > max) max = m.seq;
  }
  return max + 1;
}

/** 가릴 자리 하나 — 정규식이 찾은 것(`hit`)이거나, 이미 아는 이름의 자리(`token`) */
interface Span {
  readonly start: number;
  readonly end: number;
  readonly hit?: Hit;
  readonly token?: string;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * 문맥에 있는 **이름** 원문이 글에 그대로 있으면 그 이름표로 바꿀 자리 → ADR-079.
 *
 * **찾는 것이 아니라 재사용입니다.** 브라우저는 이름을 찾지 않습니다(정규식 없음).
 * 서버 2차가 붙인 `[이름-1]` 의 짝을 응답으로 받아 볼트에 맡긴 뒤, 같은 이름이
 * 다시 나오면 여기서 그 이름표로 바꿉니다 — 서버 장부에는 원문이 없어 서버는
 * 같은 이름에 `[이름-2]` 를 새로 붙일 수밖에 없기 때문입니다.
 *
 * **긴 이름부터** 봅니다 — 「김민」과 「김민수」가 다 있으면 긴 쪽이 이깁니다.
 * 원문이 없는 예약 칸(`\u0000` 으로 시작 — `history.ts`)은 건너뜁니다.
 *
 * ⚠️ 빈 원문은 반드시 걸러야 합니다 — `indexOf("")` 는 늘 `from` 을 돌려주고
 * `from += 0` 이라 반복문이 영원히 돕니다(서버 `knownSpans` 에서 실제로 있었던 일).
 */
function knownNameSpans(text: string, mappings: readonly PiiMapping[]): Span[] {
  const known = mappings
    .filter(
      (m) =>
        m.kind === "이름" &&
        // 한 글자 조각은 이름이 아닙니다 → `MIN_KNOWN_NAME_CHARS` (ADR-081).
        // 빈 원문도 이 하한이 함께 거릅니다 — 위 ⚠️ 의 무한 반복을 막는 자리입니다
        m.original.length >= MIN_KNOWN_NAME_CHARS &&
        !m.original.includes("\u0000"),
    )
    .sort((a, b) => b.original.length - a.original.length);

  const spans: Span[] = [];
  for (const m of known) {
    let from = 0;
    for (;;) {
      const start = text.indexOf(m.original, from);
      if (start < 0) break;
      const span: Span = { start, end: start + m.original.length, token: m.token };
      if (!spans.some((one) => overlaps(one, span))) spans.push(span);
      from = span.end;
    }
  }
  return spans;
}

/**
 * 텍스트를 마스킹하고 복원 매핑을 함께 냅니다.
 *
 * 같은 사건에서 이어 부를 때는 앞선 결과의 `mappings`를 `ctx`로 넘기세요.
 * 안 넘기면 일련번호가 1로 리셋돼, 서로 다른 발화의 `[계좌-1]`이
 * 다른 계좌를 가리키게 됩니다.
 *
 * 두 가지를 합니다 — ① 정규식이 찾은 넷(계좌·전화·카드·주민번호)을 가리고 새 이름표를
 * 발급하며, ② 문맥에 있는 **이미 아는 이름**을 그 이름표로 바꿉니다(ADR-079 · 발급 없음).
 * 겹치면 정규식이 이깁니다.
 */
export function maskText(text: string, ctx?: MaskContext): MaskResult {
  const mappings: PiiMapping[] = ctx ? [...ctx.mappings] : [];
  const added: PiiMapping[] = [];

  const spans: Span[] = findHits(text).map((hit) => ({ start: hit.start, end: hit.end, hit }));
  for (const span of knownNameSpans(text, mappings)) {
    if (!spans.some((one) => overlaps(one, span))) spans.push(span);
  }
  spans.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;

  for (const span of spans) {
    let token = span.token ?? "";

    if (span.hit) {
      const hit = span.hit;
      let mapping = findExisting(mappings, hit.kind, hit.value);

      if (!mapping) {
        const seq = nextSeq(mappings, hit.kind);
        mapping = {
          token: `[${hit.kind}-${seq}]`,
          kind: hit.kind,
          seq,
          original: hit.value,
        };
        mappings.push(mapping);
        added.push(mapping);
      }
      token = mapping.token;
    }

    out += text.slice(cursor, span.start) + token;
    cursor = span.end;
  }

  out += text.slice(cursor);

  return { masked: out, added, mappings };
}

/**
 * 마스킹된 텍스트에 원문이 남아 있는지 확인합니다.
 *
 * **나가기 직전에 부르세요.** 패턴을 늘리다 실수하면 조용히 새는데,
 * 이 검사가 있으면 그 자리에서 멈춥니다 — PII 경계는 협상 대상이 아닙니다.
 *
 * **4자 미만 원문은 대조하지 않습니다** → `MIN_LEAK_CHECK_CHARS` (ADR-081). 그런 조각은
 * 어느 글에나 있어 「남아 있다」가 뜻을 갖지 못하고, 대조하면 멀쩡한 글이 영구히 막힙니다.
 */
export function assertNoLeak(masked: string, mappings: PiiMapping[]): void {
  for (const m of mappings) {
    // 짧은 조각은 대조하지 않습니다 → `MIN_LEAK_CHECK_CHARS` (ADR-081).
    // 「8」이 대응표에 있으면 8월·2026 이 든 글이 전부 여기서 막힙니다
    if (m.original.length < MIN_LEAK_CHECK_CHARS) continue;
    if (masked.includes(m.original)) {
      throw new Error(
        `pii-masker: 마스킹 후에도 원문이 남아 있습니다 (${m.kind}-${m.seq}). ` +
          `네트워크로 보내지 마세요.`,
      );
    }
  }
}
