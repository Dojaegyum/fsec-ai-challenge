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
 *  · **「서면 신청」이라 쓰지 않습니다** — 낡은 표현입니다
 *  · **보드를 비우지 않습니다.** 할 일이 없는 구간에도 보여줄 것이 있습니다
 *  · 완료를 사용자 체크로 판정하지 않습니다 — 부산물(◆)이 판정합니다
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다
 *  · GET …/plan §3.6 · GET …/deadlines §3.7
 *  · 층 C: plan-viewer · deadline-viewer
 */

/** 서버(`GET …/plan`)가 내준 값 그대로. **화면이 상태를 계산하지 않습니다** */
const STEPS = [
  ["done", "국민은행에 지급정지 요청", "증빙됨", "◆ 통화 접수번호"],
  ["done", "112 신고 — 접수번호 기록됨", "증빙됨", "◆ 사건접수번호"],
  ["now", "피해구제 신청서 제출", "D-2", "8월 20일까지"],
  ["todo", "접수증 올리기", "미시작", ""],
  ["anytime", "명의도용 점검", "언제든", ""],
  ["na", "가상자산 환급 신청", "해당 없음", ""],
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
  todo: { glyph: "○", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  anytime: { glyph: "◇", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
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
            <p className="flex items-center gap-2 text-[13px] text-deadline-urgent">
              <span aria-hidden>◷</span>
              지금 하실 일은 하나입니다 · <span data-numeric>8월 20일</span>까지
            </p>
            <h2 className="mt-1 text-[21px] font-[660] leading-[1.4] tracking-[-0.01em] text-ink-1">
              피해구제 신청서를 국민은행 앱에서 제출하세요
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
              넘기더라도 <b className="font-[620] text-ink-2">9월 3일까지 유예</b>가 남습니다 —
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
            서류 초안 열기
          </button>
        </div>
      </section>

      {/* ── 사건 진행 레일 ──────────────────────────────── */}
      <section style={step(1)} className="rise">
        <h3 className="text-[12.5px] tracking-[0.12em] text-icon">사건 진행</h3>
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
                      : "text-icon"
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
        <h3 className="text-[12.5px] tracking-[0.12em] text-icon">할 일</h3>
        <ul className="mt-2">
          {STEPS.map(([tone, label, tag, artifact]) => {
            const mark = MARK[tone];
            return (
              <li
                key={label}
                className={`flex items-center gap-3 border-b border-hairline px-1.5 py-3 last:border-b-0 ${
                  tone === "now" ? "rounded-[8px] bg-[oklch(0.77_0.117_70.9/8%)]" : ""
                } ${tone === "na" ? "opacity-50" : ""}`}
              >
                <span
                  aria-hidden
                  className={`grid size-[21px] shrink-0 place-items-center rounded-full border text-[11px] font-[700] ${mark.cls}`}
                >
                  {mark.glyph}
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
                    <span className="block text-[12.5px] text-icon">{artifact}</span>
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
        <p className="mt-3 text-[12.5px] leading-[1.6] text-icon">
          기한은 <b className="font-[620] text-ink-2">서버가 계산한 값</b>입니다 — 화면이 날짜를
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
            다음은 기다리는 구간입니다 — 채권소멸 공고 2개월
          </h3>
        </div>
        <p className="mt-2 text-[13.5px] leading-[1.65] text-ink-3">
          신청이 접수되면 공고가 나가고, 그동안은 <b className="font-[620] text-ink-2">할 일이 없습니다.</b>{" "}
          대신 그 사이 오는 통지문을 여기에 올려주시면 무슨 뜻인지 풀어 드립니다 — 그게 이 구간의
          일입니다.
        </p>
        <p className="mt-2 text-[12.5px] leading-[1.6] text-icon">
          기다리는 동안 할 수 있는 것: 명의도용 점검 · 가족에게 링크 보내기
        </p>
      </section>
    </div>
  );
}
