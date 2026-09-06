"use client";

import { useRef } from "react";

import { FileRail } from "@/modules/file-sender";
import { countTokens, TranscriptView } from "@/modules/transcript-viewer";

import type { RestorableMapping } from "@/modules/pii-restorer";

import { FIXTURE_EVIDENCE, FIXTURE_MAPPINGS } from "./fixtures";
import type { EvidenceState } from "./load";
import { pickFile } from "./upload";
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
 *  · **전사·토큰** — `GET …/evidence/{id}` (§3.3) 의 결과를 **셸이 `server` 로 내려줍니다.**
 *    묻는 것은 셸의 `useEvidenceReads`(`load.ts`) 이고 이 화면은 그리기만 합니다 → ADR-078.
 *
 *    ⚠️ **2026-09-06 까지 이 화면이 폴링을 직접 돌렸습니다** — 선택된 파일 하나에 대해,
 *    이 화면이 떠 있는 동안만. 통지문을 올리고 대화 탭으로 간 사람은 25분 넘게
 *    「처리중」을 봤고, 팟은 끝난 작업을 30분 뒤 버렸습니다. 폴링의 주인을 셸로 올린
 *    이유입니다 — 「다른 화면에 가셔도 됩니다」가 그때부터 참이 됐습니다
 *  · **자료 레일** — 브라우저가 들고 있는 목록입니다(`useUploads`). 못 가려서
 *    **안 올린 파일도 남아야** 해서 서버 응답만으로는 못 만듭니다 (ADR-026)
 *  · **복원 매핑** — **셸이 볼트에서 열어 온 것**을 그대로 받습니다 (`chat.restorable`).
 *
 *    ⚠️ **2026-08-27 까지 이 자리가 `FIXTURE_MAPPINGS` 였습니다.** 전사문 줄은 서버에서
 *    오는데 되살리는 표만 개발용 예시라, **실제 피해자의 전사문에 `김민수`·
 *    `110-2345-678901` 이 끼워져** 그려졌습니다. 그리고 바로 아래 푸터가 「이 화면은
 *    원문입니다」라고 단언했습니다 — 이 사건 어디에도 없는 값을 원문이라고 말한 것입니다.
 *    사용자가 그 번호를 피해구제 신청서에 옮겨 적을 수 있었습니다.
 *
 *    머리말의 옛 ⬜ (「볼트를 여는 것은 `key-handler` 이고 아직 안 붙었습니다」)는
 *    낡은 것이었습니다 — `openVault` 는 이미 있고 챗이 쓰고 있었으며 **증거함만
 *    안 이어져** 있었습니다 (ADR-009 · ADR-027 · ADR-050)
 *
 * `token` 이 `null` 이면 **서버를 부르지 않고 픽스처로 그립니다** (`?view=` 개발 경로).
 */

/** 부모 교차(`.view-enter` 0.32s)가 끝난 뒤에 자식 계단이 시작합니다 */
const step = (i: number) => ({ animationDelay: `${360 + i * 80}ms` });

