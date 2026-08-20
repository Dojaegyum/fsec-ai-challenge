"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CallPanel } from "@/modules/work-handler";
import type { Focus, Side } from "./state";
import type { DOMRectLike } from "./absorb";
import { ABSORB_MS, absorbKeyframes, fadeKeyframes, prefersReducedMotion, rectOf } from "./absorb";
import ChatView, { MiniChat } from "./chat";
import T0Rail from "./safety";
import PlanView from "./plan";
import EvidenceView from "./evidence";

/**
 * 사건 화면 — `/c/{token}`. **세 화면이 아니라 한 화면의 두 축**입니다 (ADR-035).
 *
 * 계약: spec/frontend/08-14-screens.md 「화면 상태는 두 축입니다」 · §S-06 §S-07 §S-08
 * 시안: assets/artifacts/handoff/08-19-s06-chat/ · 08-19-s07-board-motion/ · 08-19-s08-evidence/
 *
 *   focus: 'chat' | 'plan' | 'evidence'   본문
 *   side:  'casefile' | 'work'             오른쪽 350px
 *
 * ⚠️ **순차가 아닙니다.** 「다음 단계로 넘긴다」는 코드를 쓰지 마세요 —
 * 며칠 뒤 재진입하면 `case-opener` 가 곧장 `focus: "plan"` 으로 엽니다.
 * 두 축을 한 값으로 합치지 마세요(그 순간 다시 순차가 됩니다).
 *
 * 전환은 **바뀐 축**을 따릅니다
 *  · `side` 만 바뀜 → 오른쪽 열이 밖에서 들어옴 (`.side-in`)
 *  · `focus` 만 바뀜 → 본문 교차 (`.view-out` / `.view-in`) — 빈 화면을 만들지 않습니다
 *  · `chat` ↔ 그 밖 → **흡수**: 챗이 우하단 미니 챗 자리로 빨려듭니다 (`absorb.ts`)
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다. 아래 「국면 고르기」는 **개발용 스위치**이고,
 * 실제로는 서버 시그널이 축을 정합니다
 *  · POST …/messages §3.9 · GET …/slots §3.4 · GET …/plan §3.6 · GET …/deadlines §3.7
 *  · `referenced_steps` → `side: "work"` (work-handler)
 *  · 플랜 생성·재방문 → `focus: "plan"`
 *  · ⬜ TODO(계약 필요): `focus: "evidence"` 로 보내는 시그널이 API 에 없습니다
 *  · CASE_TOKEN 을 실제 경로 파라미터로
 */

const CASE_TOKEN = "7fK2p"; // TODO: params.token 으로 교체

/** 유령을 띄워 두는 시간 — 흡수(1.5s)와 `.view-out`(0.3s 지연 + 0.7s) 중 긴 쪽 */
const GHOST_MS = ABSORB_MS;

const CASE_FILE = [
  ["피해 유형", "기관 사칭 (검찰)", "filled"],
  ["피해 금액", "300만원", "filled"],
  ["보낸 방법", "지금 여쭤보는 중", "asking"],
  ["보낸 시각", "다음 질문", "future"],
  ["상대 계좌", "모름이어도 진행", "future"],
] as const;

/** 개발용 — 서버 시그널이 붙기 전까지 축을 손으로 옮겨 봅니다 */
const DEV_VIEWS: readonly [Focus, string][] = [
  ["chat", "챗"],
  ["plan", "플랜"],
  ["evidence", "증거함"],
];

