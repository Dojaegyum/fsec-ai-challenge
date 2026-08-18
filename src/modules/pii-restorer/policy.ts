/**
 * 복원 정책의 **정본**입니다.
 *
 * spec/common/08-14-pii-boundary.md 「복원 위치와 범위」와
 * spec/backend/08-16-chat-context.md §8.1 표를 코드로 옮긴 것입니다.
 * 스펙이 바뀌면 **여기와 테스트를 함께** 고칩니다.
 *
 * ── 기본값이 「복원 안 함」입니다 ──────────────────────────────
 * 모르는 자리·모르는 종류가 오면 펼치지 않습니다. 목록에 없는 것을
 * 허용 쪽으로 떨어뜨리면, 화면이 하나 늘 때마다 경계가 조용히 넓어집니다.
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
 * 그 자리에서 어디까지 펼치나.
 *
 * **목록에 없는 자리는 `none`입니다** → PII 격리 경계 「위 목록에 없는 모든 자리」.
 */
export function scopeOf(site: RestoreSite | string): RestoreScope {
  switch (site) {
    case "slot-value":
    case "doc-field":
    case "user-input":
    case "transcript":
      return "full";
    case "chat-answer":
      return "partial";
    case "analysis-text":
    case "plan-text":
      return "none";
    default:
      return "none";
  }
}

/**
 * 부분 복원에서 종류별로 무엇을 보여주나.
 *
 * **표에 없는 종류는 펼치지 않습니다.** 주민번호가 명시적으로 빠져 있고,
 * 카드는 애초에 표에 없습니다 — 둘 다 「구분할 대상이 없고 그 자체가
 * 본인확인에 쓰이는 값」이라는 점이 같습니다.
 *
 * > ⬜ 카드가 표에 없는 것이 누락인지 의도인지 스펙에 명시가 없습니다.
 * >   안전한 쪽(복원 안 함)으로 두고 사람에게 물어야 합니다.
 */
export function maskPartial(kind: string, original: string): string | null {
  switch (kind) {
    case "계좌":
      return maskAccount(original);
    case "전화":
      return maskPhone(original);
    case "이름":
      return maskName(original);
    // 주민번호 · 카드 · 그 밖의 모든 종류 → 펼치지 않습니다
    default:
      return null;
  }
}

const digitsOf = (s: string) => s.replace(/\D/g, "");

/** `110-123-456789` → `****6789`. 어느 계좌인지 알아보게 하는 것이 목적입니다 */
function maskAccount(original: string): string | null {
  const d = digitsOf(original);
  if (d.length < 4) return null;
  return `****${d.slice(-4)}`;
}

/** `01012345678` → `010-****-5678` */
function maskPhone(original: string): string | null {
  const d = digitsOf(original);
  if (d.length < 7) return null;
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

/**
 * `김철수` → `김O수`, 두 글자면 `김O`.
 *
 * 네 글자 이상은 가운데를 전부 가립니다 (`김철수영` → `김OO영`).
 * 스펙에 두 글자·세 글자만 있어, 그 규칙을 늘린 것입니다.
 */
function maskName(original: string): string | null {
  const name = original.trim();
  if (name.length < 2) return null;
  if (name.length === 2) return `${name[0]}O`;
  return `${name[0]}${"O".repeat(name.length - 2)}${name[name.length - 1]}`;
}
