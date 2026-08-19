"use client";

import Image from "next/image";
import { useState } from "react";
import { CallPanel, Token } from "@/modules/work-handler";

/**
 * S-06 사건 · 챗 국면 — `/c/{token}` (시안 1c 확정본)
 *
 * 계약: spec/frontend/08-14-screens.md §S-06 · spec/frontend/08-17-workspace-panels.md
 * 시안: assets/artifacts/handoff/08-19-s06-chat/ 「Chat S-06 Options」 1c
 *
 * 두 국면이 한 주소입니다
 *  · 국면 1 — 진술을 받습니다. 우측은 「사건 파일」이 실시간으로 채워집니다
 *  · 국면 2 — 챗이 단계를 가리키면 **같은 자리**가 WS 패널로 바뀝니다
 *
 * 지켜야 할 것
 *  · **스트리밍하지 않습니다** (ADR-022). 근거 검증이 끝난 뒤 한 번에 나갑니다 —
 *    그 대가로 기다리는 동안 **무엇을 하는지 문장으로** 보여줍니다. 점 3개·타자기 금지
 *  · 질문은 한 번에 하나 · 전부 버튼 · 「기억이 안 나요」 상시 (F-05b).
 *    같은 크기·같은 자리에 두고 글자색만 ink-3
 *  · **파란 토큰 = 서버로 안 갔다**는 뜻입니다. 흐리지 마세요 (ADR-013)
 *  · T0 안전 절차는 **슬롯과 무관하게 상시** 붙어 있습니다
 *  · 패널은 **언급이 없으면 닫지 않습니다** — 적던 접수번호를 잃습니다
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다
 *  · POST …/messages §3.9 · GET …/slots §3.4 · GET …/plan §3.6
 *  · pendingStatus 는 poll-checker 응답 그대로. 화면이 추측·계산하지 않습니다
 *  · CASE_TOKEN 을 실제 경로 파라미터로
 */

const CASE_TOKEN = "7fK2p"; // TODO: params.token 으로 교체

/** T0 — 어떤 경우에도 틀리지 않는 절차라 항상 표시됩니다 */
const T0 = [
  ["112", "신고", "사건접수번호를 받아 두세요 — 다음 서류에 들어갑니다"],
  ["1332", "금융 상담", "금융감독원"],
  ["", "추가로 절대 송금하지 마세요", "「해결해 준다」는 연락도 같은 조직입니다"],
  ["", "앱을 설치했다면 비행기모드", "악성앱이 통화를 가로챌 수 있습니다"],
] as const;

/** 「기억이 안 나요」는 **같은 크기·같은 자리**. 글자색만 내립니다 */
const CHOICES = [
  ["계좌로 이체했어요", false],
  ["간편송금 앱으로 보냈어요", false],
  ["직접 만나서 현금으로", false],
  ["기억이 안 나요", true],
] as const;

/** 서버(poll-checker)가 내준 값 그대로. **화면이 추측하지 않습니다** */
const PENDING_STEPS = [
  "진술을 확인했습니다 — 간편송금 경로",
  "맞는 절차를 대조하고 있습니다",
  "근거를 검증합니다 — 출처 없는 문장은 나가지 않습니다",
] as const;

const CASE_FILE = [
  ["피해 유형", "기관 사칭 (검찰)", "filled"],
  ["피해 금액", "금액·1", "token"],
  ["보낸 방법", "지금 여쭤보는 중", "asking"],
  ["보낸 시각", "다음 질문", "future"],
  ["상대 계좌", "모름이어도 진행", "future"],
] as const;

const step = (i: number) => ({ animationDelay: `${60 + i * 70}ms` });

