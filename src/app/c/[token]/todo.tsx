"use client";

import { useRef } from "react";

import { ddayLabel, dueLabel, groupDeadlines } from "@/modules/deadline-viewer";
import type { Deadline } from "@/modules/deadline-viewer";
import { currentStep } from "@/modules/work-handler";
import type { PlanStep as WorkStep } from "@/modules/work-handler";
import type { PlanStep } from "@/modules/plan-viewer";

/**
 * 할 일 레일 — `/c/{token}` 왼쪽 열의 아래쪽. 챗이 중앙에 고정되면서(ADR-063)
 * 플랜 보드가 하던 단계 추적이 여기로 왔습니다.
 *
 * 계약: spec/common/08-14-api.md §3.6 §3.7 · spec/frontend/08-14-screens.md §S-07 어휘
 * 근거: ADR-063 · ADR-042(「무엇을 적는지 보기」가 제출처의 유일한 출구)
 *
 * 절대 하지 않는 것 — 플랜 보드와 같은 규칙입니다
 *  · **화면이 날짜를 세지 않습니다.** D-day·기한은 서버 값 그대로 (불변 규칙 7)
 *  · **완료는 부산물이 판정합니다.** `unconfirmed` 는 done 이 아닙니다 (불변 규칙 6)
 *  · 빨강 금지 — 기한 임박은 앰버
 *  · 좁은 레일이라고 근거·상태를 지우지 않습니다 — 짧게 할지언정 거짓말하지 않습니다
 *
 * ## 「채팅 상황에 맞는」이 뜻하는 것
 *
 * 강조(`activeStepId`)는 셸이 정합니다 — 보드에서 누른 것, 없으면 챗의
 * `referenced_steps` 가 고른 것(`pickStep`), 그것도 없으면 앞선 열린 단계.
 * 이 레일은 **그 결과를 그릴 뿐** 스스로 단계를 고르지 않습니다.
 */

/** §S-07 「단계 상태 어휘」 — 기호·태그·색 셋이 함께 갑니다 */
const MARK: Record<string, { sign: string; tag: string; cls: string }> = {
  done_verified: { sign: "✓", tag: "증빙됨", cls: "text-pii" },
  in_progress: { sign: "→", tag: "지금 차례", cls: "text-ink-1" },
  unconfirmed: { sign: "◔", tag: "확인 필요", cls: "text-deadline-urgent" },
  skipped: { sign: "—", tag: "해당 없음", cls: "text-ink-4" },
  not_started: { sign: "○", tag: "미시작", cls: "text-ink-3" },
};

