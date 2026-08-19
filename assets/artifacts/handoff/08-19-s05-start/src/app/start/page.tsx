"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * S-05 동의 · 선택 제공 — `/start` (시안 2c + 발급 1a 확정본)
 *
 * 계약: spec/frontend/08-14-screens.md §S-05
 * 시안: FSEC 렌더 페이지 설계 프로젝트 「Start S-05」 + 「Link Issue Options」 1a
 *
 * 두 국면이 한 파일입니다
 *  · intake (1/2) — 동의 모달 + Q1 문진 + 종류별 업로드 슬롯
 *  · issued (2/2) — 링크 발급. URL 카드가 화면의 주인, 오렌지 글로우는 이 순간에만
 *  · 왼쪽 단계 레일(동의 → 무슨 일 → 링크 발급)이 국면에 따라 바뀝니다
 *
 * 스펙 준수
 *  · 관문은 동의 하나. [건너뛰고 바로 시작]이 주 버튼과 같은 크기로 나란히
 *  · 동의 문구 180일 파기(ADR-016) · 주민등록번호 미수집(ADR-026)
 *  · 발급 즉시 복사 가능, 복구 불가 고지, 거절 버튼명 정직하게(ADR-021)
 *  · 이메일 검증 없음 — 오타는 알림이 안 갈 뿐 사용자가 막히지 않습니다
 *  · 빨강 없음 — 미완·경고는 앰버(--deadline-urgent)
 *
 * TODO(연결)
 *  · Q1 선택 → POST /api/cases (§3.1) — 지금은 UI 상태만
 *  · CASE_URL — 발급 응답의 실제 토큰으로 교체
 *  · [저장하고 시작하기]/[이메일 없이 시작하기] → /c/{token} 라우팅
 *  · 업로드 슬롯 채택 시 POST …/evidence 에 kind 필드 협의
 *  · REQUIRE_ALL_CHECKS — 5조항 체크 관문. 「관문은 동의 하나뿐」과 긴장, 팀 판단
 */

const REQUIRE_ALL_CHECKS = true;
const CASE_URL = "finally.kr/c/7fK2p-Qx9mR4"; // TODO: 발급 응답으로 교체

const 자료종류 = [
  ["통화 녹음", "사기범과의 통화 파일"],
  ["문자·메신저 캡처", "받은 문자, 카톡 대화 화면"],
  ["이체 내역", "은행 앱의 보낸 기록 캡처"],
  ["은행·기관에서 받은 통지", "지급정지 문자, 우편 통지"],
] as const;

const Q1 = [
  ["내 돈이 나갔어요", false],
  ["내 계좌가 갑자기 묶였어요", false],
  ["잘 모르겠어요", true], // 모름 — ink-3 로 낮추되 같은 크기·같은 자리
] as const;

const step = (i: number) => ({ animationDelay: `${60 + i * 70}ms` });

const btnPrimary =
  "inline-flex min-h-[50px] items-center justify-center rounded-[12px] bg-ink-1 text-[15.5px] font-[660] text-ground transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pii";
const btnGhost =
  "inline-flex min-h-[50px] items-center justify-center rounded-[12px] border border-hairline bg-chip text-[15.5px] font-[560] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]";

/** 레일 점 — done(파랑) / now(앰버 링) / todo */
function RailDot({ state, tail }: { state: "done" | "now" | "todo"; tail?: boolean }) {
  return (
    <div className="grid justify-items-center">
      <span
        className={`mt-1.5 size-[9px] rounded-full ${
          state === "done"
            ? "bg-pii"
            : state === "now"
              ? "bg-deadline-urgent shadow-[0_0_0_4px_oklch(0.77_0.117_70.9/18%)]"
              : "bg-ink-4"
        }`}
      />
      {tail && <span className="min-h-[26px] w-px flex-1 bg-hairline" />}
    </div>
  );
}

/** 모달 전문의 조항 한 개 — 제목줄 오른쪽이 「확인했습니다」 체크 */
function Clause({
  title,
  checked,
  onToggle,
  last,
  children,
}: {
  title: string;
  checked: boolean;
  onToggle: () => void;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`py-5 ${last ? "" : "border-b border-[oklch(0.386_0.016_274/72%)]"}`}>
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-[15px] font-[640] text-ink-1">{title}</h3>
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={checked}
          className="inline-flex min-h-[var(--size-touch)] select-none items-center gap-[9px] px-1.5 text-[13px] text-ink-3"
        >
          확인했습니다
          <span className="grid size-[22px] shrink-0 place-items-center rounded-[7px] border-[1.5px] border-icon bg-[oklch(1_0_0/10%)]">
            {checked && (
              <span className="grid size-[22px] place-items-center rounded-[7px] bg-ink-1 text-[13px] font-extrabold text-ground">
                ✓
              </span>
            )}
          </span>
        </button>
      </div>
      <p className="mt-2 text-[13.5px] leading-[1.65] text-ink-3">{children}</p>
    </section>
  );
}