export default function CaseChat() {
  const [t0Open, setT0Open] = useState(true);
  const [phase, setPhase] = useState<"intake" | "working">("intake");
  const [copied, setCopied] = useState(false);

  const working = phase === "working";

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(`https://finally.kr/c/${CASE_TOKEN}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 미지원 — 주소는 헤더에 보이므로 손으로 옮길 수 있습니다 */
    }
  };

  return (
    <main className="flex min-h-svh flex-col">
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <header className="border-b border-hairline bg-stage">
        <div className="mx-auto flex h-[56px] w-full max-w-shell items-center justify-between gap-4 px-[clamp(16px,3vw,32px)]">
          <div className="flex items-center gap-2.5">
            <Image
              src="/brand/symbol-mark.png"
              alt=""
              width={169}
              height={158}
              priority
              className="h-[23px] w-auto invert"
            />
            <span className="text-[18px] font-[660] tracking-[-0.02em] text-ink-1">
              Fin<span className="text-pii">Ally</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span
              data-numeric
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3"
            >
              <span aria-hidden className="size-[5px] rounded-full bg-pii" />
              사건 {CASE_TOKEN}
            </span>
            {working && (
              <span className="inline-flex items-center rounded-full border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/10%)] px-3 py-[5px] text-[13px] font-[620] text-deadline-urgent">
                피해구제 신청 D-2
              </span>
            )}
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-hairline bg-chip px-3 text-[13px] text-ink-3 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] hover:text-ink-1"
            >
              {copied ? "복사됨 ✓" : "주소 복사"}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-shell flex-1 md:grid-cols-[1fr_350px]">
        {/* ── 왼쪽 · T0 + 챗 ────────────────────────────── */}
        <section className="flex min-w-0 flex-col px-[clamp(16px,3vw,32px)] py-[clamp(18px,3vh,28px)]">
          <div className="mx-auto flex w-full max-w-[700px] flex-1 flex-col">
            {/* T0 — 슬롯과 무관하게 상시. 접어도 요약 한 줄은 남습니다 */}
            <div className="rounded-[14px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg p-[13px_15px]">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <p className="min-w-0 text-[13.5px] leading-[1.6] text-ink-2">
                  <b className="font-[620] text-pii">112 신고 ✓</b> · 1332 상담 · 추가 송금 금지 ·
                  비행기모드 — <span className="text-ink-3">항상 여기 있습니다</span>
                </p>
                <button
                  type="button"
                  onClick={() => setT0Open((v) => !v)}
                  aria-expanded={t0Open}
                  className="inline-flex min-h-[var(--size-touch)] shrink-0 items-center text-[13px] text-pii"
                >
                  {t0Open ? "접기 ▴" : "펼치기 ▾"}
                </button>
              </div>
              {t0Open && (
                <ul className="mt-3 grid gap-2.5 border-t border-[oklch(0.697_0.16_258.2/22%)] pt-3">
                  {T0.map(([num, name, why]) => (
                    <li key={name} className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        data-numeric
                        className="mt-px grid size-[21px] shrink-0 place-items-center rounded-full border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/18%)] text-[12.5px] font-[620] text-pii"
                      >
                        {num || "!"}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-[600] text-ink-1">
                          {num ? `${num} ${name}` : name}
                        </span>
                        <span className="block text-[13px] text-icon">{why}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 챗 스트림 */}
            <div className="mt-5 flex flex-1 flex-col gap-3.5">
              <Bubble who="ai" i={0}>
                무슨 일이 있으셨는지 편하게 적어주세요. 문장이 아니어도 됩니다.
              </Bubble>
              <Bubble who="me" i={1}>
                아까 검찰이라면서 전화가 와서 3백만원을 보냈어요
              </Bubble>
              <Bubble who="ai" i={2}>
                <Token>금액·1</Token>을 보내셨군요. 개인정보는 이렇게 가려진 채로만 처리됩니다.
              </Bubble>

              {working ? (
                <>
                  <Bubble who="ai" i={3}>
                    접수 문자 잘 받았습니다. 다음은{" "}
                    <b className="font-[620] text-ink-1">국민은행에 지급정지 요청</b>입니다.
                    전화로 하실 수 있게{" "}
                    <b className="font-[620] text-ink-1">대본을 오른쪽에 준비했습니다</b> — 끊기
                    전에 접수번호만 받아적으시면 됩니다.
                  </Bubble>
                  <Bubble who="me" i={4}>
                    뭐라고 말해야 하죠?
                  </Bubble>
                  <Bubble who="ai" i={5}>
                    오른쪽 대본을 그대로 읽으시면 됩니다. 가려진 <Token>계좌·2</Token> 같은 값은{" "}
                    <b className="font-[620] text-ink-1">그 화면에서만</b> 원래 숫자로 펼쳐집니다.
                  </Bubble>
                </>
              ) : (
                <>
                  <Bubble who="ai" i={3}>
                    바로 이어서 여쭐게요 —{" "}
                    <b className="font-[640] text-ink-1">돈이 어떻게 나갔나요?</b>
                    <span className="mt-1.5 block text-[13px] text-icon">
                      한 번에 하나만 여쭤봅니다
                    </span>
                  </Bubble>

                  {/* 선택지 — 전부 버튼. 기본 선택 없음 */}
                  <div
                    style={step(4)}
                    className="rise grid gap-2 md:grid-cols-2"
                    role="radiogroup"
                    aria-label="돈이 어떻게 나갔나요?"
                  >
                    {CHOICES.map(([label, dim]) => (
                      <button
                        key={label}
                        type="button"
                        role="radio"
                        aria-checked={false}
                        onClick={() => setPhase("working")}
                        className={`flex min-h-[48px] items-center gap-2.5 rounded-[12px] border border-hairline bg-chip px-[14px] py-[11px] text-left text-[14.5px] transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] ${
                          dim ? "text-ink-3" : "text-ink-2"
                        }`}
                      >
                        <span aria-hidden className="shrink-0 text-[18px] text-icon">
                          ○
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* 컴포저 — 포커스 링은 여기에만 */}
            <div className="mt-5 flex items-center gap-2 rounded-[14px] border border-[oklch(0.697_0.16_258.2/45%)] bg-surface px-[14px] shadow-[0_0_0_3px_oklch(0.697_0.16_258.2/10%)]">
              <input
                aria-label="진술 입력"
                placeholder={working ? "무엇이든 물어보세요" : "직접 적으셔도 됩니다"}
                className="min-h-[52px] flex-1 bg-transparent text-[14.5px] text-ink-1 placeholder:text-ink-4 focus:outline-none"
              />
              <button
                type="button"
                aria-label="보내기"
                className="grid size-[30px] shrink-0 place-items-center rounded-full bg-ink-1 text-[14px] font-bold text-ground"
              >
                ↑
              </button>
            </div>
          </div>
        </section>

        {/* ── 오른쪽 · 사건 파일 → WS 패널 ────────────────
            같은 자리입니다. 챗이 단계를 가리키면 여기가 바뀝니다 */}
        <aside className="border-t border-hairline bg-[oklch(1_0_0/1.5%)] p-[clamp(16px,3vw,20px)] md:border-l md:border-t-0">
          {working ? (
            <>
              <div className="mb-3 text-[12.5px] tracking-[0.12em] text-icon">워크스페이스</div>
              <CallPanel
                title="국민은행에 전화"
                status={{ tone: "pii", label: "⏱ 04:17" }}
                artifactLabel="끊기 전에 접수번호를 받아적으세요"
                placeholder="2026-0815-000123"
                script={
                  <>
                    「보이스피싱 피해를 입었습니다.{" "}
                    <b className="font-[620] text-ink-1">지급정지</b>를 요청합니다.」 제 계좌는{" "}
                    <Token>계좌·2</Token>, <Token>금액·1</Token>을 <Token>계좌·1</Token>로
                    보냈습니다.
                  </>
                }
              />
              <p className="mt-3 text-[12.5px] leading-[1.6] text-icon">
                패널은 챗이 가리킨 단계를 따라 바뀝니다. 언급이 없으면{" "}
                <b className="font-[620] text-ink-2">닫지 않고 그대로</b> — 적던 접수번호를 잃지
                않습니다.
              </p>
            </>
          ) : (
            <>
              <div className="mb-3 text-[12.5px] tracking-[0.12em] text-icon">
                사건 파일 — 실시간
              </div>
              <div className="rounded-[14px] border border-[oklch(0.305_0.013_267.1/60%)] bg-stage p-[14px_15px]">
                <div className="flex items-center gap-2 text-[13.5px] font-[620] text-ink-1">
                  진술에서 파악한 것
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                  />
                </div>
                <dl className="mt-2.5 grid gap-px">
                  {CASE_FILE.map(([label, value, kind]) => (
                    <div
                      key={label}
                      className={`flex items-baseline justify-between gap-3 rounded-[7px] px-1.5 py-[7px] text-[13.5px] ${
                        kind === "asking" ? "bg-[oklch(0.77_0.117_70.9/6%)]" : ""
                      } ${kind === "future" ? "opacity-55" : ""}`}
                    >
                      <dt className="shrink-0 text-icon">{label}</dt>
                      <dd className="min-w-0 text-right">
                        {kind === "token" ? (
                          <Token>{value}</Token>
                        ) : kind === "filled" ? (
                          <span className="font-[580] text-ink-1">{value}</span>
                        ) : (
                          <span className="text-[13px] text-icon">{value}</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] leading-[1.6] text-icon">
                  채워지는 만큼 절차가 정확해집니다.{" "}
                  <b className="font-[620] text-ink-2">모름도 답입니다</b> — 빈 칸이어도 진행됩니다.
                </p>
              </div>
              <p className="mt-3 text-[12.5px] leading-[1.6] text-icon">
                답변이 끝나면 이 자리가 <b className="font-[620] text-ink-2">할 일 보드</b>로
                바뀝니다 — 챗과 보드는 같은 주소입니다.
              </p>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}

/* ── 말풍선 ─────────────────────────────────────────────────── */

function Bubble({
  who,
  i,
  children,
}: {
  who: "ai" | "me";
  i: number;
  children: React.ReactNode;
}) {
  const mine = who === "me";
  return (
    <div
      style={step(i)}
      className={`rise max-w-[78%] rounded-[15px] px-[15px] py-[11px] text-[14.5px] leading-[1.65] ${
        mine
          ? "ml-auto max-w-[68%] rounded-br-[5px] bg-[oklch(1_0_0/11%)] text-ink-1"
          : "rounded-bl-[5px] border border-hairline bg-surface text-ink-2"
      }`}
    >
      {children}
    </div>
  );
}

/**
 * 응답 대기 — **스트리밍 금지(ADR-022)의 대가**입니다.
 * 점 3개·스켈레톤·타자기를 쓰지 않고 **무엇을 하는지 문장으로** 말합니다.
 * 값은 서버(poll-checker)가 내준 것 그대로이고, 화면이 단계를 추측하지 않습니다.
 *
 * TODO(연결): poll-checker 응답이 붙으면 currentIndex 를 그 값으로 바꿉니다.
 */
export function PendingBubble({ currentIndex }: { currentIndex: number }) {
  return (
    <div className="max-w-[78%] rounded-[15px] rounded-bl-[5px] border border-hairline bg-surface px-[15px] py-[11px]">
      <div className="flex items-center gap-2 text-[14.5px] text-ink-2">
        답변을 준비하고 있습니다 — 검증이 끝나면 한 번에 보여드립니다
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
        />
      </div>
      <ul className="mt-2.5 grid gap-1.5">
        {PENDING_STEPS.map((label, i) => {
          const done = i < currentIndex;
          const now = i === currentIndex;
          return (
            <li
              key={label}
              className={`flex items-start gap-2 text-[13px] leading-[1.6] ${
                done ? "text-ink-3" : now ? "text-ink-1" : "text-ink-3 opacity-55"
              }`}
            >
              <span aria-hidden className="mt-[3px] shrink-0 text-pii">
                {done ? "✓" : now ? "◉" : "○"}
              </span>
              {label}
            </li>
          );
        })}
      </ul>
      <p className="mt-2.5 text-[12.5px] text-icon">
        상태는 서버(poll-checker)가 내준 값 그대로입니다 — 화면이 추측하지 않습니다
      </p>
    </div>
  );
}
