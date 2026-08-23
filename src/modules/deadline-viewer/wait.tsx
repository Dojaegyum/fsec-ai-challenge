"use client";

import { dueLabel } from "./label";
import type { Deadline } from "./types";

export interface WaitCardProps {
  /** 공고의 만료 시점. `kind: "info"` 인 기한입니다 (§3.7) */
  deadline: Deadline;
  /**
   * 공고가 시작된 시점 (ISO).
   *
   * ⬜ **§3.7 에 없습니다.** 시안은 「진행 마커 위치까지 전부 서버 계산값」이라
   * 이 값도 서버가 줘야 합니다 → 계획 Task 1 과 같은 방식으로 올려 뒀습니다.
   */
  startAt: string;
  /**
   * 시작~만료 사이에서 지금이 어디인가. `0`~`1`.
   *
   * ⬜ **§3.7 에 없습니다.** 그리고 **화면이 만들 수 없습니다** —
   * 만들려면 기기 시계를 읽어야 하고, 그건 「화면이 날짜를 세지 않는다」 위반입니다.
   */
  progress: number;
  /** 통지·우편을 올리는 자리. 없으면 버튼을 그리지 않습니다 */
  onUpload?: () => void;
}

/**
 * 공고 대기 카드 — 시안 「wait-card」(2a).
 *
 * **단계 행 사이에 같은 폭으로 끼웁니다.** 1b 의 풀폭 진행 스트립(47%)은
 * 카운트다운으로 읽혀 폐기됐습니다.
 *
 * 이 카드가 지키는 것 셋:
 *  · **D-n·퍼센트를 쓰지 않습니다.** 두 달을 세면 매일 실망을 줍니다
 *  · **앰버를 쓰지 않습니다.** 사용자 기한이 아니라 제도가 흐르는 시간입니다
 *  · **보드를 비우지 않습니다.** 할 일이 없는 구간에도 「기다림이 정상」이라고 말합니다
 *
 * ⬜ 진행 막대의 `--horizon` 은 [tokens](../../../spec/frontend/design-system/08-16-tokens.md)에서
 * **「장식 전용 · 의미를 싣지 마세요」** 입니다. 시안이 **일부러 앰버를 피해** 고른 색이라
 * 이유는 타당하지만, 토큰의 뜻을 넓힐지는 사람이 정합니다. 그래서 막대와 점은
 * 전부 `aria-hidden` 이고, **뜻은 아래 글자 셋이 싣습니다.**
 */
export function WaitCard({ deadline, startAt, progress, onUpload }: WaitCardProps) {
  const endLabel = dueLabel(deadline);
  const startLabel = dueLabel({ ...deadline, due_at: startAt });
  const done = Math.min(1, Math.max(0, progress));

  return (
    <div className="my-2.5 rounded-[13px] border border-hairline bg-surface p-[15px_17px]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-[12.5px] text-ink-4">
          제도가 흐르는 시간 · 은행과 금융감독원이 진행합니다
        </p>
        {endLabel && (
          <span
            data-numeric
            className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-chip px-2.5 py-[3px] text-[12.5px] whitespace-nowrap text-ink-3"
          >
            공고 기간 · {endLabel}까지
          </span>
        )}
      </div>

      <h4 className="mt-1.5 text-[15.5px] font-[640] leading-[1.5] text-ink-1">
        채권소멸 공고가 진행 중입니다. 연락이 없는 것이 정상입니다
      </h4>

      {/* 달력 앵커 — 시작 · 지금 · 만료 예정. **퍼센트도 D-n 도 쓰지 않습니다**.
          장식이라 통째로 aria-hidden 이고, 뜻은 바로 아래 글자가 싣습니다 */}
      <div aria-hidden className="mt-3.5 flex items-center">
        <span className="size-2 shrink-0 rounded-full bg-horizon" />
        <span
          style={{ flexGrow: done }}
          className="h-1 rounded-full bg-[linear-gradient(90deg,var(--horizon),oklch(0.811_0.14_66.9/80%))]"
        />
        <span className="size-2.5 shrink-0 rounded-full bg-horizon shadow-[0_0_0_4px_oklch(0.811_0.14_66.9/22%),0_0_14px_oklch(0.811_0.14_66.9/45%)]" />
        <span
          style={{ flexGrow: 1 - done }}
          className="h-1 rounded-full bg-[oklch(1_0_0/9%)]"
        />
        <span className="size-2 shrink-0 rounded-full border border-[oklch(0.305_0.013_267.1/70%)]" />
      </div>
      <div
        data-numeric
        className="mt-[7px] flex justify-between gap-2.5 text-[12.5px] text-ink-4"
      >
        <span>{startLabel ? `${startLabel} 공고 시작` : "공고 시작"}</span>
        <span className="font-[620] text-horizon">지금</span>
        <span>{endLabel ? `${endLabel} 만료 예정` : "만료 예정"}</span>
      </div>

      <p className="mt-3 text-[13px] leading-[1.65] text-ink-3">
        공고가 끝나면 은행이 <b className="font-[620] text-ink-2">환급 결정을 통지</b>합니다.
        날짜를 세지 않습니다. 통지가 오면 저희가 먼저 알려드립니다.
      </p>

      {onUpload && (
        <button
          type="button"
          onClick={onUpload}
          className="mt-3 flex min-h-[var(--size-touch)] w-full items-center justify-center gap-2 rounded-[10px] bg-ink-1 px-4 text-[13.5px] font-[660] text-ground"
        >
          그동안 통지·우편을 받으셨나요? 올리시면 무슨 뜻인지 읽어드립니다
        </button>
      )}

      <p className="mt-2.5 text-[12.5px] leading-[1.6] text-ink-4">
        이 기간에도 하실 일이 생기면 보드 첫 줄에 올립니다. 이 카드는 기다림이 정상임을
        알리는 자리입니다
      </p>
    </div>
  );
}
