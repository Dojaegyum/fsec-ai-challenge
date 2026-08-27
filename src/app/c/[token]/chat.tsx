"use client";

import { useState } from "react";

import {
  AnswerBubble,
  PiiConfirmCard,
  QuestionButtons,
  QuestionField,
} from "@/modules/chat-handler";

import type { ChatSend } from "./send";

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
 *
 * ## 나가는 것은 `send.ts` 를 지납니다
 *
 * 컴포저가 `fetch` 를 직접 부르지 않습니다. **원문을 네트워크에 태우는 경로를
 * 여기 만들지 마세요** — 불변 규칙 2 입니다. 순서(볼트 먼저, 발화 나중)도 그쪽에
 * 있습니다.
 *
 * `token` 이 `null` 이면 **서버를 부르지 않고 예시 대화를 그립니다** (`?view=` 개발 경로).
 *
 * ## 지난 대화를 되살립니다 → ADR-050
 *
 * 첫 로드에 볼트를 열고(§3.11 `GET`) 그 매핑으로 이력을 되살립니다(§3.12).
 * **가족이 링크를 받아 열면 열쇠가 없어** `[계좌-1]` 이 그대로 보이는데,
 * 그게 맞는 동작이라 **화면이 그 이유를 말합니다.**
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
  token,
  chat,
  onPickChoice,
}: {
  atWork: boolean;
  /** 사건 링크 토큰. `null` 이면 개발 경로라 서버를 안 부릅니다 */
  token: string | null;
  /** 대화 한 벌. **셸이 들고 있습니다** — 유령까지 같은 것을 봐야 합니다 */
  chat: ChatSend;
  onPickChoice: () => void;
}) {
  const { lines, sending, fail, send, loading, truncated, locked, ask } = chat;
  const [draft, setDraft] = useState("");
  const dev = token === null;
  const question = ask.question;

  /** 답하면 오른쪽 열이 할 일 패널로 넘어갑니다 — 보내기 전에 옮기지 않습니다 */
  const answer = (value: string) => void ask.answer(value).then(onPickChoice);
  const skip = () => void ask.skip().then(onPickChoice);

  const submit = () => {
    if (dev || sending) return;
    // **보낸 것이 확인되면 그때 비웁니다.** 실패했는데 지우면 사용자가 방금 쓴
    // 글을 통째로 다시 타이핑해야 합니다
    void send(draft).then((ok) => {
      if (ok) setDraft("");
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-[700px] flex-1 flex-col">
      {/* 챗 스트림 */}
      <div className="flex flex-1 flex-col gap-3.5">
        {dev ? (
          <DemoStream atWork={atWork} />
        ) : (
          <>
            {/* 지난 대화를 읽는 중 — 볼트를 먼저 열고 그 매핑으로 되살립니다
                (ADR-050). 스켈레톤을 쓰지 않고 무엇을 하는지 말합니다 */}
            {loading && (
              <p className="flex items-center gap-2 text-[13px] text-ink-3">
                지난 대화를 불러오고 있습니다
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                />
              </p>
            )}

            {/* **열쇠가 없는 기기입니다** — 가족이 링크를 받아 연 경우입니다.
                아무 말 없이 `[계좌-1]` 이 보이면 고장으로 읽힙니다 (ADR-050) */}
            {locked && (
              <div className="rounded-[13px] border border-hairline bg-surface p-[13px_15px]">
                <p className="text-[13.5px] leading-[1.65] text-ink-2">
                  <b className="font-[620] text-ink-1">이 기기에는 여는 열쇠가 없습니다.</b>{" "}
                  계좌번호·이름은 <b className="font-[620] text-pii">[계좌-1]</b> 처럼 가려진
                  채로 보입니다 — 절차와 기한은 그대로 보입니다.
                </p>
                <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-3">
                  열쇠는 처음 시작한 기기에만 있습니다. 그래야 링크가 새어도 그 값들이
                  함께 새지 않습니다.
                </p>
              </div>
            )}

            {/* 앞부분이 잘렸으면 **말합니다** — 조용히 자르면 사용자는 대화가
                그것뿐이었다고 읽습니다 (§3.12) */}
            {truncated && (
              <p className="text-[12.5px] text-ink-3">
                앞부분은 줄였습니다. 최근 대화만 보여드립니다.
              </p>
            )}

            {!loading && lines.length === 0 && (
              <Bubble who="ai" i={0}>
                무슨 일이 있으셨는지 편하게 적어주세요. 문장이 아니어도 됩니다.
              </Bubble>
            )}

            {lines.map((line, i) =>
              line.who === "me" ? (
                /* **원문 그대로입니다** — 나간 것은 가려진 형태였습니다 (ADR-034) */
                <Bubble key={"me-" + i} who="me" i={i}>
                  {line.text}
                </Bubble>
              ) : (
                /* 근거 한 줄은 `chat-handler` 가 답니다 — `kb-` 만 세는 것이
                   그쪽 규칙입니다 (§3.9) */
                <div key={line.message_id} style={step(i)} className="rise">
                  <AnswerBubble turn={line} />
                </div>
              ),
            )}

            {/* 기다리는 동안 **무엇을 하는지 문장으로** — 스트리밍을 안 쓰는 대가입니다 */}
            {sending && <PendingBubble currentIndex={1} />}
          </>
        )}

        {/* 실패는 앰버 카드로. **스스로 다시 보내지 않습니다** — 못 보낸 글은
            입력칸에 그대로 남아 있고, 누르는 것은 사용자입니다 (에러 §3.1) */}
        {fail && (
          <div
            role="alert"
            className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[13px_15px]"
          >
            <p className="text-[13.5px] leading-[1.6] text-ink-1">{fail.fail.message}</p>
            {fail.stage === "vault" && (
              <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-3">
                <b className="font-[620] text-ink-2">발화는 보내지 않았습니다.</b> 가린 값을 이
                기기에서 풀 수 있게 맡겨 두는 것이 먼저라, 그게 안 되면 보내지 않습니다.
              </p>
            )}
            {fail.fail.retryAfterSec !== undefined && (
              <p data-numeric className="mt-1.5 text-[12.5px] text-deadline-urgent">
                {fail.fail.retryAfterSec}초 뒤 다시 보낼 수 있습니다
              </p>
            )}
          </div>
        )}

        {/* 질문은 스트림 맨 아래에 붙습니다 — 한 번에 하나 (§3.4 · §S-06).
            **`atWork` 로 가리지 않습니다** — 그 조건이 프로덕션에서 문진을 통째로
            지우고 있었습니다 (`QuestionBlock` 머리말) */}
        {!sending && <QuestionBlock ask={ask} onAnswered={onPickChoice} i={lines.length} />}
      </div>

      {/* 컴포저 — 포커스 링은 여기에만 */}
      <div className="mt-5 flex items-center gap-2 rounded-[14px] border border-[oklch(0.697_0.16_258.2/45%)] bg-surface px-[14px] shadow-[0_0_0_3px_oklch(0.697_0.16_258.2/10%)]">
        <input
          aria-label="진술 입력"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 조합 중(한글 입력)에 Enter 를 먹으면 마지막 글자가 잘립니다
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          disabled={dev || sending}
          placeholder={
            dev
              ? "예시 화면입니다"
              : sending
                ? "보내는 중입니다"
                : atWork
                  ? "무엇이든 물어보세요"
                  : "직접 적으셔도 됩니다"
          }
          className="min-h-[52px] flex-1 bg-transparent text-[14.5px] text-ink-1 placeholder:text-ink-4 focus:outline-none disabled:cursor-not-allowed"
        />
        {/* 원은 30px 그대로 두고 **히트 영역만** 44px 로 넓힙니다 — 크기를 키우면
            컴포저 밀도가 무너집니다 → design-system/08-16-components.md 「칩과 터치 목표」 */}
        <button
          type="button"
          data-hit
          aria-label="보내기"
          onClick={submit}
          disabled={dev || sending || draft.trim().length === 0}
          className="grid size-[30px] shrink-0 place-items-center rounded-full bg-ink-1 text-[14px] font-bold text-ground disabled:opacity-40"
        >
          <span aria-hidden>↑</span>
        </button>
      </div>
    </div>
  );
}

/**
 * `?view=` 개발 경로가 그리는 예시 대화.
 *
 * **제품 경로가 아닙니다.** 시연·스크린샷에 사건을 DB 에 심어 둘 필요를 없애는
 * 자리이고, 실제 대화는 위의 `lines` 가 그립니다.
 */
function DemoStream({ atWork }: { atWork: boolean }) {
  return (
    <>
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

      {atWork && (
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
      )}
    </>
  );
}

/* ── 말풍선 ─────────────────────────────────────────────────── */

/**
 * 문진 한 문항 — **챗 본문과 오른쪽 미니 챗이 같은 것을 그립니다.**
 *
 * 계약: spec/common/08-14-api.md §3.4 · spec/frontend/08-14-screens.md §S-06
 *
 * ⚠️ **2026-08-27 까지 이 자리가 `!atWork` 로 막혀 있었습니다.** 워크스페이스가
 * 열려 있으면 문항을 통째로 안 그렸는데, 그건 목업 시절 「작업 중이면 다른 대사를
 * 보여준다」는 연출 분기가 조건만 남은 것이었습니다. 계약 어디에도 「워크스페이스가
 * 열리면 문진을 감춘다」는 말이 없습니다.
 *
 * **그 조건 하나 때문에 프로덕션에서 문진이 한 번도 안 그려졌습니다** — 사건은
 * 만들어지자마자 T0 단계가 붙어 언제나 워크스페이스가 열린 채로 열리기 때문입니다
 * (`case-opener` 의 `side`). 서버는 `next_question` 을 제대로 내고 있었습니다.
 *
 * 두 곳이 같은 컴포넌트를 쓰는 것이 중요합니다 — 갈라 적으면 한쪽만 「모름」을
 * 빠뜨려도 화면은 멀쩡해 보입니다.
 */
export function QuestionBlock({
  ask,
  /** 답한 뒤 셸이 할 일. 미니 챗에서는 옮길 곳이 없어 아무것도 안 합니다 */
  onAnswered,
  /** 계단 등장의 순번 */
  i,
}: {
  ask: ChatSend["ask"];
  onAnswered: () => void;
  i: number;
}) {
  const question = ask.question;
  if (!question) return null;

  const answer = (value: string) => void ask.answer(value).then(onAnswered);
  const skip = () => void ask.skip().then(onAnswered);

  return (
    <>
      <>
        {/* 질문 문구도 서버가 준 것입니다 — 화면이 다시 적지 않습니다 (§3.4) */}
        <Bubble who="ai" i={i}>
          바로 이어서 여쭐게요. <b className="font-[640] text-ink-1">{question.text}</b>
          <span className="mt-1.5 block text-[13px] text-ink-3">
            한 번에 하나만 여쭤봅니다
          </span>
        </Bubble>

        {/* 답을 못 보냈을 때. **스스로 다시 보내지 않습니다** — 고른 것은
            그대로 있고 누르는 것은 사용자입니다 (에러 §3.1) */}
        {ask.fail && (
          <div
            role="alert"
            className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[13px_15px]"
          >
            <p className="text-[13.5px] leading-[1.6] text-ink-1">{ask.fail.fail.message}</p>
            {ask.fail.stage === "vault" && (
              <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-3">
                <b className="font-[620] text-ink-2">답은 보내지 않았습니다.</b> 가린 값을 이
                기기에서 풀 수 있게 맡겨 두는 것이 먼저라, 그게 안 되면 보내지 않습니다.
              </p>
            )}
          </div>
        )}

        {/* 되묻기가 오면 **선택지 대신** 이 카드입니다 — 아직 답한 것이
            아니라서입니다 (ADR-041 · §3.5) */}
        <div style={step(i + 1)} className="rise">
          {ask.confirm ? (
            <PiiConfirmCard
              confirm={ask.confirm.card}
              typed={ask.confirm.typed}
              busy={ask.busy}
              onPick={(id) => void ask.resolve(id).then(onAnswered)}
            />
          ) : (
            <>
              {/* 선택지는 `chat-handler` 가 그립니다 — 「모름」을 지우지 않는 것과
                  「같은 크기·같은 자리, 글자색만」이 그쪽 규칙이기 때문입니다 (§3.4 · §S-06).
                  **어느 것이 「모름」인지도 그쪽이 가릅니다** — 색과 `action` 이
                  같은 판정을 써야 합니다 */}
              <QuestionButtons
                question={question}
                onAnswer={answer}
                onSkip={skip}
                busy={ask.busy}
              />
              <QuestionField
                question={question}
                onAnswer={answer}
                onSkip={skip}
                busy={ask.busy}
              />
            </>
          )}
        </div>
      </>
    </>
  );
}

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
export function MiniChat({
  chat,
  token,
}: {
  /** **셸이 들고 있는 그 한 벌입니다** — 위 컴포저와 같은 것을 봐야 합니다 */
  chat: ChatSend;
  /** `null` 이면 개발 경로라 서버를 안 부릅니다 */
  token: string | null;
}) {
  const { lines, sending, fail, send } = chat;
  const [draft, setDraft] = useState("");
  const dev = token === null;

  const submit = () => {
    if (dev || sending) return;
    // 위 컴포저와 **같은 규칙** — 보낸 것이 확인되면 그때 비웁니다
    void send(draft).then((ok) => {
      if (ok) setDraft("");
    });
  };

  // **좁은 자리라 최근 것만** 보여줍니다. 전부는 「대화」로 넘어가면 있습니다
  const recent = lines.slice(-4);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2.5 text-[12.5px] tracking-[0.12em] text-ink-4">대응 비서</div>
      <div className="grid min-h-0 flex-1 content-start gap-2 overflow-y-auto">
        {recent.length === 0 && (
          <p className="rounded-[13px] rounded-bl-[4px] border border-hairline bg-surface px-3 py-2.5 text-[13px] leading-[1.55] text-ink-2">
            궁금한 것을 여기서 바로 물어보셔도 됩니다.
          </p>
        )}
        {recent.map((line, i) =>
          line.who === "me" ? (
            /* **원문 그대로입니다** — 나간 것은 가려진 형태였습니다 (ADR-034) */
            <p
              key={"me-" + i}
              className="ml-auto max-w-[85%] rounded-[13px] rounded-br-[4px] bg-[oklch(1_0_0/11%)] px-3 py-2.5 text-[13px] text-ink-1"
            >
              {line.text}
            </p>
          ) : (
            /* **근거를 떼고 보여주지 않습니다.** 좁다고 인용을 지우면 답만 남습니다 */
            <div
              key={line.message_id}
              className="rounded-[13px] rounded-bl-[4px] border border-hairline bg-surface px-3 py-2.5"
            >
              <p className="text-[13px] leading-[1.55] text-ink-2">{line.reply}</p>
              {line.sourceNote && (
                <p className="mt-1.5 text-[11.5px] leading-[1.5] text-ink-4">
                  {line.sourceNote}을 보고 안내했습니다
                </p>
              )}
            </div>
          ),
        )}
        {/* 스트리밍을 안 쓰는 대가 — 기다리는 동안 무엇을 하는지 말합니다 (ADR-022) */}
        {sending && (
          <p className="rounded-[13px] rounded-bl-[4px] border border-hairline bg-surface px-3 py-2.5 text-[13px] text-ink-3">
            근거를 찾아보고 있습니다
          </p>
        )}
        {/* **문항도 여기 뜹니다** — 본문 챗과 **같은 것**을 그립니다.
            사건은 언제나 플랜으로 열리므로(`case-opener`) 이 자리가 실사건
            사용자가 문진을 보는 곳입니다 */}
        {!sending && <QuestionBlock ask={chat.ask} onAnswered={() => undefined} i={recent.length} />}

        {/* **스스로 다시 보내지 않습니다** — 못 보낸 글은 입력칸에 남아 있습니다 (에러 §3.1) */}
        {fail && (
          <p
            role="alert"
            className="rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2.5 text-[12.5px] leading-[1.55] text-ink-1"
          >
            {fail.fail.message}
          </p>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2 rounded-[12px] border border-[oklch(0.697_0.16_258.2/45%)] bg-surface px-3 shadow-[0_0_0_3px_oklch(0.697_0.16_258.2/10%)]">
        {/* 입력칸은 히트 영역이 아니라 **실제 높이**가 44px 여야 합니다 —
            눌러서 끝이 아니라 그 안에 커서를 두고 타이핑하는 자리입니다 */}
        <input
          aria-label="대응 비서에게 묻기"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // 조합 중(한글 입력)에 Enter 를 먹으면 마지막 글자가 잘립니다
            if (e.key === "Enter" && !e.nativeEvent.isComposing) submit();
          }}
          disabled={dev || sending}
          placeholder={dev ? "예시 화면입니다" : sending ? "보내는 중입니다" : "무엇이든 물어보세요"}
          className="min-h-[var(--size-touch)] min-w-0 flex-1 bg-transparent text-[13px] text-ink-1 placeholder:text-ink-4 focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          data-hit
          aria-label="보내기"
          onClick={submit}
          disabled={dev || sending || draft.trim().length === 0}
          className="grid size-[26px] shrink-0 place-items-center rounded-full bg-ink-1 text-[12px] font-bold text-ground disabled:opacity-40"
        >
          <span aria-hidden>↑</span>
        </button>
      </div>
    </div>
  );
}
