"use client";

import { QuestionButtons } from "@/modules/chat-handler";

import { FIXTURE_QUESTION } from "./fixtures";

/**
 * `focus: "chat"` 일 때의 본문 — S-06.
 *
 * 계약: spec/frontend/08-14-screens.md §S-06
 * 시안: assets/artifacts/handoff/08-19-s06-chat/ 「Chat S-06 Options」 1c
 *
 * 지켜야 할 것
 *  · **스트리밍하지 않습니다** (ADR-022). 근거 검증이 끝난 뒤 한 번에 나갑니다 —
 *    그 대가로 기다리는 동안 **무엇을 하는지 문장으로** 보여줍니다. 점 3개·타자기 금지
 *  · 질문은 한 번에 하나 · 전부 버튼 · 「기억이 안 나요」 상시 (F-05b).
 *    같은 크기·같은 자리에 두고 글자색만 ink-3
 *  · **T0 안전 절차는 여기 없습니다** — 왼쪽 고정 레일(`safety.tsx`)로 나갔습니다.
 *    본문 안에 두면 플랜·증거함으로 갈 때 같이 사라집니다 (ADR-036)
 *  · 화면이 보여주는 값은 **원문**입니다 (ADR-034). 토큰은 경계를 넘을 때의 형태입니다
 */


/** 서버(poll-checker)가 내준 값 그대로. **화면이 추측하지 않습니다** */
const PENDING_STEPS = [
  "진술을 확인했습니다 (간편송금 경로)",
  "맞는 절차를 대조하고 있습니다",
  "근거를 검증합니다. 출처 없는 문장은 나가지 않습니다",
] as const;

const step = (i: number) => ({ animationDelay: `${60 + i * 70}ms` });

export default function ChatView({
  atWork,
  onPickChoice,
}: {
  atWork: boolean;
  onPickChoice: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[700px] flex-1 flex-col">
      {/* 챗 스트림 */}
      <div className="flex flex-1 flex-col gap-3.5">
        <Bubble who="ai" i={0}>
          무슨 일이 있으셨는지 편하게 적어주세요. 문장이 아니어도 됩니다.
        </Bubble>
        <Bubble who="me" i={1}>
          아까 검찰이라면서 전화가 와서 3백만원을 보냈어요
        </Bubble>
        <Bubble who="ai" i={2}>
          <b className="font-[620] text-ink-1">300만원</b>을 보내셨군요. 밖으로 나갈 때는 이 값이
          가려진 채로만 나갑니다.
        </Bubble>

        {atWork ? (
          <>
            <Bubble who="ai" i={3}>
              접수 문자 잘 받았습니다. 다음은{" "}
              <b className="font-[620] text-ink-1">국민은행에 지급정지 요청</b>입니다. 전화로 하실
              수 있게 <b className="font-[620] text-ink-1">대본을 오른쪽에 준비했습니다.</b> 끊기
              전에 접수번호만 받아적으시면 됩니다.
            </Bubble>
            <Bubble who="me" i={4}>
              뭐라고 말해야 하죠?
            </Bubble>
            <Bubble who="ai" i={5}>
              오른쪽 대본을 그대로 읽으시면 됩니다. 계좌번호도 그대로 적혀 있으니 보고 읽으시면
              돼요.
            </Bubble>
          </>
        ) : (
          <>
            <Bubble who="ai" i={3}>
              바로 이어서 여쭐게요.{" "}
              <b className="font-[640] text-ink-1">돈이 어떻게 나갔나요?</b>
              <span className="mt-1.5 block text-[13px] text-ink-3">한 번에 하나만 여쭤봅니다</span>
            </Bubble>

            {/* 선택지는 `chat-handler` 가 그립니다 — 「모름」을 지우지 않는 것과
                「같은 크기·같은 자리, 글자색만」이 그쪽 규칙이기 때문입니다 (§3.4 · §S-06) */}
            <div style={step(4)} className="rise">
              <QuestionButtons question={FIXTURE_QUESTION} onPick={onPickChoice} />
            </div>
          </>
        )}
      </div>

      {/* 컴포저 — 포커스 링은 여기에만 */}
      <div className="mt-5 flex items-center gap-2 rounded-[14px] border border-[oklch(0.697_0.16_258.2/45%)] bg-surface px-[14px] shadow-[0_0_0_3px_oklch(0.697_0.16_258.2/10%)]">
        <input
          aria-label="진술 입력"
          placeholder={atWork ? "무엇이든 물어보세요" : "직접 적으셔도 됩니다"}
          className="min-h-[52px] flex-1 bg-transparent text-[14.5px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
        />
        {/* 원은 30px 그대로 두고 **히트 영역만** 44px 로 넓힙니다 — 크기를 키우면
            컴포저 밀도가 무너집니다 → design-system/08-16-components.md 「칩과 터치 목표」 */}
        <button
          type="button"
          data-hit
          aria-label="보내기"
          className="grid size-[30px] shrink-0 place-items-center rounded-full bg-ink-1 text-[14px] font-bold text-ground"
        >
          <span aria-hidden>↑</span>
        </button>
      </div>
    </div>
  );
}

