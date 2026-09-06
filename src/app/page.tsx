import Image from "next/image";
import Link from "next/link";

import { HorizonGlow } from "@/components/HorizonGlow";

import LandingScenes from "./scenes";

/**
 * S-04 랜딩 — `/` (리디자인 · 시안 1c)
 *
 * 계약: spec/frontend/08-14-screens.md
 * 시안: FSEC 렌더 페이지 설계 프로젝트 「Landing Options」 1c 확정본
 *
 * 이전 구현과 달라진 것
 *  · 좌우 2단 → **심볼 중심의 센터 히어로**. 오비트 링 + 오렌지(horizon) 글로우
 *  · 3단계 카드는 히어로 아래 3열 그리드로
 *  · 「링크 하나로 이어지는 화면들」 섹션 — 화면별 역할을 소개. 2026-09-06 부터
 *    와이어프레임이 아니라 **실제 화면 컴포넌트를 픽스처로 그립니다** (`scenes.tsx`)
 *
 * 지켜야 할 것 (이전과 동일)
 *  · 행동은 [지금 시작하기] 하나. 메뉴·소개·요금 링크를 붙이지 않습니다
 *  · 아직 신고 전인 사람을 112로 내보냅니다
 *  · 기대치 관리를 랜딩에서 합니다 — 환급 보장 없음을 여기서 말합니다
 *  · **「서류를 만들어 드립니다」라고 쓰지 마세요.** 우리가 하는 것은 서식의 칸과 값을
 *    짝지어 보여주는 것까지입니다 (ADR-037). 2026-08-19 시안에 있던 문구를 08-21 에 고쳤습니다
 *  · **「파란 토큰 = 서버로 안 갔다는 뜻」도 쓰지 마세요.** ADR-034 이후 화면은 원문을
 *    보여주고, 토큰이 되는 것은 경계를 넘을 때입니다 — 그 문장은 이제 사실이 아닙니다
 *  · 링·글로우는 장식입니다. --horizon 규칙대로 의미를 싣지 않습니다
 *
 * 필요한 keyframes(spin-slow·spin-rev·pulse-dot·breathe·bloom-in)는 globals.css 에
 * 있습니다 — prefers-reduced-motion 감속이 함께 적용됩니다.
 *
 * 첫 렌더의 순서 — 링·글로우가 `bloom`(1.2s)으로 피어나는 동안 글자가 `rise` 계단으로
 * 올라옵니다. 가운데 심볼은 `priority` — lazy 로 두면 링이 먼저 서고 가운데가
 * 비었다가 채워져 툭 끊깁니다. 바닥의 호라이즌은 `HorizonGlow` 가 천천히 켭니다.
 * 장식이 먼저 툭 서 있고 글자만 올라오면 둘이 따로 놉니다 — 그게 2026-08-25 이전의 모습이었습니다.
 */

const 하는일 = [
  ["1", "무슨 일이 있었는지만 말하면", "보낸 방법에 맞는 절차를 찾아드립니다"],
  ["2", "기한을 대신 셉니다", "3영업일·2개월 같은 법정 기한을 규칙으로 계산합니다"],
  ["3", "서류는 칸마다 짚어 드립니다", "무엇을 어디에 적는지 값과 함께. 받은 통지도 읽어드립니다"],
] as const;

/**
 * 위에서 아래로 차례로 나타납니다. 값은 등장 순서.
 *
 * 간격이 70ms 였을 때는 **거의 동시에 뜨는 것처럼** 보였습니다 — 계단이
 * 계단으로 읽히려면 한 칸이 앞칸의 움직임보다 늦게 시작해야 합니다
 * (2026-08-28). 마지막 칸까지 0.63초 + 등장 0.62초 = 1.25초입니다.
 */
const step = (i: number) => ({ animationDelay: `${60 + i * 95}ms` });

