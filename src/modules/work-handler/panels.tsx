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
 *  · **안 받은 값을 가리키는 것을 그리지 않습니다** — 아래 「빈 자리는 그리지 않습니다」
 */

import type { PanelId } from "./types";

/* ── 빈 자리는 그리지 않습니다 ────────────────────────────────────
   2026-08-27 까지 이 파일의 패널들은 **호출부가 넘기지도 않은 값**(`script`·`exitLabel`·
   `fileLabel`·`from`·`to`·`source`…)을 조건 없이 그렸습니다. 호출부인 `workspace.tsx` 는
   `title` 과 `children` 만 넘깁니다 — 그 값들의 서버 계약이 아직 없기 때문입니다.

   남은 것은 빈 상자와 **라벨이 빈 전폭 버튼**, 그리고 더 나쁜 것 — **없는 것을 가리키는
   지시문**이었습니다. 「계좌번호는 그대로 적혀 있습니다. 보고 읽으시면 됩니다」가
   지급정지 요청 통화 중인 사람 앞에 떠 있었습니다.

   ⚠️ **같은 자리를 같은 날 둘이 따로 고쳤습니다.** 다른 쪽은 값이 올 때만 그리도록
   **게이팅**했고, 이쪽은 위 둘을 **지웠습니다** — 게이팅으로 부족한 이유가 각각
   아래 자리에 적혀 있습니다(통화 패널의 `allowsFullRestore: false`, 대기 패널의
   상수 폭과 두 계약의 금지).

   그래서 규칙은 하나입니다: **넘어오지 않은 값에 딸린 것은 그 값을 가리키는 문장·상자까지
   함께 안 그립니다.** 값이 오면 그리는 자리로는 남습니다.

   버튼도 같은 규칙입니다 — **동작(`on*`)을 안 받으면 버튼을 안 그립니다.** 눌러도 아무
   일이 없는 버튼은 「막지 않음」이 아니라 「막힌 것처럼 보임」이라, spec 의
   「어느 패널에서도 나중에 하기를 막지 마세요」를 오히려 어깁니다. */

/* ── 재질 ─────────────────────────────────────────────────────────
   액티브(사용자가 지금 뭔가 하는 유형)는 띄운 면, 수동은 평면입니다.
   구분은 넷이 함께 만듭니다 — 그라데이션 · 밝기 · pii 테두리 · 채도 */
const ACTIVE =
  "rounded-[14px] border border-[oklch(0.697_0.16_258.2/34%)] " +
  "[background:linear-gradient(180deg,var(--panel-top),var(--panel-bottom))] " +
  // 입체감 — 위 모서리 하이라이트 + 아래 그림자. 평평한 테두리만으로는
  // 어두운 바탕에서 안 뜹니다 (2026-09-03 지적)
  "shadow-[0_1px_0_oklch(1_0_0/8%)_inset,0_14px_32px_-14px_oklch(0_0_0/70%)]";
const PASSIVE =
  "rounded-[14px] border border-hairline bg-surface " +
  "shadow-[0_1px_0_oklch(1_0_0/6%)_inset,0_10px_24px_-12px_oklch(0_0_0/60%)]";

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

/**
 * 「나중에」 — **미루는 길은 어느 패널에서도 막지 않습니다.**
 *
 * 단 **누구도 받지 않는 버튼은 그리지 않습니다**(`onClick` 이 없으면 `null`).
 * 눌렀는데 아무 일이 없으면 사용자는 「막혔다」로 읽고, 그건 이 버튼이 있는
 * 이유와 정반대입니다. 미루는 것 자체는 서버에 낼 것이 없어도 되지만,
 * **그 판단은 호출부가 합니다** — 패널은 렌더만 합니다.
 */
