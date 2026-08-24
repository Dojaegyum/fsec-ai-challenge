"use client";

/**
 * 나가는 쪽 — 발화 한 턴. `load.ts` 의 짝입니다.
 *
 * 계약: spec/common/08-14-api.md §3.9 (챗) · §3.11 (볼트) ·
 *       spec/common/08-14-pii-boundary.md
 * 근거: ADR-009(매핑은 암호문으로 서버에) · ADR-027(키는 브라우저에만) ·
 *       ADR-034(화면은 원문) · ADR-049(볼트는 같은 Postgres)
 *
 * ## 순서가 계약입니다
 *
 * ```
 * outgoing()  →  sealAll()  →  POST …/vault  →  POST …/messages
 *  가리고        봉하고        맡기고           보낸다
 * ```
 *
 * **거꾸로 하면 아무도 못 푸는 토큰이 사건에 남습니다.** `[계좌-1]` 이 영영
 * `[계좌-1]` 이 되고, 사용자는 서류가 왜 빈칸인지 알 방법이 없습니다 (§3.11).
 * 그래서 볼트가 실패하면 **발화를 보내지 않습니다** — 반대 순서의 실패는
 * 안전합니다(안 쓰이는 매핑이 남을 뿐이고 파기일에 함께 지워집니다).
 *
 * ## 네트워크에 태우는 것은 `outgoing().content` 뿐입니다
 *
 * 원문을 `fetch` 에 넣는 경로를 여기 만들지 마세요 — **불변 규칙 2** 입니다.
 * 화면에 그리는 것은 원문이고(ADR-034), 나가는 것은 토큰입니다. 둘은 다른 값입니다.
 */

import { useCallback, useMemo, useState } from "react";

import { outgoing, toTurn } from "@/modules/chat-handler";
import type { ChatResponse, Turn } from "@/modules/chat-handler";
import {
  createSessionKey,
  indexedDbKeyStore,
  loadOrCreateKey,
  sealAll,
} from "@/modules/key-handler";
import type { KeyStore } from "@/modules/key-handler";
import type { PiiMapping } from "@/modules/pii-masker";

import { postJson } from "./load";
import type { LoadFail } from "./load";

/** 어느 걸음에서 멈췄나 — 화면이 무엇을 말할지가 갈립니다 */
export type SendStage = "vault" | "message";

export type SendResult =
  | { readonly ok: true; readonly turn: Turn; readonly mappings: PiiMapping[] }
  | { readonly ok: false; readonly stage: SendStage; readonly fail: LoadFail };

/** 화면에 남는 한 줄. **사용자 발화는 원문으로 보관합니다** → ADR-034 */
export interface Said {
  readonly who: "me";
  readonly text: string;
}

export type Line = Said | ({ readonly who: "ai" } & Turn);

export async function sendUtterance(input: {
  caseToken: string;
  text: string;
  mappings: readonly PiiMapping[];
  store: KeyStore;
  signal?: AbortSignal;
}): Promise<SendResult> {
  const { caseToken, text, store, signal } = input;

  // ① 가립니다. **이 다음부터 원문은 브라우저 밖으로 안 나갑니다**
  const out = outgoing(text, { mappings: [...input.mappings] });

  // ② 새로 생긴 매핑이 있으면 봉해서 먼저 맡깁니다.
  //    키는 `extractable: false` 라 꺼낼 수 없고, 서버는 암호문만 받습니다
  if (out.added.length > 0) {
    let entries;
    try {
      const session = await loadOrCreateKey(store, caseToken, createSessionKey);
      entries = await sealAll(session, out.added);
    } catch {
      // 봉하지 못했으면 **보내지 않습니다.** 토큰만 나가고 매핑이 없으면
      // 그 값은 영영 못 풉니다
      return {
        ok: false,
        stage: "vault",
        fail: {
          poll: false,
          reason: "error",
          retryable: true,
          message: "이 브라우저에서 값을 안전하게 보관하지 못했습니다.",
        },
      };
    }

    const kept = await postJson(
      `/api/cases/${encodeURIComponent(caseToken)}/vault`,
      { entries },
      signal,
    );
    if (!kept.ok) return { ok: false, stage: "vault", fail: kept.fail };
  }

  // ③ 이제 보냅니다. 태우는 것은 `content` 뿐입니다
  const said = await postJson(
    `/api/cases/${encodeURIComponent(caseToken)}/messages`,
    { content: out.content },
    signal,
  );
  if (!said.ok) return { ok: false, stage: "message", fail: said.fail };

  // ④ 화면에 그릴 때 원문으로 되돌립니다 — **종류별 부분 복원**입니다.
  //    계좌는 `국민 ****7890`, 주민번호는 복원하지 않습니다 (§3.9)
  return {
    ok: true,
    turn: toTurn(said.json as ChatResponse, out.mappings),
    mappings: out.mappings,
  };
}

/** 컴포저가 받는 것. **셸이 한 벌만 들고 두 곳(본문·유령)에 내려줍니다** */
export interface ChatSend {
  readonly lines: readonly Line[];
  readonly sending: boolean;
  readonly fail: { readonly stage: SendStage; readonly fail: LoadFail } | null;
  readonly send: (text: string) => Promise<boolean>;
}

/**
 * 컴포저가 쓰는 얼굴.
 *
 * **다시 보내는 것은 사용자가 합니다** — 실패해도 스스로 다시 부르지 않습니다
 * (에러 §3.1). 못 보낸 글은 지우지 않고 입력칸에 남겨 둡니다.
 *
 * ⚠️ **화면마다 부르지 마세요.** 전환 중에는 나가는 본문의 사본(유령)이 함께
 * 그려지는데, 훅이 둘이면 사본은 **빈 대화**를 보여줍니다. 셸에서 한 번 부르고
 * 내려보냅니다.
 */
export function useChatSend(caseToken: string | null): ChatSend {
  const store = useMemo<KeyStore>(() => indexedDbKeyStore(), []);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [mappings, setMappings] = useState<PiiMapping[]>([]);
  const [sending, setSending] = useState(false);
  const [fail, setFail] = useState<{ stage: SendStage; fail: LoadFail } | null>(null);

  /** 보냈나 — **부른 쪽이 입력칸을 비울지 정하는 데 씁니다.** 실패했는데 비우면
   *  사용자가 방금 쓴 글을 통째로 다시 타이핑해야 합니다 */
  const send = useCallback(
    async (text: string): Promise<boolean> => {
      if (!caseToken || sending) return false;
      const trimmed = text.trim();
      if (trimmed.length === 0) return false;

      setSending(true);
      setFail(null);
      // 내가 한 말은 곧바로 화면에 남깁니다 — **원문으로** (ADR-034)
      setLines((prev) => [...prev, { who: "me", text: trimmed }]);

      const result = await sendUtterance({ caseToken, text: trimmed, mappings, store });
      setSending(false);

      if (!result.ok) {
        setFail({ stage: result.stage, fail: result.fail });
        // 못 보낸 말은 화면에서 걷어냅니다 — 남겨 두면 보낸 것처럼 보입니다
        setLines((prev) => prev.slice(0, -1));
        return false;
      }
      setMappings(result.mappings);
      setLines((prev) => [...prev, { who: "ai", ...result.turn }]);
      return true;
    },
    [caseToken, mappings, sending, store],
  );

  return { lines, sending, fail, send };
}
