"use client";

/**
 * 첫 로드 — `GET /api/cases/{case_token}` **한 번**.
 *
 * 계약: spec/common/08-14-api.md §3.10 · spec/backend/08-16-errors.md §3.1 §3.1.1
 * 근거: ADR-021(재진입) · ADR-022(스트리밍을 쓰지 않는다) · ADR-039(주소는 링크 토큰)
 *
 * ## 왜 한 번인가
 *
 * §3.10 이 `slots`·`plan`·`deadlines` 를 **한 응답에** 싣습니다. 셋을 따로 부르면
 * 왕복이 셋이고 **그 사이에 화면이 반쯤 그려진 상태**가 생깁니다 — 며칠 만에
 * 링크를 연 사람에게 플랜 없는 화면이 먼저 뜹니다.
 *
 * ## 여기가 `fetch` 하는 유일한 자리입니다
 *
 * **층 C 모듈 안에서 부르지 마세요.** 모듈은 전부 「판단만 돌려주고 부르지 않는다」로
 * 서 있습니다 (spec/common/08-16-module-boundaries.md). 부르는 것은 화면의 일이고,
 * 화면 중에서도 이 파일입니다.
 *
 * ## 에러를 스스로 다시 부르지 않습니다
 *
 * 판정은 `poll-checker` 의 `decidePoll` 이 합니다 — **폴링이 아니어도 같은 물음**이기
 * 때문입니다. `retryable` 이 「다시 시도 버튼을 띄울지」, `retryAfterSec` 이
 * 「몇 초 뒤라고 적을지」이고, **누르는 것은 사용자입니다** (에러 §3.1).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { isCaseToken, type CaseResponse } from "@/modules/case-opener";
import type { NextQuestion } from "@/modules/chat-handler";
import type { Deadline } from "@/modules/deadline-viewer";
import type { EvidenceStatus } from "@/modules/file-sender";
import type { PiiMapping } from "@/modules/pii-masker";
import type { PlanStep } from "@/modules/plan-viewer";
import { decidePoll, type PollVerdict } from "@/modules/poll-checker";
import type { PiiToken, RawLine } from "@/modules/transcript-viewer";

/** 화면 셋이 나눠 쓰는 한 응답 → §3.10 */
export interface CaseBundle {
  /** `case-opener` 가 첫 화면을 고르는 데 쓰는 부분 */
  readonly case: CaseResponse;
  /** §3.6 그대로 */
  readonly steps: readonly PlanStep[];
  /** §3.7 그대로 */
  readonly deadlines: readonly Deadline[];
  /** §3.4 `next_question`. 더 물을 것이 없으면 `null` */
  readonly question: NextQuestion | null;
  /**
   * §3.4 `slots[]` — **진술에서 파악한 것**. 사건 파일 카드가 그립니다 (§S-06).
   *
   * ⚠️ **2026-08-27 까지 이 값을 받아 놓고 버렸습니다.** 그래서 사건 파일 카드가
   * 하드코딩 상수(「피해 유형: 기관 사칭 (검찰)」·「피해 금액: 300만원」)를 그렸고,
   * 카드 제목이 「진술에서 파악한 것」이라 **사용자는 그것을 자기 진술에서 뽑은
   * 값으로 읽었습니다.**
   */
  readonly slots: readonly CaseSlot[];
}

/** §3.4 의 슬롯 한 줄 — 깊이 검사하지 않습니다. 모양은 서버가 지키는 계약입니다 */
export interface CaseSlot {
  readonly slot_key: string;
  readonly tier?: string;
  readonly state: string;
  /** 「모름」이면 `null`. 토큰이면 `[계좌-1]` 같은 모양입니다 */
  readonly value: string | null;
}

/** 못 읽었을 때 화면이 그리는 재료 — `decidePoll` 의 판정 + 사람이 읽을 한 줄 */
export type LoadFail = Extract<PollVerdict, { poll: false }> & {
  readonly message: string;
};

export type LoadState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly bundle: CaseBundle }
  | { readonly phase: "failed"; readonly fail: LoadFail };

/** 서버가 준 문구가 있으면 그것을, 없으면 이것을 씁니다 */
const FALLBACK_MESSAGE = "사건을 불러오지 못했습니다.";