/* ── 말풍선 ─────────────────────────────────────────────────── */

export function Bubble({
  who,
  i,
  children,
}: {
  who: "ai" | "me";
  i: number;
  children: React.ReactNode;
}) {
  const mine = who === "me";
  return (
    <div
      style={step(i)}
      className={`rise max-w-[78%] rounded-[15px] px-[15px] py-[11px] text-[14.5px] leading-[1.65] ${
        mine
          ? "ml-auto max-w-[68%] rounded-br-[5px] bg-[oklch(1_0_0/11%)] text-ink-1"
          : "rounded-bl-[5px] border border-hairline bg-surface text-ink-2"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * 응답 대기 — **스트리밍 금지(ADR-022)의 대가**입니다.
 * 점 3개·스켈레톤·타자기를 쓰지 않고 **무엇을 하는지 문장으로** 말합니다.
 * 값은 서버(poll-checker)가 내준 것 그대로이고, 화면이 단계를 추측하지 않습니다.
 *
 * TODO(연결): poll-checker 응답이 붙으면 currentIndex 를 그 값으로 바꿉니다.
 */
export function PendingBubble({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="max-w-[78%] rounded-[15px] rounded-bl-[5px] border border-hairline bg-surface px-[15px] py-[11px]">
      <div className="flex items-center gap-2 text-[14.5px] text-ink-2">
        답변을 준비하고 있습니다. 검증이 끝나면 한 번에 보여드립니다
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
        />
      </div>
      <ul className="mt-2.5 grid gap-1.5">
        {PENDING_STEPS.map((label, i) => {
          const done = i < currentIndex;
          const now = i === currentIndex;
          return (
            <li
              key={label}
              className={`flex items-start gap-2 text-[13px] leading-[1.6] ${
                done ? "text-ink-3" : now ? "text-ink-1" : "text-ink-3 opacity-55"
              }`}
            >
              <span aria-hidden className="mt-[3px] shrink-0 text-pii">
                {done ? "✓" : now ? "◉" : "○"}
              </span>
              {label}
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[12.5px] text-ink-3">
        이 단계는 서버가 알려준 그대로입니다. 화면이 추측하지 않습니다
      </p>
    </div>
  );
}

/**
 * 미니 챗 — 본문이 플랜·증거함일 때 오른쪽 열 **아래쪽**에 앉는 대응 비서.
 *
 * 흡수 모션의 **착지점**입니다. 축소된 사본을 남기는 게 아니라 **자연 크기의
 * 진짜 폼**이고, 원본 챗이 사라지는 자리에서 교차로 이어받습니다
 * (`absorb.ts` 의 `CROSSFADE`).
 */
export function MiniChat() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2.5 text-[12.5px] tracking-[0.12em] text-ink-4">대응 비서</div>
      <div className="grid flex-1 content-start gap-2">
        <p className="rounded-[13px] rounded-bl-[4px] border border-hairline bg-surface px-3 py-2.5 text-[13px] leading-[1.55] text-ink-2">
          다음은 <b className="font-[640] text-ink-1">피해구제 신청</b>입니다.{" "}
          <b className="font-[640] text-deadline-urgent">8월 20일</b>까지요.
        </p>
        <p className="ml-auto rounded-[13px] rounded-br-[4px] bg-[oklch(1_0_0/11%)] px-3 py-2.5 text-[13px] text-ink-1">
          뭐부터 하면 돼요?
        </p>
      </div>
      <div className="mt-2.5 flex items-center gap-2 rounded-[12px] border border-[oklch(0.697_0.16_258.2/45%)] bg-surface px-3 shadow-[0_0_0_3px_oklch(0.697_0.16_258.2/10%)]">
        {/* 입력칸은 히트 영역이 아니라 **실제 높이**가 44px 여야 합니다 —
            눌러서 끝이 아니라 그 안에 커서를 두고 타이핑하는 자리입니다 */}
        <input
          aria-label="대응 비서에게 묻기"
          placeholder="무엇이든 물어보세요"
          className="min-h-[var(--size-touch)] min-w-0 flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
        />
        <button
          type="button"
          data-hit
          aria-label="보내기"
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-ink-1 text-[12px] font-bold text-ground"
        >
          <span aria-hidden>↑</span>
        </button>
      </div>
    </div>
  );
}
