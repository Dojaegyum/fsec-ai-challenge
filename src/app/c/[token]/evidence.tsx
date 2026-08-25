"use client";

import { useRef } from "react";

import { FileRail } from "@/modules/file-sender";
import { countTokens, TranscriptView } from "@/modules/transcript-viewer";

import { FIXTURE_EVIDENCE, FIXTURE_MAPPINGS } from "./fixtures";
import { useEvidence } from "./load";
import type { Uploads } from "./upload";

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
 * ## 값이 어디서 오나
 *
 *  · **전사·토큰** — `GET …/evidence/{id}` (§3.3). 서버가 준 `poll_after_ms` 로만
 *    다시 묻습니다 (`load.ts` 의 `useEvidence`). 간격을 화면이 지어내지 않습니다
 *  · **자료 레일** — 브라우저가 들고 있는 목록입니다(`useUploads`). 못 가려서
 *    **안 올린 파일도 남아야** 해서 서버 응답만으로는 못 만듭니다 (ADR-026)
 *  · **복원 매핑** — 볼트를 여는 것은 `key-handler` 이고 아직 안 붙었습니다.
 *    ⬜ 그때까지 `FIXTURE_MAPPINGS` 입니다 — **원문이 서버에서 오지 않는다**는
 *    사실은 그대로입니다 (ADR-009 · ADR-027)
 *
 * `token` 이 `null` 이면 **서버를 부르지 않고 픽스처로 그립니다** (`?view=` 개발 경로).
 */

/** 부모 `.view-in` 이 0.5초 지연이라, 자식 계단도 그 뒤에서 시작합니다 */
const step = (i: number) => ({ animationDelay: `${520 + i * 80}ms` });

