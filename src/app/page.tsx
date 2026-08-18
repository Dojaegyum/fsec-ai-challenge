import Image from "next/image";
import Link from "next/link";

/**
 * S-04 랜딩 — `/`
 *
 * 계약: spec/frontend/08-14-screens.md
 * 목업: assets/artifacts/plans/08-17-screen-mockups.html 「화면 01」
 *
 * **목업의 구조·비율을 따릅니다.** 실제 브라우저는 목업 창(1180px)보다 넓어서,
 * 폭과 헤드라인 크기는 화면에 맞춰 키웠습니다 — 목업 값을 그대로 쓰면
 * 넓은 화면에서 콘텐츠가 가운데 작게 뭉칩니다.
 *
 * 목업과 다른 곳 셋 (전부 의도적)
 *  · `.xs` 12.4px → **13px** — 디자인 시스템의 「13px 미만 금지」(고령 사용자 기준)
 *  · 헤드라인 40px → **clamp(38…66px)** — 넓은 화면에서 히어로가 히어로답게
 *  · 기대치 문구를 「대상인지 알려드리는 것」 → **「방향을 잡아드리는 것」**
 *
 * 지켜야 할 것
 *  · 행동은 [지금 시작하기] 하나. 메뉴·소개·요금 링크를 붙이지 않습니다
 *  · 첫 문장이 포지셔닝입니다 — 112를 대체하지 않는다를 헤드라인이 직접 말합니다
 *  · 아직 신고 전인 사람을 112로 내보냅니다. 전환율을 깎지만, 빼면 가장 급한 사람을 붙잡습니다
 *  · 기대치 관리를 랜딩에서 합니다 — 뒤에서 말하면 이미 기대가 부풀어 있습니다
 */

const 하는일 = [
  ["1", "무슨 일이 있었는지만 말하면", "보낸 방법에 맞는 절차를 찾아드립니다"],
  ["2", "기한을 대신 셉니다", "3영업일·2개월 같은 법정 기한을 규칙으로 계산합니다"],
  ["3", "서류를 만들어 드립니다", "받은 통지가 무슨 뜻인지도 읽어드립니다"],
] as const;

/** 목업의 `.cd` — 떠 있는 카드 */
const cd = "rounded-[14px] border border-hairline bg-surface px-[18px] py-[16px]";
/** 목업의 `.cd.dash` — 배경 없이 점선만 */
const cdDash = "rounded-[14px] border border-dashed px-[18px] py-[16px]";

/** 위에서 아래로 차례로 나타납니다. 값은 등장 순서 */
const step = (i: number) => ({ animationDelay: `${60 + i * 70}ms` });