export default function Start() {
  const [phase, setPhase] = useState<"intake" | "issued">("intake");
  const [modalOpen, setModalOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [checks, setChecks] = useState([false, false, false, false, false]);
  const [q1, setQ1] = useState(0);
  const [copied, setCopied] = useState(false);

  const checkedCount = checks.filter(Boolean).length;
  const canAgree = !REQUIRE_ALL_CHECKS || checkedCount === 5;
  const toggle = (i: number) => setChecks((c) => c.map((v, j) => (j === i ? !v : v)));
  const agree = () => {
    if (!canAgree) return;
    setAgreed(true);
    setModalOpen(false);
  };
  const issue = () => setPhase("issued"); // TODO: POST /api/cases 후 전환
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(`https://${CASE_URL}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard 미지원 — 주소가 화면에 전부 보이므로 수동 복사 가능 */
    }
  };

  const issued = phase === "issued";

  return (
    <main className="flex min-h-svh flex-col">
      <header className="border-b border-hairline bg-stage">
        <div className="mx-auto flex w-full max-w-shell items-center justify-between gap-4 px-[clamp(20px,4.2vw,40px)] py-[14px]">
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
          {issued ? (
            <span className="inline-flex items-center gap-2 text-[13px] text-icon">
              <span aria-hidden className="size-[5px] rounded-full bg-pii" />
              사건 7fK2p
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-[13px] text-pii">
              <span aria-hidden className="size-[5px] rounded-full bg-current" />
              개인정보는 브라우저 밖으로 나가지 않습니다
            </span>
          )}
        </div>
      </header>

      <div className="grid flex-1 md:grid-cols-[300px_1fr]">
        {/* ── 단계 레일 ─────────────────────────────────── */}
        <aside className="border-b border-hairline bg-[oklch(1_0_0/1.5%)] p-[26px_26px_28px] md:border-b-0 md:border-r">
          <div className="mb-4 text-[12px] tracking-[0.12em] text-icon">시작하기</div>
          <div className="grid grid-cols-[16px_1fr] gap-[11px]">
            <RailDot state={agreed ? "done" : "now"} tail />
            <div className="pb-4">
              <div className="text-[14px] font-[580] text-ink-1">동의</div>
              {agreed ? (
                <div className="text-[13px] text-icon">완료 · 180일 파기 · 주민번호 미수집</div>
              ) : (
                <div className="text-[13px] text-deadline-urgent">전문 확인이 필요합니다</div>
              )}
            </div>
            <RailDot state={issued ? "done" : agreed ? "now" : "todo"} tail />
            <div className="pb-4">
              <div className={`text-[14px] font-[580] ${issued || agreed ? "text-ink-1" : "text-ink-2"}`}>
                무슨 일이 있었는지
              </div>
              <div className="text-[13px] text-icon">
                {issued ? Q1[q1][0] : "하나만 고르면 됩니다"}
              </div>
            </div>
            <RailDot state={issued ? "now" : "todo"} />
            <div>
              <div className={`text-[14px] ${issued ? "font-[580] text-ink-1" : "text-ink-3"}`}>
                사건 링크 발급
              </div>
              {issued ? (
                <div className="text-[13px] text-deadline-urgent">주소를 보관하세요</div>
              ) : (
                <div className="text-[13px] text-icon">회원가입 없음</div>
              )}
            </div>
          </div>
          <div className="mt-[26px] rounded-[12px] border border-dashed border-hairline p-[13px_15px] text-[13px] leading-[1.6] text-icon">
            {issued ? (
              <>
                이 화면을 지나면 <b className="font-[620] text-ink-2">주소가 유일한 열쇠</b>가
                됩니다. 계정이 없어 되찾아 드릴 수 없습니다.
              </>
            ) : (
              <>
                답이 어려우면 언제든 <b className="font-[620] text-ink-2">「잘 모르겠어요」</b>를
                고르세요. 모름은 실패가 아닙니다.
              </>
            )}
          </div>
        </aside>

        {/* ── 본문 1/2 · 동의 + 문진 ───────────────────── */}
        {!issued && (
          <section className="p-[clamp(24px,4vw,44px)]">
            <div className="max-w-[620px]">
              {agreed ? (
                <div className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface px-[15px] py-[11px]">
                  <span
                    aria-hidden
                    className="grid size-[18px] shrink-0 place-items-center rounded-[5px] bg-ink-1 text-[11px] font-extrabold text-ground"
                  >
                    ✓
                  </span>
                  <span className="flex-1 text-[13px] text-ink-3">개인정보 수집·이용 동의 완료</span>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="px-1.5 py-3 text-[13px] text-pii"
                  >
                    전문 다시 보기
                  </button>
                </div>
              ) : (
                <div className="rise flex flex-wrap items-center gap-3 rounded-[12px] border border-[oklch(0.77_0.117_70.9/42%)] bg-[oklch(0.77_0.117_70.9/6%)] px-[15px] py-[11px]">
                  <span
                    aria-hidden
                    className="size-[18px] shrink-0 rounded-[5px] border-[1.5px] border-deadline-urgent"
                  />
                  <span className="min-w-0 flex-1 text-[13px] text-ink-2">
                    <b className="font-[620] text-ink-1">개인정보 수집·이용 동의 (필수)</b> — 전문을
                    확인하고 동의해 주세요
                  </span>
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-4 text-[13.5px] font-[660] text-ground transition-transform duration-200 hover:-translate-y-px"
                  >
                    전문 보고 동의하기
                  </button>
                </div>
              )}

              <h1
                style={step(1)}
                className="rise mt-[30px] text-[26px] font-[660] tracking-[-0.02em] text-ink-1"
              >
                무슨 일이 있으셨나요?
              </h1>
              <p className="mb-4 mt-[7px] text-[14px] text-icon">하나만 골라 주세요.</p>
              <div style={step(2)} className="rise grid gap-[9px]" role="radiogroup">
                {Q1.map(([label, dim], i) => {
                  const sel = q1 === i;
                  return (
                    <button
                      key={label}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => setQ1(i)}
                      className={`flex min-h-[52px] items-center gap-3 rounded-[12px] px-[18px] py-[14px] text-left text-[16px] transition-colors duration-200 ${
                        sel
                          ? "border border-[oklch(1_0_0/34%)] bg-[oklch(1_0_0/9%)] font-[600] text-ink-1"
                          : `border border-hairline bg-chip hover:border-[oklch(1_0_0/25%)] ${dim ? "text-ink-3" : "text-ink-2"}`
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`w-5 shrink-0 text-center ${sel ? "" : "text-icon"}`}
                      >
                        {sel ? "●" : "○"}
                      </span>
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* 업로드 — 종류가 곧 안내이자 분류입니다 */}
              <div style={step(3)} className="rise mt-[26px]">
                <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
                  <span className="text-[14px] text-ink-2">
                    이런 자료가 있으면 올려 주세요 <span className="text-ink-3">(선택)</span>
                  </span>
                  <span className="text-[13px] text-icon">
                    종류를 눌러 올리면 저희가 바로 알아봅니다
                  </span>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {자료종류.map(([name, hint]) => (
                    <button
                      key={name}
                      type="button"
                      className="flex min-h-[52px] items-center gap-3 rounded-[12px] border border-dashed border-hairline px-[14px] py-[11px] text-left transition-colors duration-200 hover:border-[oklch(0.697_0.16_258.2/45%)] hover:bg-[oklch(1_0_0/3%)]"
                    >
                      <span aria-hidden className="w-[18px] shrink-0 text-center text-icon">
                        ＋
                      </span>
                      <span>
                        <span className="block text-[14px] font-[580] text-ink-1">{name}</span>
                        <span className="block text-[13px] text-icon">{hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-icon">
                  <span>없어도 괜찮습니다 — 진술만으로 시작할 수 있습니다</span>
                  <span>
                    <b className="font-[620] text-deadline-urgent">
                      신분증·주민등록증은 올리지 마세요
                    </b>{" "}
                    — 저희는 주민등록번호를 받지 않습니다
                  </span>
                </div>
              </div>

              <div style={step(4)} className="rise mt-7 flex gap-[11px]">
                {agreed ? (
                  <button type="button" onClick={issue} className={`${btnPrimary} flex-1`}>
                    다음
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-2.5 rounded-[12px] bg-[oklch(1_0_0/10%)] text-[15.5px] font-[660] text-icon"
                  >
                    다음
                    <span className="text-[13px] font-[560]">동의가 필요합니다</span>
                  </button>
                )}
                <button type="button" className={`${btnGhost} flex-1`}>
                  건너뛰고 바로 시작
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── 본문 2/2 · 링크 발급 (시안 1a) ───────────── */}
        {issued && (
          <section className="relative overflow-hidden p-[clamp(24px,4vw,44px)]">
            {/* 오렌지 글로우 — 발급 순간에만. 장식이며 의미 없음 */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-10 top-16 h-[300px] w-[640px] rounded-full blur-[34px]
                         [background:radial-gradient(closest-side,oklch(0.811_0.14_66.9/22%)_0%,transparent_72%)]
                         [animation:breathe_6s_ease-in-out_infinite]"
            />
            <div className="relative max-w-[620px]">
              <h1 className="rise text-[24px] font-[660] tracking-[-0.02em] text-ink-1">
                사건이 만들어졌습니다
              </h1>
              <p className="mt-2 text-[15px] text-ink-3">
                이 주소가 <b className="font-[640] text-ink-1">사건의 열쇠</b>입니다. 다시 오실 때
                이 주소로 들어오세요.
              </p>

              <div
                style={step(1)}
                className="rise mt-4 rounded-[14px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg p-[16px_18px]
                           shadow-[0_0_50px_-14px_oklch(0.811_0.14_66.9/40%)]"
              >
                <div className="text-[13px] text-pii">내 사건 주소</div>
                <div className="mt-2 flex items-center gap-3">
                  <span
                    data-numeric
                    className="flex-1 break-all font-mono text-[19px] text-ink-1"
                  >
                    {CASE_URL}
                  </span>
                  <button
                    type="button"
                    onClick={copyUrl}
                    className="inline-flex min-h-[var(--size-touch)] shrink-0 items-center rounded-[10px] bg-ink-1 px-[18px] text-[14px] font-[660] text-ground transition-transform duration-200 hover:-translate-y-px"
                  >
                    {copied ? "복사됨 ✓" : "주소 복사"}
                  </button>
                </div>
              </div>

              <div style={step(2)} className="rise mt-6 grid items-start gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="email" className="text-[14.5px] font-[620] text-ink-1">
                    이메일 <span className="font-[500] text-ink-3">(선택)</span>
                  </label>
                  {/* 검증하지 않습니다 — 오타는 알림이 안 갈 뿐, 여기서 막히지 않습니다 */}
                  <input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    className="mt-2 min-h-[48px] w-full rounded-[10px] border border-hairline bg-[oklch(0_0_0/34%)] px-[13px] text-[14px] text-ink-1 placeholder:text-ink-4 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pii"
                  />
                  <p className="mt-2 text-[13px] leading-[1.6] text-icon">
                    기한이 다가오면 알려드립니다. 확인 메일은 보내지 않습니다.
                  </p>
                </div>
                {/* ADR-021 — 경고는 선택지 옆에 같은 크기로 */}
                <div className="rounded-[12px] border border-[oklch(0.77_0.117_70.9/42%)] bg-[oklch(0.77_0.117_70.9/8%)] p-[13px_15px] text-[13.5px] leading-[1.6] text-ink-2">
                  <b className="font-[620] text-deadline-urgent">이메일을 안 주시면</b> 기한 알림을
                  보내드릴 수 없습니다. 이 주소를 잃어버리면 사건을 다시 찾을 방법도 없습니다.
                </div>
              </div>

              <div style={step(3)} className="rise mt-6 flex gap-[11px]">
                {/* TODO: /c/{token} 라우팅 */}
                <button type="button" className={`${btnPrimary} flex-1`}>
                  저장하고 시작하기
                </button>
                <button type="button" className={`${btnGhost} flex-1`}>
                  이메일 없이 시작하기
                </button>
              </div>
            </div>
          </section>
        )}
      </div>

      {/* ── 동의 전문 모달 ─────────────────────────────── */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="개인정보 수집·이용 동의 전문"
          onClick={() => setModalOpen(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-[oklch(0_0_0/62%)] p-4 backdrop-blur-[6px] md:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="rise flex max-h-[84vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[18px] border border-[oklch(0.386_0.016_274/80%)] bg-stage shadow-[0_40px_90px_-30px_oklch(0_0_0/90%)]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[oklch(0.386_0.016_274/72%)] px-6 py-[18px]">
              <div>
                <div className="text-[16.5px] font-[660] tracking-[-0.015em] text-ink-1">
                  개인정보 수집·이용 동의 (필수)
                </div>
                <div className="mt-0.5 text-[13px] text-icon">
                  시행 2026. 8. — · 버전 초안 (법무 검토 전)
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span
                  data-numeric
                  className="inline-flex items-center rounded-full border border-[oklch(0.697_0.16_258.2/42%)] bg-[oklch(0.697_0.16_258.2/10%)] px-2.5 py-[3px] text-[13px] font-[620] text-pii"
                >
                  확인 {checkedCount} / 5
                </span>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="닫기"
                  className="grid size-[34px] place-items-center rounded-[10px] border border-[oklch(0.386_0.016_274/72%)] text-[15px] text-ink-3 transition-colors hover:border-[oklch(1_0_0/25%)] hover:text-ink-1"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-2 pt-5">
              {/* 약속 네 가지 요약 — 전문과 다르면 전문이 기준 */}
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-[12px] border border-[oklch(0.386_0.016_274/72%)] bg-surface p-[12px_14px]">
                  <div className="text-[13.5px] font-[640] text-ink-1">180일 뒤 자동 파기</div>
                  <p className="mt-1 text-[13px] leading-[1.55] text-ink-3">
                    마지막 활동일 기준입니다.
                  </p>
                </div>
                <div className="rounded-[12px] border border-[oklch(0.386_0.016_274/72%)] bg-surface p-[12px_14px]">
                  <div className="text-[13.5px] font-[640] text-ink-1">
                    주민등록번호는 받지 않습니다
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.55] text-ink-3">
                    못 가리면 그 파일만 빼고 진행합니다.
                  </p>
                </div>
                <div className="rounded-[12px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg p-[12px_14px]">
                  <div className="text-[13.5px] font-[640] text-pii">브라우저에서 가려집니다</div>
                  <p className="mt-1 text-[13px] leading-[1.55] text-ink-2">
                    토큰으로 바뀐 뒤에야 서버로 갑니다.
                  </p>
                </div>
                <div className="rounded-[12px] border border-[oklch(0.386_0.016_274/72%)] bg-surface p-[12px_14px]">
                  <div className="text-[13.5px] font-[640] text-ink-1">학습에 쓰지 않습니다</div>
                  <p className="mt-1 text-[13px] leading-[1.55] text-ink-3">
                    이 사건의 처리에만 씁니다.
                  </p>
                </div>
              </div>

              <Clause title="1. 수집하는 항목" checked={checks[0]} onToggle={() => toggle(0)}>
                진술 내용, 올리신 자료(통화 녹음·문자 캡처·이체 내역·통지, 전부 선택),
                이메일(선택). 계좌·전화·이름은 전송 전 브라우저에서 토큰으로 치환되며{" "}
                <b className="font-[620] text-deadline-urgent">주민등록번호는 수집하지 않습니다.</b>
              </Clause>
              <Clause title="2. 이용 목적" checked={checks[1]} onToggle={() => toggle(1)}>
                절차 안내, 법정 기한 계산과 알림, 서류 초안 작성, 통지 해석.{" "}
                <b className="font-[620] text-ink-2">
                  이 사건 처리 외 목적으로 쓰지 않고 AI 학습에 쓰지 않습니다.
                </b>
              </Clause>
              <Clause title="3. 보관과 파기" checked={checks[2]} onToggle={() => toggle(2)}>
                마지막 활동일부터 <b className="font-[620] text-ink-2">180일이 지나면 자동 파기</b>
                됩니다. 링크로 다시 접속하면 활동일이 갱신되며, 파기 후에는 복구할 수 없습니다.
              </Clause>
              <Clause title="4. 제3자 제공과 위탁" checked={checks[3]} onToggle={() => toggle(3)}>
                제3자에게 제공하지 않습니다. 서류 제출은{" "}
                <b className="font-[620] text-ink-2">이용자가 직접</b> 합니다. 위탁이 생기면 이
                문서에 명시합니다.
              </Clause>
              <Clause title="5. 이용자의 권리" checked={checks[4]} onToggle={() => toggle(4)} last>
                언제든 자료 삭제와 사건 종결(즉시 파기)을 요청할 수 있습니다. 동의를 거부하면
                서비스를 시작할 수 없습니다.{" "}
                <b className="font-[620] text-ink-2">사건 링크를 아는 사람만</b> 이 권리를 행사할 수
                있습니다.
              </Clause>
            </div>

            <div className="flex gap-2.5 border-t border-[oklch(0.386_0.016_274/72%)] bg-stage px-6 py-4">
              {canAgree ? (
                <button type="button" onClick={agree} className={`${btnPrimary} flex-1 text-[15px]`}>
                  동의하고 계속하기
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-[50px] flex-1 cursor-not-allowed items-center justify-center gap-2.5 rounded-[12px] bg-[oklch(1_0_0/10%)] text-[15px] font-[660] text-icon"
                >
                  동의하고 계속하기
                  <span data-numeric className="text-[13px] font-[560]">
                    {5 - checkedCount}개 항목 확인 남음
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className={`${btnGhost} px-6 text-[14.5px]`}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