function Later({ onClick, children }: { onClick?: () => void; children: React.ReactNode }) {
  if (!onClick) return null;
  return (
    <button type="button" className={LATER} onClick={onClick}>
      {children}
    </button>
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
 *  `WS-download` 의 기재 항목 엔드포인트는 spec 에 TODO 로 남아 있습니다 (ADR-037) */
export interface PanelProps {
  title: string;
  /** 통화 타이머·D-day 처럼 상태 칩에 들어갈 것 */
  status?: { tone: "pii" | "amber"; label: string };
  /**
   * **부산물을 내는 자리** — 패널 본문 아래에 붙습니다 → §3.8.
   *
   * 넘기지 않으면 안 그립니다. 그래서 시안을 그리던 기존 호출부는
   * 그대로 돌고, 실제 단계에 붙은 호출부만 동작합니다.
   */
  children?: React.ReactNode;
}

/* ── 유형 일곱 ───────────────────────────────────────────────── */

/**
 * 통화 — 전화는 관측 불가한 블랙박스. **대본과 받아적기 칸이 타이머가 도는 동안 이미 떠 있어야** 합니다.
 *
 * 받아적기 칸은 **`children` 으로 옵니다**(`workspace.tsx` 의 `ArtifactSlot`).
 * 패널이 제 입력칸을 또 그리면 **칸이 두 개**가 되고 그중 하나는 아무 데도
 * 안 보내는 가짜라, 사용자는 통화 중에 받아 적은 접수번호를 잃습니다.
 */
export function CallPanel({ title, status, script, children }: PanelProps & {
  script?: React.ReactNode;
}) {
  return (
    <Shell
      active
      eyebrow="통화"
      title={title}
      status={status && <Chip tone={status.tone}>{status.label}</Chip>}
    >
      {/* 대본이 없으면 상자도 없습니다 — 빈 상자는 「여기 뭐가 있어야 하는데 안 떴다」로 읽힙니다 */}
      {script ? <div className={INNER}>{script}</div> : null}

      {/* ⚠️ 여기 「계좌번호는 그대로 적혀 있습니다. 보고 읽으시면 됩니다」가 조건 없이 떠
          있었습니다. **되살리지 마세요** — 값이 언젠가 채워질 자리가 아니라 계약상 영원히
          거짓인 문장입니다. `WS-call` 은 `allowsFullRestore: false` 라(panel.ts ·
          spec 「WS-download 가 PII 전체 복원이 허용된 유일한 작업 패널입니다」 ·
          불변 규칙 2) **이 패널에는 계좌번호 원문이 애초에 올 수 없습니다.**
          지급정지 요청 통화 중인 사람에게 없는 것을 읽으라고 지시하게 됩니다 */}

      {/* 시안은 여기에 받아적기 칸과 「올리기」를 그렸습니다. 실제 단계에 붙은 호출부는
          그 자리를 `children` 으로 받아 오고, 그쪽만 §3.8 로 냅니다 */}
      {children}
    </Shell>
  );
}

/** 외부 이동 — 화면을 떠나는 유일한 유형. **나가기 전에 「들고 돌아올 것」을 먼저** */
export function VisitPanel({
  title,
  status,
  bring,
  why,
  exitLabel,
  onExit,
  note,
  onLater,
  children,
}: PanelProps & {
  bring?: string;
  why?: string;
  exitLabel?: string;
  /** 나갈 곳은 호출부가 정합니다 → `panel.ts` 의 `exitFor` (기관별 `contact` · 기관 무관 `url`) */
  onExit?: () => void;
  note?: string;
  onLater?: () => void;
}) {
  return (
    <Shell
      active
      eyebrow="외부 이동"
      title={title}
      status={status && <Chip tone={status.tone}>{status.label}</Chip>}
    >
      {/* 「돌아오실 때 이걸 들고 오세요」는 `bring` 을 가리키는 문장입니다 — 값이 없으면
          상자째 안 그립니다. ◆ 뒤가 빈 줄은 「들고 올 것이 없다」로 읽히는데, 그건 이
          유형이 하는 말과 정반대입니다(spec 「무엇을 들고 돌아와야 하는지를 나가기 전에」) */}
      {bring ? (
        <div className={INNER}>
          <div className="text-[12.5px] text-ink-3">돌아오실 때 이걸 들고 오세요</div>
          <div className="mt-1.5 text-[14px] font-[620] text-ink-1">◆ {bring}</div>
          {why ? <p className="mt-1.5 text-[12.5px] text-ink-3">{why}</p> : null}
        </div>
      ) : null}

      {/* 라벨만 있고 갈 곳이 없으면 **화살표 하나짜리 전폭 버튼**이 남습니다 */}
      {exitLabel && onExit ? (
        <button type="button" className={`${PRIMARY} mt-3 w-full`} onClick={onExit}>
          {exitLabel} ↗
        </button>
      ) : null}

      <Later onClick={onLater}>나중에 할게요</Later>
      {note ? <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">{note}</p> : null}
      {children}
    </Shell>
  );
}

/**
 * 받아적기 — **형식이 틀려도 막지 않습니다.** 저장 후 「확인 필요」 표시만.
 *
 * 입력칸은 `CallPanel` 과 같은 이유로 **`children`(`ArtifactSlot`) 이 그립니다.**
 * 패널이 제 칸과 「저장」을 또 그리면 칸이 둘이 되고, 위엣것은 아무 데도 안
 * 보내서 **사용자가 적은 접수번호가 「저장」을 누르는 순간 사라집니다.**
 */
export function WritePanel({ title, why, onLater, children }: PanelProps & {
  why?: React.ReactNode;
  onLater?: () => void;
}) {
  return (
    <Shell active eyebrow="받아적기" title={title}>
      {why ? <p className={BODY}>{why}</p> : null}
      <Later onClick={onLater}>기억이 안 나요</Later>
      {/* 값에 딸린 문장이 아니라 이 유형이 늘 하는 말입니다 → spec 「형식이 틀려도 막지 않습니다」(L1) */}
      <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">
        형식이 달라도 저장됩니다.{" "}
        <b className="font-[620] text-deadline-urgent">확인 필요</b>로 표시만 합니다
      </p>
      {children}
    </Shell>
  );
}

/** 제출 — **「올려도 되는 이유」를 패널 안에서** 설명합니다 */
export function UploadPanel({ title, onLater, children }: PanelProps & {
  onLater?: () => void;
}) {
  return (
    <Shell active eyebrow="제출" title={title}>
      {/* ⚠️ 여기 끌어다 놓는 자리가 있었지만 **파일을 받는 손이 없었습니다.** 다시 만들지
          마세요 — 올리는 경로는 하나여야 합니다. `workspace.tsx` 의 `ArtifactSlot` 이
          `onPickFile` 로 §3.2 세 걸음을 밟고 §3.8 로 냅니다.
          둘째 경로를 만들면 그것이 곧 **가리지 않은 업로드 경로**가 됩니다
          → panel.ts 의 `WS-upload` 규칙(L2) · ADR-026 */}
      <div className={INNER}>
        <div className="text-[12.5px] text-ink-3">올리면 먼저 하는 일</div>
        <p className="mt-1.5 text-[13.5px] leading-[1.65] text-ink-2">
          {/* 파일은 브라우저가 못 가립니다 — 가리는 곳은 저희 서버(전사·판독)입니다.
              바깥 AI 로는 가려진 것만 나갑니다 (2026-09-02 문구 정정) */}
          이름·계좌·전화번호를{" "}
          <b className="font-[620] text-pii">저희 서버에서 가린 뒤에야</b> 바깥 AI 로 보냅니다
        </p>
      </div>
      <Later onClick={onLater}>나중에 올릴게요</Later>
      {children}
    </Shell>
  );
}

/** 받기 — **PII 전체 복원이 허용된 유일한 패널.** 사용자가 직접 연 자리입니다 */
export function DownloadPanel({
  title,
  status,
  fields,
  fileLabel,
  onDownload,
  onLater,
  children,
}: PanelProps & {
  fields?: { label: string; value: string }[];
  fileLabel?: string;
  onDownload?: () => void;
  onLater?: () => void;
}) {
  const rows = fields ?? [];

  return (
    <Shell
      active
      eyebrow="받기"
      title={title}
      status={status && <Chip tone={status.tone}>{status.label}</Chip>}
    >
      {/* 「이 화면은 원문입니다」는 **아래 값들을 가리키는 문장**입니다 — 기재 항목이
          없으면 상자도 문장도 안 그립니다. 아무것도 안 펼친 화면에 대고 원문이라고
          말하면, 정작 원문이 떴을 때 그 경고가 안 읽힙니다 */}
      {rows.length ? (
        <>
          <div className={INNER}>
            {rows.map((f) => (
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
        </>
      ) : null}

      {/* 받을 것이 정해져야 버튼이 생깁니다. 라벨만 넘어오면 **글자 없는 전폭 검은 버튼**입니다.
          ⬜ `doc-builder`(F-08) 엔드포인트 계약이 아직 없습니다 → ADR-037 · spec 「TODO」 */}
      {fileLabel && onDownload ? (
        <button type="button" className={`${PRIMARY} mt-3 w-full`} onClick={onDownload}>
          {fileLabel}
        </button>
      ) : null}

      <Later onClick={onLater}>나중에 받을게요</Later>
      {children}
    </Shell>
  );
}

/**
 * 기다리기 — **할 일이 없는 유형.** 앰버 금지, 「기다림이 정상」을 말하는 자리.
 *
 * ⚠️ 여기 진행 막대가 있었습니다. 폭이 `w-[38%]` 로 박혀 있어 **어느 사건에서나 38%**
 * 였고, 채권소멸공고 2개월의 진행률로 읽혔습니다. **다시 만들지 마세요** — 두 계약이
 * 이미 금지합니다: spec 「`WS-wait` 에 진행률 막대를 D-day 처럼 쓰지 마세요」 ·
 * panel.ts 의 `WS-wait` 규칙 「카운트다운을 만들지 마세요」. 그리고 **화면은 날짜를
 * 세지 않습니다**(불변 규칙 7 · 기한 규칙 「기준 시계는 서버」).
 *
 * 진행 정도를 보여줄 것이 생기면 **서버가 계산해 내려야** 합니다 — 자리는
 * `GET …/deadlines` 의 `kind: "info"` 에 `elapsed` 로 이미 잡혀 있고(§3.7 · 서버 미구현),
 * 그 값을 그리는 것은 `deadline-viewer` 쪽입니다. 화면이 폭을 계산하는 순간 다시
 * 카운트다운이 됩니다.
 */
export function WaitPanel({ title, body, footer, children }: PanelProps & {
  body?: React.ReactNode;
  footer?: string;
}) {
  return (
    <Shell active={false} eyebrow="기다리기" title={title}>
      {body ? <p className={BODY}>{body}</p> : null}
      {footer ? (
        <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">{footer}</p>
      ) : null}
      {children}
    </Shell>
  );
}

/** 읽기 — **완료 개념이 없습니다. 체크박스·버튼을 두지 마세요.** 사각지대를 사각지대라고 말하는 자리 */
export function ReadPanel({ title, body, source, children }: PanelProps & {
  body?: React.ReactNode;
  /** 근거 — §3.6 `citation.legal_basis` 가 올 자리입니다 */
  source?: string;
}) {
  return (
    <Shell active={false} eyebrow="읽기" title={title}>
      {body ? <p className={BODY}>{body}</p> : null}
      {/* 「근거 · 」 뒤가 비면 **근거 없는 안내**가 됩니다 — 불변 규칙 1 이 막는 바로 그
          모양이고, 빈 줄이 있으면 「근거는 원래 이렇게 비는 것」으로 굳습니다.
          값이 없으면 줄째 안 그립니다 */}
      {source ? (
        <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] leading-[1.6] text-ink-3">
          근거 · {source}
        </p>
      ) : null}
      {children}
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
