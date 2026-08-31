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
 *
 * ## 무엇이 이미 맡겨져 있는지 모르면 **새 이름표를 발급하지 않습니다**
 *
 * 볼트는 `ON CONFLICT (case_id, token) DO UPDATE SET ciphertext` 로 덮어씁니다
 * (§3.11 · `migrations/0004_vault_schema.sql`). 그래서 **번호를 잘못 발급하는 것이
 * 곧 남의 칸을 지우는 것**입니다 — 못 여는 칸이 있어도 이름표는 `openVault` 가
 * 예약해 주지만(`history.ts`), 볼트 조회 자체가 실패했으면 **아무것도 모릅니다.**
 *
 * 그때는 `vaultRead: false` 로 들어오고, 가릴 것이 생긴 순간 **한 번 더 물어본
 * 뒤에** 붙입니다. 그래도 못 물어보면 보내지 않습니다 — 조용히 1번부터 붙이면
 * 며칠 뒤 본인의 계좌가 남의 계좌로 복원됩니다.
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
  memoryKeyStore,
  loadOrCreateKey,
  sealAll,
} from "@/modules/key-handler";
import type { KeyStore } from "@/modules/key-handler";
import type { PiiMapping } from "@/modules/pii-masker";
import type { RestorableMapping } from "@/modules/pii-restorer";

import { fetchHistory, isReserved, openVault } from "./history";
import { postJson, sendJson } from "./load";
import type { LoadFail } from "./load";

/** 어느 걸음에서 멈췄나 — 화면이 무엇을 말할지가 갈립니다 */
export type SendStage = "vault" | "message";

export type SendResult =
  | {
      readonly ok: true;
      readonly turn: Turn;
      readonly mappings: PiiMapping[];
      /** 볼트를 확인한 채로 끝났나 — 부른 쪽이 다음 턴에 그대로 넘깁니다 */
      readonly vaultRead: boolean;
    }
  | { readonly ok: false; readonly stage: SendStage; readonly fail: LoadFail };

/** 화면에 남는 한 줄. **사용자 발화는 원문으로 보관합니다** → ADR-034 */
export interface Said {
  readonly who: "me";
  readonly text: string;
}

export type Line = Said | ({ readonly who: "ai" } & Turn);

/**
 * 볼트에서 다시 읽어 온 것을 앞에 두고 이 세션에만 있는 것을 뒤에 잇습니다.
 *
 * **같은 이름표가 둘이면 볼트 쪽이 이깁니다** — 서버에 실제로 맡겨진 것이
 * 진짜이고, 이 세션의 짐작이 그것을 덮으면 안 됩니다.
 */
function mergeContext(
  kept: readonly PiiMapping[],
  local: readonly PiiMapping[],
): PiiMapping[] {
  const taken = new Set(kept.map((m) => m.token));
  return [...kept, ...local.filter((m) => !taken.has(m.token))];
}

/** 볼트에 무엇이 있는지 모른 채로는 번호를 못 붙입니다 → 위 머리말 */
const VAULT_UNKNOWN: LoadFail = {
  poll: false,
  reason: "error",
  retryable: true,
  message: "이 사건에 이미 맡겨진 값을 확인하지 못했습니다. 잠시 뒤 다시 보내 주세요.",
};

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
  /**
   * 볼트에 **무엇이 맡겨져 있는지 확인한 상태인가** → `openVault` 의 `read`.
   *
   * `false` 면 이미 쓰인 번호를 모르는 것이라, 새 이름표를 붙이기 전에 한 번
   * 더 물어봅니다. **기본값을 두지 않습니다** — 안 넘기고 `true` 로 떨어지면
   * 그 자리가 곧 덮어쓰기입니다.
   */
  vaultRead: boolean;
  store: KeyStore;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; content: string; mappings: PiiMapping[]; vaultRead: boolean }
  | { ok: false; fail: LoadFail }
