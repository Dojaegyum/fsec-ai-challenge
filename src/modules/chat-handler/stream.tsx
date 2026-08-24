"use client";

import { useState } from "react";

import { isDontKnow } from "./turn";
import type { NextQuestion, PiiConfirm, Turn } from "./types";

/**
 * 답변 한 덩어리.
 *
 * **인용 번호가 아니라 매뉴얼 이름**만 밝힙니다 — 판단 근거(`why`)는 여기 오지 않습니다
 * (ADR-022 결정 셋).
 */
export function AnswerBubble({ turn }: { turn: Turn }) {
  return (
    <div className="max-w-[46ch] rounded-[14px] rounded-bl-[5px] bg-surface p-3.5">
      <p className="text-[15px] leading-[1.75] text-ink-1">{turn.reply}</p>
      {turn.sourceNote && (
        <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-4">
          {turn.sourceNote}을 보고 안내했습니다
        </p>
      )}
    </div>
  );
}

/**
 * 슬롯 질문 — **한 번에 하나, 전부 버튼, 기본 선택 없음** (§S-06 · §3.4).
 *
 * **`options` 를 걸러내지 마세요.** 「모름」이 항상 들어 있고, 없으면 그건
 * **서버 쪽 스펙 위반**입니다 — 화면이 대신 채우면 그 위반이 가려집니다.
 */
export function QuestionButtons({
  question,
  onAnswer,
  onSkip,
  busy = false,
}: {
  question: NextQuestion;
  /** 값으로 답한다 → `PATCH {action:"answer"}` */
  onAnswer?: (value: string) => void;
  /** 「모름」 → `PATCH {action:"unknown"}`. **실패가 아니라 상태입니다** */
  onSkip?: () => void;
  busy?: boolean;
}) {
  if (question.input !== "buttons" || !question.options) return null;

  return (
    <div
      className="grid gap-2 md:grid-cols-2"
      role="radiogroup"
      aria-label={question.text}
    >
      {question.options.map((option) => {
        // **가르는 자리가 하나입니다** — 색과 보내는 `action` 이 같은 판정을 씁니다
        const skip = isDontKnow(option);
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={false}
            disabled={busy}
            onClick={() => (skip ? onSkip?.() : onAnswer?.(option))}
            className={`flex min-h-[48px] items-center gap-2.5 rounded-[12px] border border-hairline bg-chip px-[14px] py-[11px] text-left text-[14.5px] transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] disabled:opacity-45 ${
              skip ? "text-ink-3" : "text-ink-2"
            }`}
          >
            <span aria-hidden className="shrink-0 text-[18px] text-icon">
              ○
            </span>
            {option}
          </button>
        );
      })}
    </div>
  );
}

/** `input` 넷 중 버튼이 아닌 셋 → §3.4 */
const FIELD_KIND: Readonly<Record<string, { type: string; hint: string }>> = {
  text: { type: "text", hint: "적어 주세요" },
  date: { type: "date", hint: "날짜를 골라 주세요" },
  amount: { type: "text", hint: "숫자만 적으셔도 됩니다" },
};

/**
 * 버튼으로 못 받는 질문 — `text`·`date`·`amount` (§3.4).
 *
 * ⬜ **§S-06 은 「전부 버튼」이라고 적혀 있습니다.** 그런데 §3.4 의 `input` 은 넷이라
 * 나머지 셋이 오면 그릴 것이 없습니다. **안 그리면 그 질문이 영영 안 끝나고**
 * 같은 질문이 계속 돌아옵니다 — 그래서 그립니다. 어느 쪽이 정본인지는 사람이 정합니다.
 *
 * **「모름」은 여기에도 있습니다** (F-05b · 불변 규칙 5). 버튼 질문에서만 있고
 * 타이핑 질문에서 사라지면, 답을 모르는 사람이 그 자리에서 막힙니다.
 */
export function QuestionField({
  question,
  onAnswer,
  onSkip,
  busy = false,
}: {
  question: NextQuestion;
  onAnswer?: (value: string) => void;
  onSkip?: () => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const kind = FIELD_KIND[question.input];
  if (!kind) return null;

  const send = () => {
    const value = draft.trim();
    if (busy || value.length === 0) return;
    onAnswer?.(value);
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2 rounded-[12px] border border-hairline bg-chip px-[14px]">
        <input
          aria-label={question.text}
          type={kind.type}
          {...(question.input === "amount"
            ? { inputMode: "numeric" as const, "data-numeric": true }
            : {})}
          value={draft}
          disabled={busy}
          placeholder={kind.hint}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 조합 중(한글 입력)에 Enter 를 먹으면 마지막 글자가 잘립니다
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          className="min-h-[48px] flex-1 bg-transparent text-[14.5px] text-ink-1 placeholder:text-ink-4 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          data-hit
          onClick={send}
          disabled={busy || draft.trim().length === 0}
          className="shrink-0 rounded-full bg-ink-1 px-3 py-1.5 text-[13px] font-[620] text-ground disabled:opacity-40"
        >
          답하기
        </button>
      </div>
      {/* **같은 크기·같은 자리, 글자색만** — 버튼 질문과 같은 규칙입니다 (§S-06) */}
      <button
        type="button"
        disabled={busy}
        onClick={() => onSkip?.()}
        className="flex min-h-[48px] items-center gap-2.5 rounded-[12px] border border-hairline bg-chip px-[14px] py-[11px] text-left text-[14.5px] text-ink-3 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] disabled:opacity-45"
      >
        <span aria-hidden className="shrink-0 text-[18px] text-icon">
          ○
        </span>
        기억이 안 나요
      </button>
    </div>
  );
}

/**
 * 되묻기 — **거부가 아니라 확인**입니다 (ADR-041 · §3.5).
 *
 * 문구(`text`·`note`)와 선택지 라벨은 **서버가 준 것**을 그대로 씁니다. 화면이
 * 다시 적으면 「토큰·마스킹」 같은 말이 새어 들어옵니다.
 *
 * ⚠️ **`found[].text` 를 그리지 않습니다** — 그건 서버가 붙인 이름표(`[이름-1]`)라
 * 사용자에게는 뜻이 없습니다. 대신 **사용자가 적은 값**을 그대로 보여줍니다
 * (ADR-034 「화면은 원문」).
 */
export function PiiConfirmCard({
  confirm,
  typed,
  onPick,
  busy = false,
}: {
  confirm: PiiConfirm;
  /** 사용자가 적은 값 — 브라우저에 있는 원문입니다 */
  typed: string;
  onPick?: (id: "mask" | "keep") => void;
  busy?: boolean;
}) {
  const kinds = [...new Set(confirm.found.map((one) => one.kind))].filter(
    (kind) => kind.length > 0,
  );

  return (
    <div className="rounded-[13px] border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/7%)] p-[13px_15px]">
      <p className="text-[14px] leading-[1.65] text-ink-1">{confirm.text}</p>
      {typed.length > 0 && (
        <p className="mt-2 rounded-[9px] bg-[oklch(1_0_0/6%)] px-2.5 py-2 text-[14px] text-pii">
          {typed}
        </p>
      )}
      {kinds.length > 0 && (
        <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">
          {kinds.join(" · ")}(으)로 보입니다.
        </p>
      )}
      <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-3">{confirm.note}</p>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {confirm.options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={busy}
            onClick={() => onPick?.(option.id)}
            className="flex min-h-[48px] items-center gap-2.5 rounded-[12px] border border-hairline bg-chip px-[14px] py-[11px] text-left text-[14.5px] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] disabled:opacity-45"
          >
            <span aria-hidden className="shrink-0 text-[18px] text-icon">
              ○
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
