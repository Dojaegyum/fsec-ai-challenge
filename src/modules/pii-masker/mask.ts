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
import type { MaskContext, MaskResult, PiiKind, PiiMapping } from "./types";

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

/**
 * 텍스트를 마스킹하고 복원 매핑을 함께 냅니다.
 *
 * 같은 사건에서 이어 부를 때는 앞선 결과의 `mappings`를 `ctx`로 넘기세요.
 * 안 넘기면 일련번호가 1로 리셋돼, 서로 다른 발화의 `[계좌-1]`이
 * 다른 계좌를 가리키게 됩니다.
 */
export function maskText(text: string, ctx?: MaskContext): MaskResult {
  const mappings: PiiMapping[] = ctx ? [...ctx.mappings] : [];
  const added: PiiMapping[] = [];
  const hits = findHits(text);

  let out = "";
  let cursor = 0;

  for (const hit of hits) {
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

    out += text.slice(cursor, hit.start) + mapping.token;
    cursor = hit.end;
  }

  out += text.slice(cursor);

  return { masked: out, added, mappings };
}

/**
 * 마스킹된 텍스트에 원문이 남아 있는지 확인합니다.
 *
 * **나가기 직전에 부르세요.** 패턴을 늘리다 실수하면 조용히 새는데,
 * 이 검사가 있으면 그 자리에서 멈춥니다 — PII 경계는 협상 대상이 아닙니다.
 */
export function assertNoLeak(masked: string, mappings: PiiMapping[]): void {
  for (const m of mappings) {
    if (masked.includes(m.original)) {
      throw new Error(
        `pii-masker: 마스킹 후에도 원문이 남아 있습니다 (${m.kind}-${m.seq}). ` +
          `네트워크로 보내지 마세요.`,
      );
    }
  }
}
