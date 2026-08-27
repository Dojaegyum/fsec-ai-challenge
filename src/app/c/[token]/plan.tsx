"use client";

/**
 * S-07 사건 · 플랜 — `/c/{token}` 의 `focus: "plan"` 일 때의 본문.
 *
 * 계약: spec/frontend/08-14-screens.md §S-07 · spec/common/08-14-api.md §3.6 §3.7
 * 시안: assets/artifacts/handoff/08-19-s07-board-motion/ 「Board S-07 Options」
 *       **1c 골격 + 1b 히어로 스트립** 결합 (1a 3열 탈락)
 *
 * **며칠 뒤 링크를 열었을 때 「지금 뭘 해야 하나」가 첫 줄이어야 합니다.**
 * 빈 챗창이 뜨면 관리 서비스가 아닙니다 — 그래서 히어로 스트립이 맨 위입니다.
 *
 * 절대 하지 않는 것
 *  · **빨강을 쓰지 않습니다.** 기한 임박은 앰버 — 패닉을 더 밀어붙이지 않습니다
 *  · **화면이 날짜를 세지 않습니다.** D-day·기한 문자열은 서버가 계산한 값 그대로
 *    (spec/common/08-16-deadline-rules.md · 불변 규칙 7)
 *  · **제출처를 화면이 단정하지 않습니다** — 「앱에서」도 「서면으로」도 쓰지 마세요.
 *    은행마다 다르고, 그 값은 `org.contact.submit` 이 갖고 있습니다 (ADR-042).
 *    KB·NH 는 공식 안내가 **영업점 서면**이고 나머지 다섯은 **확인 실패**입니다
 *  · **보드를 비우지 않습니다.** 할 일이 없는 구간에도 보여줄 것이 있습니다
 *  · 완료를 사용자 체크로 판정하지 않습니다 — 부산물(◆)이 판정합니다
 *
 * ## 값은 전부 위에서 옵니다
 *
 * `page.tsx` 가 §3.10 을 **한 번** 불러 내려보냅니다. 이 파일은 `fetch` 하지
 * 않습니다 — 화면이 둘로 갈라져 부르면 히어로와 보드가 서로 다른 시점을 그립니다.
 */

import { ddayLabel, dueLabel, groupDeadlines, WaitCard } from "@/modules/deadline-viewer";
import type { Deadline } from "@/modules/deadline-viewer";
import { PlanBoard } from "@/modules/plan-viewer";
import type { PlanStep, StepTone } from "@/modules/plan-viewer";

/**
 * 사건 진행 레일 — **절차의 전체 흐름**입니다. 진행률이 아닙니다.
 *
 * 계약: spec/frontend/08-14-screens.md §S-07 「사건 진행 레일」
 *
 * ⚠️ **2026-08-27 까지 라벨과 상태가 손으로 적힌 상수였습니다.** 「지급정지」에
 * `"done"` 이 박혀 있어 **아무것도 답하지 않은 진입 직후에도 첫 칸이 칠해졌고**,
 * 사용자는 「이미 그 단계까지 왔다」로 읽었습니다. 게다가 상태를 색으로만 갈라
 * §S-07 의 *"색 하나로 가르지 않습니다"* 를 이 레일만 어기고 있었습니다.
 *
 * 지금은 **서버가 준 단계에서 유도합니다.** 각 칸에 걸린 `body.step_key` 의
 * 상태를 보고 정합니다 — 화면이 지어내는 값이 없습니다.
 *
 * ## 칸이 넷인 이유
 *
 * 채택된 시안(핸드오프 「Board S-07 Options」 1c)이 넷입니다. 다섯짜리는 **탈락한
 * 1a** 의 개수였고, 그중 「결정」은 **기관이 하는 일이라 KB 에 단계가 없습니다** —
 * 영영 「미시작」으로 남을 칸을 두느니 「환급」에 합칩니다.
 *
 * ## 걸리는 단계가 없으면 「미시작」입니다
 *
 * ⬜ **유형에 따라 아예 없는 국면이 있는데 그것을 아직 못 가립니다.** 카드·통신과금·
 * 상품권은 채권소멸공고를 타지 않고(`src/kb/ch-card.json` 등이 「이 유형에는 …
 * 없습니다」로 덮습니다) 그 단계의 `state` 는 `not_started` 라, 레일에는 「공고
 * 2개월 · 미시작」으로 그려집니다. `skipped` 로 오면 「해당 없음」이 됩니다 —
 * **어느 쪽인지를 서버가 말해 주는 칸이 §3.6 에 없습니다.**
 */
