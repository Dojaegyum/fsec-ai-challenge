"use client";

/**
 * S-07 사건 · 플랜 — `/c/{token}` 의 `focus: "plan"` 일 때의 본문.
 *
 * 계약: spec/frontend/08-14-screens.md §S-07
 * 시안: assets/artifacts/handoff/08-19-s07-board-motion/ 「Board S-07 Options」
 *       **1c 골격 + 1b 히어로 스트립** 결합 (1a 3열 탈락)
 *
 * **며칠 뒤 링크를 열었을 때 「지금 뭘 해야 하나」가 첫 줄이어야 합니다.**
 * 빈 챗창이 뜨면 관리 서비스가 아닙니다 — 그래서 히어로 스트립이 맨 위입니다.
 *
 * 절대 하지 않는 것
 *  · **빨강을 쓰지 않습니다.** 기한 임박은 앰버 — 패닉을 더 밀어붙이지 않습니다
 *  · **화면이 날짜를 세지 않습니다.** D-day·기한 문자열은 서버가 계산한 값 그대로
 *    (spec/common/08-16-deadline-rules.md · 불변 규칙 7)
 *  · **제출처를 화면이 단정하지 않습니다** — 「앱에서」도 「서면으로」도 쓰지 마세요.
 *    은행마다 다르고, 그 값은 `org.contact.submit` 이 갖고 있습니다 (ADR-042).
 *    KB·NH 는 공식 안내가 **영업점 서면**이고 나머지 다섯은 **확인 실패**입니다
 *  · **보드를 비우지 않습니다.** 할 일이 없는 구간에도 보여줄 것이 있습니다
 *  · 완료를 사용자 체크로 판정하지 않습니다 — 부산물(◆)이 판정합니다
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다
 *  · GET …/plan §3.6 · GET …/deadlines §3.7
 *  · 층 C: plan-viewer · deadline-viewer
 */

/**
 * 서버(`GET …/plan`)가 내준 값 그대로. **화면이 상태를 계산하지 않습니다**
 *
 * 둘째 칸이 **순번**입니다. `null` 이면 순서가 없는 단계입니다.
 *
 * ⚠️ **세로로 늘어놓으면 사람은 순서로 읽습니다.** 그런데 우리 단계는 절반이
 * 순서가 없습니다 — 112 신고와 지급정지 요청은 **동시에** 하는 것이고
 * (`body.after` 가 둘 다 비어 있습니다), 명의도용 점검은 아무 때나 합니다.
 * 전부 번호를 매기면 **없는 순서를 지어내는 것**이고, 전부 안 매기면
 * 진짜 순서가 있는 곳(신청 → 서류 → 접수증)이 안 보입니다.
 *
 * 그래서 **번호는 `body.after` 사슬에 있는 것에만** 붙이고, 나머지는 점(·)입니다.
 * 순번은 `step_seq` 가 아니라 **사슬 안에서 몇 번째인가**입니다 —
 * `step_seq` 는 10·20·25 처럼 띄엄띄엄이라 사용자에게 보일 숫자가 아닙니다.
 */
const STEPS = [
  ["done", null, "국민은행에 지급정지 요청", "증빙됨", "◆ 통화 접수번호"],
  ["done", null, "112 신고", "증빙됨", "◆ 사건접수번호"],
  ["now", 1, "피해구제 신청서 제출", "D-2", "8월 20일까지"],
  ["todo", 2, "접수증 올리기", "미시작", ""],
  ["anytime", null, "명의도용 점검", "언제든", ""],
  ["na", null, "가상자산 환급 신청", "해당 없음", ""],
] as const;

/** 사건 진행 레일 — 지금 어디쯤인지. 색만으로 가르지 않고 라벨을 함께 둡니다 */
const RAIL = [
  ["지급정지", "done"],
  ["피해구제", "now"],
  ["공고 2개월", "todo"],
  ["결정", "todo"],
  ["환급", "todo"],
] as const;

type Tone = (typeof STEPS)[number][0];

