"use client";

import { useState } from "react";

/**
 * T0 안전 절차 — `/c/{token}` 왼쪽 열의 **위쪽, 접이식**.
 *
 * 계약: spec/backend/08-14-slot-tiering.md 「T0 · 없어도 시작」 ·
 *       spec/frontend/08-14-screens.md 「셸은 세 열입니다」 · ADR-036 · **ADR-063**
 *
 * **2026-09-02 에 접이식으로 격하됐습니다** (ADR-063). 전에는 「넓은 폭에서
 * 접히지 않는다」가 규칙이었는데, 왼쪽 열에 할 일 레일이 들어오면서 안전 절차는
 * 부가 정보가 됐습니다. slot-tiering 의 「상시 노출」은 **접힌 상태에서도 항상
 * 보이는 요약 한 줄**(112 신고 · 1332 상담 · 추가 송금 금지 · 비행기모드)이
 * 지킵니다 — 「급하면 안 보이는 것」이 되지 않습니다.
 *
 * 절대 하지 않는 것
 *  · 요약 줄을 숨기지 않습니다 — 접혀도 넷의 이름은 읽힙니다
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
  // **기본이 접힘입니다** (ADR-063) — 요약 줄이 상시라 접혀도 넷은 보입니다
  const [open, setOpen] = useState(false);

  return (
    <aside>
      <div className="rounded-[13px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg p-[12px_14px]">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-[var(--size-touch)] w-full items-center justify-between gap-3 text-left"
        >
          <span className="text-[12.5px] font-[620] tracking-[0.08em] text-pii">
            지금 당장, 무슨 일이든
          </span>
          <span aria-hidden className="text-[12px] text-pii">
            {open ? "▴" : "▾"}
          </span>
        </button>

        {/* **접혀도 이 줄은 항상 보입니다** — slot-tiering 「상시 노출」의 최소형 */}
        {!open && (
          <p className="mt-0.5 text-[12.5px] leading-[1.6] text-ink-3">
            <b data-numeric className="font-[640] text-pii">112</b> 신고 ·{" "}
            <b data-numeric className="font-[640] text-pii">1332</b> 상담 · 추가 송금 금지 ·
            비행기모드
          </p>
        )}

        {open && (
          <ul className="mt-2.5 grid gap-3 border-t border-[oklch(0.697_0.16_258.2/22%)] pt-2.5">
            {/* 들여쓰기를 두지 않습니다 — 번호 칸을 따로 주면 번호 없는 절차가
                밀려나고, 레일이 좁아 설명이 더 접힙니다 */}
            {T0.map(([num, name, why]) => (
              <li key={name}>
                <p className="text-[13.5px] font-[600] leading-[1.45] text-ink-1">
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
                <p className="mt-0.5 text-[12.5px] leading-[1.55] text-ink-3">{why}</p>
              </li>
            ))}
            <li className="border-t border-[oklch(0.697_0.16_258.2/22%)] pt-2 text-[12px] leading-[1.6] text-ink-3">
              이 넷은 <b className="font-[620] text-ink-2">어떤 경우에도 맞습니다.</b> 화면이
              바뀌어도 여기 그대로 있습니다.
            </li>
          </ul>
        )}
      </div>
    </aside>
  );
}
