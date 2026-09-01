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

import { useRef } from "react";

import { ddayLabel, dueLabel, groupDeadlines, WaitCard } from "@/modules/deadline-viewer";
import type { Deadline } from "@/modules/deadline-viewer";
import { PlanBoard } from "@/modules/plan-viewer";
import type { PlanStep, StepTone } from "@/modules/plan-viewer";
import { currentStep } from "@/modules/work-handler";
import type { PlanStep as WorkStep } from "@/modules/work-handler";

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
 * ## 유형에 없는 국면은 「해당 없음」입니다 — `body.action` 으로 가릅니다
 *
 * ⚠️ **2026-08-31 까지 「미시작」으로 그렸습니다.** 카드·통신과금·상품권은
 * 채권소멸공고를 타지 않고 가상자산은 지급정지·피해구제가 아직 열려 있지
 * 않은데(`src/kb/ch-*.json` 이 「이 유형에는 … 없습니다」로 공통을 덮습니다),
 * 그 단계의 `state` 는 `not_started` 라 레일이 **「지급정지 · 미시작」**으로
 * 그렸습니다. 사용자는 그것을 **아직 해야 하는 일**로 읽습니다 —
 * KB 가 「걸리지 않습니다」라고 말한 절차를 화면이 시켰다는 뜻이고,
 * 그것이 [불변 규칙 1](../../../CLAUDE.md)이 금지한 자리입니다.
 *
 * **가르는 값은 `body.action` 입니다.** KB 에서 `read` 인 항목은 지금 여덟 개이고
 * **전부** 「이 유형에는 없습니다 · 아직 열려 있지 않습니다」류입니다 —
 * 할 일이 아니라 **읽고 넘어가는 자리**입니다. 나머지 넷(`call`·`visit`·`upload`·
 * `wait`)은 사용자가 무언가를 하는 단계입니다.
 *
 * ⬜ **추론입니다.** 「이 국면은 이 유형에 없다」를 서버가 곧장 말해 주는 칸이
 * §3.6 에 없습니다. 생기면 그 칸을 보세요 — `skipped` 로 와도 「해당 없음」이 됩니다.
 * 새 `read` 항목을 KB 에 넣을 때는 **레일이 그 국면을 「해당 없음」으로 그린다**는
 * 것을 알고 넣으세요 (→ [RFC-002](../../../rfc/002-kb-authoring.md)).
 */
const RAIL: readonly { readonly label: string; readonly keys: readonly string[] }[] = [
  { label: "지급정지", keys: ["freeze-request"] },
  { label: "피해구제", keys: ["relief-apply", "relief-documents"] },
  { label: "공고 2개월", keys: ["debt-extinction-notice"] },
  // 기관이 하는 일이라 KB 에 단계가 없습니다 — 걸 `step_key` 가 없어
  // **앞 칸들에서 따라옵니다** (`railTones`)
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
 * **지금 하실 일** — 히어로가 가리키는 단계 하나.
 *
 * ⚠️ **2026-08-31 까지 `state === "in_progress"` 만 찾았습니다.** 그 상태는 이
 * 저장소에서 **접수번호가 L1 검증에 실패했을 때만** 생기고(`completion-checker`
 * 의 `failed()`), 새 플랜의 단계는 전부 `not_started` 입니다(`planner`). 그래서
 * 아직 아무 부산물도 못 낸 사건 — 즉 **막 신고를 마치고 들어온 모든 사용자** — 에게
 * 첫 줄이 「지금 하실 일은 없습니다 · 기다리는 구간입니다」로 떴고, 두 버튼도
 * 안 그려졌습니다. 사건은 언제나 플랜으로 열립니다(`case-opener`).
 *
 * **없는 순서를 새로 만드는 것이 아닙니다.** 워크스페이스가 이미 「눌렀으면 그 단계,
 * 아니면 아직 안 끝난 것 중 앞선 것」으로 골라 열고 있어서(`page.tsx` 의
 * `activeStep`), 히어로만 다른 규칙을 쓰고 있었습니다 — **판정을 한 벌로 맞춥니다.**
 * 끝난 것(`done_verified`)과 해당 없는 것(`skipped`)을 빼는 판단도 `work-handler`
 * 의 `isOpen` 그대로입니다.
 */
function nowStep(steps: readonly PlanStep[]): PlanStep | null {
  // 판정은 `work-handler` 에 한 벌로 있습니다 — 워크스페이스·헤더 배지가 같은 것을
  // 씁니다. 두 모듈의 타입이 각자 필요한 만큼만 선언해 놓아 여기서 넓힙니다
  return currentStep(steps as unknown as readonly WorkStep[]) as unknown as PlanStep | null;
}

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
  // 읽고 넘어가는 자리뿐이면 **할 일이 아닙니다** → 위 「유형에 없는 국면」.
  // 하나라도 사용자가 하는 단계가 섞여 있으면 「미시작」입니다 — 있는 일을
  // 「해당 없음」으로 덮는 쪽이 훨씬 나쁩니다
  if (mine.every((one) => one.body.action === "read")) return "na";
  return "todo";
}