export default function Landing() {
  return (
    <main className="relative isolate flex min-h-svh flex-col overflow-hidden">
      {/* 브랜드 분위기 — 문서 끝에 걸린 호라이즌. 의미를 싣지 않습니다 → design-system/08-16-tokens.md.
          `isolate` 가 있어야 글 아래에 깔립니다 (HorizonGlow 머리말) */}
      <HorizonGlow />

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
            {/* 범위를 좁혀 말합니다 — 이름은 자체 서버가, 녹음·캡처는 전사 서버가 원문으로
                받습니다(동의 전문 1·4항). 「브라우저 밖으로 안 나간다」는 그 전문과 반대말이었고,
                기획서 ⑧이 정확히 좁혀 쓴 문장(「외부 AI 업체로 나가지 않는다」)에 맞춥니다 */}
            바깥 AI 에는 가려진 글만 갑니다
          </span>
        </div>
      </header>

      {/* ── 히어로 · 심볼 오비트 + 포지셔닝 + 단 하나의 행동 ───────── */}
      <section className="relative mx-auto flex w-full max-w-shell flex-col items-center px-[clamp(20px,4.2vw,72px)] pt-[clamp(56px,9vh,88px)] pb-16 text-center">
        {/* 오비트 링 — 장식 전용. 회전은 reduced-motion 에서 멈춥니다 */}
        {/* 아래 여백은 상자(180px)가 아니라 링의 바깥선 기준입니다 —
            가장 바깥 링이 -inset-[52px] 로 상자 밖까지 나가므로,
            52px 를 빼고 남는 것이 눈에 보이는 간격입니다 (40~64px).
            바깥 링을 더하거나 빼면 이 값도 같이 옮기세요.
            2026-08-25 에 넷째 링(-80px)을 뺐습니다 — 넷이면 첫 렌더가 어수선했습니다 */}
        <div
          aria-hidden
          className="bloom relative mb-[clamp(92px,calc(12vh-28px),116px)] grid size-[180px] place-items-center"
        >
          {/* 오렌지 가우시안 글로우 */}
          <div
            className="pointer-events-none absolute -inset-[230px] rounded-full blur-[34px]
                       [background:radial-gradient(circle,oklch(0.811_0.14_66.9/42%)_0%,oklch(0.44_0.10_58/22%)_44%,transparent_70%)]
                       [animation:breathe_6s_ease-in-out_infinite]"
          />
          {/* 링 셋 — 안쪽 180 · 232 · 284px. 알파는 안에서 바깥으로 갈수록 옅어집니다 */}
          <div className="absolute inset-0 rounded-full border border-[oklch(0.697_0.16_258.2/62%)] [animation:breathe_5s_ease-in-out_infinite]" />
          <div className="absolute -inset-[26px] rounded-full border border-dashed border-[oklch(0.697_0.16_258.2/48%)] [animation:spin-slow_46s_linear_infinite]" />
          <div className="absolute -inset-[52px] rounded-full border border-[oklch(0.42_0.018_267.1/88%)]" />
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
            {/* priority — 없으면 lazy 로 늦게 와서 링이 먼저 서고 가운데가 비었다가 채워집니다 */}
            <Image
              src="/brand/symbol-square-white.png"
              alt=""
              width={124}
              height={124}
              priority
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
          실제 화면 컴포넌트 넷을 픽스처로 그립니다 — 전부 inert 라 그림의 자격입니다.
          무엇을 어떻게 세우는지는 `scenes.tsx` 머리말 */}
      <section
        style={step(6)}
        className="rise relative z-[2] mt-4 border-t border-[oklch(0.305_0.013_267.1/40%)]"
      >
        <div className="mx-auto w-full max-w-shell px-[clamp(20px,4.2vw,72px)] pt-13 pb-12">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 className="text-[13px] font-[620] tracking-[0.14em] text-ink-4">
              링크 하나로 이어지는 화면들
            </h2>
            <span className="text-[13px] text-ink-3">
              회원가입 없이, 발급된 링크가 곧 사건 열쇠입니다
            </span>
          </div>

          <LandingScenes />

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
