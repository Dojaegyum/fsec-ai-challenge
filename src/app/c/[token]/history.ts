"use client";

/**
 * 지난 것을 되살리는 자리 — 볼트를 열고 대화 이력을 읽습니다.
 *
 * 계약: spec/common/08-14-api.md §3.11 `GET` · §3.12
 * 근거: ADR-050(되받는 경로) · ADR-009(매핑은 암호문으로 서버에) ·
 *       ADR-027(키는 이 브라우저에만) · ADR-034(화면은 원문)
 *
 * ## 두 번 부릅니다 — 볼트 먼저
 *
 * ```
 * GET …/vault      봉한 매핑을 받아 이 기기의 키로 엽니다
 * GET …/messages   토큰화된 대화를 받아 그 매핑으로 되살립니다
 * ```
 *
 * 순서가 뒤집히면 첫 화면이 `[계좌-1]` 로 그려진 뒤 값이 튀어 바뀝니다.
 *
 * ## 키가 없는 기기에서는 토큰이 그대로 보입니다 — 그게 맞습니다
 *
 * 세션키는 **만든 브라우저의 IndexedDB 에만** 있습니다(ADR-027). 가족이 링크를
 * 받아 열면 매핑을 받아도 못 엽니다. 도우려는 사람에게 필요한 것은 절차와
 * 기한이고 계좌번호는 아닙니다 — **링크가 새어도 계좌번호는 안 나갑니다.**
 *
 * ⚠️ **여기서 키를 만들지 마세요.** `loadOrCreateKey` 를 쓰면 남의 기기에서
 * **새 키가 생기고**, 그 사람이 값을 보내는 순간 원래 브라우저가 그 칸을
 * 영영 못 엽니다. 읽기는 `store.get()` 만 씁니다.
 */

import { sourceNote } from "@/modules/chat-handler";
import { openMapping } from "@/modules/key-handler";
import type { KeyStore, VaultEntry } from "@/modules/key-handler";
import type { PiiKind, PiiMapping } from "@/modules/pii-masker";
import { parseToken, restore } from "@/modules/pii-restorer";
import type { RestorableMapping } from "@/modules/pii-restorer";

import type { Line } from "./send";

/** 1차(정규식)가 만드는 종류 넷. `[이름-1]` 은 서버 NER 이 만듭니다 */
const FIRST_PASS: readonly string[] = ["주민번호", "카드", "전화", "계좌"];

export interface OpenedVault {
  /** 화면에 되살릴 때 쓰는 것 — **열린 것 전부** */
  readonly restorable: RestorableMapping[];
  /**
   * 다음 발화를 가릴 때 이어 쓸 것 — **1차 종류만**.
   *
   * 이걸 넘겨야 같은 계좌가 다시 나올 때 `[계좌-1]` 을 재사용합니다.
   * 안 넘기면 세션마다 번호가 1부터 다시 시작해, **서로 다른 계좌가 같은
   * 번호**를 갖게 됩니다 → PII 경계 「같은 값이 다시 나오면 같은 번호」.
   */
  readonly maskContext: PiiMapping[];
  /** 이 기기에 열쇠가 있나. 없으면 토큰이 토큰으로 보입니다 */
  readonly hasKey: boolean;
  /**
   * 서버가 갖고 있던 칸 수. **열쇠 없음과 「맡긴 것이 없음」을 가르는 값**입니다 —
   * 새 사건은 둘 다 0이라 「잠겼다」고 말하면 안 됩니다
   */
  readonly stored: number;
  /** 열쇠는 있는데 못 푼 칸 수. **0이 아니면 화면이 말해야 합니다** */
  readonly failed: number;
}

const NO_VAULT: OpenedVault = {
  restorable: [],
  maskContext: [],
  hasKey: false,
  stored: 0,
  failed: 0,
};

/**
 * 볼트를 열어 매핑을 만듭니다.
 *
 * **못 열린 칸을 조용히 버리지 않습니다** — 세어서 돌려줍니다. 빈칸이
 * 값이 없어서인지 못 열어서인지 사용자가 알아야 합니다.
 */
