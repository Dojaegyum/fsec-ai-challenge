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
 *
 * ## 못 열어도 **이름표는 자리를 지킵니다**
 *
 * 볼트 항목의 `token` 은 평문입니다(`migrations/0004_vault_schema.sql` — 암호문은
 * `ciphertext` 뿐). **열쇠가 없어도 「`[계좌-1]` 은 이미 쓰였다」는 것은 압니다.**
 *
 * 그래서 못 연 칸도 `maskContext` 에 **자리만** 실어 돌려줍니다. 안 그러면
 * 이렇게 됩니다 —
 *
 * ```
 * 본인 기기      [계좌-1] = 본인 계좌 를 봉해 맡김
 * 가족이 링크 열기  열쇠가 없어 maskContext 가 빈 배열
 * 가족이 값 입력   번호가 1부터 다시 붙어 [계좌-1] = 가족 계좌
 *                POST …/vault 의 `ON CONFLICT … DO UPDATE SET ciphertext` 가
 *                **본인 칸을 덮어씀**
 * 본인이 돌아옴    옛 대화의 [계좌-1] 이 가족 계좌로 복원됨
 * ```
 *
 * 「가족에게 링크 보내기」는 이 서비스가 내건 기능입니다 — **그 기능을 쓰면
 * 본인 데이터가 조용히 망가지는 것**을 자리 예약으로 막습니다 (ADR-050 · §3.11).
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

/**
 * **자리만 예약한 칸**의 원문 대역 — 이 기기에서 못 여는 항목에 붙습니다.
 *
 * `maskContext` 의 칸은 `PiiMapping` 이라 `original` 이 반드시 있어야 하는데,
 * 못 연 칸에는 원문이 없습니다. 그래서 **아무 글에도 나타날 수 없는 값**을 넣습니다.
 *
 * 이 값이 지켜야 하는 셋입니다 — 하나라도 어기면 지금보다 나빠집니다.
 *
 * | 지킬 것 | 왜 |
 * | --- | --- |
 * | **1차 정규식이 잡는 값과 절대 같지 않다** | `pii-masker` 의 `maskText` 가 `original` **값으로** 기존 칸을 찾습니다(`findExisting`). 같아질 수 있는 값을 넣으면 **서로 다른 값이 같은 이름표**를 받습니다 |
 * | **숫자가 한 글자도 없다** | `pii-restorer` 의 `maskPartial` 이 숫자를 세어 `****6789` 를 만듭니다. 숫자가 있으면 **없는 값을 원문인 양** 그려 냅니다 |
 * | **빈 문자열이 아니다** | `assertNoLeak` 이 `masked.includes(original)` 로 검사합니다 — 빈 문자열은 **언제나 참**이라 나가는 글마다 걸립니다 |
 *
 * `\u0000` 으로 시작하는 이유는 사용자가 입력할 수 없는 글자라서입니다.
 * 정규식이 잡는 값은 숫자와 구분자뿐이므로 세 조건을 모두 만족합니다.
 */
const RESERVED_ORIGINAL = "\u0000볼트에-있으나-이-기기에서-못-여는-자리";

/**
 * 원문 없이 **번호만 잡아 둔 칸**인가.
 *
 * 봉하는 쪽(`send.ts`)이 이것을 보고 거릅니다 — 대역을 원문인 양 봉해서 맡기면
 * 그게 바로 우리가 막으려던 **덮어쓰기**입니다.
 */
export function isReserved(mapping: { readonly original: string }): boolean {
  return mapping.original === RESERVED_ORIGINAL;
}