/** 상태 어휘 — 모양·글자·색 셋이 함께 갑니다 (색 하나로 가르지 않습니다) */
const MARK: Record<Tone, { glyph: string; cls: string }> = {
  done: {
    glyph: "✓",
    cls: "border-[oklch(0.697_0.16_258.2/70%)] bg-[oklch(0.697_0.16_258.2/22%)] text-pii",
  },
  now: {
    glyph: "→",
    cls: "border-[oklch(0.77_0.117_70.9/70%)] bg-[oklch(0.77_0.117_70.9/20%)] text-deadline-urgent",
  },
  todo: { glyph: "•", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  anytime: { glyph: "•", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  na: { glyph: "—", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
};

/** 부모 `.view-in` 이 0.5초 지연이라, 자식 계단도 그 뒤에서 시작해야 합니다 —
 *  안 그러면 자식이 다 나타난 뒤에 부모가 페이드인합니다 */
const step = (i: number) => ({ animationDelay: `${520 + i * 120}ms` });

export default function PlanView() {
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5">
      {/* ── 히어로 스트립 — 첫 줄이 답입니다 ─────────────── */}
      <section
        style={step(0)}
        className="rise rounded-[13px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[15px_18px]"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3">
          <div className="min-w-0">
            {/* flex + gap 을 쓰지 마세요 — 글자 마디 사이에도 간격이 들어가
                「8월 20일  까지」처럼 벌어집니다. 아이콘만 margin 으로 띄웁니다 */}
            <p className="text-[13px] text-deadline-urgent">
              <span aria-hidden className="mr-1.5">◷</span>
              지금 하실 일은 하나입니다 · <span data-numeric>8월 20일</span>까지
            </p>
            <h2 className="mt-1 text-[21px] font-[660] leading-[1.4] tracking-[-0.01em] text-ink-1">
              피해구제 신청서를 국민은행에 제출하세요
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
              넘기더라도 <b className="font-[620] text-ink-2">9월 3일까지 유예</b>가 남습니다.
              오늘이 마지막은 아닙니다.
            </p>
          </div>
          <div
            data-numeric
            aria-hidden
            className="shrink-0 rounded-[11px] border border-[oklch(0.77_0.117_70.9/45%)] px-4 py-2 text-[26px] font-[700] leading-none text-deadline-urgent"
          >
            D-2
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-5 text-[14px] font-[660] text-ground"
          >
            지금 하기
          </button>
          <button
            type="button"
            className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] border border-hairline bg-chip px-5 text-[14px] font-[560] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]"
          >
            무엇을 적는지 보기
          </button>
          {/* 제출처는 히어로가 말하지 않습니다 (ADR-042) — 대신 어디서 보는지를 알립니다.
              기재 안내 화면의 첫 카드가 `org.contact.submit` 을 순서 그대로 그립니다 */}
          <p className="w-full text-[12.5px] leading-[1.6] text-ink-3">
            내는 곳은 은행마다 다릅니다 —{" "}
            <b className="font-[620] text-ink-2">「무엇을 적는지 보기」</b>의 첫 줄에 있습니다.
          </p>
        </div>
      </section>

      {/* ── 사건 진행 레일 ──────────────────────────────── */}
      <section style={step(1)} className="rise">
        <h3 className="text-[12.5px] tracking-[0.12em] text-ink-4">사건 진행</h3>
        <ol className="mt-2.5 grid grid-cols-5 gap-1.5">
          {RAIL.map(([label, tone]) => (
            <li key={label}>
              <div
                aria-hidden
                className={`h-1 rounded-full ${
                  tone === "done"
                    ? "bg-pii"
                    : tone === "now"
                      ? "bg-deadline-urgent"
                      : "bg-[oklch(1_0_0/12%)]"
                }`}
              />
              <p
                className={`mt-1.5 text-[12.5px] ${
                  tone === "done"
                    ? "text-pii"
                    : tone === "now"
                      ? "font-[620] text-deadline-urgent"
                      : "text-ink-3"
                }`}
              >
                {label}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── 단계 목록 ──────────────────────────────────── */}
      <section style={step(2)} className="rise">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="text-[12.5px] tracking-[0.12em] text-ink-4">할 일</h3>
          {/* ⚠️ 세로 목록은 순서로 읽힙니다. 절반은 순서가 없으니 말로 밝힙니다 */}
          <p className="text-[12.5px] leading-[1.5] text-ink-3">
            <b className="font-[620] text-ink-2">번호가 붙은 것만 순서대로</b>입니다. 나머지는 <b className="font-[620] text-ink-2">순서와 상관없습니다.</b>
          </p>
        </div>
        <ul className="mt-2">
          {STEPS.map(([tone, order, label, tag, artifact]) => {
            const mark = MARK[tone];
            return (
              <li
                key={label}
                className={`flex items-center gap-3 border-b border-hairline px-1.5 py-3 last:border-b-0 ${
                  tone === "now" ? "rounded-[8px] bg-[oklch(0.77_0.117_70.9/8%)]" : ""
                } ${tone === "na" ? "opacity-50" : ""}`}
              >
                {/* 순번이 있으면 숫자, 없으면 상태 글리프. **한 칸만 씁니다** —
                    두 칸으로 나누면 어느 쪽이 순서인지가 더 헷갈립니다.

                    ⚠️ 순번일 때는 **읽히는 글자**입니다 — `aria-hidden` 으로 덮어
                    12.5px 하한을 피하지 마세요. 21px/11px 이던 것을 24px/12.5px 로
                    올렸습니다 (ADR-032) */}
                <span
                  {...(order === null ? { "aria-hidden": true } : {})}
                  data-numeric={order === null ? undefined : true}
                  className={`grid size-[24px] shrink-0 place-items-center rounded-full border text-[12.5px] font-[700] ${mark.cls}`}
                >
                  {order === null ? mark.glyph : order}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-[14.5px] ${
                      tone === "now" ? "font-[620] text-ink-1" : "text-ink-2"
                    }`}
                  >
                    {label}
                  </span>
                  {artifact && (
                    <span className="block text-[12.5px] text-ink-3">{artifact}</span>
                  )}
                </span>
                <span
                  data-numeric
                  className={`shrink-0 text-[12.5px] ${
                    tone === "done"
                      ? "text-pii"
                      : tone === "now"
                        ? "font-[620] text-deadline-urgent"
                        : "text-ink-3"
                  }`}
                >
                  {tag}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">
          기한은 <b className="font-[620] text-ink-2">서버가 계산한 값</b>입니다. 화면이 날짜를
          세지 않습니다. 완료는 체크가 아니라 <b className="font-[620] text-ink-2">부산물(◆)</b>이
          판정합니다.
        </p>
      </section>

      {/* ── 공고 대기 — 할 일이 없는 두 달에도 보드는 비지 않습니다 ──
          앰버를 쓰지 않습니다: 사용자 기한이 아니라 제도가 흐르는 시간입니다 */}
      <section
        style={step(3)}
        className="rise rounded-[13px] border border-hairline bg-surface-low p-[15px_18px]"
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-pii [animation:pulse-dot_2.6s_ease-in-out_infinite]"
          />
          <h3 className="text-[14px] font-[620] text-ink-1">
            다음은 채권소멸 공고 2개월, 기다리는 구간입니다
          </h3>
        </div>
        <p className="mt-2 text-[13.5px] leading-[1.65] text-ink-3">
          신청이 접수되면 공고가 나가고, 그동안은{" "}
          <b className="font-[620] text-ink-2">할 일이 없습니다.</b> 그 사이 통지문이 오면 여기에
          올려주세요. 무슨 뜻인지 풀어 드리는 것이 이 구간의 일입니다.
        </p>
        <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-3">
          기다리는 동안 할 수 있는 것: 명의도용 점검 · 가족에게 링크 보내기
        </p>
      </section>
    </div>
  );
}