function fail(message: string, verdict: Extract<PollVerdict, { poll: false }>): LoadState {
  return { phase: "failed", fail: { ...verdict, message } };
}

/** 에러 본문 → 에러 §3.1. `detail` 은 응답에 없습니다(감사 로그에만) */
interface ErrorBody {
  error?: { code?: string; message?: string; retryable?: boolean };
}

/**
 * `Retry-After` 는 초 단위 정수입니다 → 에러 §3.1.
 * HTTP 날짜 형식도 규격상 가능하지만 **우리 서버는 초로만 보냅니다**(`lib/http.ts`).
 */
function retryAfterOf(res: Response): number | undefined {
  const raw = res.headers.get("Retry-After");
  if (raw === null) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** 에러 응답 하나를 화면이 쓰는 판정으로. **서버가 말한 것만 씁니다** */
async function failFrom(res: Response): Promise<LoadFail> {
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    /* 본문이 JSON 이 아니어도 상태 코드로 판정합니다 */
  }
  const verdict = decidePoll({
    status: res.status,
    done: false,
    ...(typeof body.error?.retryable === "boolean"
      ? { retryable: body.error.retryable }
      : {}),
    ...(retryAfterOf(res) === undefined ? {} : { retryAfterSec: retryAfterOf(res) }),
  }) as Extract<PollVerdict, { poll: false }>;

  return { ...verdict, message: body.error?.message ?? FALLBACK_MESSAGE };
}

/** 못 갔을 때. **이때만 화면이 `retryable` 을 만듭니다** — 서버가 아무 말도 못 한 경우입니다 */
function failUnreachable(message: string): LoadFail {
  return {
    ...(decidePoll({ status: 0, done: false, retryable: true }) as Extract<
      PollVerdict,
      { poll: false }
    >),
    message,
  };
}

/**
 * 값을 보내는 자리들이 함께 쓰는 한 자리.
 *
 * **판정을 한 곳에 둡니다** — 보내는 자리마다 상태 코드를 해석하면
 * 「`retryable` 을 안 말했을 때 버튼을 띄우지 않는다」가 조용히 갈라집니다.
 */
export async function sendJson(
  method: "POST" | "PATCH" | "PUT",
  url: string,
  body: unknown,
  signal?: AbortSignal,
  unreachableMessage = "보내지 못했습니다. 연결을 확인해 주세요.",
): Promise<{ ok: true; json: unknown } | { ok: false; fail: LoadFail }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, fail: failUnreachable(unreachableMessage) };
  }

  if (!res.ok) return { ok: false, fail: await failFrom(res) };
  return { ok: true, json: await res.json() };
}

/** 위와 같습니다 — 보내는 자리 대부분이 `POST` 라 이름을 남겨 둡니다 */
export function postJson(
  url: string,
  body: unknown,
  signal?: AbortSignal,
  unreachableMessage?: string,
) {
  return sendJson("POST", url, body, signal, unreachableMessage);
}

/** 칸 하나를 통째로 갈아끼우는 자리(§3.13 연락처)가 씁니다 */
export function putJson(
  url: string,
  body: unknown,
  signal?: AbortSignal,
  unreachableMessage?: string,
) {
  return sendJson("PUT", url, body, signal, unreachableMessage);
}

/**
 * 응답을 화면이 쓰는 모양으로.
 *
 * **깊이 검사하지 않습니다.** 모양은 서버가 지키는 계약이고(§3.10 「구조를 다시
 * 정의하지 않습니다」), 여기서 한 번 더 정의하면 **같은 것을 두 곳에서 고치게**
 * 됩니다. 없으면 빈 값으로 두어 화면이 「아직 없음」을 그리게 합니다.
 */
function toBundle(json: unknown): CaseBundle | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as {
    case_id?: unknown;
    track?: unknown;
    plan?: { steps?: unknown };
    deadlines?: { deadlines?: unknown };
    slots?: { next_question?: unknown; slots?: unknown };
  };
  if (typeof body.case_id !== "string") return null;

  const steps = Array.isArray(body.plan?.steps) ? (body.plan.steps as PlanStep[]) : [];
  const deadlines = Array.isArray(body.deadlines?.deadlines)
    ? (body.deadlines.deadlines as Deadline[])
    : [];
  const question = (body.slots?.next_question ?? null) as NextQuestion | null;
  const slots = Array.isArray(body.slots?.slots) ? (body.slots.slots as CaseSlot[]) : [];

  return {
    case: {
      case_id: body.case_id,
      track: typeof body.track === "string" ? body.track : "",
      plan: { steps: steps.map((s) => ({ step_id: s.step_id, state: s.state })) },
    },
    steps,
    deadlines,
    question,
    slots,
  };
}

