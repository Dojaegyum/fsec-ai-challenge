/**
 * work-handler / 렌더 — 유형별 작업 패널 일곱 (층 C · 브라우저)
 *
 * 계약: spec/frontend/08-17-workspace-panels.md · spec/frontend/08-14-screens.md §S-06
 * 시안: assets/artifacts/handoff/08-19-s06-chat/ 「WS Panels」 1a~1h
 *
 * ⚠️ **여기는 렌더만입니다.** 어느 패널을 열지는 `signal.ts`·`panel.ts`가 정하고,
 * 이 파일은 그 결과만 받아 그립니다 — 이 모듈의 규칙입니다(types.ts 머리말).
 * 패널 안에서 「다음에 무엇을 열지」를 계산하지 마세요.
 *
 * 절대 하지 않는 것
 *  · `WS-read` 에 체크박스·완료 버튼을 두지 않습니다 — 완료 개념이 없는 유형입니다
 *  · `WS-wait` 에 앰버를 쓰지 않습니다 — 기관 대기는 사용자 기한이 아니고 카운트다운도 아닙니다
 *  · `WS-download` 외의 패널에서 PII 원문을 펼치지 않습니다
 *  · 「나중에」를 막지 않습니다 — 미룬 단계는 「미확인」으로 남아 기한 추적이 계속됩니다
 *  · 화면에 `WS-*` 코드를 노출하지 않습니다 — 눈썹은 한글만
 */

import type { PanelId } from "./types";

/* ── 재질 ─────────────────────────────────────────────────────────
   액티브(사용자가 지금 뭔가 하는 유형)는 띄운 면, 수동은 평면입니다.
   구분은 넷이 함께 만듭니다 — 그라데이션 · 밝기 · pii 테두리 · 채도 */
const ACTIVE =
  "rounded-[14px] border border-[oklch(0.697_0.16_258.2/34%)] " +
  "[background:linear-gradient(180deg,var(--panel-top),var(--panel-bottom))]";
const PASSIVE = "rounded-[14px] border border-hairline bg-surface";

const EYEBROW = "text-[12.5px] font-[620] tracking-[0.13em]";
const TITLE = "mt-[5px] text-[16px] font-[640] text-ink-1";
const BODY = "text-[13.5px] leading-[1.65] text-ink-3";
const INNER =
  "rounded-[10px] border border-hairline bg-chip p-[11px_12px] text-[13.5px] leading-[1.7] text-ink-2";

/** 주 행동은 하나뿐입니다 */
/** ⚠️ 폭 유틸리티(`w-*`)를 여기 넣지 마세요. 쓰는 쪽에서 `w-auto` 로 덮으려 해도
 *  Tailwind 는 클래스 **문자열 순서가 아니라 생성된 CSS 순서**로 이겨서, 나란히 놓은
 *  입력칸이 0px 로 찌그러집니다. 폭은 항상 쓰는 쪽이 정합니다 */
const PRIMARY =
  "inline-flex min-h-[44px] items-center justify-center rounded-[11px] bg-ink-1 " +
  "text-[14.5px] font-[660] text-ground transition-[transform,opacity] duration-200 " +
  "hover:-translate-y-px hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pii";
/** 「나중에」 — 어느 패널에서도 상시. 막지 않습니다 */
const LATER =
  "mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-[11px] " +
  "text-[13.5px] text-ink-3 transition-colors duration-200 hover:text-ink-1";

const FIELD =
  "min-h-[44px] min-w-0 rounded-[10px] border border-hairline bg-[oklch(0_0_0/34%)] px-[12px] " +
  "text-[14px] text-ink-1 placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pii";

/** 가려진 값. 원문은 `WS-download` 에서만 펼쳐집니다 → pii-boundary */
export function Token({ children }: { children: React.ReactNode }) {
  return (
    <span className="mx-[1px] inline-flex rounded-[6px] border border-[oklch(0.697_0.16_258.2/36%)] bg-pii-bg px-2 py-px text-[12.5px] text-pii">
      {children}
    </span>
  );
}

