"use client";

/**
 * 알림용 이메일을 보내는 자리 — `PUT /api/cases/{case_token}/contact` (§3.13).
 *
 * 계약: spec/common/08-14-api.md §3.13
 * 근거: ADR-021(이메일은 선택·미검증) · CLAUDE.md 불변 규칙 5(「모름」은 실패가 아니다)
 *
 * ## 실패해도 사용자를 막지 않습니다
 *
 * 이메일은 알림의 재료이지 사건의 재료가 아닙니다. 저장이 실패하면
 * **알림이 안 갈 뿐** 사건은 그대로 진행됩니다 — 그래서 이 함수는 던지지 않고,
 * 부르는 쪽(발급 화면)은 결과와 무관하게 사건 화면으로 넘어갑니다(§3.13).
 * 실패 사실은 돌려줍니다 — 지금 화면은 안 쓰지만, 조용히 삼켜 두면
 * 나중에 말할 자리가 생겨도 말할 것이 없습니다.
 *
 * ## 여기서 검증하지 않습니다
 *
 * 정규식도 확인 메일도 없습니다(ADR-021 — 형식 검사가 곧 관문입니다).
 * 빈 값이면 **아예 안 보냅니다** — 지우기(`null`)는 이 화면에 없는 동작이고,
 * 안 준 것과 빈 칸은 같은 뜻입니다.
 */

import { putJson } from "@/app/c/[token]/load";

export type SaveEmailResult =
  /** 저장됐거나, 애초에 보낼 값이 없었다 */
  | { readonly ok: true; readonly sent: boolean }
  /** 저장에 실패했다 — 사건은 그대로 진행되고, 알림만 안 갑니다 */
  | { readonly ok: false };

export async function saveEmail(
  caseToken: string,
  email: string,
  signal?: AbortSignal,
): Promise<SaveEmailResult> {
  const trimmed = email.trim();
  if (trimmed.length === 0) return { ok: true, sent: false };

  const made = await putJson(
    `/api/cases/${caseToken}/contact`,
    { email: trimmed },
    signal,
    "이메일을 저장하지 못했습니다.",
  );

  return made.ok ? { ok: true, sent: true } : { ok: false };
}