export default function EvidenceView({
  token,
  uploads,
}: {
  token: string | null;
  /** 자료 레일 한 벌. **셸이 들고 있습니다** — 유령까지 같은 것을 봐야 합니다 */
  uploads: Uploads;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const files = uploads.files;
  const selected = uploads.selectedId;
  const file = files.find((f) => f.id === selected) ?? files[0];

  // 올라간 파일만 서버에 물을 것이 있습니다 — `evidence_id` 가 없으면 안 부릅니다
  const server = useEvidence(token, file.evidence_id);
  const read = server.phase === "ready" ? server.read : null;

  /**
   * **처리 상태의 주인은 서버입니다.** 레일의 값은 브라우저가 방금 올리며 적어 둔
   * 것이라, 응답이 오면 그쪽이 이깁니다 — 다른 기기에서 올린 파일도 있을 수 있습니다.
   */
  const status = read?.ingest_status ?? file.status;
  const lines = read?.transcript ?? (token === null ? FIXTURE_EVIDENCE.transcript : []);
  const tokens = read?.pii_tokens ?? (token === null ? FIXTURE_EVIDENCE.pii_tokens : []);

  return (
    <div className="grid w-full gap-4 md:grid-cols-[220px_1fr]">
      {/* ── 자료 레일 ──────────────────────────────────── */}
      <aside style={step(0)} className="rise min-w-0">
        <div className="flex items-baseline justify-between px-1.5">
          <h3 className="text-[12.5px] tracking-[0.12em] text-ink-4">자료 {files.length}</h3>
          {/* 종류를 계약의 셋으로 좁혀 받습니다 — PDF 는 어디에 넣을지가
              정본에 없어 안 받습니다 (`kindOf` 참고) */}
          <input
            ref={pick}
            type="file"
            accept="audio/*,image/*,text/*"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              // 같은 파일을 다시 골라도 이벤트가 나게 비웁니다
              e.target.value = "";
              if (chosen) void uploads.add(chosen);
            }}
          />
          <button
            type="button"
            onClick={() => pick.current?.click()}
            disabled={token === null || uploads.busy}
            className="inline-flex min-h-[var(--size-touch)] items-center text-[13px] text-pii disabled:opacity-45"
          >
            {uploads.busy ? "올리는 중" : "＋ 올리기"}
          </button>
        </div>

        {/* 자료 레일은 `file-sender` 가 그립니다 — 상태 점과 갈림길이
            그쪽 규칙이기 때문입니다(경계 표: 「업로드 + 처리 상태」). 레일은 선택 UI 를 겸합니다 */}
        <FileRail files={files} selectedId={selected} onSelect={uploads.select} />

        {/* 못 올렸으면 앰버로. **스스로 다시 올리지 않습니다** (에러 §3.1) */}
        {uploads.fail && (
          <p
            role="alert"
            className="mt-3 rounded-[10px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-3 text-[12.5px] leading-[1.6] text-ink-2"
          >
            {uploads.fail.message}
          </p>
        )}

        <p className="mt-3 rounded-[10px] border border-dashed border-hairline p-3 text-[12.5px] leading-[1.6] text-ink-3">
          증거가 없어도 사건은 진행됩니다.{" "}
          <b className="font-[620] text-ink-2">신분증은 올리지 마세요.</b>
        </p>
      </aside>

      {/* ── 전사 본문 ──────────────────────────────────── */}
      <section className="min-w-0 rounded-[14px] border border-hairline bg-surface-low">
        {/* **증거는 관문이 아닙니다** — 없어도 사건은 그대로 진행됩니다 */}
        {!file && (
          <p className="p-[18px_16px] text-[14px] leading-[1.65] text-ink-3">
            아직 올리신 자료가 없습니다. <b className="font-[620] text-ink-2">없어도 사건은
            진행됩니다</b> — 있으면 절차가 더 정확해질 뿐입니다.
          </p>
        )}
        {file && (
        <>
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
              {/* ⬜ **§3.3 에 올린 시각·길이 칸이 없습니다.** 지어내지 않고 비워 둡니다 —
                  파일 이름이 이미 날짜를 담고 있어(0812_수신전화.m4a) 사용자가 못 알아볼
                  자리는 아닙니다. 계약에 올릴지는 QA 계획 Task 4 에서 판단합니다 */}
            </div>
          </div>
          {/* 가려서 보낸 것이 무엇인지 — 값이 아니라 **개수**입니다.
              **가린 것이 없으면 이 줄이 통째로 없습니다** — 빈 목록으로 문장을
              만들면 「서버로는 을 가려서 보냈습니다」가 됩니다 */}
          {tokens.length > 0 && (
            <p className="shrink-0 text-[12.5px] text-ink-3">
              서버로는{" "}
              <b className="font-[620] text-pii">
                {countTokens(tokens)
                  .map((c) => `${c.kind} ${c.count}`)
                  .join(" · ")}
              </b>
              을 가려서 보냈습니다
            </p>
          )}
        </header>

        {status === "processing" ? (
          <div className="grid gap-2 p-[18px_16px]">
            <p className="flex items-center gap-2 text-[14px] text-ink-2">
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
              />
              가리는 중입니다. 끝나면 전사가 여기 뜹니다
            </p>
            <p className="text-[12.5px] text-ink-3">
              원본은 아직 이 브라우저 안에 있습니다.
            </p>
          </div>
        ) : status === "failed" ? (
          /* 갈림길이지 막는 자리가 아닙니다 — 앰버, 빨강 금지 (ADR-026) */
          <div className="grid gap-3 p-[18px_16px]">
            <p className="text-[14px] leading-[1.65] text-ink-2">
              이 파일은 <b className="font-[620] text-deadline-urgent">주민등록번호를 못 가려서</b>{" "}
              올리지 않았습니다. <b className="font-[620] text-ink-1">사건은 그대로 진행됩니다.</b>{" "}
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
        ) : status === "pending" ? (
          <p className="p-[18px_16px] text-[14px] text-ink-3">
            아직 차례를 기다리는 중입니다.
          </p>
        ) : (
          <>
            <div className="p-[18px_16px]">
              <TranscriptView
                lines={lines}
                mappings={FIXTURE_MAPPINGS}
                lineStyle={(i) => step(i + 3)}
              />
            </div>

            {/* ⚠️ 시안의 「서버가 받은 것은 이 화면 그대로입니다」는 ADR-034 이후 거짓입니다.
                ⬜ 아래 「미확인 구간」은 지금 화면에 표시가 없습니다 — 근거 스팬을 내는
                `case-reader`(층 1)가 미구현이고 §3.3 에도 자리가 없어 전사 본문에서
                빠졌습니다. 문구는 여전히 참이라 두되, 표기가 서면 함께 보여야 합니다 */}
            <footer className="border-t border-hairline p-[11px_16px] text-[12.5px] leading-[1.6] text-ink-3">
              <b className="font-[620] text-ink-2">이 화면은 원문입니다.</b> 밖으로 나간 것은
              가려진 형태였습니다. 복원은 이 브라우저 안에서만 일어납니다.{" "}
              <b className="font-[620] text-ink-2">미확인</b> 구간은 서류에 자동으로 들어가지
              않습니다.
            </footer>
          </>
        )}
        </>
        )}
      </section>
    </div>
  );
}
