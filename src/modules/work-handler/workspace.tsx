"use client";

/**
 * 열린 단계 하나를 워크스페이스에 그립니다 — **패널 일곱을 고르는 자리.**
 *
 * 계약: spec/frontend/08-17-workspace-panels.md · spec/common/08-14-api.md §3.6 §3.8
 * 근거: ADR-024(`body.action` 이 패널을 정한다) · 불변 규칙 6(완료는 부산물로)
 *
 * ## 왜 이 파일이 생겼나
 *
 * 패널 컴포넌트 일곱은 있었지만 **실제 단계와 이어져 있지 않았습니다.**
 * 화면은 「국민은행에 전화 · 110-2345-678901」 같은 시안 값을 하드코딩해
 * 그리고 있었고, 「입력」·「올리기」 버튼에는 `onClick` 이 없었습니다.
 *
 * 그래서 사용자가 무엇을 해도 부산물이 안 만들어지고, **`after` 사슬로 묶인
 * 다음 단계가 안 열리며, 기한도 안 섰습니다.**
 *
 * ## 무엇을 그릴지는 서버가 정합니다
 *
 * `body.action` 하나로 패널이 정해집니다. **화면이 `actor`·`channel`·
 * `required_artifact` 로 추론하지 않습니다** → ADR-024.
 *
 * 본문도 마찬가지입니다 — `body.summary`·`body.steps[].text` 를 그대로
 * 씁니다. 절차 문구를 화면이 지어내지 않습니다(불변 규칙 1).
 */

import { useRef, useState } from "react";

import { panelForStep, panelRule } from "./panel";
import {
  CallPanel,
  DownloadPanel,
  ReadPanel,
  UploadPanel,
  VisitPanel,
  WaitPanel,
  WritePanel,
} from "./panels";
import type { PlanStep } from "./types";

/** 부산물을 내는 세 갈래 → §3.8 */
export type Submission =
  | { kind: "receipt_no"; value: string }
  | { kind: "receipt_doc"; evidenceId: string }
  | { kind: "other"; selfReported: true };

export interface WorkspaceProps {
  /** 지금 열린 단계. `null` 이면 아무것도 안 그립니다 */
  step: FullStep | null;
  /** 부산물을 냅니다. 보내는 중이면 `busy` */
  onSubmit(stepId: string, one: Submission): void;
  busy?: boolean;
  /** 마지막 판정 — L1 이 실패하면 여기 다음 길이 담겨 옵니다 */
  verdict?: {
    verify_result: string;
    step_state: string;
    next_options?: readonly { level: string; label: string }[];
    unlocked_steps?: readonly { step_id: string; title: string }[];
    note?: string;
  } | null;
  /**
   * 고른 파일을 올려 **부산물로 냅니다** — 두 걸음입니다.
   *
   * 증거로 올려 `evidence_id` 를 받고, 그것으로 §3.8 을 부릅니다.
   * 넘기지 않으면 올리기 버튼을 안 그립니다.
   */
  onPickFile?(stepId: string, file: File): void;
}

/** `PlanStep` 에 본문까지 — 판정에 쓰는 것보다 넓습니다 */
export interface FullStep extends PlanStep {
  title: string;
  body: PlanStep["body"] & {
    summary?: string;
    caveat?: string | null;
    steps?: readonly {
      text?: string;
      action?: string;
      contact?: string | null;
    }[];
    required_artifact?: { kind?: string; label?: string } | null;
  };
}

/** 그 단계의 줄들을 읽는 모양으로 */
function lines(step: FullStep): readonly string[] {
  return (step.body.steps ?? []).map((one) => one.text ?? "").filter(Boolean);
}

/** 부산물 이름 — 없으면 패널이 받아적기 칸을 안 그립니다 */
function artifactLabel(step: FullStep): string | null {
  return step.body.required_artifact?.label ?? null;
}

/** 그 단계에서 전화할 번호 — 줄 중 처음 붙어 있는 것 */
function contactOf(step: FullStep): string | null {
  if (typeof step.body.contact === "string") return step.body.contact;
  for (const one of step.body.steps ?? []) {
    if (typeof one.contact === "string") return one.contact;
  }
  return null;
}