/**
 * 한 번 부르고 판정까지 냅니다. **기다리거나 스스로 다시 부르지 않습니다.**
 *
 * `AbortError` 는 실패가 아닙니다 — 화면이 떠난 것이라 아무 상태도 남기지 않습니다.
 */
export async function fetchCaseBundle(
  token: string,
  signal?: AbortSignal,
): Promise<LoadState | null> {
  // 모양이 아니면 서버를 부르지 않습니다 — 열거 시도에 왕복을 태우지 않습니다 (ADR-039)
  if (!isCaseToken(token)) {
    return fail("주소가 올바르지 않습니다. 받은 링크를 다시 확인해 주세요.", {
      poll: false,
      reason: "error",
      retryable: false,
    });
  }

  let res: Response;
  try {
    res = await fetch(`/api/cases/${encodeURIComponent(token)}`, {
      signal,
      headers: { accept: "application/json" },
    });
  } catch (cause) {
    if (signal?.aborted) return null;
    // 서버까지 못 갔습니다 — 상태 코드가 없어 `0` 으로 판정을 받습니다.
    // **이때만 `retryable: true` 를 화면이 만듭니다** — 서버가 아무 말도 못 한
    // 유일한 경우이고, 같은 요청을 다시 보내면 달라질 수 있습니다
    void cause;
    return fail("연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", {
      ...decidePoll({ status: 0, done: false, retryable: true }),
    } as Extract<PollVerdict, { poll: false }>);
  }

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      /* 본문이 JSON 이 아니어도 상태 코드로 판정합니다 */
    }
    const verdict = decidePoll({
      status: res.status,
      done: false,
      // **서버가 말한 것만 씁니다.** 없으면 넘기지 않아 버튼도 안 뜹니다 (에러 §3.1.1)
      ...(typeof body.error?.retryable === "boolean"
        ? { retryable: body.error.retryable }
        : {}),
      ...(retryAfterOf(res) === undefined ? {} : { retryAfterSec: retryAfterOf(res) }),
    }) as Extract<PollVerdict, { poll: false }>;

    return fail(body.error?.message ?? FALLBACK_MESSAGE, verdict);
  }

  // ⚠️ **`res.json()` 이 `try` 밖에 있었습니다.** 200 인데 본문이 JSON 이 아니면
  // (중간 장비가 낀 안내 페이지 등) 여기서 던지고, 부르는 쪽 효과에는 `catch` 가
  // 없어 `phase` 가 `loading` 에 굳습니다 — 사건 화면이 「불러오는 중」에서 영영
  // 안 풀립니다. **못 읽었으면 못 읽었다고 말합니다** (에러 §3.1)
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return fail("사건을 읽었지만 내용을 알 수 없습니다.", {
      poll: false,
      reason: "error",
      retryable: true,
    });
  }

  const bundle = toBundle(parsed);
  if (!bundle) {
    return fail("사건을 읽었지만 내용을 알 수 없습니다.", {
      poll: false,
      reason: "error",
      retryable: false,
    });
  }
  return { phase: "ready", bundle };
}

/**
 * 화면이 쓰는 얼굴. `reload` 는 **「다시 시도」 버튼이 부르는 것**이고,
 * 스스로 도는 타이머는 여기 없습니다 (에러 §3.1).
 */
