import Image from "next/image";
import Link from "next/link";

/**
 * S-04 랜딩 — `/`
 *
 * 계약: spec/frontend/08-14-screens.md
 * 목업: assets/artifacts/plans/08-17-screen-mockups.html 「화면 01」
 *
 * **목업의 구조·간격·크기를 그대로 옮긴 것입니다.** 임의로 바꾸지 마세요.
 * 하나만 다릅니다 — 목업의 12.4px(`.xs`)를 **13px**로 올렸습니다.
 * 디자인 시스템이 「13px 미만을 쓰지 않습니다」로 정했고(고령 사용자 기준),
 * 차이가 0.6px이라 인상이 바뀌지 않습니다 → design-system/08-16-tokens.md.
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
const cd = "rounded-[14px] border border-hairline bg-surface px-[17px] py-[15px]";
/** 목업의 `.cd.dash` — 배경 없이 점선만 */
const cdDash = "rounded-[14px] border border-dashed px-[17px] py-[15px]";

export default function Landing() {
  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden">
      {/* 브랜드 분위기. 의미를 싣지 않습니다 → design-system/08-16-tokens.md */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[46vh] opacity-55
                   [background:radial-gradient(120%_150%_at_50%_150%,var(--color-horizon)_0%,oklch(0.42_0.09_58)_38%,transparent_72%)]"
      />

      {/* 목업 `.top` — stage 바탕에 실선 하나 */}
      <header className="relative flex items-center justify-between gap-4 border-b border-hairline bg-stage px-[26px] py-[14px]">
        {/* 목업 `.brand` — 심볼은 브랜드 자산, 워드마크는 텍스트.
            가로 로고에는 태그라인이 함께 그려져 있어 28px 높이에서 뭉개집니다 */}
        <div className="flex items-center gap-2.5">
          <Image
            src="/brand/symbol-mark.png"
            alt=""
            width={169}
            height={158}
            priority
            className="h-6 w-auto invert"
          />
          <span className="text-[18px] font-[660] tracking-[-0.02em] text-ink-1">
            Fin<span className="text-pii">Ally</span>
          </span>
        </div>
        <span
          className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-[11px] py-[5px] text-[13px] text-pii
                     border border-[oklch(0.697_0.16_258.2/42%)] bg-[oklch(0.697_0.16_258.2/10%)]"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          개인정보는 브라우저 밖으로 나가지 않습니다
        </span>
      </header>

      <div className="relative mx-auto grid w-full max-w-wide flex-1 items-center gap-10 px-6 py-14 md:grid-cols-[1.15fr_1fr] md:gap-[52px] md:px-[52px] md:pb-14 md:pt-16">
        {/* ── 왼쪽 · 포지셔닝과 단 하나의 행동 ───────────────── */}
        <section>
          <h1 className="text-[40px] font-[690] leading-[1.18] tracking-[-0.03em] text-ink-1">
            신고는 하셨나요?
            <br />
            그다음부터
            <br />
            저희가 맡습니다.
          </h1>

          <p className="mt-[22px] max-w-[40ch] text-[17px] leading-[1.66] text-ink-3">
            은행에 언제 무엇을 내야 하는지, 기한이 며칠 남았는지 — 몇 달 동안 대신
            챙깁니다.
          </p>

          <div className="mt-[30px] flex flex-wrap items-center gap-[14px]">
            <Link
              href="/start"
              className="inline-flex min-h-[var(--size-touch)] items-center justify-center rounded-[12px]
                         bg-ink-1 px-[26px] text-[15.5px] font-[660] text-ground
                         transition-opacity hover:opacity-90
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
            className={`${cdDash} mt-[34px] max-w-[44ch] border-[oklch(0.761_0.117_70.9/40%)]`}
          >
            <div className="flex items-start gap-[11px]">
              <span
                aria-hidden
                className="text-[16px] leading-none text-deadline-urgent"
              >
                !
              </span>
              <div>
                <div className="text-[14.4px] font-[620] text-ink-1">
                  아직 신고 전이신가요?
                </div>
                <p className="mt-[3px] text-[13.4px] text-ink-3">
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
        <section className="grid gap-[11px]">
          {하는일.map(([n, title, body]) => (
            <article key={n} className={`${cd} flex items-start gap-[13px]`}>
              <span
                aria-hidden
                data-numeric
                className="mt-[3px] grid size-[21px] shrink-0 place-items-center rounded-full
                           border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/22%)]
                           text-[11.5px] font-bold text-pii"
              >
                {n}
              </span>
              <div>
                <h2 className="text-[15px] font-[620] text-ink-1">{title}</h2>
                <p className="mt-[2px] text-[13.4px] text-ink-3">{body}</p>
              </div>
            </article>
          ))}

          {/* 기대치 관리를 랜딩에서 합니다 → CLAUDE.md 불변 규칙 8 */}
          <p
            className={`${cdDash} mt-[6px] border-hairline text-[13px] leading-[1.62] text-icon`}
          >
            환급을 보장하지 않습니다.{" "}
            <b className="font-[660] text-ink-2">대상인지 알려드리는 것</b>
            까지가 저희 몫입니다.
          </p>
        </section>
      </div>
    </main>
  );
}