export default function Landing() {
  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden">
      {/* 브랜드 분위기. 의미를 싣지 않습니다 → design-system/08-16-tokens.md */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[62vh] opacity-60
                   [background:radial-gradient(110%_140%_at_50%_142%,var(--color-horizon)_0%,oklch(0.44_0.10_58)_34%,transparent_70%)]"
      />
      {/* 위쪽에 아주 옅은 빛 하나 — 헤더가 허공에 뜬 것처럼 보이지 않게 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[38vh] opacity-[0.07]
                   [background:radial-gradient(80%_100%_at_50%_0%,var(--color-pii)_0%,transparent_70%)]"
      />

      {/* 목업 `.top` — stage 바탕에 실선 하나 */}
      <header className="relative z-10 border-b border-hairline bg-stage/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-shell items-center justify-between gap-4 px-[clamp(20px,4.2vw,72px)] py-[15px]">
          {/* 목업 `.brand` — 심볼은 브랜드 자산, 워드마크는 텍스트.
              가로 로고에는 태그라인이 함께 그려져 있어 28px 높이에서 뭉개집니다 */}
          <div className="rise flex items-center gap-2.5">
            <Image
              src="/brand/symbol-mark.png"
              alt=""
              width={169}
              height={158}
              priority
              className="h-[26px] w-auto invert"
            />
            <span className="text-[19px] font-[660] tracking-[-0.02em] text-ink-1">
              Fin<span className="text-pii">Ally</span>
            </span>
          </div>
          <span
            style={step(0)}
            className="rise inline-flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-[6px] text-[13px] text-pii
                       border border-[oklch(0.697_0.16_258.2/42%)] bg-[oklch(0.697_0.16_258.2/10%)]"
          >
            <span aria-hidden className="size-1.5 rounded-full bg-current" />
            개인정보는 브라우저 밖으로 나가지 않습니다
          </span>
        </div>
      </header>

      <div className="relative mx-auto grid w-full max-w-shell flex-1 items-center gap-12 px-[clamp(20px,4.2vw,72px)] py-[clamp(48px,7vh,88px)] md:grid-cols-[1.15fr_minmax(0,1fr)] md:gap-[clamp(36px,4.5vw,76px)]">
        {/* ── 왼쪽 · 포지셔닝과 단 하나의 행동 ───────────────── */}
        <section>
          <h1
            style={step(1)}
            className="rise text-[clamp(38px,4.6vw,66px)] font-[690] leading-[1.14] tracking-[-0.035em] text-ink-1"
          >
            신고는 하셨나요?
            <br />
            그다음부터
            <br />
            저희가 맡습니다.
          </h1>

          <p
            style={step(2)}
            className="rise mt-6 max-w-[42ch] text-[clamp(17px,1.35vw,19px)] leading-[1.66] text-ink-3"
          >
            은행에 언제 무엇을 내야 하는지, 기한이 며칠 남았는지 — 몇 달 동안 대신
            챙깁니다.
          </p>

          <div
            style={step(3)}
            className="rise mt-9 flex flex-wrap items-center gap-x-4 gap-y-3"
          >
            <Link
              href="/start"
              className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-[12px]
                         bg-ink-1 px-8 text-[16px] font-[660] text-ground
                         shadow-[0_1px_0_oklch(1_0_0/40%)_inset,0_10px_30px_-12px_oklch(1_0_0/35%)]
                         transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pii"
            >
              지금 시작하기
            </Link>
            <span className="text-[13px] text-icon">
              진술 한 줄이면 됩니다 · 회원가입 없음
            </span>
          </div>

          {/* 전환율을 깎는 자리입니다. 빼면 가장 급한 사람을 우리 화면에 붙잡습니다 */}
          <aside
            style={step(4)}
            className={`${cdDash} rise mt-10 max-w-[46ch] border-[oklch(0.761_0.117_70.9/40%)] bg-[oklch(0.761_0.117_70.9/4%)]`}
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden
                className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full
                           bg-[oklch(0.761_0.117_70.9/18%)] text-[12px] font-bold text-deadline-urgent"
              >
                !
              </span>
              <div>
                <div className="text-[14.5px] font-[620] text-ink-1">
                  아직 신고 전이신가요?
                </div>
                <p className="mt-1 text-[13.5px] leading-[1.6] text-ink-3">
                  <b className="font-[660] text-deadline-urgent" data-numeric>
                    112
                  </b>
                  에 먼저 신고하세요. 저희는 그다음을 맡습니다.
                </p>
              </div>
            </div>
          </aside>
        </section>

        {/* ── 오른쪽 · 문단이 아니라 세 장의 카드 ─────────────── */}
        <section className="grid content-center gap-3">
          {하는일.map(([n, title, body], i) => (
            <article
              key={n}
              style={step(2 + i)}
              className={`${cd} rise flex items-start gap-[13px]
                          transition-colors duration-200 hover:border-[oklch(0.697_0.16_258.2/38%)]`}
            >
              <span
                aria-hidden
                data-numeric
                className="mt-[3px] grid size-[22px] shrink-0 place-items-center rounded-full
                           border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/22%)]
                           text-[12px] font-bold text-pii"
              >
                {n}
              </span>
              <div>
                <h2 className="text-[15.5px] font-[620] leading-[1.45] text-ink-1">
                  {title}
                </h2>
                <p className="mt-[3px] text-[13.5px] leading-[1.6] text-ink-3">
                  {body}
                </p>
              </div>
            </article>
          ))}

          {/* 기대치 관리를 랜딩에서 합니다 → CLAUDE.md 불변 규칙 8 */}
          <p
            style={step(5)}
            className={`${cdDash} rise mt-2 border-hairline text-[13px] leading-[1.65] text-icon`}
          >
            환급을 보장하지 않습니다.{" "}
            <b className="font-[660] text-ink-2">방향을 잡아드리는 것</b>
            까지가 저희 몫입니다.
          </p>
        </section>
      </div>
    </main>
  );
}