export function useCaseBundle(token: string, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  /**
   * **받은 값에 열쇠를 붙여 둡니다.** 효과 안에서 `setState({phase:"loading"})` 를
   * 부르면 한 번 그린 뒤 다시 그리게 되고(연쇄 렌더), 그 사이 **직전 사건이
   * 한 프레임 보입니다.** 열쇠가 다르면 렌더에서 곧장 「기다리는 중」이 됩니다
   */
  const key = `${token}#${attempt}`;
  const [got, setGot] = useState<{ key: string; state: LoadState } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const ac = new AbortController();
    void fetchCaseBundle(token, ac.signal).then((next) => {
      if (next) setGot({ key, state: next });
    });
    return () => ac.abort();
  }, [token, enabled, key]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /**
   * **화면을 비우지 않고** 값만 갈아끼웁니다 — 슬롯에 답해 플랜이 다시 만들어졌을
   * 때 부릅니다 (§3.5 `plan_regenerated`).
   *
   * `reload` 와 다릅니다. 그쪽은 「다시 시도」라 **기다리는 중으로 돌아가고**,
   * 그러면 `CaseScreen` 이 통째로 다시 서면서 **방금 나눈 대화가 사라집니다.**
   *
   * **실패는 삼킵니다.** 화면에는 이미 읽어 둔 값이 있고, 갱신 한 번 못했다고
   * 사건을 못 읽는 화면으로 돌아가면 방금 한 답까지 잃습니다.
   */
  const refresh = useCallback(() => {
    void fetchCaseBundle(token).then((next) => {
      if (next?.phase !== "ready") return;
      // **들고 있던 열쇠를 그대로 씁니다** — 새 열쇠를 적으면 화면이 「기다리는
      // 중」으로 돌아갑니다. 아직 첫 로드가 안 끝났으면 놔둡니다(그쪽이 새 값을
      // 가져옵니다)
      setGot((prev) => (prev === null ? prev : { key: prev.key, state: next }));
    });
  }, [token]);

  const state: LoadState = got?.key === key ? got.state : { phase: "loading" };
  return { state, reload, refresh };
}

/* ── 증거 하나 — 다시 묻기 ─────────────────────────────────── */

/** §3.3 응답. 상태마다 실리는 칸이 다릅니다 */
export interface EvidenceRead {
  readonly evidence_id: string;
  readonly ingest_status: EvidenceStatus | string;
  /** `processing` 일 때만 */
  readonly progress?: { phase: string; percent: number };
  /** `done` 일 때만. **토큰화된 상태로 내려옵니다** — 원문 복원은 브라우저에서 */
  readonly transcript?: readonly RawLine[];
  readonly pii_tokens?: readonly PiiToken[];
  /**
   * **토큰화가 막 일어난 그 응답에만** 실리는 원문 포함 대응표 → ADR-062.
   * 서버가 보관하지 않으므로 다음 폴링부터는 없습니다 — 받는 즉시
   * `ChatSend.absorb` 로 잠가 맡기는 것이 유일한 생존 경로입니다
   */
  readonly pii_mappings?: readonly {
    token: string;
    kind: string;
    seq: number;
    original: string;
  }[];
  /** 기계가 못 읽은 것 — 화면이 「직접 확인해 주세요」로 씁니다 */
  readonly shortfalls?: readonly unknown[];
  /** `failed` 일 때만 */
  readonly reason?: string;
}

export type EvidenceState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly read: EvidenceRead; readonly verdict: PollVerdict }
  | { readonly phase: "failed"; readonly fail: LoadFail };

export async function fetchEvidence(
  caseToken: string,
  evidenceId: string,
  signal?: AbortSignal,
): Promise<EvidenceState | null> {
  let res: Response;
  try {
    res = await fetch(
      `/api/cases/${encodeURIComponent(caseToken)}/evidence/${encodeURIComponent(evidenceId)}`,
      { signal, headers: { accept: "application/json" } },
    );
  } catch {
    if (signal?.aborted) return null;
    return {
      phase: "failed",
      fail: {
        ...(decidePoll({ status: 0, done: false, retryable: true }) as Extract<
          PollVerdict,
          { poll: false }
        >),
        message: "전사 상태를 확인하지 못했습니다.",
      },
    };
  }

  if (!res.ok) {
    let body: ErrorBody = {};
    try {
      body = (await res.json()) as ErrorBody;
    } catch {
      /* 상태 코드로 판정합니다 */
    }
    return {
      phase: "failed",
      fail: {
        ...(decidePoll({
          status: res.status,
          done: false,
          ...(typeof body.error?.retryable === "boolean"
            ? { retryable: body.error.retryable }
            : {}),
          ...(retryAfterOf(res) === undefined ? {} : { retryAfterSec: retryAfterOf(res) }),
        }) as Extract<PollVerdict, { poll: false }>),
        message: body.error?.message ?? FALLBACK_MESSAGE,
      },
    };
  }

  const read = (await res.json()) as EvidenceRead & { poll_after_ms?: number };

  /**
   * **못 읽은 것(`failed`)도 200 입니다** — 정상 상태이고, 서버가 500 을 내면
   * 화면이 「다시 시도」를 띄우게 됩니다 (불변 규칙 5 · 에러 §2). 그래서
   * 여기서도 에러로 다루지 않고, 다음 간격이 없으니 `no_interval` 로 멈춥니다.
   */
  const verdict = decidePoll({
    status: res.status,
    done: read.ingest_status === "done",
    ...(typeof read.poll_after_ms === "number" ? { pollAfterMs: read.poll_after_ms } : {}),
  });

  return { phase: "ready", read, verdict };
}

