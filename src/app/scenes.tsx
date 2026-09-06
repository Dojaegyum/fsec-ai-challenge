"use client";

import { FIXTURE_DEADLINES, FIXTURE_EVIDENCE, FIXTURE_MAPPINGS, FIXTURE_PLAN, FIXTURE_QUESTION, FIXTURE_SLOTS } from "./c/[token]/fixtures";
import ChatView from "./c/[token]/chat";
import DocGuide from "./c/[token]/doc";
import EvidenceView from "./c/[token]/evidence";
import { useChatSend } from "./c/[token]/send";
import TodoRail from "./c/[token]/todo";
import { useUploads } from "./c/[token]/upload";
import { currentStep } from "@/modules/work-handler";
import type { PlanStep as WorkStep } from "@/modules/work-handler";

/**
 * S-04 랜딩 ③ 「화면 소개」 — **실제 화면 컴포넌트를 그림의 자격으로 세웁니다.**
 *
 * 계약: spec/frontend/08-14-screens.md §S-04 「스크롤 네 마디」 ③
 * 근거: ADR-029(스크롤 허용 · 행동은 하나 · ③은 기능 목록이 아니다)
 *
 * 2026-09-06 까지 이 자리는 와이어프레임 장식이었습니다(`page.tsx` 의 `wireBar`).
 * 화면이 다 서고 나서 **같은 컴포넌트를 픽스처로 그립니다** — `?view=` 개발 경로가
 * 하는 것과 같은 배선입니다(`c/[token]/page.tsx`). 스크린샷을 찍어 두면 화면이
 * 바뀔 때마다 낡는데, 컴포넌트를 그대로 쓰면 랜딩이 제품과 늘 같은 얼굴입니다.
 *
 * 지켜야 할 것
 *  · **눌리지 않습니다.** 프레임이 `inert` 라 안쪽 버튼·입력은 탭 순서에도 접근성
 *    트리에도 없습니다. 랜딩의 행동은 여전히 [지금 시작하기] 하나입니다 (ADR-029 ①)
 *  · **설명은 한 줄.** 라벨 · 제목 · 캡션 한 문단. 늘리면 그 순간 「기능 목록」입니다 (ADR-029 ②)
 *  · **값은 픽스처 그대로.** 전부 예시이고 새 값을 짓지 않습니다 (`fixtures.ts` 머리말)
 *  · **등장 계단을 끕니다.** 아래쪽 마디라 내려왔을 때는 이미 끝나 있어야 합니다.
 *    `.rise` 는 `both` 라 애니메이션을 끄면 끝 상태(보임)로 섭니다
 *
 * 서버를 부르지 않습니다 — `useChatSend(null)`·`useUploads(null)` 은 토큰이 없으면
 * 효과에서 곧장 돌아갑니다. 서버 렌더에서도 픽스처만으로 완성된 HTML 이 나옵니다.
 */

/**
 * 460px — 챗 장면에서 말풍선 셋 · 되묻기 문항 · 선택지 버튼까지 다 보이는 높이입니다.
 * `[&_.sticky]:static` 은 챗 컴포저 때문입니다. 제품에서는 바닥에 붙어 따라오는데,
 * 잘라낸 프레임 안에서는 그 자리가 **선택지 버튼을 덮습니다** — 흐름대로 놓고 아랫단
 * 페이드에 맡깁니다. 다른 장면에도 걸리지만 잘린 프레임 안에서는 같은 이유로 맞습니다.
 */
const SCENE_FRAME =
  "relative flex h-[460px] flex-col overflow-hidden border-b border-hairline bg-ground p-4 select-none " +
  "[&_.rise]:animate-none [&_.bloom]:animate-none [&_.sticky]:static";

export default function LandingScenes() {
  // `?view=` 개발 경로와 같은 배선 — 토큰이 `null` 이면 서버를 부르지 않고 픽스처로 그립니다
  const chat = useChatSend(null, FIXTURE_QUESTION);
  const uploads = useUploads(null, FIXTURE_EVIDENCE.files);
  const steps = FIXTURE_PLAN.steps;
  // 셸이 하는 것과 같게 「앞선 열린 단계」를 강조합니다 — 레일은 스스로 고르지 않습니다
  const active = currentStep(steps as unknown as WorkStep[])?.step_id ?? null;

  return (
    <div className="mt-6 grid gap-4 md:grid-cols-2">
      <Scene
        id="chat"
        label="챗"
        title="진술로 절차를 고릅니다"
        caption="질문은 한 번에 하나, 전부 버튼. 「모름」도 항상 답입니다."
      >
        <ChatView atWork={false} token={null} chat={chat} onPickChoice={() => undefined} />
      </Scene>

      <Scene
        id="todo"
        label="할 일"
        title="지금 뭘 해야 하나"
        caption="며칠 뒤에 열어도 첫 줄이 답합니다. 기한은 서버가 셉니다."
      >
        {/* 제품에서는 330px 레일에 삽니다 — 카드 폭에 맞춰 늘리지 않습니다 */}
        <div className="mx-auto w-full max-w-[380px]">
          <TodoRail steps={steps} deadlines={FIXTURE_DEADLINES.deadlines} activeStepId={active} />
        </div>
      </Scene>

      <Scene
        id="evidence"
        label="증거함"
        title="가려지는 게 보입니다"
        caption="가려진 값은 이 기기에서만 풀립니다. 밖으로는 토큰만 나갑니다."
      >
        {/* 개발 갤러리 — 서버를 안 부르므로 조회 상태는 「아직 안 물음」이고 픽스처로 그립니다 */}
        <EvidenceView token={null} uploads={uploads} server={{ phase: "loading" }} again={() => {}} />
      </Scene>

      <Scene
        id="doc"
        label="서류"
        title="칸마다 짚어 드립니다"
        caption="무엇을 어디에 적는지 값과 함께. 받은 통지도 읽어드립니다."
      >
        {/* 「서류를 만들어 드립니다」라고 쓰지 않습니다 — 칸과 값을 짝지어 보여주는 것까지입니다 (ADR-037) */}
        <DocGuide slots={FIXTURE_SLOTS} restorable={FIXTURE_MAPPINGS} />
      </Scene>
    </div>
  );
}

function Scene({
  id,
  label,
  title,
  caption,
  children,
}: {
  id: "chat" | "todo" | "evidence" | "doc";
  label: string;
  title: string;
  /** 한 줄. 두 문장이 되더라도 문단은 하나입니다 (ADR-029 ②) */
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <article
      data-scene={id}
      className="overflow-hidden rounded-[14px] border border-hairline bg-surface-low"
    >
      {/* 그림 자리 — `inert` 가 안쪽 상호작용을 통째로 끕니다. 스크린샷과 같은 자격입니다 */}
      <div data-scene-frame inert aria-hidden className={SCENE_FRAME}>
        {children}
        {/* 잘린 아랫단은 카드 바닥색으로 사그라듭니다 — 끊긴 것이 아니라 이어지는 것으로 읽히게 */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 [background:linear-gradient(to_top,var(--surface-low),transparent)]" />
      </div>
      <div className="px-[18px] pt-[15px] pb-[17px]">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-[660] text-pii">{label}</span>
          <h3 className="text-[15px] font-[640] text-ink-1">{title}</h3>
        </div>
        <p data-scene-caption className="mt-1.5 text-[13px] leading-[1.6] text-ink-3">
          {caption}
        </p>
      </div>
    </article>
  );
}
