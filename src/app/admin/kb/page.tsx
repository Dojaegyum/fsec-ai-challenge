"use client";
/**
 * S-12 · KB 검수 큐 — /admin/kb (ADR-081). **피해자 화면 어디서도 링크하지 않습니다.**
 * 껍데기만 공개이고 데이터는 전부 /api/admin/kb/* — 401 이면 로그인 카드가 본문 자리에 뜹니다.
 */
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChangeBody, DecisionStatus, EntriesBody, QueueBody } from "@/flows/kb-review";
import { ChangeDetail, EntryDetail } from "./detail";
import { fetchChange, fetchEntries, fetchQueue, login, logout, postDecision, rememberName, rememberedName } from "./load";
import { LoginCard } from "./login";
import { QueueList } from "./queue";
import { initialState, nextPendingAfter, reduce } from "./state";

export { ChangeDetail, EntryDetail } from "./detail";
export { LoginCard } from "./login";
export { QueueList } from "./queue";

type Phase =
  | { kind: "loading" }
  | { kind: "login"; message: string | null }
  | { kind: "ready"; queue: QueueBody; entries: EntriesBody }
  | { kind: "failed"; message: string };

const CHIP =
  "inline-flex items-center gap-2 rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3";
const NAV_LINK = "inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-[13px] text-ink-3 hover:text-ink-1";