function Chip({ tone, children }: { tone: "pii" | "amber"; children: React.ReactNode }) {
  const c =
    tone === "pii"
      ? "border-[oklch(0.697_0.16_258.2/42%)] bg-[oklch(0.697_0.16_258.2/10%)] text-pii"
      : "border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/10%)] text-deadline-urgent";
  return (
    <span
      data-numeric
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-[3px] text-[12.5px] font-[620] ${c}`}
    >
      {children}
    </span>
  );
}

/** 공통 골격 — 유형은 콘텐츠만 바꿉니다 (시안 1a) */
function Shell({
  active,
  eyebrow,
  title,
  status,
  children,
}: {
  active: boolean;
  eyebrow: string;
  title: string;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={`${active ? ACTIVE : PASSIVE} p-[16px_17px_17px]`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* 눈썹은 한글만 — WS-* 코드를 화면에 노출하지 않습니다 */}
          <div className={`${EYEBROW} ${active ? "text-pii" : "text-ink-4"}`}>{eyebrow}</div>
          <h3 className={TITLE}>{title}</h3>
        </div>
        {status}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** 각 패널이 받는 것. **서버 계약이 아직 없는 자리라 화면이 채워 넣습니다** —
 *  `WS-download` 초안 엔드포인트는 spec 에 TODO 로 남아 있습니다 */
export interface PanelProps {
  title: string;
  /** 통화 타이머·D-day 처럼 상태 칩에 들어갈 것 */
  status?: { tone: "pii" | "amber"; label: string };
  children?: React.ReactNode;
}

/* ── 유형 일곱 ───────────────────────────────────────────────── */

/** 통화 — 전화는 관측 불가한 블랙박스. **대본과 받아적기 칸이 타이머가 도는 동안 이미 떠 있어야** 합니다 */
export function CallPanel({ title, status, script, artifactLabel, placeholder }: PanelProps & {
  script: React.ReactNode;
  artifactLabel: string;
  placeholder: string;
}) {
  return (
    <Shell
      active
      eyebrow="통화"
      title={title}
      status={status && <Chip tone={status.tone}>{status.label}</Chip>}
    >
      <div className={INNER}>{script}</div>
      <p className="mt-2 text-[12.5px] text-ink-3">
        계좌번호는 <b className="font-[620] text-ink-2">그대로 적혀 있습니다.</b> 보고 읽으시면 됩니다
      </p>

      <div className="mt-3.5 text-[13.5px] font-[620] text-ink-1">{artifactLabel}</div>
      <div className="mt-2 flex gap-2">
        <input className={`${FIELD} flex-1`} placeholder={placeholder} data-numeric />
        <button type="button" className={`${PRIMARY} shrink-0 px-4`}>
          입력
        </button>
      </div>

      <button type="button" className={`${PRIMARY} mt-3 w-full`}>
        접수 문자 캡처 올리기
      </button>
      <button type="button" className={LATER}>
        나중에 입력할게요
      </button>
    </Shell>
  );
}

/** 외부 이동 — 화면을 떠나는 유일한 유형. **나가기 전에 「들고 돌아올 것」을 먼저** */
export function VisitPanel({ title, status, bring, why, exitLabel, note }: PanelProps & {
  bring: string;
  why: string;
  exitLabel: string;
  note?: string;
}) {
  return (
    <Shell
      active
      eyebrow="외부 이동"
      title={title}
      status={status && <Chip tone={status.tone}>{status.label}</Chip>}
    >
      <div className={INNER}>
        <div className="text-[12.5px] text-ink-3">돌아오실 때 이걸 들고 오세요</div>
        <div className="mt-1.5 text-[14px] font-[620] text-ink-1">◆ {bring}</div>
        <p className="mt-1.5 text-[12.5px] text-ink-3">{why}</p>
      </div>
      <button type="button" className={`${PRIMARY} mt-3 w-full`}>
        {exitLabel} ↗
      </button>
      <button type="button" className={LATER}>
        나중에 할게요
      </button>
      {note && <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">{note}</p>}
    </Shell>
  );
}

/** 받아적기 — **형식이 틀려도 막지 않습니다.** 저장 후 「확인 필요」 표시만 */
export function WritePanel({ title, placeholder, why }: PanelProps & {
  placeholder: string;
  why: React.ReactNode;
}) {
  return (
    <Shell active eyebrow="받아적기" title={title}>
      <input className={`${FIELD} w-full`} placeholder={placeholder} data-numeric />
      <p className={`mt-2 ${BODY}`}>{why}</p>
      <button type="button" className={`${PRIMARY} mt-3 w-full`}>
        저장
      </button>
      <button type="button" className={LATER}>
        기억이 안 나요
      </button>
      <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">
        형식이 달라도 저장됩니다.{" "}
        <b className="font-[620] text-deadline-urgent">확인 필요</b>로 표시만 합니다
      </p>
    </Shell>
  );
}

/** 제출 — **「올려도 되는 이유」를 패널 안에서** 설명합니다 */
export function UploadPanel({ title }: PanelProps) {
  return (
    <Shell active eyebrow="제출" title={title}>
      <div className="grid min-h-[92px] place-items-center rounded-[10px] border border-dashed border-hairline bg-chip px-3 text-center text-[13.5px] text-ink-3">
        끌어다 놓거나 눌러서 선택
      </div>
      <div className={`${INNER} mt-3`}>
        <div className="text-[12.5px] text-ink-3">올리면 먼저 하는 일</div>
        <p className="mt-1.5 text-[13.5px] leading-[1.65] text-ink-2">
          이름·계좌·전화번호를{" "}
          <b className="font-[620] text-pii">브라우저에서 가린 뒤</b> 전송합니다
        </p>
      </div>
      <button type="button" className={LATER}>
        나중에 올릴게요
      </button>
    </Shell>
  );
}

/** 받기 — **PII 전체 복원이 허용된 유일한 패널.** 사용자가 직접 연 자리입니다 */
export function DownloadPanel({ title, status, fields, fileLabel }: PanelProps & {
  fields: { label: string; value: string }[];
  fileLabel: string;
}) {
  return (
    <Shell
      active
      eyebrow="받기"
      title={title}
      status={status && <Chip tone={status.tone}>{status.label}</Chip>}
    >
      <div className={INNER}>
        {fields.map((f) => (
          <div key={f.label} className="flex justify-between gap-3 py-[3px]">
            <span className="text-[12.5px] text-ink-3">{f.label}</span>
            {/* 원문입니다 — 이 패널에서만 */}
            <span className="text-[13.5px] font-[580] text-ink-1">{f.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">
        <b className="font-[620] text-ink-2">이 화면은 원문입니다.</b> 복원은 이 브라우저
        안에서만 일어나고, 서버는 원문을 보지 못합니다.
      </p>
      <button type="button" className={`${PRIMARY} mt-3 w-full`}>
        {fileLabel}
      </button>
      <button type="button" className={LATER}>
        나중에 받을게요
      </button>
    </Shell>
  );
}

/** 기다리기 — **진행률이지 카운트다운이 아닙니다.** 앰버 금지, 「기다림이 정상」을 말하는 자리 */
export function WaitPanel({ title, body, from, to, footer }: PanelProps & {
  body: React.ReactNode;
  from: string;
  to: string;
  footer: string;
}) {
  return (
    <Shell active={false} eyebrow="기다리기" title={title}>
      <p className={BODY}>{body}</p>
      {/* 진행 구간 — 앰버를 쓰지 않습니다. 기관 대기는 사용자 기한이 아닙니다 */}
      <div className="mt-3 flex items-center gap-2 text-[12.5px] text-ink-3" data-numeric>
        <span>{from}</span>
        <span aria-hidden className="h-1.5 flex-1 rounded-full bg-[oklch(0.305_0.013_267.1/40%)]">
          <span className="block h-full w-[38%] rounded-full bg-[oklch(0.697_0.16_258.2/55%)]" />
        </span>
        <span>{to}</span>
      </div>
      <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">{footer}</p>
    </Shell>
  );
}

/** 읽기 — **완료 개념이 없습니다. 체크박스·버튼을 두지 마세요.** 사각지대를 사각지대라고 말하는 자리 */
export function ReadPanel({ title, body, source }: PanelProps & {
  body: React.ReactNode;
  source: string;
}) {
  return (
    <Shell active={false} eyebrow="읽기" title={title}>
      <p className={BODY}>{body}</p>
      <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] leading-[1.6] text-ink-3">
        근거 · {source}
      </p>
    </Shell>
  );
}

/** 화면이 이 표를 보고 고릅니다. 판정은 `panel.ts` 가 이미 끝냈습니다 */
export const PANEL_EYEBROW: Record<PanelId, string> = {
  "WS-call": "통화",
  "WS-visit": "외부 이동",
  "WS-write": "받아적기",
  "WS-upload": "제출",
  "WS-download": "받기",
  "WS-wait": "기다리기",
  "WS-read": "읽기",
};
