/**
 * 복원 심사와 되돌리기.
 *
 * 검사는 셋입니다 → chat-context §8.2
 *   1. 그 자리가 복원 가능 목록에 있는가
 *   2. 그 토큰이 이 사건의 매핑에 실제로 있는가
 *   3. 거부되면 기록을 남긴다
 *
 * **2번이 「모든 토큰의 원래 값을 나열하라」는 공격을 막습니다** —
 * 모델이 지어낸 토큰은 매핑에 없어 복원되지 않습니다.
 *
 * 이 파일에 네트워크 호출이 없어야 합니다.
 */

import { maskPartial, parseToken, scopeOf, tokenPattern } from "./policy";
import type {
  DenialEvent,
  RestorableMapping,
  RestoreOptions,
  RestoreScope,
} from "./types";

function indexOf(mappings: RestorableMapping[]): Map<string, RestorableMapping> {
  const map = new Map<string, RestorableMapping>();
  for (const m of mappings) map.set(m.token, m);
  return map;
}

/**
 * 텍스트 안의 토큰을 그 자리의 규칙만큼 되돌립니다.
 *
 * 되돌리지 못한 토큰은 **지우지 않고 그대로 둡니다.** 파란 토큰이 남아 있는 것이
 * 「가려져 있다」는 뜻이라, 빈칸으로 만들면 사용자가 값이 없는 것으로 오해합니다.
 */
export function restore(
  text: string,
  mappings: RestorableMapping[],
  options: RestoreOptions,
): string {
  const scope = scopeOf(options.site);
  const byToken = indexOf(mappings);

  const deny = (event: DenialEvent) => options.onDenied?.(event);

  return text.replace(tokenPattern(), (token) => {
    if (scope === "none") {
      deny({ token, site: options.site, reason: "field_not_allowed" });
      return token;
    }

    const mapping = byToken.get(token);
    if (!mapping) {
      // 모델이 지어낸 토큰이 여기서 걸립니다
      deny({ token, site: options.site, reason: "not_in_mapping" });
      return token;
    }

    if (scope === "full") return mapping.original;

    const parsed = parseToken(token);
    const masked = parsed ? maskPartial(parsed.kind, mapping.original) : null;
    if (masked === null) {
      deny({ token, site: options.site, reason: "kind_not_allowed" });
      return token;
    }

    return mapping.label ? `${mapping.label} ${masked}` : masked;
  });
}

/**
 * 값 하나짜리 자리(슬롯 칸·서류 필드)에서 씁니다.
 *
 * 통째로 토큰인 문자열을 받아 복원값만 냅니다. 거부되면 **토큰을 그대로** 돌려줍니다.
 */
export function restoreValue(
  token: string,
  mappings: RestorableMapping[],
  options: RestoreOptions,
): string {
  return restore(token, mappings, options);
}

/** 그 자리에서 어디까지 펼치는지. 화면이 안내 문구를 고를 때 씁니다 */
export function scopeFor(site: RestoreOptions["site"]): RestoreScope {
  return scopeOf(site);
}
