"use client";

import type { NextQuestion, Turn } from "./types";

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
 * 「모름」 선택지인가 — **글자색만 내리는 자리**입니다 (§S-06 「같은 크기·같은 자리」).
 *
 * ⬜ **계약에 표시가 없어 문구로 알아봅니다.** §3.4 의 `options` 는 문자열 배열이라
 * 「어느 것이 모름인가」를 담을 칸이 없습니다. 못 알아봐도 **선택지가 사라지지는
 * 않습니다** — 색만 같아집니다. 칸을 둘지는 사람이 정합니다.
 */
function isDontKnow(option: string): boolean {
  return option.includes("모름") || option.includes("기억");
}

/**
 * 슬롯 질문 — **한 번에 하나, 전부 버튼, 기본 선택 없음** (§S-06 · §3.4).
 *
 * **`options` 를 걸러내지 마세요.** 「모름」이 항상 들어 있고, 없으면 그건
 * **서버 쪽 스펙 위반**입니다 — 화면이 대신 채우면 그 위반이 가려집니다.
 */
export function QuestionButtons({
  question,
  onPick,
}: {
  question: NextQuestion;
  onPick?: (value: string) => void;
}) {
  if (question.input !== "buttons" || !question.options) return null;

  return (
    <div
      className="grid gap-2 md:grid-cols-2"
      role="radiogroup"
      aria-label={question.text}
    >
      {question.options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={false}
          onClick={() => onPick?.(option)}
          className={`flex min-h-[48px] items-center gap-2.5 rounded-[12px] border border-hairline bg-chip px-[14px] py-[11px] text-left text-[14.5px] transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] ${
            isDontKnow(option) ? "text-ink-3" : "text-ink-2"
          }`}
        >
          <span aria-hidden className="shrink-0 text-[18px] text-icon">
            ○
          </span>
          {option}
        </button>
      ))}
    </div>
  );
}