> {
  const { caseToken, text, store, signal } = input;
  let vaultRead = input.vaultRead;

  // ① 가립니다. **이 다음부터 원문은 브라우저 밖으로 안 나갑니다**
  let out = outgoing(text, { mappings: [...input.mappings] });

  // ①' 새 이름표를 붙여야 하는데 **이미 쓰인 번호를 모른다면** 먼저 물어봅니다.
  //     가릴 것이 없으면 여기 안 옵니다 — 볼트를 괜히 부르지 않습니다
  if (out.added.length > 0 && !vaultRead) {
    const again = await openVault(caseToken, store, signal);
    if (!again.read) return { ok: false, fail: VAULT_UNKNOWN };
    vaultRead = true;
    // 예약 칸까지 들어 있는 목록으로 **다시** 가립니다. 이번엔 번호가 이어집니다
    out = outgoing(text, { mappings: mergeContext(again.maskContext, input.mappings) });
  }

  // ② 새로 생긴 매핑이 있으면 봉해서 먼저 맡깁니다.
  //    키는 `extractable: false` 라 꺼낼 수 없고, 서버는 암호문만 받습니다
  if (out.added.length > 0) {
    // ⚠️ **원문이 없는 예약 칸은 절대 봉하지 않습니다.** 대역을 원문인 양 봉해
    //    맡기면 `ON CONFLICT … DO UPDATE SET ciphertext` 가 본인 칸을 그 대역으로
    //    갈아끼웁니다 — 우리가 막으려던 덮어쓰기 그 자체입니다 (`history.ts`).
    //    `maskText` 는 예약 칸을 `added` 에 넣지 않지만, 값이 새는 자리는
    //    한 번 뚫리면 조용하므로 나가기 직전에 한 번 더 거릅니다
    const fresh = out.added.filter((m) => !isReserved(m));

    if (fresh.length > 0) {
      let entries;
      try {
        const session = await loadOrCreateKey(store, caseToken, createSessionKey);
        entries = await sealAll(session, fresh);
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
  }

  return { ok: true, content: out.content, mappings: out.mappings, vaultRead };
}

export async function sendUtterance(input: {
  caseToken: string;
  text: string;
  mappings: readonly PiiMapping[];
  /** `openVault` 의 `read` 를 그대로 → `screenAndSeal` 의 같은 이름 참고 */
  vaultRead: boolean;
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
    vaultRead: out.vaultRead,
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
      /** 볼트를 확인한 채로 끝났나 — 발화와 같은 값을 이어 씁니다 */
      readonly vaultRead: boolean;
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
  /** `openVault` 의 `read` 를 그대로 → `screenAndSeal` 의 같은 이름 참고 */
  vaultRead: boolean;
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
      vaultRead: input.vaultRead,
    };
  }

  // 되묻기에 답하는 것은 **같은 값을 다시** 보내는 것입니다 — 이미 가렸고 이미 맡겼습니다.
  // 여기서 다시 가리면 같은 값에 **새 토큰**이 붙어 볼트에 쌍둥이가 생깁니다
  let content = input.value ?? "";
  let mappings = [...input.mappings];
  let vaultRead = input.vaultRead;

  if (action === "answer") {
    const out = await screenAndSeal({ ...input, text: content });
    if (!out.ok) return { ok: false, stage: "vault", fail: out.fail };
    content = out.content;
    mappings = out.mappings;
    vaultRead = out.vaultRead;
  }

  const said = await sendJson(
    "PATCH",
    url,
    { action, value: content },
    signal,
    "답을 보내지 못했습니다.",
  );
  if (!said.ok) return { ok: false, stage: "answer", fail: said.fail };

  return {
    ok: true,
    response: said.json as SlotAnswerResponse,
    mappings,
    sent: content,
    vaultRead,
  };
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
   * 지난 대화를 **못 읽었나.** 빈 대화와 가릅니다 — 조용히 뭉치면 사용자는
   * 자기 대화가 사라진 줄 압니다
   */
  readonly pastFailed: boolean;
  /**
   * 이 기기에 볼트를 열 열쇠가 없나 — **가족이 링크를 받아 연 경우**입니다.
   * 그러면 `[계좌-1]` 이 그대로 보이고, 화면이 그 이유를 말해야 합니다 (ADR-050).
   */
  readonly locked: boolean;
  /**
   * 볼트에서 열어 온 복원 매핑 — **이 브라우저에만 있습니다** (ADR-009 · ADR-027).
   *
   * ⚠️ **증거함이 이것을 못 받아서 픽스처를 쓰고 있었습니다.** 실제 전사문에
   * 하드코딩된 예시 값(`김민수`·`110-2345-678901`)이 끼워져 그려졌고, 바로 아래
   * 푸터가 「이 화면은 원문입니다」라고 단언했습니다 — 이 사건에 없는 값을 원문이라고
   * 말한 것입니다. 사용자가 그 번호를 서류에 옮겨 적을 수 있었습니다.
   *
   * **셸이 한 벌만 들고 내려줍니다.** 챗과 증거함이 갈라 열면 같은 값에 번호가
   * 따로 붙습니다 → PII 경계 「같은 값이 다시 나오면 같은 번호」.
   */
  readonly restorable: readonly RestorableMapping[];
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
  /**
   * 답이 가리킨 단계들 → §3.9 `referenced_steps`.
   *
   * **여기서 패널을 고르지 않습니다** — 언급이 여럿이어도 열 것은 하나이고,
   * 그 판단은 `work-handler` 의 `pickStep` 이 합니다.
   */
  onReferenced?: (stepIds: readonly string[]) => void,
): ChatSend {
  /**
   * 열쇠 보관소.
   *
   * ⚠️ **`useMemo` 는 서버 렌더에서도 돕니다.** `indexedDbKeyStore()` 는 그
   * 자리에서 던지도록 만들어져 있어(조용히 메모리로 떨어지면 새로고침 뒤에
   * 서류를 못 만드는데 이유를 아무도 모릅니다), 이 화면이 서버에서 한 번이라도
   * 그려지면 **500 이 났습니다** — `?view=` 로 여는 시연·스크린샷 경로가 그랬고,
   * 2026-08-27 에 배포에서 확인했습니다.
   *
   * 서버 렌더에서는 메모리 보관소를 씁니다. **그 자리에서는 아무것도 저장하지
   * 않습니다** — 브라우저에서 다시 그려질 때 진짜 보관소로 바뀌고, 열쇠를
   * 만드는 것은 그 뒤의 일입니다(불변 규칙 3: 열쇠는 클라이언트에만).
   */
  const store = useMemo<KeyStore>(
    () => (typeof indexedDB === "undefined" ? memoryKeyStore() : indexedDbKeyStore()),
    [],
  );
  const [lines, setLines] = useState<readonly Line[]>([]);
  const [mappings, setMappings] = useState<PiiMapping[]>([]);
  const [sending, setSending] = useState(false);
  const [fail, setFail] = useState<{ stage: SendStage; fail: LoadFail } | null>(null);
  const [loading, setLoading] = useState(caseToken !== null);
  const [truncated, setTruncated] = useState(false);
  /** 지난 대화를 **못 읽었나.** 「대화가 없다」와 다릅니다 */
  const [pastFailed, setPastFailed] = useState(false);
  const [locked, setLocked] = useState(false);
  /**
   * 볼트에 **무엇이 맡겨져 있는지 확인했나** → `openVault` 의 `read`.
   *
   * 첫 값이 `false` 인 것이 중요합니다 — 아직 안 물어본 상태에서 값이 실린
   * 발화가 나가면 `[계좌-1]` 을 다시 발급해 **남의 칸을 덮어씁니다** (§3.11).
   */
  const [vaultRead, setVaultRead] = useState(false);
  /** 볼트에서 열어 온 것. **증거함도 같은 것을 봐야 합니다** */
  const [restorable, setRestorable] = useState<readonly RestorableMapping[]>([]);

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
      // 이력만 되살리고 버리면 증거함이 볼 것이 없습니다 — 그래서 들고 있습니다
      setRestorable(vault.restorable);
      // **못 물어봤으면 `false` 로 둡니다.** 그래야 값이 실린 첫 발화가
      // 번호를 붙이기 전에 한 번 더 물어봅니다 (`screenAndSeal`)
      setVaultRead(vault.read);
      // 볼트에 맡긴 것이 있는데 열쇠가 없을 때만 잠긴 것입니다 —
      // 아직 아무것도 안 맡긴 새 사건은 잠긴 것이 아닙니다
      setLocked(!vault.hasKey && vault.stored > 0);

      const past = await fetchHistory(caseToken, vault.restorable, ac.signal);
      if (!alive) return;
      setLines(past.lines);
      setTruncated(past.truncated);
      setPastFailed(past.failed === true);
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

      const result = await sendUtterance({
        caseToken,
        text: trimmed,
        mappings,
        vaultRead,
        store,
      });
      setSending(false);

      if (!result.ok) {
        setFail({ stage: result.stage, fail: result.fail });
        // 못 보낸 말은 화면에서 걷어냅니다 — 남겨 두면 보낸 것처럼 보입니다
        setLines((prev) => prev.slice(0, -1));
        return false;
      }
      setMappings(result.mappings);
      // 여기서 다시 물어봤을 수 있습니다 — 확인했으면 다음 턴은 그냥 이어 씁니다
      setVaultRead(result.vaultRead);
      setLines((prev) => [...prev, { who: "ai", ...result.turn }]);
      // 「지급정지부터 하세요」라고 답했으면 그 단계의 작업 자리가 열려야 합니다.
      // **비어 있어도 부릅니다** — 「감사합니다」 같은 답에서는 비고, 그때
      // 패널을 그대로 두는 것이 부르는 쪽의 규칙입니다(`applySignal`)
      onReferenced?.(result.turn.referencedSteps);
      // 발화도 질문을 옮깁니다 — §3.9 응답에 `next_question` 이 실립니다.
      // 이걸 안 받으면 답을 말로 했는데 **같은 질문이 그대로 남아** 있습니다
      setQuestion(result.turn.question);
      return true;
    },
    [caseToken, mappings, onReferenced, sending, store, vaultRead],
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
        vaultRead,
        store,
      });
      setAsking(false);

      if (!result.ok) {
        setAskFail({ stage: result.stage, fail: result.fail });
        return;
      }
      setMappings(result.mappings);
      setVaultRead(result.vaultRead);

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
    [asking, caseToken, mappings, onPlanChanged, question, store, vaultRead],
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

  return { lines, sending, fail, send, loading, truncated, pastFailed, locked, restorable, ask };
}