export interface OpenedVault {
  /** 화면에 되살릴 때 쓰는 것 — **열린 것 전부** */
  readonly restorable: RestorableMapping[];
  /**
   * 다음 발화를 가릴 때 이어 쓸 것 — **1차 종류만**.
   *
   * 이걸 넘겨야 같은 계좌가 다시 나올 때 `[계좌-1]` 을 재사용합니다.
   * 안 넘기면 세션마다 번호가 1부터 다시 시작해, **서로 다른 계좌가 같은
   * 번호**를 갖게 됩니다 → PII 경계 「같은 값이 다시 나오면 같은 번호」.
   *
   * **못 연 칸도 여기 들어옵니다** — 원문 자리에 `RESERVED_ORIGINAL` 이 박힌
   * 예약 칸으로. 위 머리말의 덮어쓰기를 막는 것이 이 칸들입니다.
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
  /**
   * 서버에 **무엇이 맡겨져 있는지 실제로 확인했나.**
   *
   * ⚠️ **「맡긴 것이 없다」와 「못 물어봤다」는 다릅니다.** 못 물어본 채로 다음
   * 발화를 가리면 번호가 1부터 다시 붙고, 그 발화가 **이미 있던 칸을 덮어씁니다**
   * (`ON CONFLICT (case_id, token) DO UPDATE SET ciphertext` → §3.11).
   * 그래서 봉하는 쪽이 이 값을 보고 **모르면 발급하지 않습니다**(`send.ts`).
   */
  readonly read: boolean;
}

/** 물어보지 못했다 — **「없다」가 아닙니다.** 위 `read` 참고 */
const NO_VAULT: OpenedVault = {
  restorable: [],
  maskContext: [],
  hasKey: false,
  stored: 0,
  failed: 0,
  read: false,
};

/**
 * 볼트를 열어 매핑을 만듭니다.
 *
 * **못 열린 칸을 조용히 버리지 않습니다** — 세어서 돌려주고, **이름표는
 * 자리에 남겨 둡니다.** 빈칸이 값이 없어서인지 못 열어서인지 사용자가 알아야
 * 하고, 그 자리를 비우면 다음 발화가 **같은 번호를 다시 발급해 덮어씁니다**
 * (머리말 「못 열어도 이름표는 자리를 지킵니다」).
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

  let entries: readonly VaultEntry[];
  try {
    const body = (await res.json()) as { entries?: readonly VaultEntry[] };
    entries = body.entries ?? [];
  } catch {
    // 본문이 JSON 이 아닙니다 — **무엇이 맡겨져 있는지 모르는 것**이지
    // 「없는 것」이 아닙니다. 여기서 던지면 부르는 쪽의 `void (async …)()` 가
    // 통째로 거절돼 화면이 영영 「불러오는 중」에 머뭅니다
    return NO_VAULT;
  }

  const restorable: RestorableMapping[] = [];
  const maskContext: PiiMapping[] = [];
  let failed = 0;

  for (const entry of entries) {
    /**
     * 못 열었으면 `null`. **열쇠가 없는 기기에서는 열어 볼 것도 없습니다** —
     * 여기서 `loadOrCreateKey` 를 부르면 남의 기기에 키가 생깁니다(머리말 경고).
     */
    let original: string | null = null;
    if (session) {
      try {
        original = await openMapping(session, entry);
      } catch {
        // 키가 다르거나 암호문이 손상된 칸입니다. **세 둡니다** —
        // 화면이 「몇 칸을 못 열었다」를 말할 근거입니다
        failed += 1;
      }
    }

    // 원문이 있는 것만 되살립니다. 예약 칸을 여기 넣으면 대역이 화면에 그려집니다
    if (original !== null) restorable.push({ token: entry.token, original });

    const parsed = parseToken(entry.token);
    if (parsed && FIRST_PASS.includes(parsed.kind)) {
      // **못 열어도 넣습니다.** 넣는 것은 이름표(`token`·`kind`·`seq`)이고,
      // 원문 자리에는 아무 글에도 나타날 수 없는 대역이 들어갑니다 —
      // 그러면 다음 발화가 이 번호를 피해 `[계좌-2]` 를 씁니다
      maskContext.push({
        token: entry.token,
        kind: parsed.kind as PiiKind,
        seq: parsed.seq,
        original: original ?? RESERVED_ORIGINAL,
      });
    }
  }

  return {
    restorable,
    maskContext,
    hasKey: session !== null,
    stored: entries.length,
    failed,
    read: true,
  };
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
