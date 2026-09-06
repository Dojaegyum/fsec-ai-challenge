"use client";
/**
 * S-12 가 서버와 말하는 유일한 자리 — API §7. 401 이면 화면이 로그인 카드로 돌아갑니다.
 * **스스로 다시 부르지 않습니다** — 실패는 메시지로 돌려주고, 누르는 것은 사람입니다(에러 §3.1).
 */
import type { ChangeBody, DecisionBody, DecisionStatus, EntriesBody, HistoryBody, QueueBody } from "@/flows/kb-review";

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number; code: string | null; message: string };

const UNREACHABLE = "서버에 닿지 못했습니다. 연결을 확인해 주세요.";

async function call<T>(url: string, init: RequestInit = {}): Promise<Loaded<T>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init.headers ?? {}) } });
  } catch {
    return { ok: false, status: 0, code: null, message: UNREACHABLE };
  }
  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* 본문이 JSON 이 아니어도 상태 코드로 판정합니다 */
    }
    return {
      ok: false,
      status: res.status,
      code: body.error?.code ?? null,
      message: body.error?.message ?? "요청에 실패했습니다.",
    };
  }
  return { ok: true, data: (await res.json()) as T };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchQueue = (status: "pending" | "deferred") => call<QueueBody>(`/api/admin/kb/queue?status=${status}`);
export const fetchChange = (changeId: string) => call<ChangeBody>(`/api/admin/kb/changes/${changeId}`);
export const fetchEntries = () => call<EntriesBody>("/api/admin/kb/entries");
export const fetchHistory = () => call<HistoryBody>("/api/admin/kb/history");
export const postDecision = (
  changeId: string,
  input: { status: DecisionStatus; reviewed_by: string; note: string | null },
) => call<DecisionBody>(`/api/admin/kb/changes/${changeId}/decision`, json(input));
export const login = (password: string) => call<{ ok: true }>("/api/admin-login", json({ password }));
export const logout = () => call<{ ok: true }>("/api/admin/logout", { method: "POST" });

/** 검수자 이름 — 브라우저에만 둡니다(S-12 「문」). 쿠키엔 넣지 않습니다(§5.1) */
const NAME_KEY = "fin-ally.admin.reviewer";
export function rememberedName(): string {
  try {
    return window.localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function rememberName(name: string): void {
  try {
    window.localStorage.setItem(NAME_KEY, name);
  } catch {
    /* 저장 못 해도 이번 세션은 상태에 있습니다 */
  }
}