export default function TodoRail({
  steps,
  deadlines,
  activeStepId,
  onPickStep,
  onOpenDoc,
  onPickFile,
  busy = false,
}: {
  steps: readonly PlanStep[];
  deadlines: readonly Deadline[];
  /** 지금 워크스페이스가 보고 있는 단계 — 챗이 가리키면 따라 움직입니다 */
  activeStepId: string | null;
  /** 단계를 누르면 워크스페이스가 그리로. 없으면 안 눌립니다 */
  onPickStep?: (stepId: string) => void;
  /** 「무엇을 적는지 보기」 — 제출처를 가진 유일한 출구 (ADR-042) */
  onOpenDoc?: () => void;
  /** 통지·우편을 올리는 자리 — 공고 대기 줄이 씁니다 */
  onPickFile?: (file: File) => void;
  busy?: boolean;
}) {
  // 본 기한·추가 기간·안내를 가릅니다. **합치지 않습니다** → 데이터 모델 §8.1
  const groups = groupDeadlines(deadlines);
  const notice = groups.info[0] ?? null;

  // **「지금 하실 일」은 in_progress 만이 아닙니다** (2026-09-03). 그 상태는
  // 접수번호가 L1 검증에 실패했을 때만 생기고, 갓 만든 사건은 전부
  // not_started 라 — 막 신고를 마치고 들어온 사람에게 「지금 하실 일 없음」이
  // 떴습니다. 히어로·헤더 배지와 같은 판정을 씁니다 (`currentStep`)
  const now = currentStep(steps as unknown as readonly WorkStep[]) as PlanStep | null;
  const primary = now ? (groups.primary.find((d) => d.step_id === now.step_id) ?? null) : null;

  const noticeRef = useRef<HTMLInputElement>(null);
  const byStep = new Map(groups.primary.map((d) => [d.step_id, d]));

  return (
    <section aria-label="할 일" className="flex min-h-0 flex-col gap-2.5">
      {/* 구역 이름표 — 오른쪽 「워크스페이스」와 짝. 없으니 어느 구역인지
          이름으로 못 불렀습니다 (2026-09-03 지적) */}
      <div className="text-[12.5px] tracking-[0.12em] text-ink-4">할 일</div>
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

      {/* ── 지금 카드 — 이 레일의 첫 줄이 「지금 뭘 해야 하나」의 답입니다 ── */}
      <div className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/7%)] p-[12px_14px] shadow-[0_1px_0_oklch(1_0_0/7%)_inset,0_10px_24px_-12px_oklch(0_0_0/65%)]">
        <p className="text-[12px] font-[620] tracking-[0.08em] text-deadline-urgent">
          <span aria-hidden className="mr-1">◷</span>
          {now ? "지금 하실 일" : "지금 하실 일 없음"}
        </p>
        <div className="mt-1 flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-[14.5px] font-[640] leading-[1.45] text-ink-1">
            {now ? now.title : "기다리는 구간입니다"}
          </h3>
          {/* 서버가 센 값이 없으면 그리지 않습니다 — 불변 규칙 7 */}
          {primary && ddayLabel(primary) && (
            <span
              data-numeric
              className="shrink-0 rounded-[9px] border border-[oklch(0.77_0.117_70.9/45%)] px-2 py-0.5 text-[15px] font-[700] text-deadline-urgent"
            >
              {ddayLabel(primary)}
            </span>
          )}
        </div>
        {primary && dueLabel(primary) && (
          <p data-numeric className="mt-1 text-[12.5px] text-ink-3">
            {dueLabel(primary)}까지
            {/* 기산점 미확인이면 확정처럼 안 보이게 — 기한 규칙 */}
            {primary.estimated && (
              <span className="ml-1 text-ink-4">· 아직 확정 아님</span>
            )}
          </p>
        )}
      </div>

      {/* ── 단계 리스트 — 하나가 카드 하나입니다 (ADR-063 「구역을 눈으로」) ──
          ⚠️ **`grid` 가 아니라 `flex flex-col` 입니다** (2026-09-03). 명시적 열이
          없는 grid 는 암묵 열을 `auto`(max-content)로 잡아, 긴 제목의 버튼이 열
          폭(320px)이 아니라 **제목 길이만큼** 자라 옆 채팅 열로 삐져나왔습니다.
          flex-col 은 자식을 열 폭에 맞춰(stretch) truncate 가 실제로 자릅니다 */}
      <ol className="flex flex-col gap-1.5">
        {steps.map((s) => {
          const mark = MARK[s.state] ?? MARK.not_started;
          const dl = byStep.get(s.step_id);
          const active = s.step_id === activeStepId;
          return (
            <li key={s.step_id}>
              <button
                type="button"
                onClick={onPickStep ? () => onPickStep(s.step_id) : undefined}
                disabled={!onPickStep}
                aria-current={active ? "step" : undefined}
                className={`flex w-full min-w-0 items-center gap-2.5 rounded-[11px] border px-[11px] py-[9px] text-left transition-colors duration-200 shadow-[0_1px_0_oklch(1_0_0/7%)_inset,0_8px_20px_-10px_oklch(0_0_0/65%)] ${
                  active
                    ? "border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/9%)]"
                    : "border-hairline bg-surface hover:border-[oklch(1_0_0/22%)]"
                }`}
              >
                <span aria-hidden className={`w-[16px] shrink-0 text-center text-[13px] ${mark.cls}`}>
                  {mark.sign}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[13.5px] leading-[1.4] ${
                      s.state === "skipped" ? "text-ink-4" : "font-[580] text-ink-1"
                    }`}
                  >
                    {s.title}
                  </span>
                  <span className={`text-[11.5px] ${mark.cls}`}>{mark.tag}</span>
                </span>
                {dl && ddayLabel(dl) && (
                  <span
                    data-numeric
                    className="shrink-0 text-[12px] font-[640] text-deadline-urgent"
                  >
                    {ddayLabel(dl)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {/* ── 공고 대기 — 사용자 기한이 아니라 앰버를 안 씁니다 ── */}
      {notice && (
        <div className="rounded-[11px] border border-hairline bg-chip p-[10px_12px]">
          <p className="text-[12.5px] leading-[1.55] text-ink-3">
            <span aria-hidden className="mr-1 text-pii">◇</span>
            공고 게시 기간입니다 — 기다림이 정상입니다
          </p>
          {onPickFile && (
            <button
              type="button"
              onClick={() => noticeRef.current?.click()}
              disabled={busy}
              className="mt-1.5 inline-flex min-h-[var(--size-touch)] items-center text-[12.5px] text-pii disabled:opacity-45"
            >
              통지·우편을 받으셨나요? 올리기 ↗
            </button>
          )}
        </div>
      )}

      {/* 제출처는 여기서 말하지 않습니다 (ADR-042) — 유일한 출구만 둡니다 */}
      {onOpenDoc && (
        <button
          type="button"
          onClick={onOpenDoc}
          className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-[11px] border border-hairline bg-chip text-[13px] font-[560] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]"
        >
          무엇을 적는지 보기
        </button>
      )}

      <p className="text-[11.5px] leading-[1.6] text-ink-4">
        기한은 서버가 계산한 값입니다. 완료는 체크가 아니라 부산물(◆)이 판정합니다.
      </p>
    </section>
  );
}