export default function CaseScreen() {
  // 개발용 — `?view=plan` 처럼 주소로 열 수 있습니다 (스크린샷·시연용).
  // 효과에서 setState 하면 한 번 그린 뒤 다시 그리게 되므로 **처음부터 초기값**으로 씁니다.
  // 서버 시그널이 붙으면 이 세 줄은 통째로 지웁니다.
  const wanted = useSearchParams().get("view");
  const devFocus: Focus = wanted === "plan" || wanted === "evidence" ? wanted : "chat";

  const [focus, setFocus] = useState<Focus>(devFocus);
  const [side, setSide] = useState<Side>(devFocus === "chat" ? "casefile" : "work");
  const [copied, setCopied] = useState(false);

  const atWork = side === "work";
  const chatIsMain = focus === "chat";

  // ── 흡수 ────────────────────────────────────────────────
  // 챗 본문과 미니 챗 자리의 **실제 위치를 재서** 그 사이를 잇습니다.
  // 시안은 1280×720 고정 캔버스라 픽셀이 박혀 있지만 우리는 반응형이라
  // 그 숫자를 그대로 못 씁니다 — 곡선만 가져오고 끝점은 잽니다 (absorb.ts).
  const mainRef = useRef<HTMLElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Focus>(focus);
  /** 유령은 **화면에 있던 그대로**여야 합니다 — side 가 같은 턴에 바뀌므로 직전 값을 씁니다 */
  const sideAtChange = useRef<boolean>(atWork);
  /** 나가는 쪽은 이미 언마운트된 뒤라, 마지막으로 본 자리를 들고 있어야 합니다 */
  const lastRects = useRef<{ main?: DOMRectLike; mini?: DOMRectLike }>({});
  /**
   * **바뀌기 직전** 본문의 자리. 유령은 이걸 써야 합니다.
   *
   * `lastRects.main` 을 쓰면 안 됩니다 — 그건 이미 **새 본문**의 자리입니다.
   * 플랜이 챗보다 길어서, 그 높이로 유령을 만들면 화면 아래로 늘어나고
   * **맨 아래 컴포저가 잘려 나갑니다.** 챗이 떨어져 나가는 동안 입력창이
   * 사라져 보이던 것이 이것 때문이었습니다.
   */
  const prevMain = useRef<DOMRectLike | undefined>(undefined);
  /**
   * 전환이 도는 동안만 **나가는 본문**을 유령으로 띄웁니다.
   * 없으면 새 본문이 뜨기 전에 빈 화면이 한 박자 생깁니다 — 시안이 금지한 것입니다.
   *  · 챗에서 나갈 때 → 슬롯으로 빨려들며 사라집니다 (흡수)
   *  · 플랜 ↔ 증거함 → 겹쳐 지나갑니다 (`.view-out`)
   */
  const [ghost, setGhost] = useState<{ rect: DOMRectLike; from: Focus; atWork: boolean } | null>(
    null,
  );
  const ghostRef = useRef<HTMLDivElement>(null);

  // 자리를 계속 기억해 둡니다 (그려져 있을 때만 잴 수 있으므로).
  // 본문은 **직전 것도** 남겨야 합니다 — 아래 focus 효과가 그걸 씁니다.
  // 미니 챗은 반대로 **방금 마운트된 것**이 필요해서 덮어씁니다.
  useEffect(() => {
    if (mainRef.current) {
      prevMain.current = lastRects.current.main;
      lastRects.current.main = rectOf(mainRef.current);
    }
    if (miniRef.current) lastRects.current.mini = rectOf(miniRef.current);
  });

  useEffect(() => {
    const was = prevFocus.current;
    prevFocus.current = focus;
    if (was === focus) return;

    if (prefersReducedMotion()) return;

    const miniBox = lastRects.current.mini;
    // 유령은 **바뀌기 직전** 자리로, 복귀는 **지금** 본문 자리로 재야 합니다
    const ghostBox = prevMain.current;
    const mainBox = lastRects.current.main;
    if (!ghostBox || !mainBox) return;

    const enteringChat = was !== "chat" && focus === "chat";

    // 나가는 본문을 그 자리에 유령으로 남깁니다 — 겹쳐야 공백이 없습니다
    setGhost({ rect: ghostBox, from: was, atWork: sideAtChange.current });
    const t = setTimeout(() => setGhost(null), GHOST_MS);

    // 복귀 — 들어오는 본문에 같은 곡선을 거꾸로 겁니다 (뱉어내듯 펴짐)
    let anim: Animation | undefined;
    if (enteringChat && miniBox && mainRef.current) {
      anim = mainRef.current.animate(absorbKeyframes(mainBox, miniBox, "emit"), {
        duration: ABSORB_MS,
        easing: "linear",
      });
    }
    return () => {
      clearTimeout(t);
      anim?.cancel();
    };
  }, [focus]);

  // 유령이 챗이면 슬롯으로 빨아들입니다. 그 밖은 CSS(`.view-out`)가 합니다
  useEffect(() => {
    const el = ghostRef.current;
    const miniBox = lastRects.current.mini;
    if (!ghost || ghost.from !== "chat" || !el || !miniBox) return;
    el.animate(absorbKeyframes(ghost.rect, miniBox, "absorb"), {
      duration: ABSORB_MS,
      easing: "linear",
      fill: "forwards",
    });
    el.animate(fadeKeyframes("out"), { duration: ABSORB_MS, easing: "linear", fill: "forwards" });
  }, [ghost]);

  // ⚠️ **맨 마지막 효과**여야 합니다. 효과는 선언 순서로 도니, 위의 focus 효과가
  // 「바뀌기 직전 side」를 읽고 난 뒤에 갱신돼야 유령이 화면에 있던 그대로 나옵니다
  useEffect(() => {
    sideAtChange.current = atWork;
  });

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(`https://finally.kr/c/${CASE_TOKEN}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 미지원 — 주소는 헤더에 보이므로 손으로 옮길 수 있습니다 */
    }
  };

  return (
    // `overflow-x-clip` 은 전환 중 변형된 요소가 문서를 넓히지 못하게 하는 안전장치입니다.
    // 유령은 제 겹에서 가두지만, 여기가 마지막 방어선입니다
    <main className="flex min-h-svh flex-col overflow-x-clip">
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <header className="border-b border-hairline bg-stage">
        <div className="mx-auto flex min-h-[56px] w-full max-w-shell flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[clamp(16px,3vw,32px)] py-2">
          <div className="flex items-center gap-2.5">
            <Image
              src="/brand/symbol-mark.png"
              alt=""
              width={169}
              height={158}
              priority
              className="h-[23px] w-auto invert"
            />
            <span className="text-[18px] font-[660] tracking-[-0.02em] text-ink-1">
              Fin<span className="text-pii">Ally</span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              data-numeric
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3"
            >
              <span aria-hidden className="size-[5px] rounded-full bg-pii" />
              사건 {CASE_TOKEN}
            </span>
            {/* 경유 서비스 유형 — CH-bank (spec/backend/08-14-channel-matrix.md) */}
            <span className="inline-flex items-center rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3">
              국민은행 계좌이체
            </span>
            {!chatIsMain && (
              <span className="inline-flex items-center gap-2 rounded-full border border-[oklch(0.697_0.16_258.2/40%)] bg-[oklch(0.697_0.16_258.2/12%)] px-3 py-[5px] text-[13px] text-pii">
                <span aria-hidden>✓</span>
                지급정지 완료
              </span>
            )}
            {focus === "evidence" && (
              <span className="inline-flex items-center rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3">
                증거함
              </span>
            )}
            {/* 기한은 서버가 계산한 값입니다 — 화면이 날짜를 세지 않습니다 */}
            {(atWork || !chatIsMain) && (
              <span className="inline-flex items-center rounded-full border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/10%)] px-3 py-[5px] text-[13px] font-[620] text-deadline-urgent">
                피해구제 신청까지 D-2
              </span>
            )}
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-hairline bg-chip px-3 text-[13px] text-ink-3 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] hover:text-ink-1"
            >
              {copied ? "복사됨 ✓" : "가족에게 링크 보내기"}
            </button>
          </div>
        </div>
      </header>

      {/* 셸은 **세 열**입니다 — T0 레일 · 본문 · 오른쪽 열 (ADR-036).
          T0 를 본문 밖에 두어야 국면이 바뀌어도 사라지지 않습니다 */}
      <div className="mx-auto grid w-full max-w-shell flex-1 gap-0 md:grid-cols-[288px_1fr_350px]">
        {/* 좁은 폭 순서 — spec S-06 「워크스페이스가 맨 위로 옵니다」.
            워크스페이스가 있을 때만 그렇습니다. 아직 진술을 받는 중(`casefile`)이면
            할 일이 없으니 T0 가 먼저입니다 — 그때가 T0 가 가장 급한 때이기도 합니다 */}
        <div
          className={`px-[clamp(16px,3vw,32px)] pt-[clamp(18px,3vh,28px)] md:border-r md:border-hairline md:px-5 md:pb-[clamp(18px,3vh,28px)] md:order-none ${
            atWork ? "order-3" : "order-1"
          }`}
        >
          <T0Rail />
        </div>

        {/* ── 본문 ───────────────────────────────────────── */}
        <section
          ref={mainRef}
          key={focus}
          // ⚠️ `absorb.ts` 의 좌표는 **왼쪽 위 기준**으로 계산합니다.
          // 기본값(가운데)으로 두면 축소 기준이 어긋나 화면 밖으로 나갑니다
          style={{ transformOrigin: "top left" }}
          className={`order-2 flex min-w-0 flex-col px-[clamp(16px,3vw,32px)] py-[clamp(18px,3vh,28px)] md:order-none ${
            focus === "chat" ? "" : "view-in"
          }`}
        >
          {focus === "chat" && (
            <ChatView atWork={atWork} onPickChoice={() => setSide("work")} />
          )}
          {focus === "plan" && <PlanView />}
          {focus === "evidence" && <EvidenceView />}
        </section>

        {/* ── 오른쪽 열 — 자리는 하나, 내용이 바뀝니다 ──────
            본문이 챗이면 사건 파일 ↔ 워크스페이스,
            본문이 챗이 아니면 워크스페이스 **위** + 미니 챗 **아래** */}
        <aside
          className={`flex min-w-0 flex-col border-t border-hairline bg-[oklch(1_0_0/1.5%)] p-[clamp(16px,3vw,20px)] md:order-none md:border-l md:border-t-0 ${
            atWork ? "order-1 border-t-0 border-b" : "order-3"
          } ${atWork ? "side-in" : ""}`}
        >
          {atWork ? (
            <>
              <div className="mb-3 text-[12.5px] tracking-[0.12em] text-ink-4">워크스페이스</div>
              <CallPanel
                title="국민은행에 전화"
                status={{ tone: "pii", label: "⏱ 04:17" }}
                artifactLabel="끊기 전에 접수번호를 받아적으세요"
                placeholder="2026-0815-000123"
                script={
                  <>
                    「보이스피싱 피해를 입었습니다.{" "}
                    <b className="font-[620] text-ink-1">지급정지</b>를 요청합니다.」 제 계좌는{" "}
                    <b className="font-[620] text-ink-1">110-2345-678901</b>, 300만원을{" "}
                    <b className="font-[620] text-ink-1">352-0987-654321</b>로 보냈습니다.
                  </>
                }
              />
              {chatIsMain ? (
                <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">
                  챗이 다른 단계를 가리키면 이 패널이 바뀝니다. 언급이 없으면{" "}
                  <b className="font-[620] text-ink-2">그대로 둡니다.</b> 적던 접수번호가
                  사라지지 않습니다.
                </p>
              ) : (
                <div
                  ref={miniRef}
                  style={
                    ghost?.from === "chat"
                      ? { animation: `mini-take ${ABSORB_MS}ms linear both` }
                      : undefined
                  }
                  className="mt-4 flex min-h-[220px] flex-col border-t border-hairline pt-4"
                >
                  <MiniChat />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-3 text-[12.5px] tracking-[0.12em] text-ink-4">
                사건 파일
              </div>
              <div className="rounded-[14px] border border-[oklch(0.305_0.013_267.1/60%)] bg-stage p-[14px_15px]">
                <div className="flex items-center gap-2 text-[13.5px] font-[620] text-ink-1">
                  진술에서 파악한 것
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                  />
                </div>
                <dl className="mt-2.5 grid gap-px">
                  {CASE_FILE.map(([label, value, kind]) => (
                    <div
                      key={label}
                      className={`flex items-baseline justify-between gap-3 rounded-[7px] px-1.5 py-[7px] text-[13.5px] ${
                        kind === "asking" ? "bg-[oklch(0.77_0.117_70.9/6%)]" : ""
                      } ${kind === "future" ? "opacity-55" : ""}`}
                    >
                      <dt className="shrink-0 text-ink-3">{label}</dt>
                      <dd className="min-w-0 text-right">
                        {kind === "filled" ? (
                          <span className="font-[580] text-ink-1">{value}</span>
                        ) : (
                          <span className="text-[13px] text-ink-3">{value}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] leading-[1.6] text-ink-3">
                  채워지는 만큼 절차가 정확해집니다.{" "}
                  <b className="font-[620] text-ink-2">모름도 답입니다.</b> 빈 칸이어도
                  진행됩니다.
                </p>
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">
                답변이 끝나면 이 자리가 <b className="font-[620] text-ink-2">할 일 패널</b>로
                바뀝니다. 챗과 플랜은 같은 주소입니다.
              </p>
            </>
          )}
        </aside>
      </div>

      {/* 개발용 축 스위치 — 제품이 아닙니다. 서버 시그널이 붙으면 통째로 지웁니다.
          화면 흐름을 가리지 않도록 오른쪽 아래에 떠 있게 두고, `?view=` 로도 받습니다 */}
      <div className="pointer-events-auto fixed bottom-3 right-3 z-50 flex items-center gap-1 rounded-full border border-hairline bg-stage/90 px-1.5 py-1 text-[12.5px] backdrop-blur">
        <span className="px-1.5 text-icon">dev</span>
        {DEV_VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setFocus(id);
              if (id !== "chat") setSide("work");
            }}
            aria-pressed={focus === id}
            className={`rounded-full px-2.5 py-1 transition-colors duration-200 ${
              focus === id ? "bg-[oklch(1_0_0/14%)] text-ink-1" : "text-ink-3 hover:text-ink-1"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSide(atWork ? "casefile" : "work")}
          disabled={!chatIsMain}
          className="rounded-full px-2.5 py-1 text-ink-3 transition-colors duration-200 hover:text-ink-1 disabled:opacity-30"
        >
          {atWork ? "사건파일" : "WS"}
        </button>
      </div>

      {/* 나가는 본문의 유령 — 새 본문과 **겹쳐** 지나갑니다.
          바깥 겹은 반드시 있어야 합니다: 유령이 기울고 늘어나며 화면 밖으로 나가는데,
          가두지 않으면 **문서가 넓어져 아래 레이아웃이 통째로 오른쪽으로 밀립니다** */}
      {ghost && (
        <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          <div
            ref={ghostRef}
            aria-hidden
            className={`absolute overflow-hidden ${
              ghost.from === "chat" ? "border border-transparent" : "view-out"
            }`}
            style={{
              ...(ghost.from === "chat"
                ? { animation: `ghost-card ${ABSORB_MS}ms linear both` }
                : null),
              left: ghost.rect.x,
              top: ghost.rect.y,
              width: ghost.rect.w,
              height: ghost.rect.h,
              transformOrigin: "top left",
            }}
          >
            {/* `[&_.rise]:animate-none` — 나가는 중인데 내용이 새로 등장하면 안 됩니다 */}
            <div className="flex h-full flex-col overflow-hidden px-[clamp(16px,3vw,32px)] py-[clamp(18px,3vh,28px)] [&_.rise]:animate-none">
              {ghost.from === "chat" && (
                <ChatView atWork={ghost.atWork} onPickChoice={() => undefined} />
              )}
              {ghost.from === "plan" && <PlanView />}
              {ghost.from === "evidence" && <EvidenceView />}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