/**
 * 판정을 사람 말로 — **L1 실패가 막다른 길이 아님을 보여주는 자리**입니다.
 *
 * 서버가 `next_options` 로 다음 길을 함께 내므로 그대로 그립니다.
 */
function Verdict({ verdict }: { verdict: NonNullable<WorkspaceProps["verdict"]> }) {
  const done = verdict.step_state === "done_verified";

  return (
    <div
      className={`mt-3 rounded-[10px] border p-[11px_13px] text-[13px] leading-[1.6] ${
        done ? "border-hairline bg-chip text-ink-2" : "border-amber/40 bg-amber/5 text-ink-2"
      }`}
      role="status"
    >
      {done ? (
        <>
          <b className="font-[620] text-ink-1">확인했습니다.</b> 이 단계는 끝났습니다.
          {verdict.unlocked_steps?.length ? (
            <p className="mt-1.5 text-ink-3">
              다음이 열렸습니다 —{" "}
              <b className="font-[620] text-ink-2">
                {verdict.unlocked_steps.map((one) => one.title).join(" · ")}
              </b>
            </p>
          ) : null}
        </>
      ) : (
        <>
          {verdict.note ?? "아직 완료로 기록하지 않았습니다."}
          {verdict.next_options?.length ? (
            <ul className="mt-1.5 list-disc pl-4 text-ink-3">
              {verdict.next_options.map((one) => (
                <li key={one.level}>{one.label}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * 부산물을 내는 자리 — **패널 일곱이 같은 모양을 씁니다.**
 *
 * 유형마다 다른 것은 본문이지 「무엇으로 완료를 증명하나」가 아닙니다.
 * 세 갈래를 늘 함께 냅니다 — **L1 이 실패해도 길이 막히지 않습니다**(§3.8).
 */
function ArtifactSlot({
  label,
  typed,
  onTyped,
  onSendNumber,
  onSelfReport,
  onPickFile,
  busy,
}: {
  label: string | null;
  typed: string;
  onTyped(v: string): void;
  onSendNumber(): void;
  onSelfReport(): void;
  onPickFile?: (file: File) => void;
  busy?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="mt-3.5 border-t border-hairline pt-3.5">
      {label ? (
        <div className="text-[13.5px] font-[620] text-ink-1">{label}</div>
      ) : null}

      <div className="mt-2 flex gap-2">
        <input
          className="min-h-[44px] min-w-0 flex-1 rounded-[10px] border border-hairline bg-[oklch(0_0_0/34%)] px-[12px] text-[14px] text-ink-1 placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pii"
          placeholder="접수번호"
          value={typed}
          onChange={(e) => onTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSendNumber();
          }}
          disabled={busy}
          data-numeric
        />
        <button
          type="button"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-[11px] bg-ink-1 px-4 text-[14.5px] font-[660] text-ground transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pii"
          onClick={onSendNumber}
          disabled={busy || typed.trim().length === 0}
        >
          입력
        </button>
      </div>

      {onPickFile ? (
        <>
          {/* 받는 것은 §3.2 가 정한 셋입니다 — 소리 아니면 사진 */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // **같은 파일을 다시 고를 수 있어야** 합니다 — 값을 비우지 않으면
              // 두 번째 선택에서 change 가 안 옵니다
              e.target.value = "";
              if (file) onPickFile(file);
            }}
          />
          <button
            type="button"
            className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-[11px] bg-ink-1 text-[14.5px] font-[660] text-ground transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95 disabled:opacity-50"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            {busy ? "올리는 중…" : "접수증·캡처 올리기"}
          </button>
        </>
      ) : null}

      {/* **완료가 되지 않습니다** — 리마인더 추적 대상으로만 남습니다 (L3) */}
      <button
        type="button"
        className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-[11px] text-[13.5px] text-ink-3 transition-colors duration-200 hover:text-ink-1 disabled:opacity-50"
        onClick={onSelfReport}
        disabled={busy}
      >
        번호 없이 했다고 표시
      </button>
    </div>
  );
}

/**
 * 열린 단계를 그립니다.
 *
 * **`body.action` 이 표 밖이면 아무것도 안 그립니다** — 모르는 것을 「읽기만
 * 하면 되는 것」으로 바꾸면 사용자가 해야 할 일을 안 해도 되는 줄 압니다
 * (`panelFor` 의 주석과 같은 이유).
 *
 * 패널에는 **`title` 과 본문만** 넘깁니다. 유형별 고유 props(대본·들고 갈 것·
 * 기재 항목)는 시안이 쓰던 자리이고, 그 값들의 서버 계약이 아직 없습니다 —
 * 본문은 KB 가 준 `summary`·`steps[].text` 를 그대로 씁니다(불변 규칙 1).
 *
 * ⚠️ **여기서 안 넘긴 것을 패널이 그리면 안 됩니다.** 2026-08-27 까지 패널들은
 * 안 받은 값을 조건 없이 그려서, 빈 상자와 **라벨이 빈 전폭 버튼**과 「계좌번호는
 * 그대로 적혀 있습니다」 같은 **없는 것을 가리키는 지시문**을 남겼습니다.
 * 결함은 패널 안이 아니라 **호출부와 패널 사이의 틈**에 있었습니다 —
 * 그래서 이 짝은 `panels.test.tsx`(패널 단독)와 `workspace.test.tsx`(일곱 유형을
 * 이 호출부로 통과시키는 것) **양쪽에서** 지킵니다.
 */
export function Workspace({ step, onSubmit, busy, verdict, onPickFile }: WorkspaceProps) {
  const [typed, setTyped] = useState("");

  if (!step) return null;
  const panel = panelForStep(step);
  if (!panel) return null;

  const contact = contactOf(step);

  const sendNumber = () => {
    const value = typed.trim();
    if (!value || busy) return;
    onSubmit(step.step_id, { kind: "receipt_no", value });
    setTyped("");
  };

  const sendSelfReport = () => {
    if (!busy) onSubmit(step.step_id, { kind: "other", selfReported: true });
  };

  const inside = (
    <>
      {step.body.summary ? (
        <div className="rounded-[10px] border border-hairline bg-chip p-[11px_12px] text-[13.5px] leading-[1.7] text-ink-2">
          {step.body.summary}
        </div>
      ) : null}

      {lines(step).map((text, i) => (
        <p key={i} className="mt-2 text-[13.5px] leading-[1.65] text-ink-2">
          {text}
        </p>
      ))}

      {contact ? (
        <p className="mt-2.5 text-[13.5px] text-ink-2">
          전화:{" "}
          <b className="font-[620] text-ink-1" data-numeric>
            {contact}
          </b>
        </p>
      ) : null}

      {step.body.caveat ? (
        <p className="mt-2.5 text-[12.5px] leading-[1.6] text-ink-3">{step.body.caveat}</p>
      ) : null}

      {/* **완료 개념이 있는 유형에만** 냅니다 → `panel.ts` 의 규칙 표 `hasCompletion`.
          `WS-read` 는 「완료 개념이 없습니다. 체크박스를 두지 마세요」이고 `WS-wait` 은
          「사용자가 하지 않음」입니다(spec 「유형별로 다른 것」). 읽기만 하면 되는 자리에
          「번호 없이 했다고 표시」를 두면, 사용자는 **아무 절차도 밟지 않고 단계를
          「미확인」으로 만들고** 그걸 한 것으로 기억합니다 — 불변 규칙 6 이 막는 모양입니다 */}
      {panelRule(panel).hasCompletion ? (
        <ArtifactSlot
          label={artifactLabel(step)}
          typed={typed}
          onTyped={setTyped}
          onSendNumber={sendNumber}
          onSelfReport={sendSelfReport}
          onPickFile={onPickFile ? (file) => onPickFile(step.step_id, file) : undefined}
          busy={busy}
        />
      ) : null}

      {verdict ? <Verdict verdict={verdict} /> : null}
    </>
  );

  const props = { title: step.title, children: inside };

  switch (panel) {
    case "WS-call":
      return <CallPanel {...props} />;
    case "WS-upload":
      return <UploadPanel {...props} />;
    case "WS-visit":
      return <VisitPanel {...props} />;
    case "WS-write":
      return <WritePanel {...props} />;
    case "WS-download":
      return <DownloadPanel {...props} />;
    case "WS-wait":
      return <WaitPanel {...props} />;
    case "WS-read":
      return <ReadPanel {...props} />;
  }
}
