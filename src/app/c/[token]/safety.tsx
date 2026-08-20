"use client";

import { useState } from "react";

/**
 * T0 안전 절차 — `/c/{token}` 의 **왼쪽 고정 레일**.
 *
 * 계약: spec/backend/08-14-slot-tiering.md 「T0 · 없어도 시작」 ·
 *       spec/frontend/08-14-screens.md 「셸은 세 열입니다」 · ADR-036
 *
 * **본문이 무엇이든 여기 있습니다.** 챗·플랜·증거함 어디로 가도 사라지지 않습니다 —
 * `slot-tiering` 이 「슬롯과 무관하게 상시 노출」이라 했고, 모듈 명세도 `plan-viewer` 가
 * T0 를 상시 노출한다고 적고 있습니다. 본문 안에 두면 국면이 바뀔 때 같이 사라집니다.
 *
 * 절대 하지 않는 것
 *  · **넓은 폭에서 접히지 않습니다.** 자리가 남으니 접을 이유가 없고,
 *    접는 순간 「급하면 안 보이는 것」이 됩니다. 접기는 **좁은 폭 전용**입니다
 *  · 슬롯이 얼마나 찼는지에 따라 바뀌지 않습니다 — 어떤 분기에서도 틀리지 않는 슈퍼셋입니다
 *  · 여기서 절차를 늘리지 마세요. **넷을 넘기면 T0 가 아닙니다**
 */

/** 어떤 경우에도 틀리지 않는 절차 넷. KB 가 아니라 상수인 유일한 절차입니다 */
const T0 = [
  ["112", "신고", "사건접수번호를 받아 두세요. 다음 서류에 들어갑니다"],
  ["1332", "금융 상담", "금융감독원"],
  ["", "추가로 절대 송금하지 마세요", "「해결해 준다」는 연락도 같은 조직입니다"],
  ["", "앱을 설치했다면 비행기모드", "악성앱이 통화를 가로챌 수 있습니다"],
] as const;

export default function T0Rail() {
  // 좁은 폭에서만 씁니다 — 넓은 폭에서는 아래 `md:` 가 상태와 무관하게 펼쳐 둡니다
  const [open, setOpen] = useState(true);

  return (
    <aside className="md:sticky md:top-[clamp(18px,3vh,28px)] md:self-start">
      <div className="rounded-[14px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg p-[14px_15px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-[13px] font-[620] tracking-[0.08em] text-pii">
            지금 당장, 무슨 일이든
          </h2>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-[var(--size-touch)] items-center text-[13px] text-pii md:hidden"
          >
            {open ? "접기 ▴" : "펼치기 ▾"}
          </button>
        </div>

        <p className="mt-1 text-[13px] leading-[1.6] text-ink-3 md:hidden">
          112 신고 · 1332 상담 · 추가 송금 금지 · 비행기모드
        </p>

        {/* 넓은 폭에서는 `md:grid` 가 상태와 무관하게 펼칩니다 — 접기는 좁은 폭 전용입니다 */}
        <ul className={`mt-3 gap-3.5 border-t border-[oklch(0.697_0.16_258.2/22%)] pt-3 ${open ? "grid" : "hidden md:grid"}`}>
          {/* 들여쓰기를 두지 않습니다. 번호 칸을 따로 주면 번호 없는 절차가
              빈 칸만큼 밀려나고, 레일이 좁아 설명이 더 접힙니다.
              번호는 이름과 한 줄에 두고 **전부 왼쪽 끝에서** 시작합니다 */}
          {T0.map(([num, name, why]) => (
            <li key={name}>
              <p className="text-[14px] font-[600] leading-[1.45] text-ink-1">
                {num ? (
                  <>
                    <b data-numeric className="font-[680] text-pii">
                      {num}
                    </b>{" "}
                    {name}
                  </>
                ) : (
                  <>
                    <span aria-hidden className="mr-1.5 text-icon">
                      ·
                    </span>
                    {name}
                  </>
                )}
              </p>
              <p className="mt-1 text-[13px] leading-[1.55] text-ink-3">{why}</p>
            </li>
          ))}
        </ul>

        <p className="mt-3 border-t border-[oklch(0.697_0.16_258.2/22%)] pt-2.5 text-[12.5px] leading-[1.6] text-ink-3">
          이 넷은 <b className="font-[620] text-ink-2">어떤 경우에도 맞습니다.</b> 화면이 바뀌어도
          여기 그대로 있습니다.
        </p>
      </div>
    </aside>
  );
}