const RAIL: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
  { label: "지급정지", keys: ["freeze-request"] },
  { label: "피해구제", keys: ["relief-apply", "relief-documents"] },
  { label: "공고 2개월", keys: ["debt-extinction-notice"] },
  // 기관이 하는 일이라 KB 에 단계가 없습니다 — **늘 「미시작」이고 그게 사실입니다**
  { label: "환급", keys: [] },
];

/**
 * §S-07 「단계 상태 어휘」 그대로 — **기호·태그·색 셋이 함께 갑니다.**
 *
 * `now` 의 태그만 다릅니다. 단계 목록에서는 서버가 준 D-day 가 그 자리를 채우는데,
 * 레일의 칸은 국면이라 자기 기한이 없습니다 → §S-07 「사건 진행 레일」.
 */
const RAIL_MARK: Record<StepTone, { readonly sign: string; readonly tag: string }> = {
  done: { sign: "✓", tag: "증빙됨" },
  now: { sign: "→", tag: "지금 차례" },
  todo: { sign: "○", tag: "미시작" },
  anytime: { sign: "◇", tag: "언제든" },
  na: { sign: "—", tag: "해당 없음" },
};

/**
 * 레일 한 칸의 상태를 그 칸에 걸린 단계들에서 정합니다.
 *
 * **완료는 부산물이 판정합니다** (불변 규칙 6). `unconfirmed`(사용자가 했다고만
 * 말한 것)는 `done` 이 아니라 아직 안 끝난 것으로 셉니다 — `plan-viewer` 의
 * `toneOf` 와 같은 판단입니다.
 */
function railTone(steps: readonly PlanStep[], keys: readonly string[]): StepTone {
  const mine = steps.filter((one) => keys.includes(one.body.step_key ?? ""));
  // 걸린 단계가 없으면 아직 오지 않은 국면입니다. **비었다고 칠하지 않습니다**
  if (mine.length === 0) return "todo";
  if (mine.some((one) => one.state === "in_progress")) return "now";
  if (mine.every((one) => one.state === "done_verified")) return "done";
  // 「지우지 않고 흐리게」 — 왜 없는지가 정보입니다 (§S-07)
  if (mine.every((one) => one.state === "skipped")) return "na";
  return "todo";
}

/** 부모 `.view-in` 이 0.5초 지연이라, 자식 계단도 그 뒤에서 시작해야 합니다 —
 *  안 그러면 자식이 다 나타난 뒤에 부모가 페이드인합니다 */
const step = (i: number) => ({ animationDelay: `${520 + i * 120}ms` });