export default function EvidenceView({
  token,
  uploads,
  onContinue,
  restorable,
  server,
  again,
  locked = false,
}: {
  token: string | null;
  /** 자료 레일 한 벌. **셸이 들고 있습니다** — 유령까지 같은 것을 봐야 합니다 */
  uploads: Uploads;
  /**
   * 「없이 진행」 — 이 파일을 못 읽었어도 사건은 그대로 갑니다.
   *
   * **없으면 그 버튼을 안 그립니다.** 「사건은 그대로 진행됩니다」라고 써
   * 놓고 눌러도 아무 데도 안 가면 그 말이 거짓이 됩니다.
   */
  onContinue?: () => void;
  /**
   * 볼트에서 열어 온 복원 매핑. **셸이 한 벌만 들고 챗과 함께 내려줍니다.**
   * 개발 경로(`token === null`)에서는 안 넘어오고 픽스처를 씁니다
   */
  restorable?: readonly RestorableMapping[];
  /**
   * **지금 그릴 파일의 §3.3 조회 상태** — 셸의 `useEvidenceReads` 가 들고 내려줍니다.
   * 이 화면은 서버를 부르지 않습니다. 파일에 `evidence_id` 가 없거나(못 올린 것)
   * 아직 안 물었으면 `loading` 이고, 그때는 레일 줄의 상태로 그립니다
   */
  server: EvidenceState;
  /** 「다시 확인」 — 조회가 끊긴 파일을 셸이 처음부터 다시 묻게 합니다 (§3.1: 누르는 것은 사용자) */
  again: () => void;
  /** 이 기기에 열쇠가 없나 — 가족이 링크를 받아 연 경우입니다 (ADR-050) */
  locked?: boolean;
}) {
  const pick = useRef<HTMLInputElement>(null);
  const files = uploads.files;
  const selected = uploads.selectedId;
  /**
   * **셸과 같은 규칙으로 고릅니다** (`pickFile`) — 셸이 내려준 `server` 는 이 규칙으로
   * 고른 파일의 것입니다. `files[0]` 을 그냥 쓰면 자료가 0개일 때 화면이 통째로 죽습니다
   */
  const file = pickFile(files, selected);

  const read = server.phase === "ready" ? server.read : null;
  /** 조회 자체가 실패했다 — 전사가 실패한 것(`readFailed`)과 다릅니다 */
  const askFailed = server.phase === "failed" ? server.fail : null;
  // 레일 줄을 서버 값으로 맞추는 것(`markRail`)도 셸이 합니다 — 이 화면이 안 떠 있어도
  // 끝난 파일의 줄이 「전사 완료」로 바뀌어야 하기 때문입니다 (ADR-078)

  /**
   * **처리 상태의 주인은 서버입니다.** 레일의 값은 브라우저가 방금 올리며 적어 둔
   * 것이라, 응답이 오면 그쪽이 이깁니다 — 다른 기기에서 올린 파일도 있을 수 있습니다.
   *
   * ⚠️ **둘을 뭉치지 않습니다.** 서버의 실패는 **전사·판독이 안 됐다**는 뜻이고
   * (데이터 모델 §3), 레일의 실패는 **올리다 끊겼다**는 뜻입니다. `file-sender` 가
   * *"뭉치면 진짜 전사 실패가 났을 때 화면에 「가릴 수 없는 정보가 있어 올리지
   * 않았습니다」라는 거짓 문구가 나갑니다"* 라고 이미 경고해 둔 자리입니다
   */
  const readFailed = read?.ingest_status === "failed";
  const sendFailed = !read && file?.status === "failed";
  const status = read?.ingest_status ?? file?.status;
  /** §3.3 `progress.percent` — 서버가 준 값 그대로. 레일 줄에도 같은 값이 있습니다(`markRail`) */
  const percent = read?.progress?.percent ?? file?.percent;
  /** §3.3 `progress.retrying` — 서버에 닿지 못해 다시 맡기는 중. 진행률 대신 이 사실을 그립니다(ADR-091 §6) */
  const retrying = read?.progress?.retrying === true;
  const lines = read?.transcript ?? (token === null ? FIXTURE_EVIDENCE.transcript : []);
  const tokens = read?.pii_tokens ?? (token === null ? FIXTURE_EVIDENCE.pii_tokens : []);
  /** §3.3 `shortfalls[]` — 픽스처엔 없습니다. 개발 경로에서는 「다 읽었다」로 둡니다 */
  const shortfalls = read?.shortfalls ?? [];

  /**
   * 되살리는 표 — **개발 경로에서만 픽스처**입니다.
   *
   * 실서버 경로에서 픽스처를 쓰면 **이 사건에 없는 값이 원문으로 그려집니다.**
   * 열쇠가 없으면 빈 목록이고, 그때는 아래에서 그 이유를 말합니다
   */
  const mappings = token === null ? FIXTURE_MAPPINGS : (restorable ?? []);

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
        {/* **갈림길을 실제로 냅니다** — 넘기지 않으면 레일이 버튼을 안 그립니다.
            「없이 진행」은 고를 것이 없어 안 넘깁니다: 사건은 이미 진행 중이고
            이 화면이 막고 있지 않습니다 (ADR-026) */}
        <FileRail
          files={files}
          selectedId={selected}
          onSelect={uploads.select}
          {...(token === null ? {} : { onRetry: () => pick.current?.click() })}
        />

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

        {askFailed ? (
          /* **조회가 끊긴 것을 말합니다.** 조용히 「처리중」으로 두면 사용자는
             영영 기다립니다. 스스로 다시 부르지 않습니다 — 누르는 것은
             사용자입니다 (§3.1) */
          <div
            role="alert"
            className="m-[18px_16px] rounded-[11px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[13px_15px]"
          >
            <p className="text-[13.5px] leading-[1.6] text-ink-1">{askFailed.message}</p>
            {askFailed.retryable !== false && (
              <button
                type="button"
                data-hit
                onClick={again}
                className="mt-2.5 rounded-full border border-hairline px-3.5 py-1.5 text-[13px] text-ink-2 transition-colors duration-200 hover:border-[oklch(0.697_0.16_258.2/45%)] hover:text-ink-1"
              >
                다시 확인
              </button>
            )}
          </div>
        ) : status === "processing" ? (
          <div className="grid gap-2 p-[18px_16px]">
            {retrying ? (
              /* **서버에 닿지 못해 다시 맡기는 중** (ADR-091). 오류가 아니라 처리중이고, 셸의 폴링이
                 5초마다 다시 맡깁니다. 진행률은 안 적습니다 — 0% 는 멈춘 것으로 보입니다 */
              <p className="flex items-center gap-2 text-[14px] text-ink-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                />
                전사 서버에 다시 연결하는 중입니다. 파일은 안전하게 보관돼 있습니다
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[14px] text-ink-2">
                <span
                  aria-hidden
                  className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                />
                개인정보 보호 처리중입니다. 끝나면 전사가 여기 뜹니다
                {typeof percent === "number" && (
                  <span data-numeric className="text-ink-3">
                    · {percent}%
                  </span>
                )}
              </p>
            )}
            {/* **예상 시간은 적지 않습니다** — 실측이 없고, 틀린 숫자는 기다리는 사람을
                더 불안하게 합니다. 대신 진행률과 「가셔도 됩니다」. 이 문장이 참인 것은
                폴링을 셸이 들기 때문입니다(ADR-078) — 화면을 떠나도 조회는 계속됩니다.
                (기존 「다른 화면에 가셔도 됩니다」 문단 그대로 — 재시도중에도 참입니다) */}
            <p className="text-[12.5px] leading-[1.6] text-ink-3">
              원본은 아직 이 브라우저 안에 있습니다.{" "}
              <b className="font-[620] text-ink-2">다른 화면에 가셔도 됩니다</b> — 이 창을 열어
              두면 {retrying ? "연결되면 이어서 처리하고, " : ""}끝났을 때 자료함에 「전사 완료」로 표시됩니다.
            </p>
          </div>
        ) : readFailed || sendFailed ? (
          /* 갈림길이지 막는 자리가 아닙니다 — 앰버, 빨강 금지 (ADR-026)

             ⚠️ **여기서 「주민등록번호를 못 가려서」라고 말하면 거짓말입니다.**
             파일 속 주민번호 검출은 아직 미결이라(ADR-026) 그 판정 자체가
             일어나지 않습니다. 실제로 일어난 일은 둘 중 하나입니다 —
             전사·판독이 안 됐거나(서버), 올리다 끊겼거나(브라우저) */
          <div className="grid gap-3 p-[18px_16px]">
            <p className="text-[14px] leading-[1.65] text-ink-2">
              {readFailed ? (
                <>
                  이 파일은{" "}
                  <b className="font-[620] text-deadline-urgent">읽어내지 못했습니다.</b> 소리가
                  작거나 글자가 흐리면 그렇습니다.
                </>
              ) : (
                <>
                  이 파일은{" "}
                  <b className="font-[620] text-deadline-urgent">올리지 못했습니다.</b> 연결이
                  끊겼을 수 있습니다.
                </>
              )}{" "}
              <b className="font-[620] text-ink-1">사건은 그대로 진행됩니다.</b> 이 파일 하나만
              빠집니다.
            </p>
            <div className="flex flex-wrap gap-2">
              {/* 위 「＋ 올리기」와 **같은 파일 선택기**를 엽니다 — 갈림길이 두 개면
                  둘 중 하나만 동작하는 일이 생깁니다 */}
              <button
                type="button"
                onClick={() => pick.current?.click()}
                disabled={token === null || uploads.busy}
                className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-4 text-[13.5px] font-[660] text-ground disabled:opacity-45"
              >
                {uploads.busy ? "올리는 중" : "다른 파일 올리기"}
              </button>
              {onContinue && (
                <button
                  type="button"
                  onClick={onContinue}
                  className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] border border-hairline bg-chip px-4 text-[13.5px] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]"
                >
                  없이 진행
                </button>
              )}
            </div>
          </div>
        ) : status === "pending" ? (
          <p className="p-[18px_16px] text-[14px] text-ink-3">
            아직 차례를 기다리는 중입니다.
          </p>
        ) : (
          <>
            <div className="grid gap-3 p-[18px_16px]">
              {/* **열쇠가 없는 기기입니다** — 가족이 링크를 받아 연 경우입니다.
                  아무 말 없이 `[계좌-1]` 이 보이면 고장으로 읽힙니다 (ADR-050) */}
              {locked && (
                <p className="rounded-[10px] border border-hairline bg-chip p-3 text-[12.5px] leading-[1.6] text-ink-2">
                  <b className="font-[620] text-ink-1">이 기기에는 여는 열쇠가 없습니다.</b>{" "}
                  계좌번호·이름은 <b className="font-[620] text-pii">[계좌-1]</b> 처럼 가려진 채로
                  보입니다 — 전사 내용과 절차는 그대로 보입니다.
                </p>
              )}
              <TranscriptView
                lines={lines}
                mappings={mappings}
                shortfalls={shortfalls}
                lineStyle={(i) => step(i + 3)}
              />
            </div>

            {/* ⚠️ 시안의 「서버가 받은 것은 이 화면 그대로입니다」는 ADR-034 이후 거짓입니다.
                ⬜ 아래 「미확인 구간」은 지금 화면에 표시가 없습니다 — 근거 스팬을 내는
                `case-reader`(층 1)가 미구현이고 §3.3 에도 자리가 없어 전사 본문에서
                빠졌습니다. 문구는 여전히 참이라 두되, 표기가 서면 함께 보여야 합니다 */}
            <footer className="border-t border-hairline p-[11px_16px] text-[12.5px] leading-[1.6] text-ink-3">
              <b className="font-[620] text-ink-2">
                {locked ? "이 화면은 가려진 채입니다." : "이 화면은 원문입니다."}
              </b>{" "}
              밖으로 나간 것은 가려진 형태였습니다. 복원은 이 브라우저 안에서만 일어납니다.{" "}
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
