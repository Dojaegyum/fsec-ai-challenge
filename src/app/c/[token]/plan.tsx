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
import type { PlanStep } from "@/modules/plan-viewer";

import { FIXTURE_NOTICE } from "./fixtures";

/**
 * 사건 진행 레일 — 지금 어디쯤인지. 색만으로 가르지 않고 라벨을 함께 둡니다.
 *
 * ⬜ **아직 손으로 적은 다섯입니다.** 계약에 사건의 큰 국면을 내리는 칸이 없어
 * 단계에서 유도할 수 없습니다 — `docs/plans/08-23-qa-readiness.md` Task 4 에서
 * 정본에 올릴지 정합니다. 그때까지 **이 다섯은 예시**입니다.
 */
const RAIL = [
  ["지급정지", "done"],
  ["피해구제", "now"],
  ["공고 2개월", "todo"],
  ["결정", "todo"],
  ["환급", "todo"],
] as const;

/** 부모 `.view-in` 이 0.5초 지연이라, 자식 계단도 그 뒤에서 시작해야 합니다 —
 *  안 그러면 자식이 다 나타난 뒤에 부모가 페이드인합니다 */
const step = (i: number) => ({ animationDelay: `${520 + i * 120}ms` });

export default function PlanView({
  steps,
  deadlines,
}: {
  steps: readonly PlanStep[];
  deadlines: readonly Deadline[];
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
            <button
              type="button"
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-5 text-[14px] font-[660] text-ground"
            >
              지금 하기
            </button>
            <button
              type="button"
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] border border-hairline bg-chip px-5 text-[14px] font-[560] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]"
            >
              무엇을 적는지 보기
            </button>
            {/* 제출처는 히어로가 말하지 않습니다 (ADR-042) — 대신 어디서 보는지를 알립니다.
                기재 안내 화면의 첫 카드가 `org.contact.submit` 을 순서 그대로 그립니다 */}
            <p className="w-full text-[12.5px] leading-[1.6] text-ink-3">
              내는 곳은 은행마다 다릅니다 —{" "}
              <b className="font-[620] text-ink-2">「무엇을 적는지 보기」</b>의 첫 줄에 있습니다.
            </p>
          </div>
        )}
      </section>

      {/* ── 사건 진행 레일 ──────────────────────────────── */}
      <section style={step(1)} className="rise">
        <h3 className="text-[12.5px] tracking-[0.12em] text-ink-4">사건 진행</h3>
        <ol className="mt-2.5 grid grid-cols-5 gap-1.5">
          {RAIL.map(([label, tone]) => (
            <li key={label}>
              <div
                aria-hidden
                className={`h-1 rounded-full ${
                  tone === "done"
                    ? "bg-pii"
                    : tone === "now"
                      ? "bg-deadline-urgent"
                      : "bg-[oklch(1_0_0/12%)]"
                }`}
              />
              <p
                className={`mt-1.5 text-[12.5px] ${
                  tone === "done"
                    ? "text-pii"
                    : tone === "now"
                      ? "font-[620] text-deadline-urgent"
                      : "text-ink-3"
                }`}
              >
                {label}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── 단계 목록 — `plan-viewer` 가 그립니다 ──────────
          기한은 **서버가 준 값**만 넘깁니다. `days_left` 가 없으면 D-day 도 없습니다 */}
      <div style={step(2)} className="rise">
        <PlanBoard
          steps={steps}
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
            notice && now && id === now.step_id ? (
              <WaitCard
                deadline={notice}
                /* ⬜ **`starts_at`·`elapsed` 는 아직 서버가 안 보냅니다** (§3.7 에 2026-08-23
                   확정, 미구현 — QA 계획 Task 4). 화면이 대신 만들 수 없습니다:
                   만들려면 기기 시계를 읽어야 하고 그건 불변 규칙 7 위반입니다 */
                startAt={FIXTURE_NOTICE.startAt}
                progress={FIXTURE_NOTICE.progress}
                onUpload={() => {}}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
