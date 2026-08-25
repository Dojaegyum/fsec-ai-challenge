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

import { useCallback, useEffect, useMemo, useState } from "react";

import { outgoing, toTurn } from "@/modules/chat-handler";
import type {
  ChatResponse,
  NextQuestion,
  PiiConfirm,
  SlotAnswerResponse,
  Turn,
} from "@/modules/chat-handler";
import {
  createSessionKey,
  indexedDbKeyStore,
  loadOrCreateKey,
  sealAll,
} from "@/modules/key-handler";
import type { KeyStore } from "@/modules/key-handler";
import type { PiiMapping } from "@/modules/pii-masker";

import { fetchHistory, openVault } from "./history";
import { postJson, sendJson } from "./load";
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

/**
 * ①② **가리고 봉하고 맡긴다** — 값을 내보내는 모든 자리가 여기를 지납니다.
 *
 * 발화(§3.9)와 슬롯 답(§3.5)이 같은 함수를 쓰는 것이 중요합니다. 둘로 갈라
 * 적으면 한쪽만 볼트를 빠뜨려도 **화면은 멀쩡해 보이고**, 며칠 뒤 서류가
 * 빈칸이 됐을 때야 압니다.
 */
async function screenAndSeal(input: {
  caseToken: string;
  text: string;
  mappings: readonly PiiMapping[];
  store: KeyStore;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; content: string; mappings: PiiMapping[] }
  | { ok: false; fail: LoadFail }
> {
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
    if (!kept.ok) return { ok: false, fail: kept.fail };
  }

  return { ok: true, content: out.content, mappings: out.mappings };
}