/**
 * 서버가 지시한 간격으로만 다시 묻습니다.
 *
 * **이건 자동 재시도가 아닙니다.** 에러 §3.1 이 금지한 것은 「에러 응답을 스스로
 * 다시 부르는 것」이고, 여기서 되풀이하는 것은 **서버가 `poll_after_ms` 로 시킨**
 * 정상 진행입니다. 간격을 화면이 지어내면 그때 부하 조절이 무의미해집니다 (§3.3).
 */
export function useEvidence(
  caseToken: string | null,
  evidenceId: string | undefined,
  /**
   * 원문 포함 대응표가 실려 왔을 때 — **한 응답에 한 번만** 옵니다 (ADR-062).
   * 셸이 `ChatSend.absorb` 를 이어 줍니다. 안 이으면 그 짝은 여기서 버려져
   * 올린 본인의 기기에서도 원문이 영영 안 보입니다
   */
  onMappings?: (fresh: readonly PiiMapping[]) => void,
) {
  const key = `${caseToken}/${evidenceId}`;
  const [got, setGot] = useState<{ key: string; state: EvidenceState } | null>(null);
  /**
   * 「다시 확인」을 누른 횟수 — 효과의 열쇠에 넣어 폴링을 처음부터 다시 겁니다.
   *
   * ⚠️ **이게 없어서 조회가 한 번 실패하면 화면이 「개인정보 보호 처리중」에
   * 영영 멈췄습니다.** 실패하면 `verdict.poll` 이 꺼져 되풀이가 서는데(§3.1 —
   * 에러 응답을 스스로 다시 부르지 않습니다), 사용자가 다시 물을 길도 없었습니다.
   * 다시 부르는 것은 **사용자**입니다.
   */
  const [asked, setAsked] = useState(0);
  // 콜백이 바뀌어도 폴링을 다시 시작하지 않습니다 — 최신 것만 부릅니다.
  // 그리는 중에 ref 를 쓰면 안 되므로(리액트 규칙) 효과에서 갱신합니다 —
  // 폴링 응답은 비동기라 효과가 먼저 돕니다
  const onMappingsRef = useRef(onMappings);
  useEffect(() => {
    onMappingsRef.current = onMappings;
  }, [onMappings]);

  useEffect(() => {
    if (!caseToken || !evidenceId) return;
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;

    const ask = async () => {
      const next = await fetchEvidence(caseToken, evidenceId, ac.signal);
      if (!next || !alive) return;
      setGot({ key, state: next });
      // 대응표는 이 응답 한 번뿐입니다 — 화면 상태와 무관하게 즉시 건넵니다
      if (next.phase === "ready" && next.read.pii_mappings?.length) {
        onMappingsRef.current?.(
          next.read.pii_mappings.map((one) => ({
            token: one.token,
            kind: one.kind as PiiMapping["kind"],
            seq: one.seq,
            original: one.original,
          })),
        );
      }
      if (next.phase === "ready" && next.verdict.poll) {
        timer = setTimeout(() => void ask(), next.verdict.delayMs);
      }
    };
    void ask();

    return () => {
      alive = false;
      ac.abort();
      clearTimeout(timer);
    };
    // `asked` 는 「다시 확인」 — 값이 오르면 처음부터 다시 묻습니다
  }, [caseToken, evidenceId, key, asked]);

  const again = useCallback(() => {
    setGot(null);
    setAsked((n) => n + 1);
  }, []);

  return {
    state: got?.key === key ? got.state : ({ phase: "loading" } as EvidenceState),
    again,
  };
}
