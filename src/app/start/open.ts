"use client";

/**
 * 사건을 만드는 자리 — `POST /api/cases` (§3.1).
 *
 * 계약: spec/common/08-14-api.md §3.1 · spec/frontend/08-14-screens.md §S-05
 * 근거: ADR-021(재진입은 링크가 유일한 열쇠) · ADR-039(주소에 실리는 것은 링크 토큰) ·
 *       ADR-046(사건과 T0 를 함께 만든다)
 *
 * ## 주소에 실리는 것은 `link_token` 입니다
 *
 * ⚠️ **`case_id` 를 주소에 쓰면 조회가 언제나 빕니다.** 둘 다 26자 Crockford Base32 라
 * **형식으로는 못 가립니다** — 잘못 써도 화면은 조용히 404 를 보여주고, 원인이
 * 안 드러납니다 (ADR-039).
 *
 * ## 응답에 플랜이 함께 옵니다
 *
 * §3.1 이 T0 공통 안전 절차를 **즉시** 실어 보냅니다 (ADR-046). 그래서 사건을
 * 만든 직후 화면이 플랜 조회를 한 번 더 부를 필요가 없습니다 — 다만 지금은
 * 곧바로 `/c/{token}` 으로 넘어가므로 그쪽이 §3.10 을 한 번 부릅니다.
 */

import { postJson } from "@/app/c/[token]/load";
import type { LoadFail } from "@/app/c/[token]/load";

/** §3.1 이 받는 둘. **여기 없는 값을 보내면 400 입니다** */
export type Track = "victim" | "frozen_account";

export type OpenResult =
  | { readonly ok: true; readonly linkToken: string }
  | { readonly ok: false; readonly fail: LoadFail };

/**
 * 화면의 Q1 → `track`.
 *
 * **「잘 모르겠어요」는 wire 값이 아니라 `victim` 으로 엽니다** → ADR-060.
 *
 * 화면 계약(§S-05)은 「잘 모르겠어요」를 **같은 크기·같은 자리**의 1급 선택지로
 * 두라고 합니다 — 「모름은 실패가 아니다」(불변 규칙 5)이기 때문입니다. 그런데
 * §3.1 의 `track` 은 `victim`·`frozen_account` 둘뿐이고, 세 번째 값을 계약에
 * 두면 KB 조회축(`track`)에 그 값의 행이 없어 **빈 플랜이 나갑니다** — 모름을
 * 1급으로 대접하려던 값이 그 사람을 빈 화면에 세웁니다.
 *
 * `victim` 은 지어낸 값이 아닙니다 — 스키마 자신의 기본값이고
 * (`NOT NULL DEFAULT 'victim'` — 데이터 모델 §2), victim 의 T0 가 곧 설계가
 * 정한 「모름 → 보수적 슈퍼셋」입니다(slot-tiering) — 112·1332·추가 송금 금지는
 * 어느 갈래여도 틀리지 않습니다.
 *
 * **고른 뒤에는 바꾸지 않습니다** (ADR-066). 통장묶기는 절차가 완전히 달라 같은
 * 사건 안에서 트랙을 갈아끼우면 옛 단계가 남습니다(재생성은 step_key 병합) —
 * 명의인이었다면 새 사건으로 다시 엽니다. `frozen_account` 의 KB 는 2026-09-04 에 생겼습니다.
 */
export function trackOf(pick: number): Track {
  return pick === 1 ? "frozen_account" : "victim";
}

export async function openCase(track: Track, signal?: AbortSignal): Promise<OpenResult> {
  const made = await postJson(
    "/api/cases",
    { track },
    signal,
    "사건을 만들지 못했습니다. 연결을 확인해 주세요.",
  );
  if (!made.ok) return { ok: false, fail: made.fail };

  const body = made.json as { link_token?: unknown };
  if (typeof body.link_token !== "string" || body.link_token.length === 0) {
    // **주소를 못 받으면 다음 요청을 아예 못 보냅니다** — §3.2 부터 경로가
    // `{case_token}` 이고 그 값을 받을 자리가 여기뿐입니다
    return {
      ok: false,
      fail: {
        poll: false,
        reason: "error",
        retryable: true,
        message: "사건은 만들어졌는데 주소를 받지 못했습니다.",
      },
    };
  }
  return { ok: true, linkToken: body.link_token };
}
