"use client";

import { useState } from "react";

/**
 * S-08 증거함 — `/c/{token}` 의 `focus: "evidence"` 일 때의 본문.
 *
 * 계약: spec/frontend/08-14-screens.md §S-08
 * 시안: assets/artifacts/handoff/08-19-s08-evidence/ 「Evidence S-08 Options」
 *       **1d 채택** (1a 서랍 그리드 · 1b 전사 전폭 · 1c 파이프라인 탈락)
 *
 * ⚠️ **전사 본문은 시안과 다릅니다 — ADR-034 때문입니다.**
 * 시안은 문장 안 PII 를 파란 토큰으로 두고 「파란 토큰 = 서버로 안 갔다는 뜻 —
 * 서버가 받은 것은 이 화면 그대로입니다」라고 적었습니다. ADR-034 로 화면은
 * **원문**을 보여주게 됐으므로 그 문장은 이제 **사실이 아닙니다**(화면은 원문,
 * 서버가 받은 것은 토큰). 그래서 값은 원문으로, 문구는 사실대로 고쳤습니다.
 * **대신할 신뢰 장치는 미결입니다** — ADR-034 「잃는 것」 참고.
 *
 * 절대 하지 않는 것
 *  · **업로드를 관문으로 만들지 않습니다.** 증거가 없어도 사건은 진행됩니다
 *  · **주민등록번호를 못 가리면 그 파일만 빼고 진행**합니다 — 막지 않습니다.
 *    그때도 **빨강이 아니라 앰버**입니다 (ADR-026)
 *  · 미확인 구간을 숨기지 않습니다 — 드러내고, 서류에 자동으로 넣지 않습니다
 *  · 화면이 재마스킹하지 않습니다 — 서버가 준 결과를 그대로 그립니다
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다
 *  · POST …/evidence §3.2 · GET …/evidence/{id} §3.3
 *  · 층 C: transcript-viewer · file-sender
 */

type Status = "done" | "processing" | "failed" | "pending";

/** 상태 어휘는 S-06 EvidenceCard 와 같습니다 — 넷 밖의 값을 만들지 마세요 */
const FILES = [
  { id: "a", name: "0812_수신전화.m4a", status: "done", note: "통화 녹음 · 전사 완료" },
  { id: "b", name: "0813_재통화.m4a", status: "processing", note: "가리는 중 74%" },
  { id: "c", name: "지급정지_접수문자.png", status: "done", note: "캡처 · ◆ 단계 증빙" },
  { id: "d", name: "신분증_사진.jpg", status: "failed", note: "제외 — 주민번호를 못 가렸습니다" },
  { id: "e", name: "이체내역_0812.png", status: "pending", note: "대기 중" },
] as const satisfies readonly { id: string; name: string; status: Status; note: string }[];

/** 상태 점 — 색만으로 가르지 않습니다. 아래 한 줄이 항상 말로 설명합니다 */
const DOT: Record<Status, string> = {
  done: "bg-pii",
  processing: "bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]",
  failed: "bg-deadline-urgent",
  pending: "border border-icon bg-transparent",
};

/** 서버가 준 전사 그대로. **화면이 다시 가리거나 풀지 않습니다** */
const TRANSCRIPT = [
  {
    at: "00:12",
    who: "상대방",
    suspect: false,
    body: "서울중앙지검 수사관입니다. 김민수 씨 명의 계좌가 범죄에 연루되어 확인이 필요합니다.",
  },
  {
    at: "01:04",
    who: "나",
    suspect: false,
    body: "제가요? 저는 그런 적이 없는데요.",
  },
  {
    at: "02:47",
    who: "상대방",
    suspect: true,
    body: "안전계좌로 옮기셔야 합니다. 지금 불러드리는 110-2345-678901 로 이체해 주세요.",
  },
  {
    at: "04:31",
    who: "상대방",
    suspect: false,
    unverified: true,
    body: "확인되면 24시간 안에 돌려드립니다. 절대 다른 곳에 말하지 마세요.",
  },
] as const;

/** 부모 `.view-in` 이 0.5초 지연이라, 자식 계단도 그 뒤에서 시작합니다 */
const step = (i: number) => ({ animationDelay: `${520 + i * 80}ms` });