export default function AdminKbPage() {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [state, dispatch] = useReducer(reduce, initialState);
  const [name, setName] = useState("");
  const [change, setChange] = useState<ChangeBody | null>(null);
  const [changeLoading, setChangeLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /** 마지막으로 부탁한 조문 — 빠르게 두 번 누르면 먼저 온 옛 응답을 버립니다 */
  const wanted = useRef<string | null>(null);

  // 상태 갱신은 전부 응답이 온 뒤(.then)에 — 효과 안에서 동기로 setState 하지 않습니다
  const load = useCallback(
    () =>
      Promise.all([fetchQueue("pending"), fetchEntries()]).then(([q, e]) => {
        // 이름은 브라우저에만 있습니다(load.ts) — 서버 렌더와 어긋나지 않게 첫 응답 뒤에 읽습니다
        setName(rememberedName());
        if (!q.ok || !e.ok) {
          const fail = !q.ok ? q : (e as Extract<typeof e, { ok: false }>);
          setPhase(fail.status === 401 ? { kind: "login", message: null } : { kind: "failed", message: fail.message });
          return;
        }
        setPhase({ kind: "ready", queue: q.data, entries: e.data });
      }),
    [],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // 조문을 고르면 원문 한 번 — 메모리에 두고, 같은 건을 다시 부르지 않습니다
  const loadChange = useCallback(
    async (id: string) => {
      if (change?.change.change_id === id) return;
      wanted.current = id;
      setChangeLoading(true);
      setMessage(null);
      const r = await fetchChange(id);
      if (wanted.current !== id) return;
      setChangeLoading(false);
      if (r.ok) setChange(r.data);
      else if (r.status === 401) setPhase({ kind: "login", message: null });
      else setMessage(r.message);
    },
    [change],
  );

  /** 선택을 바꾸는 유일한 문 — 조문을 고르면 원문도 함께 부릅니다 */
  const pick = useCallback(
    (action: Parameters<typeof dispatch>[0]) => {
      dispatch(action);
      if (action.type === "pick-change") void loadChange(action.changeId);
    },
    [loadChange],
  );

  const onLogin = async (who: string, password: string) => {
    setBusy(true);
    const r = await login(password);
    setBusy(false);
    if (!r.ok) {
      setPhase({
        kind: "login",
        message: r.status === 429 ? "너무 여러 번 시도했습니다. 잠시 뒤에 다시." : "들어가지 못했습니다.",
      });
      return;
    }
    rememberName(who);
    setName(who);
    setPhase({ kind: "loading" });
    void load();
  };

  const onDecide = async (status: DecisionStatus, note: string) => {
    if (phase.kind !== "ready" || !state.selected || !("changeId" in state.selected)) return;
    const id = state.selected.changeId;
    setBusy(true);
    setMessage(null);
    const r = await postDecision(id, { status, reviewed_by: name, note: note.trim() || null });
    setBusy(false);
    if (!r.ok) {
      if (r.status === 401) setPhase({ kind: "login", message: null });
      else setMessage(r.message);
      return;
    }
    const next = nextPendingAfter(phase.queue.groups, id);
    setChange(null);
    await load();
    if (next) pick({ type: "pick-change", changeId: next });
    else dispatch({ type: "clear" });
  };

  const nextTitle = (() => {
    if (phase.kind !== "ready" || !state.selected || !("changeId" in state.selected)) return null;
    const id = nextPendingAfter(phase.queue.groups, state.selected.changeId);
    const hit = phase.queue.groups.flatMap((g) => g.changes).find((one) => one.change_id === id);
    return hit ? `${hit.article ?? hit.source_key}` : null;
  })();

  return (
    <main className="flex min-h-svh flex-col">
      <header className="border-b border-hairline bg-stage">
        <div className="mx-auto flex min-h-[56px] w-full max-w-shell flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[clamp(16px,3vw,32px)] py-2">
          <div className="flex items-center gap-2.5">
            <Image src="/brand/symbol-mark.png" alt="" width={169} height={158} className="h-[23px] w-auto invert" />
            <span className="text-[18px] font-[660] tracking-[-0.02em] text-ink-1">
              Fin<span className="text-pii">Ally</span>
            </span>
            <span className="ml-1 text-[13px] text-ink-3">KB 검수</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {phase.kind === "ready" && (
              <span data-numeric className={CHIP}>
                <span aria-hidden className="size-[5px] rounded-full bg-pii" />
                지금 나가는 KB {phase.queue.kb_version ?? "미설정"}
              </span>
            )}
            <nav
              aria-label="고객 화면 열기"
              className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-chip p-0.5"
            >
              <Link href="/" className={NAV_LINK}>
                랜딩
              </Link>
              <Link href="/start" className={NAV_LINK}>
                시작
              </Link>
              <Link href="/c/demo?view=chat" className={NAV_LINK}>
                시연 챗
              </Link>
            </nav>
            {name && <span className={CHIP}>검수자 {name}</span>}
            {phase.kind === "ready" && (
              <button
                type="button"
                onClick={() => void logout().then(() => setPhase({ kind: "login", message: null }))}
                className={NAV_LINK}
              >
                나가기
              </button>
            )}
          </div>
        </div>
      </header>

      {phase.kind === "loading" && <p className="mx-auto mt-10 text-[13px] text-ink-3">검수 큐를 불러오고 있습니다</p>}
      {phase.kind === "login" && <LoginCard name={name} onSubmit={onLogin} busy={busy} message={phase.message} />}
      {phase.kind === "failed" && (
        <p role="alert" className="mx-auto mt-10 text-[13.5px] text-ink-1">
          {phase.message}
        </p>
      )}
      {phase.kind === "ready" && (
        <div className="mx-auto grid w-full max-w-shell grid-cols-[400px_minmax(0,1fr)] gap-[18px] px-[clamp(16px,3vw,32px)] pb-8 pt-[22px]">
          <QueueList state={state} queue={phase.queue} entries={phase.entries} dispatch={pick} />
          <section className="self-start rounded-[18px] bg-stage p-5 shadow-[0_1px_0_oklch(1_0_0/6%)_inset,0_16px_40px_-18px_oklch(0_0_0/70%)]">
            {state.lens === "entry" && state.selected && "kbEntryId" in state.selected ? (
              (() => {
                const id = state.selected.kbEntryId;
                const entry = phase.entries.entries.find((one) => one.kb_entry_id === id);
                const touching = phase.queue.groups.flatMap((g) => g.changes).filter((one) => one.affected.includes(id));
                return entry ? (
                  <EntryDetail
                    entry={entry}
                    changes={touching}
                    onPickChange={(cid) => pick({ type: "pick-change", changeId: cid })}
                  />
                ) : null;
              })()
            ) : (
              <ChangeDetail
                change={state.selected && "changeId" in state.selected ? change : null}
                loading={changeLoading}
                onPickEntry={(eid) => dispatch({ type: "pick-entry", kbEntryId: eid })}
                onDecide={onDecide}
                busy={busy}
                message={message}
                nextTitle={nextTitle}
              />
            )}
          </section>
        </div>
      )}
    </main>
  );
}
