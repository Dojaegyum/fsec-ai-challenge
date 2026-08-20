import Image from "next/image";
import Link from "next/link";

/**
 * S-04 랜딩 — `/` (리디자인 · 시안 1c)
 *
 * 계약: spec/frontend/08-14-screens.md
 * 시안: FSEC 렌더 페이지 설계 프로젝트 「Landing Options」 1c 확정본
 *
 * 이전 구현과 달라진 것
 *  · 좌우 2단 → **심볼 중심의 센터 히어로**. 오비트 링 + 오렌지(horizon) 글로우
 *  · 3단계 카드는 히어로 아래 3열 그리드로
 *  · 「링크 하나로 이어지는 화면들」 섹션 추가 — 화면별 역할을 미니 목업으로 소개.
 *    각 화면 디자인이 확정되는 대로 목업을 하나씩 실물로 교체합니다
 *
 * 지켜야 할 것 (이전과 동일)
 *  · 행동은 [지금 시작하기] 하나. 메뉴·소개·요금 링크를 붙이지 않습니다
 *  · 아직 신고 전인 사람을 112로 내보냅니다
 *  · 기대치 관리를 랜딩에서 합니다 — 환급 보장 없음을 여기서 말합니다
 *  · 링·글로우는 장식입니다. --horizon 규칙대로 의미를 싣지 않습니다
 *
 * 필요한 keyframes(spin-slow·spin-rev·pulse-dot·breathe)는 globals.css 에
 * 추가합니다 — prefers-reduced-motion 감속이 함께 적용됩니다.
 */

const 하는일 = [
  ["1", "무슨 일이 있었는지만 말하면", "보낸 방법에 맞는 절차를 찾아드립니다"],
  ["2", "기한을 대신 셉니다", "3영업일·2개월 같은 법정 기한을 규칙으로 계산합니다"],
  ["3", "서류를 만들어 드립니다", "받은 통지가 무슨 뜻인지도 읽어드립니다"],
] as const;

/** 위에서 아래로 차례로 나타납니다. 값은 등장 순서 */
const step = (i: number) => ({ animationDelay: `${60 + i * 70}ms` });

/** 미니 목업 공통 — 장식이므로 전부 aria-hidden. 실물 확정 시 교체 */
const wireBar = "rounded-[4px] bg-[oklch(0.305_0.013_267.1/70%)]";
const wireBarDim = "rounded-[4px] bg-[oklch(0.305_0.013_267.1/45%)]";
const piiChip =
  "inline-flex rounded-[5px] bg-pii-bg px-[7px] py-[2px] text-[11px] text-pii";