export default function EvidenceView() {
  const [selected, setSelected] = useState<string>("a");
  const file = FILES.find((f) => f.id === selected) ?? FILES[0];

  return (
    <div className="grid w-full gap-4 md:grid-cols-[220px_1fr]">
      {/* ── 자료 레일 ──────────────────────────────────── */}
      <aside style={step(0)} className="rise min-w-0">
        <div className="flex items-baseline justify-between px-1.5">
          <h3 className="text-[12.5px] tracking-[0.12em] text-icon">자료 {FILES.length}</h3>
          <button
            type="button"
            className="inline-flex min-h-[var(--size-touch)] items-center text-[13px] text-pii"
          >
            ＋ 올리기
          </button>
        </div>

        <ul className="mt-1.5 grid gap-1">
          {FILES.map((f, i) => {
            const on = f.id === selected;
            return (
              <li key={f.id} style={step(i + 1)} className="rise">
                <button
                  type="button"
                  onClick={() => setSelected(f.id)}
                  aria-current={on ? "true" : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-[10px] border px-2.5 py-2.5 text-left transition-colors duration-200 ${
                    on
                      ? "border-[oklch(0.697_0.16_258.2/34%)] bg-[oklch(0.697_0.16_258.2/10%)]"
                      : "border-transparent hover:border-hairline"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`size-[7px] shrink-0 rounded-full ${DOT[f.status]}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-[12.5px] ${
                        on ? "font-[600] text-ink-1" : "text-ink-2"
                      }`}
                    >
                      {f.name}
                    </span>
                    <span
                      className={`block truncate text-[12.5px] ${
                        f.status === "failed" ? "text-deadline-urgent" : "text-icon"
                      }`}
                    >
                      {f.note}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 rounded-[10px] border border-dashed border-hairline p-3 text-[12.5px] leading-[1.6] text-icon">
          증거가 없어도 사건은 진행됩니다.{" "}
          <b className="font-[620] text-ink-2">신분증은 올리지 마세요.</b>
        </p>
      </aside>

      {/* ── 전사 본문 ──────────────────────────────────── */}
      <section className="min-w-0 rounded-[14px] border border-hairline bg-surface-low">
        <header
          style={step(2)}
          className="rise flex flex-wrap items-center justify-between gap-3 border-b border-hairline p-[13px_16px]"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-[oklch(0.697_0.16_258.2/35%)] bg-[oklch(0.697_0.16_258.2/14%)] text-[13px] text-pii"
            >
              ▸
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-[640] text-ink-1">{file.name}</p>
              <p data-numeric className="text-[12.5px] text-icon">
                8월 12일 14:22 · 6분 41초
              </p>
            </div>
          </div>
          {/* 가려서 보낸 것이 무엇인지 — 값이 아니라 **개수**입니다 */}
          <p className="shrink-0 text-[12.5px] text-icon">
            서버로는 <b className="font-[620] text-pii">이름 1 · 계좌 1</b>을 가려서 보냈습니다
          </p>
        </header>

        {file.status === "processing" ? (
          <div className="grid gap-2 p-[18px_16px]">
            <p className="flex items-center gap-2 text-[14px] text-ink-2">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
              />
              가리는 중입니다 — 끝나면 전사가 여기 뜹니다
            </p>
            <p className="text-[12.5px] text-icon">
              원본은 아직 이 브라우저 안에 있습니다.
            </p>
          </div>
        ) : file.status === "failed" ? (
          /* 갈림길이지 막는 자리가 아닙니다 — 앰버, 빨강 금지 (ADR-026) */
          <div className="grid gap-3 p-[18px_16px]">
            <p className="text-[14px] leading-[1.65] text-ink-2">
              이 파일은 <b className="font-[620] text-deadline-urgent">주민등록번호를 못 가려서</b>{" "}
              올리지 않았습니다. <b className="font-[620] text-ink-1">사건은 그대로 진행됩니다</b> —
              이 파일 하나만 빠집니다.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-4 text-[13.5px] font-[660] text-ground"
              >
                다른 파일 올리기
              </button>
              <button
                type="button"
                className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] border border-hairline bg-chip px-4 text-[13.5px] text-ink-2"
              >
                없이 진행
              </button>
            </div>
          </div>
        ) : file.status === "pending" ? (
          <p className="p-[18px_16px] text-[14px] text-ink-3">
            아직 차례를 기다리는 중입니다.
          </p>
        ) : (
          <>
            <div className="grid gap-4 p-[18px_16px]">
              {TRANSCRIPT.map((line, i) => (
                <div
                  key={line.at}
                  style={step(i + 3)}
                  className="rise grid grid-cols-[42px_1fr] gap-3"
                >
                  <span data-numeric className="mt-0.5 font-mono text-[12.5px] text-icon">
                    {line.at}
                  </span>
                  <div className="min-w-0">
                    <p className="mb-1 text-[12.5px] text-icon">
                      {line.who}
                      {line.suspect && (
                        <>
                          {" · "}
                          <b className="font-[620] text-deadline-urgent">사칭 정황 구간</b>
                        </>
                      )}
                    </p>
                    <p
                      className={`text-[14px] leading-[1.7] text-ink-2 ${
                        line.suspect
                          ? "border-l-2 border-[oklch(0.77_0.117_70.9/60%)] pl-3"
                          : ""
                      }`}
                    >
                      {"unverified" in line && line.unverified ? (
                        <>
                          <span className="underline decoration-[oklch(0.77_0.117_70.9/70%)] decoration-dashed underline-offset-4">
                            {line.body}
                          </span>
                          <span className="ml-2 inline-flex items-center rounded-full border border-[oklch(0.77_0.117_70.9/45%)] px-2 py-px align-middle text-[12.5px] text-deadline-urgent">
                            미확인
                          </span>
                        </>
                      ) : (
                        line.body
                      )}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* ⚠️ 시안의 「서버가 받은 것은 이 화면 그대로입니다」는 ADR-034 이후 거짓입니다 */}
            <footer className="border-t border-hairline p-[11px_16px] text-[12.5px] leading-[1.6] text-icon">
              <b className="font-[620] text-ink-2">이 화면은 원문입니다</b> — 밖으로 나간 것은
              가려진 형태였습니다. 복원은 이 브라우저 안에서만 일어납니다 ·{" "}
              <b className="font-[620] text-ink-2">미확인</b> 구간은 서류에 자동으로 들어가지
              않습니다.
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