export async function openVault(
  caseToken: string,
  store: KeyStore,
  signal?: AbortSignal,
): Promise<OpenedVault> {
  // **여기서 키를 만들지 않습니다** — 위 경고 참고
  const session = await store.get(caseToken);

  let res: Response;
  try {
    res = await fetch(`/api/cases/${encodeURIComponent(caseToken)}/vault`, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch {
    return NO_VAULT;
  }
  if (!res.ok) return NO_VAULT;

  const body = (await res.json()) as { entries?: readonly VaultEntry[] };
  const entries = body.entries ?? [];

  // **열쇠가 없는 기기입니다** — 몇 칸이 있었는지는 알려 줍니다. 그래야 화면이
  // 「열쇠가 없어 가려진 채로 보입니다」와 「아직 아무것도 없습니다」를 가릅니다
  if (!session) return { ...NO_VAULT, stored: entries.length };

  const restorable: RestorableMapping[] = [];
  const maskContext: PiiMapping[] = [];
  let failed = 0;

  for (const entry of entries) {
    let original: string;
    try {
      original = await openMapping(session, entry);
    } catch {
      // 키가 다르거나 암호문이 손상된 칸입니다. **세고 넘어갑니다**
      failed += 1;
      continue;
    }
    restorable.push({ token: entry.token, original });

    const parsed = parseToken(entry.token);
    if (parsed && FIRST_PASS.includes(parsed.kind)) {
      maskContext.push({
        token: entry.token,
        kind: parsed.kind as PiiKind,
        seq: parsed.seq,
        original,
      });
    }
  }

  return { restorable, maskContext, hasKey: true, stored: entries.length, failed };
}

/** §3.12 응답 한 줄 */
interface HistoryRow {
  readonly message_id: string;
  readonly role: string;
  readonly content: string;
  readonly citations?: readonly { ref: string; label: string }[];
  readonly created_at: string;
}

export interface History {
  readonly lines: readonly Line[];
  /** 앞부분이 잘렸나 → §3.12. **화면이 그 사실을 말해야 합니다** */
  readonly truncated: boolean;
  /**
   * 못 읽었나. **「대화가 없다」와 다릅니다.**
   *
   * 조용히 빈 목록으로 떨어뜨리면, 며칠 뒤 링크로 돌아온 사용자가 자기 대화가
   * **사라진 것인지 못 읽은 것인지** 알 수 없습니다 — 링크가 유일한 열쇠인
   * 서비스에서 그 구분이 특히 중요합니다 (ADR-021 · ADR-050)
   */
  readonly failed?: boolean;
}

const NO_HISTORY: History = { lines: [], truncated: false };

/**
 * 대화 이력을 읽어 화면 줄로 되살립니다.
 *
 * **자리마다 펼치는 정도가 다릅니다** → PII 경계 「복원 가능 목록」.
 *  · 내가 한 말(`user-input`) — 전부 펼칩니다. 내가 쓴 글입니다
 *  · 비서의 답(`chat-answer`) — **종류별 부분 복원.** 계좌는 `국민 ****7890`,
 *    주민번호는 안 펼칩니다. 인젝션으로 값을 캐내려는 시도를 막는 자리입니다
 */
export async function fetchHistory(
  caseToken: string,
  mappings: readonly RestorableMapping[],
  signal?: AbortSignal,
): Promise<History> {
  let res: Response;
  try {
    res = await fetch(`/api/cases/${encodeURIComponent(caseToken)}/messages`, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch {
    // ⚠️ **못 읽은 것과 대화가 없던 것을 가릅니다.** 뭉치면 며칠 뒤 링크로 돌아온
    // 사용자가 자기 대화가 **사라진 것인지 못 읽은 것인지** 알 수 없습니다.
    // 이 서비스는 링크가 유일한 열쇠라 그 구분이 특히 중요합니다 (ADR-021 · ADR-050)
    return { ...NO_HISTORY, failed: true };
  }
  if (!res.ok) return { ...NO_HISTORY, failed: true };

  const body = (await res.json()) as {
    messages?: readonly HistoryRow[];
    truncated?: boolean;
  };
  const open = [...mappings];

  const lines: Line[] = (body.messages ?? []).map((row) =>
    row.role === "user"
      ? { who: "me", text: restore(row.content, open, { site: "user-input" }) }
      : {
          who: "ai",
          message_id: row.message_id,
          reply: restore(row.content, open, { site: "chat-answer" }),
          question: null,
          sourceNote: sourceNote(row.citations ?? []),
          referencedSteps: [],
        },
  );

  return { lines, truncated: body.truncated === true };
}
