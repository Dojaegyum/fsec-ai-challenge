/**
 * 복원 정책의 **정본**입니다.
 *
 * spec/common/08-14-pii-boundary.md 「복원 위치와 범위」를 코드로 옮긴 것입니다.
 * 스펙이 바뀌면 **여기와 테스트를 함께** 고칩니다.
 *
 * ── 브라우저면 전부, 아니면 하나도 ────────────────────────────
 * [ADR-034](../../../decisions/034-browser-shows-plaintext.md) 로 표가 한 줄이
 * 됐습니다 — *브라우저가 보여주는 것은 전부 원문.* 자리마다 다르던 규칙은
 * **폐기됐습니다** (→ `RestoreSite` 의 경고).
 *
 * ── 기본값이 「복원 안 함」입니다 ──────────────────────────────
 * 모르는 자리가 오면 펼치지 않습니다. 목록에 없는 것을 허용 쪽으로 떨어뜨리면,
 * 화면이 하나 늘 때마다 경계가 조용히 넓어집니다.
 */

import type { ParsedToken, RestoreScope, RestoreSite } from "./types";

/** `[계좌-1]` 을 뜯습니다. 종류는 한글·영문 모두 받습니다 (2차 NER 토큰 대비) */
const TOKEN_RE = /\[([^\]\-]+)-(\d+)\]/g;

export function tokenPattern(): RegExp {
  return new RegExp(TOKEN_RE.source, "g");
}

export function parseToken(token: string): ParsedToken | null {
  const m = /^\[([^\]\-]+)-(\d+)\]$/.exec(token);
  if (!m) return null;
  return { kind: m[1], seq: Number(m[2]) };
}

/**
 * 그 자리에서 펼치나 마나.
 *
 * **목록에 없는 자리는 `none`입니다** → PII 격리 경계 「위 목록에 없는 모든 자리」.
 * 목록에 있으면 **전부 `full`** 입니다 — 전부 브라우저가 그리는 자리이고,
 * 브라우저는 원문을 보여줍니다 (ADR-034).
 */
export function scopeOf(site: RestoreSite | string): RestoreScope {
  switch (site) {
    case "slot-value":
    case "doc-field":
    case "user-input":
    case "transcript":
    case "chat-answer":
    case "analysis-text":
    case "plan-text":
      return "full";
    default:
      return "none";
  }
}