export default function Landing() {
  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden">
      {/* 브랜드 분위기. 의미를 싣지 않습니다 → design-system/08-16-tokens.md */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-[-10%] h-[70vh] opacity-45
                   [background:radial-gradient(100%_120%_at_50%_130%,oklch(0.811_0.14_66.9/70%)_0%,oklch(0.44_0.10_58/60%)_36%,transparent_72%)]"
      />

      <header className="relative z-10 border-b border-hairline bg-stage/80 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-shell items-center justify-between gap-4 px-[clamp(20px,4.2vw,72px)] py-[15px]">
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
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-current [animation:pulse-dot_2.6s_ease-in-out_infinite]"
            />
            개인정보는 브라우저 밖으로 나가지 않습니다
          </span>
        </div>
      </header>

      {/* ── 히어로 · 심볼 오비트 + 포지셔닝 + 단 하나의 행동 ───────── */}
      <section className="relative mx-auto flex w-full max-w-shell flex-col items-center px-[clamp(20px,4.2vw,72px)] pt-[clamp(56px,9vh,88px)] pb-16 text-center">
        {/* 오비트 링 — 장식 전용. 회전은 reduced-motion 에서 멈춥니다 */}
        {/* 아래 여백은 상자(180px)가 아니라 링의 바깥선 기준입니다 —
            가장 바깥 링이 -inset-[80px] 로 상자 밖까지 나가므로,
            80px 를 빼고 남는 것이 눈에 보이는 간격입니다 (40~64px).
            바깥 링을 더하거나 빼면 이 값도 같이 옮기세요 */}
        <div
          aria-hidden
          className="relative mb-[clamp(120px,12vh,144px)] grid size-[180px] place-items-center"
        >
          {/* 오렌지 가우시안 글로우 */}
          <div
            className="pointer-events-none absolute -inset-[230px] rounded-full blur-[34px]
                       [background:radial-gradient(circle,oklch(0.811_0.14_66.9/42%)_0%,oklch(0.44_0.10_58/22%)_44%,transparent_70%)]
                       [animation:breathe_6s_ease-in-out_infinite]"
          />
          {/* 링 넷 — 안쪽 180 · 232 · 284 · 340px. 알파는 안에서 바깥으로 갈수록 옅어집니다 */}
          <div className="absolute inset-0 rounded-full border border-[oklch(0.697_0.16_258.2/62%)] [animation:breathe_5s_ease-in-out_infinite]" />
          <div className="absolute -inset-[26px] rounded-full border border-dashed border-[oklch(0.697_0.16_258.2/48%)] [animation:spin-slow_46s_linear_infinite]" />
          <div className="absolute -inset-[52px] rounded-full border border-[oklch(0.42_0.018_267.1/88%)]" />
          {/* 새 바깥 층 — 가장 옅고 가장 느립니다. 깊이만 더하고 시선을 끌지 않게 */}
          <div className="absolute -inset-[80px] rounded-full border border-[oklch(0.36_0.014_267.1/52%)]" />
          <div
            className="absolute -inset-[80px] rounded-full [animation:spin-rev_64s_linear_infinite]
                       [background:conic-gradient(from_300deg,transparent_0_88%,oklch(0.697_0.16_258.2/55%)_96%,transparent_100%)]
                       [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),#000_calc(100%-1px))]"
          />
          <div
            className="absolute -inset-[52px] rounded-full [animation:spin-slow_9s_linear_infinite]
                       [background:conic-gradient(from_0deg,transparent_0_78%,oklch(0.697_0.16_258.2/95%)_92%,transparent_100%)]
                       [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),#000_calc(100%-1px))]"
          />
          <div
            className="absolute -inset-[26px] rounded-full [animation:spin-rev_14s_linear_infinite]
                       [background:conic-gradient(from_180deg,transparent_0_86%,oklch(0.811_0.14_66.9/92%)_95%,transparent_100%)]
                       [mask:radial-gradient(farthest-side,transparent_calc(100%-2px),#000_calc(100%-1px))]"
          />
          <div
            className="relative grid size-[112px] place-items-center rounded-full border border-hairline
                       [background:radial-gradient(circle_at_50%_38%,var(--surface),var(--ground)_78%)]
                       shadow-[0_0_60px_-12px_oklch(0.697_0.16_258.2/35%),0_1px_0_oklch(1_0_0/8%)_inset]"
          >
            <Image
              src="/brand/symbol-square-white.png"
              alt=""
              width={124}
              height={124}
              className="size-[62px]"
            />
          </div>
        </div>

        <h1
          style={step(1)}
          className="rise text-[clamp(38px,4.3vw,62px)] font-[700] leading-[1.14] tracking-[-0.038em] text-ink-1"
        >
          신고는 하셨나요?
          <br />
          {/* 2행만 오른쪽으로 0.21em 밀어 광학 중앙을 맞춥니다.
              가운데 정렬은 글자폭 기준인데 마침표는 폭만 차지하고 잉크가 거의 없어
              2행이 왼쪽으로 밀려 보입니다. 1행은 「?」 가 폭을 채워 보정이 필요 없습니다.

              ⚠️ margin 으로 하지 마세요. 이 section 이 flex + items-center 라
              h1 이 내용에 맞춰 줄어드는데, 음수 margin 이 그 폭 계산에 섞이면
              상자가 글자보다 좁아져 줄바꿈이 생깁니다. position:relative 는
              레이아웃 폭을 건드리지 않아 안전합니다. */}
          <span className="relative left-[0.21em]">그다음부터 저희가 맡습니다.</span>
        </h1>

        <p
          style={step(2)}
          className="rise mt-[22px] max-w-[46ch] text-[clamp(17px,1.35vw,19px)] leading-[1.7] text-ink-3"
        >
          은행에 언제 무엇을 내야 하는지, 기한이 며칠 남았는지.
          <br />몇 달 동안 대신 챙깁니다.
        </p>

        <div style={step(3)} className="rise mt-9 flex flex-col items-center gap-3">
          <Link
            href="/start"
            className="inline-flex min-h-[52px] items-center rounded-[12px] bg-ink-1 px-11 text-[17px] font-[660] text-ground
                       shadow-[0_1px_0_oklch(1_0_0/40%)_inset,0_16px_40px_-14px_oklch(0.697_0.16_258.2/45%)]
                       transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pii"
          >
            지금 시작하기
          </Link>
          <span className="text-[13px] text-ink-3">
            진술 한 줄이면 됩니다 · 회원가입 없음
          </span>
        </div>
      </section>

      {/* ── 하는 일 · 세 장의 카드 ────────────────────────────── */}
      <section className="relative z-[2] mx-auto grid w-full max-w-shell gap-4 px-[clamp(20px,4.2vw,72px)] pb-10 md:grid-cols-3">
        {하는일.map(([n, title, body], i) => (
          <article
            key={n}
            style={step(3 + i)}
            className="rise rounded-[16px] border border-hairline p-6
                       [background:linear-gradient(180deg,var(--surface),var(--surface-low))]
                       shadow-[0_1px_0_oklch(1_0_0/7%)_inset,0_24px_48px_-28px_oklch(0_0_0)]
                       transition-colors duration-200 hover:border-[oklch(0.697_0.16_258.2/38%)]"
          >
            <span
              aria-hidden
              data-numeric
              className="grid size-[26px] place-items-center rounded-full border border-[oklch(0.697_0.16_258.2/45%)]
                         bg-[oklch(0.697_0.16_258.2/22%)] text-[13px] font-bold text-pii"
            >
              {n}
            </span>
            <h2 className="mt-3.5 text-[17px] font-[640] text-ink-1">{title}</h2>
            <p className="mt-1.5 text-[14.5px] leading-[1.65] text-ink-3">{body}</p>
          </article>
        ))}
      </section>

      {/* ── 링크 하나로 이어지는 화면들 ───────────────────────────
          각 화면 디자인이 확정되는 대로 미니 목업을 실물 스크린샷/렌더로 교체합니다.
          지금은 역할 소개가 목적 — 와이어프레임은 전부 장식(aria-hidden)입니다 */}
      <section className="relative z-[2] mt-4 border-t border-[oklch(0.305_0.013_267.1/40%)]">
        <div className="mx-auto w-full max-w-shell px-[clamp(20px,4.2vw,72px)] pt-13 pb-12">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 className="text-[13px] font-[620] tracking-[0.14em] text-ink-4">
              링크 하나로 이어지는 화면들
            </h2>
            <span className="text-[13px] text-ink-3">
              회원가입 없이, 발급된 링크가 곧 사건 열쇠입니다
            </span>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-4">
            {/* /start — 동의와 링크 발급 */}
            <article className="overflow-hidden rounded-[14px] border border-hairline bg-surface-low">
              <div aria-hidden className="flex h-[118px] flex-col gap-2 border-b border-hairline bg-stage p-4">
                <div className={`${wireBar} h-[9px] w-[64%]`} />
                <div className={`${wireBarDim} h-[9px] w-[44%]`} />
                <div className="mt-auto flex items-center gap-2">
                  <div className="h-6 w-[74px] rounded-[7px] bg-ink-1 opacity-90" />
                  <div className="h-6 w-[58px] rounded-[7px] border border-[oklch(0.305_0.013_267.1/70%)]" />
                </div>
              </div>
              <div className="px-[18px] pt-[15px] pb-[17px]">
                <div className="flex items-baseline gap-2">
                  <span data-numeric className="text-[13px] font-[660] text-pii">/start</span>
                  <h3 className="text-[15px] font-[640] text-ink-1">동의, 그리고 링크 발급</h3>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-3">
                  관문은 동의 하나뿐. 증거·이메일은 줄 수 있는 사람만 줍니다.
                </p>
              </div>
            </article>

            {/* 챗 — 진술로 절차 선택 */}
            <article className="overflow-hidden rounded-[14px] border border-hairline bg-surface-low">
              <div aria-hidden className="flex h-[118px] flex-col gap-2 border-b border-hairline bg-stage p-4">
                <div className="h-5 w-[58%] self-start rounded-[9px_9px_9px_3px] bg-[oklch(0.305_0.013_267.1/50%)]" />
                <div className="h-5 w-[34%] self-end rounded-[9px_9px_3px_9px] border border-[oklch(0.697_0.16_258.2/35%)] bg-[oklch(0.697_0.16_258.2/25%)]" />
                <div className="mt-auto flex gap-1.5">
                  <div className="h-5 w-[52px] rounded-full border border-[oklch(0.305_0.013_267.1/70%)]" />
                  <div className="h-5 w-[52px] rounded-full border border-[oklch(0.305_0.013_267.1/70%)]" />
                  <div className="h-5 w-[44px] rounded-full border border-[oklch(0.697_0.16_258.2/40%)] bg-[oklch(0.697_0.16_258.2/10%)]" />
                </div>
              </div>
              <div className="px-[18px] pt-[15px] pb-[17px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-[660] text-pii">챗</span>
                  <h3 className="text-[15px] font-[640] text-ink-1">진술로 절차를 고릅니다</h3>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-3">
                  질문은 한 번에 하나, 전부 버튼. 「모름」도 항상 답입니다.
                </p>
              </div>
            </article>

            {/* 보드 — 지금 할 일 */}
            <article className="overflow-hidden rounded-[14px] border border-hairline bg-surface-low">
              <div aria-hidden className="flex h-[118px] flex-col gap-[7px] border-b border-hairline bg-stage p-4">
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full border border-[oklch(0.697_0.16_258.2/60%)] bg-[oklch(0.697_0.16_258.2/25%)]" />
                  <div className={`${wireBar} h-2 w-[56%]`} />
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full border-2 border-pii" />
                  <div className={`${wireBar} h-2 w-[44%]`} />
                  <div className="ml-auto h-4 w-[38px] rounded-full border border-[oklch(0.761_0.117_70.9/50%)] bg-[oklch(0.761_0.117_70.9/12%)]" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="size-3 rounded-full border border-[oklch(0.305_0.013_267.1/70%)]" />
                  <div className={`${wireBarDim} h-2 w-[50%]`} />
                </div>
                <div className="mt-auto h-1.5 w-full rounded-[4px] bg-[oklch(0.305_0.013_267.1/40%)]">
                  <div className="h-full w-[38%] rounded-[4px] bg-[oklch(0.697_0.16_258.2/60%)]" />
                </div>
              </div>
              <div className="px-[18px] pt-[15px] pb-[17px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-[660] text-pii">보드</span>
                  <h3 className="text-[15px] font-[640] text-ink-1">지금 뭘 해야 하나</h3>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-3">
                  며칠 뒤에 열어도 첫 줄이 답합니다. 기한은 서버가 셉니다.
                </p>
              </div>
            </article>

            {/* 증거함·서류 — PII 마스킹이 보이는 곳 */}
            <article className="overflow-hidden rounded-[14px] border border-hairline bg-surface-low">
              <div aria-hidden className="flex h-[118px] flex-col gap-2 border-b border-hairline bg-stage p-4">
                <div className={`${wireBar} h-2 w-[70%] opacity-80`} />
                <div className="flex flex-wrap items-center gap-[5px]">
                  <div className={`${wireBarDim} h-2 w-[34%]`} />
                  <span className={piiChip}>계좌·1</span>
                  <div className={`${wireBarDim} h-2 w-[18%]`} />
                  <span className={piiChip}>이름·1</span>
                </div>
                <div className={`${wireBarDim} h-2 w-[52%]`} />
                <div className="mt-auto flex items-center gap-1.5">
                  <div className="size-2.5 rounded-[3px] border border-[oklch(0.697_0.16_258.2/60%)]" />
                  <div className={`${wireBarDim} h-[7px] w-[40%]`} />
                </div>
              </div>
              <div className="px-[18px] pt-[15px] pb-[17px]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[13px] font-[660] text-pii">증거함·서류</span>
                  <h3 className="text-[15px] font-[640] text-ink-1">가려지는 게 보입니다</h3>
                </div>
                <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-3">
                  파란 토큰 = 서버로 안 갔다는 뜻. 서류 초안까지 만듭니다.
                </p>
              </div>
            </article>
          </div>

          {/* 기대치 관리를 랜딩에서 합니다 → CLAUDE.md 불변 규칙 8 */}
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-7 gap-y-3 text-[13.5px] text-ink-3">
            <span>
              <b className="font-[660] text-deadline-urgent">신고 전이라면 112가 먼저</b>
              입니다 — 저희는 그다음을 맡습니다
            </span>
            <span aria-hidden className="hidden h-3.5 w-px bg-hairline md:block" />
            <span>
              환급을 보장하지 않습니다 ·{" "}
              <b className="font-[640] text-ink-2">방향을 잡아드리는 것</b>
              까지가 저희 몫입니다
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}