export default function PlanView({
  steps,
  deadlines,
  onPickStep,
  onOpenDoc,
}: {
  steps: readonly PlanStep[];
  deadlines: readonly Deadline[];
  /** 단계를 누르면 워크스페이스가 그리로 옮겨집니다. 없으면 안 눌립니다 */
  onPickStep?: (stepId: string) => void;
  /**
   * 「무엇을 적는지 보기」 — 기재 안내 화면으로.
   *
   * **없으면 그 버튼을 안 그립니다.** 히어로 본문이 그 버튼을 이름으로
   * 가리키고 있어서(「‘무엇을 적는지 보기’의 첫 줄에 있습니다」), 눌러도
   * 안 열리는 채로 두면 사용자가 그 첫 줄을 영영 못 찾습니다.
   */
  onOpenDoc?: () => void;
}) {
  // 본 기한·추가 기간·안내를 가릅니다. **합치지 않습니다** → 데이터 모델 §8.1
  const groups = groupDeadlines(deadlines);
  // 공고는 `kind: "info"` 기한 하나입니다 — 사용자가 지킬 기한이 아닙니다 (§3.7)
  const notice = groups.info[0] ?? null;

  // **지금 하실 일** — 진행 중인 단계 하나. 없으면 히어로가 「할 일이 없다」를 말합니다.
  // 「다음 것을 골라 밀어붙이지」 않습니다 — 순차가 아니기 때문입니다 (ADR-035)
  const now = steps.find((s) => s.state === "in_progress") ?? null;
  const primary = now ? (groups.primary.find((d) => d.step_id === now.step_id) ?? null) : null;
  const grace = now ? (groups.grace.find((d) => d.step_id === now.step_id) ?? null) : null;

  // 서버가 센 값이 없으면 **그리지 않습니다** — 화면이 날짜를 세지 않습니다 (불변 규칙 7)
  const dday = primary ? ddayLabel(primary) : null;
  const dueText = primary ? dueLabel(primary) : null;
  const graceText = grace ? dueLabel(grace) : null;

  const byId = new Map(steps.map((s) => [s.step_id, s]));

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      {/* ── 히어로 스트립 — 첫 줄이 답입니다 ─────────────── */}
      <section
        style={step(0)}
        className="rise rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[15px_18px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="min-w-0">
            {/* flex + gap 을 쓰지 마세요 — 글자 마디 사이에도 간격이 들어가
                「8월 20일  까지」처럼 벌어집니다. 아이콘만 margin 으로 띄웁니다 */}
            <p className="text-[13px] text-deadline-urgent">
              <span aria-hidden className="mr-1.5">
                ◷
              </span>
              {now ? "지금 하실 일은 하나입니다" : "지금 하실 일은 없습니다"}
              {dueText && (
                <>
                  {" · "}
                  <span data-numeric>{dueText}</span>까지
                </>
              )}
            </p>
            {/* **기산점이 확인 안 된 기한입니다.** 히어로는 이 사건에서 가장
                크게 읽히는 자리라, 여기서 확정처럼 보이면 배지에 「미확인」이
                붙어 있어도 소용이 없습니다 → 기한 규칙 */}
            {primary?.estimated && (
              <p className="mt-1 text-[12.5px] leading-[1.55] text-ink-3">
                말씀해 주신 날짜로 센 것이라{" "}
                <b className="font-[620] text-ink-2">아직 확정이 아닙니다.</b> 접수증을
                올려주시면 정확한 날짜로 다시 세어 드립니다.
              </p>
            )}
            <h2 className="mt-1 text-[21px] font-[660] leading-[1.4] tracking-[-0.01em] text-ink-1">
              {now ? now.title : "기다리는 구간입니다"}
            </h2>
            {/* 추가 기간이 **있을 때만** 말합니다. 없는데 「유예가 남는다」고 적으면
                기한을 넘겨도 된다고 읽힙니다 */}
            {graceText ? (
              <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
                넘기더라도 <b className="font-[620] text-ink-2">{graceText}까지 유예</b>가
                남습니다. 오늘이 마지막은 아닙니다.
              </p>
            ) : (
              <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
                {now
                  ? "이 단계가 끝나면 다음 할 일이 여기 뜹니다."
                  : "진행은 계속되고 있습니다. 아래 보드에서 어디까지 왔는지 보실 수 있습니다."}
              </p>
            )}
          </div>
          {/* **`days_left` 가 없으면 배지가 없습니다.** 여기서 날짜를 세지 않습니다 */}
          {dday && (
            <div
              data-numeric
              aria-hidden
              className="shrink-0 rounded-[11px] border border-[oklch(0.77_0.117_70.9/45%)] px-4 py-2 text-[26px] font-[700] leading-none text-deadline-urgent"
            >
              {dday}
            </div>
          )}
        </div>
        {now && (
          <div className="mt-4 flex flex-wrap gap-2">
            {/* **누르면 그 단계의 작업 자리로 옮겨갑니다** — 아래 단계 줄을 누르는 것과
                같은 길입니다(`onPickStep`). 히어로가 「지금 하실 일은 하나」라고 해 놓고
                눌러도 안 움직이면 그 말이 거짓이 됩니다 */}
            <button
              type="button"
              onClick={onPickStep ? () => onPickStep(now.step_id) : undefined}
              disabled={!onPickStep}
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-5 text-[14px] font-[660] text-ground disabled:opacity-40"
            >
              지금 하기
            </button>
            {onOpenDoc && (
              <button
                type="button"
                onClick={onOpenDoc}
                className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] border border-hairline bg-chip px-5 text-[14px] font-[560] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]"
              >
                무엇을 적는지 보기
              </button>
            )}
            {/* 제출처는 히어로가 말하지 않습니다 (ADR-042) — 대신 어디서 보는지를 알립니다.
                기재 안내 화면의 첫 카드가 `org.contact.submit` 을 순서 그대로 그립니다 */}
            {onOpenDoc && (
              <p className="w-full text-[12.5px] leading-[1.6] text-ink-3">
                내는 곳은 은행마다 다릅니다 —{" "}
                <b className="font-[620] text-ink-2">「무엇을 적는지 보기」</b>의 첫 줄에 있습니다.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── 사건 진행 레일 ────────────────────────────────
          **가로 막대를 쓰지 않습니다.** 왼쪽부터 채워지는 막대는 진행률의 관용구라
          「여기까지 왔다」로 읽힙니다 — 이 줄이 말하는 것은 절차의 전체 흐름입니다 */}
      <section style={step(1)} className="rise">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[12.5px] tracking-[0.12em] text-ink-4">사건 진행</h3>
          {/* 무엇을 보는 줄인지 말합니다 — 안 말하면 색을 진행률로 읽습니다 */}
          <p className="text-[12.5px] text-ink-4">절차의 전체 흐름입니다</p>
        </div>
        <ol className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-4">
          {RAIL.map(({ label, keys }) => {
            const tone = railTone(steps, keys);
            const mark = RAIL_MARK[tone];
            return (
              /* **기호·태그·색 셋이 함께 갑니다** — 색만으로 가르지 않습니다 (§S-07).
                 「해당 없음」은 지우지 않고 흐리게 둡니다 — 왜 없는지가 정보입니다 */
              <li key={label} className={tone === "na" ? "opacity-55" : ""}>
                <div className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className={`w-[13px] shrink-0 text-center text-[12px] ${
                      tone === "done"
                        ? "text-pii"
                        : tone === "now"
                          ? "text-deadline-urgent"
                          : "text-ink-4"
                    }`}
                  >
                    {mark.sign}
                  </span>
                  <span
                    className={`min-w-0 truncate text-[13px] ${
                      tone === "now" ? "font-[620] text-ink-1" : "text-ink-2"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                <p
                  className={`mt-0.5 pl-[19px] text-[12px] ${
                    tone === "now" ? "text-deadline-urgent" : "text-ink-4"
                  }`}
                >
                  {mark.tag}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── 단계 목록 — `plan-viewer` 가 그립니다 ──────────
          기한은 **서버가 준 값**만 넘깁니다. `days_left` 가 없으면 D-day 도 없습니다 */}
      <div style={step(2)} className="rise">
        <PlanBoard
          steps={steps}
          onPickStep={onPickStep}
          hasDeadline={(id) => deadlines.some((d) => d.step_id === id)}
          deadlineFor={(id) => {
            const d = groups.primary.find((x) => x.step_id === id);
            const label = d ? dueLabel(d) : null;
            return label && `${label}까지`;
          }}
          /* 부산물은 §3.6 `required_artifact` 입니다 — **화면이 고르지 않습니다.**
             완료를 판정하는 것이 무엇인지 미리 보이게 하는 자리입니다 (불변 규칙 6) */
          artifactFor={(id) => {
            const need = byId.get(id)?.required_artifact;
            return need ? `◆ ${need.label}` : null;
          }}
          /* 공고 대기 카드는 **단계 행 사이**에 같은 폭으로 들어갑니다 — 시안 「wait-card」.
             1b 의 풀폭 진행 스트립은 카운트다운으로 읽혀 폐기됐습니다 */
          afterStep={(id) =>
            /* **서버가 두 값을 다 보낼 때만 그립니다.** 화면이 대신 만들 수
               없습니다 — 만들려면 기기 시계를 읽어야 하고, 날짜가 틀린
               사용자에게 「공고가 끝났다」를 잘못 보여줍니다. 기준 시계는
               서버입니다 → spec/common/08-16-deadline-rules.md */
            notice?.starts_at !== undefined &&
            notice.elapsed !== undefined &&
            now &&
            id === now.step_id ? (
              <WaitCard
                deadline={notice}
                startAt={notice.starts_at}
                progress={notice.elapsed}
                onUpload={() => {}}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
