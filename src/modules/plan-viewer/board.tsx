"use client";

import { Fragment } from "react";
import type { ReactNode } from "react";

import { numberSteps } from "./order";
import { tagOf, toneOf } from "./tone";
import type { PlanStep, StepTone } from "./types";

/** 상태 어휘 — 모양·글자·색 셋이 함께 갑니다 (색 하나로 가르지 않습니다) */
const MARK: Record<StepTone, { glyph: string; cls: string }> = {
  done: {
    glyph: "✓",
    cls: "border-[oklch(0.697_0.16_258.2/70%)] bg-[oklch(0.697_0.16_258.2/22%)] text-pii",
  },
  now: {
    glyph: "→",
    cls: "border-[oklch(0.77_0.117_70.9/70%)] bg-[oklch(0.77_0.117_70.9/20%)] text-deadline-urgent",
  },
  // 미시작은 **빈 원**(글리프 없음), 언제든은 `◇` 입니다.
  //
  // 시안(「wait-card」·1c)은 둘을 같은 빈 원으로 그렸고 §S-07 표는 `todo: ○`·`anytime: ◇`
  // 였습니다. **2026-08-23 에 사람이 `◇` 로 정했습니다** — 기호가 정보를 한 겹 더
  // 싣는 쪽입니다. `todo` 의 빈 원은 표의 `○` 와 같은 뜻이라 그대로 둡니다.
  // 시안은 이 자리에서 어긋난 채 남습니다 → 다음 핸드오프에 반영을 요청합니다.
  todo: { glyph: "", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  anytime: { glyph: "◇", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  na: { glyph: "—", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
};

export interface StepRowProps {
  step: PlanStep;
  tone: StepTone;
  tag: string;
  /** 사슬 안 위치. `null` 이면 상태 기호를 그립니다 */
  number: number | null;
  /** 서버가 준 기한 문자열. **화면이 만들지 않습니다** */
  deadlineLabel?: string | null;
  /** 부산물 한 줄 — 「◆ 통화 접수번호」. §3.6 `artifacts`·`required_artifact` 에서 */
  artifactLabel?: string | null;
  /** 누르면 워크스페이스가 이 단계로 옮겨집니다. 없으면 안 눌립니다 */
  onPick?: () => void;
}

export function StepRow({
  step,
  tone,
  tag,
  number,
  deadlineLabel,
  artifactLabel,
  onPick,
}: StepRowProps) {
  const mark = MARK[tone];
  return (
    <li
      className={`flex items-center gap-3 border-b border-hairline px-1.5 py-3 last:border-b-0 ${
        tone === "now" ? "rounded-[8px] bg-[oklch(0.77_0.117_70.9/8%)]" : ""
      } ${tone === "na" ? "opacity-50" : ""} ${
        onPick
          ? "cursor-pointer transition-colors duration-200 hover:bg-[oklch(1_0_0/3%)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pii"
          : ""
      }`}
      /* **줄 전체가 눌립니다** — 시안이 버튼을 따로 두지 않았고, 손가락으로
         누르는 자리는 넓을수록 좋습니다.
         **키보드로도 같은 자리가 열려야 합니다** — 이 서비스는 마우스를 못 쓰는
         사람도 씁니다. 그래서 `role`·`tabIndex`·Enter·Space 를 함께 답니다 */
      {...(onPick
        ? {
            role: "button" as const,
            tabIndex: 0,
            onClick: onPick,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              // Space 는 기본이 스크롤입니다 — 누르는 자리에서는 막습니다
              e.preventDefault();
              onPick();
            },
          }
        : {})}
    >
      {/* 순번이 있으면 숫자, 없으면 상태 기호. **한 칸만 씁니다** —
          두 칸으로 나누면 어느 쪽이 순서인지가 더 헷갈립니다 (시안 설계 노트)

          ⚠️ 순번일 때는 **읽히는 글자**입니다 — `aria-hidden` 으로 덮어
          12.5px 하한을 피하지 마세요. 21px/11px 이던 것을 24px/12.5px 로
          올린 자리입니다 (ADR-032) */}
      <span
        {...(number === null ? { "aria-hidden": true } : {})}
        data-numeric={number === null ? undefined : true}
        className={`grid size-[24px] shrink-0 place-items-center rounded-full border text-[12.5px] font-[700] ${mark.cls}`}
      >
        {number === null ? mark.glyph : number}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-[14.5px] ${
            tone === "now" ? "font-[620] text-ink-1" : "text-ink-2"
          }`}
        >
          {step.title}
        </span>
        {step.conditional && (
          <span className="block text-[12.5px] text-ink-3">{step.conditional}</span>
        )}
        {/* 완료를 판정한 것이 무엇인지 — 사용자 체크가 아니라 부산물입니다 */}
        {artifactLabel && (
          <span className="block text-[12.5px] text-ink-3">{artifactLabel}</span>
        )}
      </span>

      <span
        data-numeric
        className={`shrink-0 text-[12.5px] ${
          tone === "done"
            ? "text-pii"
            : tone === "now"
              ? "font-[620] text-deadline-urgent"
              : "text-ink-3"
        }`}
      >
        {/* D-day 가 태그 자리를 대신하는 것은 **`now` 에만** 해당합니다 */}
        {tone === "now" ? (deadlineLabel ?? tag) : tag}
      </span>
    </li>
  );
}

export interface PlanBoardProps {
  steps: readonly PlanStep[];
  /**
   * 단계를 눌렀을 때 — **워크스페이스를 그 단계로 옮깁니다.**
   *
   * 넘기지 않으면 줄이 눌리지 않습니다(버튼이 아니라 그냥 목록입니다).
   * **무엇을 열지는 이 모듈이 정하지 않습니다** — `work-handler` 의
   * `openStep` 이 정합니다 → ADR-023.
   */
  onPickStep?: (stepId: string) => void;
  /** 그 단계의 기한 문자열. 없으면 `null`. **서버가 준 값만** */
  deadlineFor?: (stepId: string) => string | null;
  /** 그 단계에 기한이 있는가 — `toneOf` 가 「언제든」을 가릅니다 */
  hasDeadline?: (stepId: string) => boolean;
  /** 그 단계의 부산물 한 줄. 「◆ 통화 접수번호」 */
  artifactFor?: (stepId: string) => string | null;
  /**
   * 그 단계 **뒤에** 끼워 넣을 것. 공고 대기 카드가 이 자리를 씁니다
   * (시안 「wait-card」 — 「단계 행 사이에 같은 폭으로」).
   *
   * **이 모듈이 무엇을 끼울지 고르지 않습니다** — 끼우는 것은 부르는 쪽의 판단이고,
   * 여기서 고르면 `plan-viewer` 가 기한·국면까지 알게 됩니다.
   */
  afterStep?: (stepId: string) => ReactNode;
}

/**
 * 단계 목록 한 덩어리 — 머리(할 일 + 순서 안내) · 목록 · 꼬리.
 *
 * **머리와 꼬리를 같이 가져온 이유**는 시안이 「할 일」과 순서 안내를 **한 줄**에
 * 두기 때문입니다. 목록만 모듈로 가져오면 그 줄이 화면에 남아, 번호가 하나도 없을 때도
 * 「번호가 붙은 것만 순서대로」가 뜹니다 — 사슬이 없으면 안 뜨는 것이 이 태스크의 요점입니다.
 */
export function PlanBoard({
  steps,
  deadlineFor,
  hasDeadline,
  artifactFor,
  afterStep,
  onPickStep,
}: PlanBoardProps) {
  const numbers = numberSteps(steps);
  const numbered = [...numbers.values()].some((n) => n !== null);

  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-[12.5px] tracking-[0.12em] text-ink-4">할 일</h3>
        {/* ⚠️ 세로 목록은 순서로 읽힙니다. 절반은 순서가 없으니 말로 밝힙니다.
            **번호가 하나도 없으면 이 줄도 없습니다** — 없는 순서를 광고하지 않습니다 */}
        {numbered && (
          <p className="text-[12.5px] leading-[1.5] text-ink-3">
            <b className="font-[620] text-ink-2">번호가 붙은 것만 순서대로</b>입니다. 나머지는{" "}
            <b className="font-[620] text-ink-2">순서와 상관없습니다.</b>
          </p>
        )}
      </div>

      <ul className="mt-2">
        {steps.map((s) => {
          const tone = toneOf(s, hasDeadline?.(s.step_id) ?? false);
          const after = afterStep?.(s.step_id);
          return (
            <Fragment key={s.step_id}>
              <StepRow
                step={s}
                tone={tone}
                tag={tagOf(s, tone)}
                number={numbers.get(s.step_id) ?? null}
                deadlineLabel={deadlineFor?.(s.step_id) ?? null}
                artifactLabel={artifactFor?.(s.step_id) ?? null}
                onPick={onPickStep ? () => onPickStep(s.step_id) : undefined}
              />
              {after && <li>{after}</li>}
            </Fragment>
          );
        })}
      </ul>

      <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">
        기한은 <b className="font-[620] text-ink-2">서버가 계산한 값</b>입니다. 화면이 날짜를
        세지 않습니다. 완료는 체크가 아니라 <b className="font-[620] text-ink-2">부산물(◆)</b>이
        판정합니다.
      </p>
    </section>
  );
}