/**
 * 레일 넉 칸의 상태를 한꺼번에 정합니다.
 *
 * ## 걸 단계가 없는 칸은 앞 칸에서 따라옵니다
 *
 * 「환급」은 기관이 하는 일이라 KB 에 단계가 없습니다. 혼자 보면 늘 「미시작」인데,
 * **앞 국면이 전부 「해당 없음」인 사건에서 그것은 거짓입니다** — 가상자산 사건에서
 * 지급정지·피해구제·공고가 다 「해당 없음」인데 환급만 「미시작」이면, 사용자는
 * **기다리면 환급이 온다**로 읽습니다. 「받을 수 있다고 말하지 않는다」
 * ([불변 규칙 8](../../../CLAUDE.md))가 정확히 그 자리입니다.
 *
 * 앞 칸이 하나라도 살아 있으면 「미시작」 그대로입니다 — **있는 절차를
 * 「해당 없음」으로 덮는 쪽이 훨씬 나쁩니다.**
 */
function railTones(steps: readonly PlanStep[]): StepTone[] {
  const tones = RAIL.map(({ keys }) => railTone(steps, keys));
  const anchored = RAIL.map(({ keys }, i) => (keys.length > 0 ? tones[i] : null));
  const live = anchored.filter((one) => one !== null);

  // 걸린 칸이 전부 「해당 없음」일 때만 따라갑니다. 하나도 없으면(단계가 아직
  // 안 붙은 새 사건) 판단하지 않습니다
  const allNa = live.length > 0 && live.every((one) => one === "na");
  return tones.map((tone, i) => (RAIL[i].keys.length === 0 && allNa ? "na" : tone));
}

/** 부모 `.view-in` 이 0.5초 지연이라, 자식 계단도 그 뒤에서 시작해야 합니다 —
 *  안 그러면 자식이 다 나타난 뒤에 부모가 페이드인합니다 */
const step = (i: number) => ({ animationDelay: `${520 + i * 120}ms` });

export default function PlanView({
  steps,
  deadlines,
  onPickStep,
  onOpenDoc,
  onPickFile,
  busy = false,
}: {
  steps: readonly PlanStep[];
  deadlines: readonly Deadline[];
  /** 단계를 누르면 워크스페이스가 그리로 옮겨집니다. 없으면 안 눌립니다 */
  onPickStep?: (stepId: string) => void;
  /**
   * 「무엇을 적는지 보기」가 가는 곳 — S-10 기재 안내.
   *
   * ⚠️ **2026-08-27 까지 이 버튼에 `onClick` 이 없었습니다.** 그런데 바로 아래
   * 문장이 *「내는 곳은 은행마다 다릅니다 — 「무엇을 적는지 보기」의 첫 줄에
   * 있습니다」* 라고 그 버튼을 가리킵니다. [ADR-042](../../../decisions/042-submit-channel.md)가
   * 히어로에서 제출처를 말하지 못하게 막은 대가로 **그 버튼을 유일한 출구로
   * 지정**했는데 출구가 닫혀 있었습니다. 3영업일 기한이 걸린 서류입니다
   */
  onOpenDoc?: () => void;
  /** 통지·우편을 올리는 자리 — 공고 대기 카드가 씁니다 */
  onPickFile?: (file: File) => void;
  busy?: boolean;
}) {
  /** 레일 넉 칸 — 「환급」이 앞 칸에서 따라오므로 한꺼번에 정합니다 */
  const tones = railTones(steps);

  // 본 기한·추가 기간·안내를 가릅니다. **합치지 않습니다** → 데이터 모델 §8.1
  const groups = groupDeadlines(deadlines);
  // 공고는 `kind: "info"` 기한 하나입니다 — 사용자가 지킬 기한이 아닙니다 (§3.7)
  const notice = groups.info[0] ?? null;

  // **지금 하실 일** — 하나입니다. 없으면 히어로가 「할 일이 없다」를 말합니다.
  const now = nowStep(steps);
  const primary = now ? (groups.primary.find((d) => d.step_id === now.step_id) ?? null) : null;
  const grace = now ? (groups.grace.find((d) => d.step_id === now.step_id) ?? null) : null;

  // 서버가 센 값이 없으면 **그리지 않습니다** — 화면이 날짜를 세지 않습니다 (불변 규칙 7)
  const dday = primary ? ddayLabel(primary) : null;
  const dueText = primary ? dueLabel(primary) : null;
  const graceText = grace ? dueLabel(grace) : null;

  const byId = new Map(steps.map((s) => [s.step_id, s]));

  /** 공고 대기 카드의 「통지·우편 받으셨나요」가 여는 파일 선택 */
  const noticeRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      {/* 받는 것은 §3.2 가 정한 셋입니다 — 통지는 사진으로 찍어 올립니다 */}
      <input
        ref={noticeRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPickFile?.(file);
        }}
      />

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
          {RAIL.map(({ label }, cell) => {
            const tone = tones[cell];
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
                /* ⚠️ **빈 함수를 넘기면 모듈이 걸어 둔 안전장치가 열립니다.**
                   `wait.tsx` 가 *「통지·우편을 올리는 자리. 없으면 버튼을 그리지
                   않습니다」* 로 막아 뒀는데, 여기서 `() => {}` 를 넘겨 **눌러도
                   아무 일이 없는 전폭 버튼**이 켜져 있었습니다 */
                {...(onPickFile
                  ? { onUpload: () => { if (!busy) noticeRef.current?.click(); } }
                  : {})}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
}