export async function sendUtterance(input: {
  caseToken: string;
  text: string;
  mappings: readonly PiiMapping[];
  store: KeyStore;
  signal?: AbortSignal;
}): Promise<SendResult> {
  const { caseToken, signal } = input;

  const out = await screenAndSeal(input);
  if (!out.ok) return { ok: false, stage: "vault", fail: out.fail };

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

/* ── 슬롯 답변 — §3.5 ───────────────────────────────────────── */

/** 어느 걸음에서 멈췄나 */
export type SlotStage = "vault" | "answer";

export type SlotResult =
  | {
      readonly ok: true;
      readonly response: SlotAnswerResponse;
      readonly mappings: PiiMapping[];
      /** 실제로 보낸 값 — 되묻기에 다시 답할 때 **같은 것**을 보내야 합니다 */
      readonly sent: string | null;
    }
  | { readonly ok: false; readonly stage: SlotStage; readonly fail: LoadFail };

/**
 * 질문 하나에 답한다 → §3.5.
 *
 * **발화와 같은 경계를 지납니다** — 타이핑한 값에 계좌번호가 들어 있을 수 있고,
 * 이 값은 나중에 `prompt-builder` 가 프롬프트에 실어 **외부 모델로 내보냅니다**
 * (ADR-040 · `flows/chat-turn.ts` 의 `caseState`). 그래서 순서도 같습니다:
 * **볼트 먼저, 답 나중.**
 *
 * | `action` | 무엇 | 값 |
 * | --- | --- | --- |
 * | `answer` | 값으로 답한다 | 원문 → 여기서 가려서 보냅니다 |
 * | `unknown` | 「모름」 | 없음. **실패가 아니라 상태입니다** (불변 규칙 5) |
 * | `mask`·`keep` | 되묻기에 답한다 | **이미 가려서 보냈던 그 값** 그대로 |
 *
 * ⬜ **`mask` 를 서버가 합니다.** §3.5 는 「가리는 것은 브라우저가 합니다」라고
 * 적혀 있지만, 2차에서 걸리는 것은 NER 이 집은 것(이름·기관)이라 **브라우저의
 * 정규식은 그것을 못 집습니다** — 지금 브라우저가 할 수 있는 일이 아닙니다.
 * `flows/answer-slot.ts` 가 하는 대로 이어 두고 판단은 남깁니다 → QA 계획 Task 9 ①.
 */
export async function answerSlot(input: {
  caseToken: string;
  slotKey: string;
  action: "answer" | "unknown" | "mask" | "keep";
  /** `answer` 면 원문 · `mask`/`keep` 이면 앞서 보낸 가려진 값 */
  value?: string;
  mappings: readonly PiiMapping[];
  store: KeyStore;
  signal?: AbortSignal;
}): Promise<SlotResult> {
  const { caseToken, slotKey, action, signal } = input;
  const url = `/api/cases/${encodeURIComponent(caseToken)}/slots/${encodeURIComponent(slotKey)}`;

  // 「모름」은 값이 없으니 경계를 지날 것도 없습니다
  if (action === "unknown") {
    const said = await sendJson("PATCH", url, { action }, signal, "답을 보내지 못했습니다.");
    if (!said.ok) return { ok: false, stage: "answer", fail: said.fail };
    return {
      ok: true,
      response: said.json as SlotAnswerResponse,
      mappings: [...input.mappings],
      sent: null,
    };
  }

  // 되묻기에 답하는 것은 **같은 값을 다시** 보내는 것입니다 — 이미 가렸고 이미 맡겼습니다.
  // 여기서 다시 가리면 같은 값에 **새 토큰**이 붙어 볼트에 쌍둥이가 생깁니다
  let content = input.value ?? "";
  let mappings = [...input.mappings];

  if (action === "answer") {
    const out = await screenAndSeal({ ...input, text: content });
    if (!out.ok) return { ok: false, stage: "vault", fail: out.fail };
    content = out.content;
    mappings = out.mappings;
  }

  const said = await sendJson(
    "PATCH",
    url,
    { action, value: content },
    signal,
    "답을 보내지 못했습니다.",
  );
  if (!said.ok) return { ok: false, stage: "answer", fail: said.fail };

  return { ok: true, response: said.json as SlotAnswerResponse, mappings, sent: content };
}

/** 질문 자리가 화면에 내주는 것 */
export interface SlotAsk {
  /** 지금 물을 것. 없으면 `null` → 질문 자리를 안 그립니다 */
  readonly question: NextQuestion | null;
  /**
   * 되묻기 중이면 그 카드 — **질문 대신** 뜹니다. `typed` 는 사용자가 적은
   * 원문이라 화면이 그대로 보여줍니다 (ADR-034)
   */
  readonly confirm: { readonly card: PiiConfirm; readonly typed: string } | null;
  readonly busy: boolean;
  readonly fail: { readonly stage: SlotStage; readonly fail: LoadFail } | null;
  /** 값으로 답한다 */
  readonly answer: (value: string) => Promise<void>;
  /** 「모름」 */
  readonly skip: () => Promise<void>;
  /** 되묻기에 답한다 */
  readonly resolve: (id: "mask" | "keep") => Promise<void>;
}

/** 컴포저가 받는 것. **셸이 한 벌만 들고 두 곳(본문·유령)에 내려줍니다** */
export interface ChatSend {
  readonly lines: readonly Line[];
  readonly sending: boolean;
  readonly fail: { readonly stage: SendStage; readonly fail: LoadFail } | null;
  readonly send: (text: string) => Promise<boolean>;
  /** 지난 대화를 아직 읽는 중인가 */
  readonly loading: boolean;
  /** 앞부분이 잘렸나 → §3.12 */
  readonly truncated: boolean;
  /**
   * 이 기기에 볼트를 열 열쇠가 없나 — **가족이 링크를 받아 연 경우**입니다.
   * 그러면 `[계좌-1]` 이 그대로 보이고, 화면이 그 이유를 말해야 합니다 (ADR-050).
   */
  readonly locked: boolean;
  /**
   * 질문 자리 → §3.4 · §3.5.
   *
   * **같은 훅에 있는 것이 중요합니다.** 슬롯 답과 발화가 매핑 목록을 나눠 가지면
   * 같은 계좌에 번호가 따로 붙어 **서로 다른 값이 같은 토큰**을 갖게 됩니다
   * → PII 경계 「같은 값이 다시 나오면 같은 번호」.
   */
  readonly ask: SlotAsk;
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
export function useChatSend(
  caseToken: string | null,
  /** §3.10 이 준 첫 질문. 이후로는 답의 `next_question` 이 이어받습니다 */
  firstQuestion: NextQuestion | null = null,
  /** 플랜이 다시 만들어졌을 때 — **화면을 비우지 않는 갱신**이어야 합니다 */
  onPlanChanged?: () => void,
): ChatSend {
  const store = useMemo<KeyStore>(() => indexedDbKeyStore(), []);
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [mappings, setMappings] = useState<PiiMapping[]>([]);
  const [sending, setSending] = useState(false);
  const [fail, setFail] = useState<{ stage: SendStage; fail: LoadFail } | null>(null);
  const [loading, setLoading] = useState(caseToken !== null);
  const [truncated, setTruncated] = useState(false);
  const [locked, setLocked] = useState(false);

  // 질문 자리 — 첫 값은 §3.10, 그 뒤로는 답과 발화가 함께 옮깁니다
  const [question, setQuestion] = useState<NextQuestion | null>(firstQuestion);
  const [confirm, setConfirm] = useState<{
    card: PiiConfirm;
    typed: string;
    /** 되묻기에 답할 때 **다시 보낼 값** — 이미 가려서 맡긴 그것입니다 */
    sent: string;
  } | null>(null);
  const [asking, setAsking] = useState(false);
  const [askFail, setAskFail] = useState<{ stage: SlotStage; fail: LoadFail } | null>(null);

  /**
   * 첫 로드 — **볼트를 먼저 열고** 그 매핑으로 이력을 되살립니다 (ADR-050).
   *
   * 매핑을 `mappings` 에 심어 두는 것이 중요합니다. 안 심으면 같은 계좌가
   * 다시 나올 때 번호가 1부터 다시 붙어 **서로 다른 값이 같은 토큰**을
   * 갖게 됩니다 → PII 경계 「같은 값이 다시 나오면 같은 번호」.
   */
  useEffect(() => {
    if (!caseToken) return;
    const ac = new AbortController();
    let alive = true;

    void (async () => {
      const vault = await openVault(caseToken, store, ac.signal);
      if (!alive) return;
      setMappings(vault.maskContext);
      // 볼트에 맡긴 것이 있는데 열쇠가 없을 때만 잠긴 것입니다 —
      // 아직 아무것도 안 맡긴 새 사건은 잠긴 것이 아닙니다
      setLocked(!vault.hasKey && vault.stored > 0);

      const past = await fetchHistory(caseToken, vault.restorable, ac.signal);
      if (!alive) return;
      setLines(past.lines);
      setTruncated(past.truncated);
      setLoading(false);
    })();

    return () => {
      alive = false;
      ac.abort();
    };
  }, [caseToken, store]);

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
      // 발화도 질문을 옮깁니다 — §3.9 응답에 `next_question` 이 실립니다.
      // 이걸 안 받으면 답을 말로 했는데 **같은 질문이 그대로 남아** 있습니다
      setQuestion(result.turn.question);
      return true;
    },
    [caseToken, mappings, sending, store],
  );

  /** 답 하나를 보내고 화면 상태를 옮깁니다 — 세 입구(`answer`·`skip`·`resolve`)가 함께 씁니다 */
  const put = useCallback(
    async (
      action: "answer" | "unknown" | "mask" | "keep",
      value: string | undefined,
      typed: string,
    ) => {
      if (!caseToken || !question || asking) return;

      setAsking(true);
      setAskFail(null);

      const result = await answerSlot({
        caseToken,
        slotKey: question.slot_key,
        action,
        ...(value === undefined ? {} : { value }),
        mappings,
        store,
      });
      setAsking(false);

      if (!result.ok) {
        setAskFail({ stage: result.stage, fail: result.fail });
        return;
      }
      setMappings(result.mappings);

      // 되묻기가 오면 **질문은 그대로 두고** 카드를 겹칩니다 — 아직 답한 것이
      // 아니라서입니다. 확인 전에는 없는 값과 같습니다 (ADR-041)
      const card = result.response.pii_confirm;
      if (card && result.sent !== null) {
        setConfirm({ card, typed, sent: result.sent });
        return;
      }

      setConfirm(null);
      setQuestion(result.response.next_question);
      // **화면을 비우지 않는 갱신입니다** — 여기서 사건을 다시 읽으면 방금 한
      // 대화가 사라집니다 (`useCaseBundle` 의 `refresh`)
      if (result.response.plan_regenerated) onPlanChanged?.();
    },
    [asking, caseToken, mappings, onPlanChanged, question, store],
  );

  const ask = useMemo<SlotAsk>(
    () => ({
      question,
      confirm: confirm ? { card: confirm.card, typed: confirm.typed } : null,
      busy: asking,
      fail: askFail,
      answer: (value: string) => put("answer", value, value),
      skip: () => put("unknown", undefined, ""),
      // **같은 값을 다시 보냅니다** — 이미 가렸고 이미 맡겼습니다
      resolve: (id: "mask" | "keep") =>
        confirm ? put(id, confirm.sent, confirm.typed) : Promise.resolve(),
    }),
    [asking, askFail, confirm, put, question],
  );

  return { lines, sending, fail, send, loading, truncated, locked, ask };
}
