"use client";

import { useState } from "react";

/**
 * T0 안전 절차 — 본문(챗) 위에 떠 있는 **오버레이 알약**.
 *
 * 계약: spec/backend/08-14-slot-tiering.md 「T0 · 없어도 시작」 ·
 *       spec/frontend/08-14-screens.md 「셸은 두 열입니다」 · ADR-036 · ADR-063
 *
 * **2026-09-03 자리 정정** — ADR-063 구현이 처음에 이걸 왼쪽 열에 앉혔는데,
 * 결정의 뜻은 **챗 위에 겹쳐 접어 두는 것**이었습니다(사용자 확인). 왼쪽 열은
 * 이제 할 일 레일 하나입니다.
 *
 * ## 오버레이인 이유
 *
 * 접힌 알약은 한 줄이라 챗을 거의 안 가리고, **펼친 카드는 흐름에 끼어들지 않고
 * 떠서** 챗 스크롤을 밀지 않습니다 — 부가 정보로 격하됐지만(ADR-063) 어느
 * 국면에서든 같은 자리에 있습니다. slot-tiering 의 「상시 노출」은 접힌
 * 알약에 항상 보이는 넷의 이름이 지킵니다.
 *
 * 절대 하지 않는 것
 *  · 알약을 숨기지 않습니다 — 접혀도 넷의 이름은 읽힙니다
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

export default function T0Overlay() {
  // 기본이 접힘입니다 (ADR-063) — 알약의 넷 이름이 상시라 접혀도 길을 잃지 않습니다
  const [open, setOpen] = useState(false);

  return (
    /* **알약은 흐름에, 펼친 카드만 띄웁니다** — 알약이 흐름 밖이면 첫 말풍선과
       겹치고, 카드가 흐름 안이면 펼칠 때마다 챗이 밀립니다 */
    <div className="relative z-20 mb-3 flex justify-center">
      <div className="relative w-full max-w-[560px]">
          {/* ── 알약 — 접혀 있을 때의 전부입니다. 한 줄로 넷을 말합니다 ── */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className={`flex min-h-[38px] w-full items-center justify-center gap-2 rounded-full border px-4 text-[12.5px] leading-none backdrop-blur transition-colors duration-200 ${
              open
                ? "border-[oklch(0.697_0.16_258.2/55%)] bg-[oklch(0.21_0.02_262/92%)] text-ink-1"
                : "border-[oklch(0.697_0.16_258.2/40%)] bg-[oklch(0.21_0.02_262/85%)] text-ink-2 hover:border-[oklch(0.697_0.16_258.2/60%)]"
            }`}
          >
            <span aria-hidden className="size-[6px] shrink-0 rounded-full bg-pii" />
            <span className="truncate">
              <b data-numeric className="font-[660] text-pii">112</b> 신고
              <span aria-hidden className="mx-1.5 text-ink-4">·</span>
              <b data-numeric className="font-[660] text-pii">1332</b> 상담
              <span aria-hidden className="mx-1.5 text-ink-4">·</span>
              송금 금지
              <span aria-hidden className="mx-1.5 text-ink-4">·</span>
              비행기모드
            </span>
            <span aria-hidden className="shrink-0 text-[11px] text-pii">
              {open ? "▲" : "▼"}
            </span>
          </button>

          {/* ── 펼친 카드 — 챗 위에 떠서 스크롤을 안 밉니다 ── */}
          {open && (
            <div className="absolute inset-x-0 top-full mt-1.5 rounded-[14px] border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.19_0.018_262/97%)] p-[14px_16px] shadow-[0_12px_36px_oklch(0_0_0/45%)] backdrop-blur">
              <p className="text-[12px] font-[620] tracking-[0.08em] text-pii">
                지금 당장, 무슨 일이든 — 이 넷은 어떤 경우에도 맞습니다
              </p>
              <ul className="mt-2.5 grid gap-2.5 border-t border-[oklch(0.697_0.16_258.2/22%)] pt-2.5 sm:grid-cols-2">
                {T0.map(([num, name, why]) => (
                  <li key={name} className="rounded-[10px] bg-[oklch(1_0_0/4%)] p-[9px_11px]">
                    <p className="text-[13.5px] font-[620] leading-[1.4] text-ink-1">
                      {num ? (
                        <>
                          <b data-numeric className="font-[700] text-pii">
                            {num}
                          </b>{" "}
                          {name}
                        </>
                      ) : (
                        name
                      )}
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-[1.5] text-ink-3">{why}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    </div>
  );
}
