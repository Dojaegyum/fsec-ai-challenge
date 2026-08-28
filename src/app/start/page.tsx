"use client";

import { LinkHandoff } from "@/modules/case-opener";
import { HorizonGlow } from "@/components/HorizonGlow";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import type { LoadFail } from "@/app/c/[token]/load";
import { kindOf, uploadFile } from "@/app/c/[token]/upload";
import { screenName } from "@/modules/file-sender";
import { openCase, trackOf } from "./open";

/**
 * S-05 동의 · 선택 제공 — `/start` (시안 2c + 발급 1a 확정본)
 *
 * 계약: spec/frontend/08-14-screens.md §S-05
 * 시안: FSEC 렌더 페이지 설계 프로젝트 「Start S-05」 + 「Link Issue Options」 1a
 *
 * 두 국면이 한 파일입니다
 *  · intake (1/2) — 동의 모달 + Q1 문진 + 종류별 업로드 슬롯
 *  · issued (2/2) — 링크 발급. URL 카드가 화면의 주인, 카드 뒤의 가까운 글로우는 이 순간에만
 *    (화면 바닥의 호라이즌은 두 국면 모두에 있습니다 — `HorizonGlow`)
 *  · 왼쪽 단계 레일(동의 → 무슨 일 → 링크 발급)이 국면에 따라 바뀌고, **스크롤을 따라옵니다**
 *
 * 스펙 준수
 *  · 관문은 동의 하나. [건너뛰고 바로 시작]이 주 버튼과 같은 크기로 나란히
 *  · 조항 다섯을 모두 확인해야 동의 성립 — 관문을 하나 더 세운 게 아니라
 *    동의를 얻는 방식입니다 (ADR-031). 남은 개수를 항상 보여줍니다
 *  · 동의 문구 180일 파기(ADR-016) · 주민등록번호 미수집(ADR-026)
 *  · 발급 즉시 복사 가능, 복구 불가 고지, 거절 버튼명 정직하게(ADR-021)
 *  · 이메일 검증 없음 — 오타는 알림이 안 갈 뿐 사용자가 막히지 않습니다
 *  · 빨강 없음 — 미완·경고는 앰버(--deadline-urgent)
 *
 * ## 서버에 붙은 것
 *
 *  · [다음]·[건너뛰고 바로 시작] → `POST /api/cases` (§3.1). 주소에 실리는 것은
 *    응답의 **`link_token`** 입니다 — `case_id` 를 쓰면 조회가 언제나 빕니다 (ADR-039)
 *  · [저장하고 시작하기]·[이메일 없이 시작하기] → `/c/{token}` 으로 이동
 *
 * ## 아직 안 붙은 것
 *
 *  · ⬜ **이메일이 갈 곳이 없습니다.** `case` 표에 칸도, 라우트도, §3 계약도
 *    없습니다. 화면은 「기한이 다가오면 알려드립니다」라고 적어 두었지만
 *    **지금은 아무 데도 안 갑니다** → QA 계획 Task 9 ⑤
 *  · ⬜ **「잘 모르겠어요」가 갈 `track` 이 없습니다** — `open.ts` 의 `trackOf` 참고
 *
 * ## 자료 슬롯 — 2026-08-27 에 붙었습니다
 *
 * ⚠️ **그전까지 버튼 넷에 `onClick` 이 없었습니다.** 이 파일에 파일 선택 입력이
 * 하나도 없어서, 눌러도 고르는 창조차 안 떴습니다 — 계약(§S-05)은 여기를 증거
 * 자리로 못박아 두었는데(*"증거 · 선택. 올리면 … `file-sender`가 보냅니다"*)
 * 모양만 배포돼 있었습니다.
 *
 * **고른 파일은 바로 안 올라갑니다.** 올릴 주소(`POST …/evidence`)의 경로가
 * `{case_token}` 이라 **사건이 있어야** 합니다. 그래서 브라우저가 들고 있다가
 * [다음]으로 사건이 만들어진 직후에 함께 올립니다 — **파일을 골랐다고 사건이
 * 생기지는 않습니다.** 관문은 동의 하나입니다 (ADR-031).
 *
 *  · **같은 자리를 2026-08-27 에 둘이 따로 고쳤습니다.** 한쪽은 눌러도 안 되는 버튼을
 *    **목록으로 바꿔** 정직하게 만들었고(「시작한 다음 화면에서 올리실 수 있습니다」),
 *    이쪽은 **실제로 올라가게** 이었습니다. 뒤엣것이 앞엣것을 대신합니다 — 이제
 *    여기서 고를 수 있고, 사건이 만들어진 직후에 함께 올라갑니다
 *  · ⬜ 슬롯 종류를 `POST …/evidence` 의 `kind` 필드로 보낼지는 아직 미정입니다
 *    (§S-05 의 TODO). 지금은 파일의 MIME 으로만 가립니다
 */

/**
 * 종류별 슬롯 넷 → §S-05 「자료 — 종류가 곧 안내입니다」.
 *
 * 셋째 칸은 그 슬롯이 받는 파일입니다. **§3.2 의 `kind` 셋(audio·image·text)에서
 * 이 슬롯에 올 수 있는 것만 좁힌 것**이고, 좁히는 이유는 종류가 곧 분류라서입니다.
 *
 * ⬜ **PDF 를 안 넣었습니다.** `kind` 에 자리가 없어 잘못된 종류로 올리면 전사기가
 * 다른 일을 합니다 (`upload.ts` 의 `kindOf`) → QA 계획 Task 9 ⑧.
 * 우편 통지는 사진으로 찍어 올리면 됩니다.
 */
const 자료종류 = [
  ["통화 녹음", "사기범과의 통화 파일", "audio/*"],
  ["문자·메신저 캡처", "받은 문자, 카톡 대화 화면", "image/*"],
  ["이체 내역", "은행 앱의 보낸 기록 캡처", "image/*"],
  ["은행·기관에서 받은 통지", "지급정지 문자, 우편 통지", "image/*"],
] as const;

/**
 * 고른 자료 한 장 — **아직 안 올라간 것**입니다.
 *
 * `File` 을 그대로 들고 있습니다. 사건이 만들어지기 전에는 올릴 주소가 없어서
 * 브라우저 밖으로 아무것도 안 나갑니다.
 */
interface Picked {
  readonly id: number;
  /** 몇 번째 슬롯에서 골랐나 */
  readonly slot: number;
  /** 화면에 그리는 이름. **`screenName` 을 지난 것**입니다 — 「입금내역_110-2345-678901.png」 */
  readonly name: string;
  readonly file: File;
}

const Q1 = [
  ["내 돈이 나갔어요", false],
  ["내 계좌가 갑자기 묶였어요", false],
  ["잘 모르겠어요", true], // 모름 — ink-3 로 낮추되 같은 크기·같은 자리
] as const;

/** 랜딩과 **같은 간격**입니다 — 두 화면을 잇달아 보므로 리듬이 달라지면 걸립니다 */
const step = (i: number) => ({ animationDelay: `${60 + i * 95}ms` });

const btnPrimary =
  "inline-flex min-h-[50px] items-center justify-center rounded-[12px] bg-ink-1 text-[15.5px] font-[660] text-ground transition-[transform,opacity] duration-200 hover:-translate-y-px hover:opacity-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pii";
const btnGhost =
  "inline-flex min-h-[50px] items-center justify-center rounded-[12px] border border-hairline bg-chip text-[15.5px] font-[560] text-ink-2 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)]";

/**
 * 발급 화면에서 자료가 어떻게 됐는지 한 줄.
 *
 * **셋을 가릅니다** — 올리는 중 · 다 올렸다 · 일부를 못 올렸다. 「끝났는데 실패」와
 * 「아직 안 끝남」을 같은 문구로 두면, 올리는 중인 사람이 실패한 줄 압니다.
 *
 * **못 올려도 앰버까지입니다.** 사건은 이미 만들어졌고 절차 안내는 그대로
 * 나갑니다 — 빨강을 쓰지 않습니다 (§S-07 「색」).
 */
export function UploadNote({
  total,
  sending,
  done,
  notSent,
}: {
  total: number;
  /** 지금 몇 번째를 올리는 중인가. `0` 이면 안 올리는 중 */
  sending: number;
  done: boolean;
  notSent: readonly string[];
}) {
  if (!done) {
    return (
      <p className="mt-2.5 text-[13.5px] leading-[1.6] text-ink-3">
        <span aria-hidden className="mr-1.5">
          ◷
        </span>
        자료를 올리고 있습니다{" "}
        <span data-numeric>
          ({Math.max(sending, 1)}/{total})
        </span>{" "}
        — <b className="font-[620] text-ink-2">주소는 이미 유효합니다.</b> 지금 복사해 두세요.
      </p>
    );
  }

  if (notSent.length === 0) {
    return (
      <p className="mt-2.5 text-[13.5px] leading-[1.6] text-pii">
        <span aria-hidden className="mr-1.5">
          ◆
        </span>
        자료 <span data-numeric>{total}</span>개를 함께 올렸습니다. 읽는 데 조금 걸리고, 끝나면
        사건 화면에 뜹니다.
      </p>
    );
  }

  return (
    <p
      role="alert"
      className="mt-3 rounded-[12px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[13px_15px] text-[13.5px] leading-[1.6] text-ink-1"
    >
      자료 <span data-numeric>{notSent.length}</span>개를 올리지 못했습니다 —{" "}
      {notSent.join(" · ")}. <b className="font-[620] text-ink-2">사건은 그대로 진행됩니다.</b>{" "}
      자료가 없어도 절차 안내는 나갑니다.
    </p>
  );
}

/**
 * 자료 슬롯 넷 — §S-05 「자료 — 종류가 곧 안내입니다」.
 *
 * **여기서 아무것도 안 보냅니다.** 고른 것을 위로 넘길 뿐이고, 올리는 것은
 * 사건이 만들어진 뒤 `Start` 가 합니다 — 올릴 주소가 그때 생깁니다.
 *
 * 떼어 둔 이유는 **시험이 마운트할 수 있어야** 하기 때문입니다. `Start` 는
 * `useRouter` 를 부르므로 라우터 문맥 없이는 못 그리는데, 이 자리에 붙어 있던
 * 결함(**버튼에 `onClick` 도 파일 입력도 없어 눌러도 아무 일이 없던 것**)은
 * 정확히 렌더 시험이 잡는 종류입니다 → `page.test.tsx`.
 */
export function EvidenceSlots({
  picked,
  busy,
  rejected,
  onPick,
  onUnpick,
}: {
  picked: readonly Picked[];
  /** 사건을 만드는 중. 이때는 고르는 것도 빼는 것도 막습니다 */
  busy: boolean;
  /** 못 받는 종류를 골랐을 때의 문구. 없으면 `null` */
  rejected: string | null;
  onPick: (slot: number, file: File) => void;
  onUnpick: (id: number) => void;
}) {
  /** 슬롯마다 숨은 파일 선택 입력 하나. 버튼이 이걸 대신 누릅니다 */
  const slotRefs = useRef<(HTMLInputElement | null)[]>([]);

  return (
    <div style={step(3)} className="rise mt-[26px]">
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[14px] text-ink-2">
          이런 자료가 있으면 올려 주세요 <span className="text-ink-3">(선택)</span>
        </span>
        <span className="text-[13px] text-ink-3">
          종류를 눌러 고르면 사건을 만들 때 함께 올라갑니다
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {자료종류.map(([name, hint, accept], i) => {
          const mine = picked.filter((one) => one.slot === i);
          return (
            <div key={name}>
              {/* 받는 것은 §3.2 가 정한 셋입니다 — 이 슬롯은 그중 하나뿐 */}
              <input
                ref={(el) => {
                  slotRefs.current[i] = el;
                }}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // **같은 파일을 다시 고를 수 있어야** 합니다 — 값을 안 비우면
                  // 두 번째 선택에서 change 가 안 옵니다
                  e.target.value = "";
                  if (file) onPick(i, file);
                }}
              />
              <button
                type="button"
                onClick={() => slotRefs.current[i]?.click()}
                disabled={busy}
                className="flex min-h-[52px] w-full items-center gap-3 rounded-[12px] border border-dashed border-hairline px-[14px] py-[11px] text-left transition-colors duration-200 hover:border-[oklch(0.697_0.16_258.2/45%)] hover:bg-[oklch(1_0_0/3%)] disabled:opacity-60"
              >
                <span aria-hidden className="w-[18px] shrink-0 text-center text-icon">
                  ＋
                </span>
                <span>
                  <span className="block text-[14px] font-[580] text-ink-1">{name}</span>
                  <span className="block text-[13px] text-ink-3">{hint}</span>
                </span>
              </button>
              {/* 고른 것 — **아직 안 올라갔습니다.** 그 사실을 여기서 말합니다 */}
              {mine.map((one) => (
                <div
                  key={one.id}
                  className="mt-1.5 flex items-center gap-2 rounded-[10px] border border-hairline bg-chip px-[12px] py-[9px]"
                >
                  <span aria-hidden className="shrink-0 text-[12px] text-pii">
                    ◆
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
                    {one.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => onUnpick(one.id)}
                    disabled={busy}
                    className="shrink-0 px-1.5 py-1 text-[12.5px] text-ink-3 transition-colors duration-200 hover:text-ink-1 disabled:opacity-60"
                  >
                    빼기
                  </button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {/* 못 받는 종류를 골랐을 때. **막지 않습니다** — 그 파일만 안 받습니다 */}
      {rejected && (
        <p
          role="alert"
          className="mt-2.5 rounded-[10px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-[13px] py-[10px] text-[13px] leading-[1.6] text-ink-1"
        >
          {rejected}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap gap-x-[18px] gap-y-1.5 text-[13px] text-ink-3">
        {picked.length > 0 && (
          <span>
            <b className="font-[620] text-ink-2">아직 올리지 않았습니다</b> — [다음]을
            누르면 사건이 만들어지고 그때 함께 올라갑니다
          </span>
        )}
        <span>없어도 괜찮습니다 — 진술만으로 시작할 수 있습니다</span>
        <span>
          <b className="font-[620] text-deadline-urgent">
            신분증·주민등록증은 올리지 마세요
          </b>{" "}
          — 저희는 주민등록번호를 받지 않습니다
        </span>
      </div>
    </div>
  );
}

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
    <section className={`py-5 ${last ? "" : "border-b border-[oklch(0.305_0.013_267.1/72%)]"}`}>
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
  const router = useRouter();
  const [phase, setPhase] = useState<"intake" | "issued">("intake");
  const [modalOpen, setModalOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [checks, setChecks] = useState([false, false, false, false, false]);
  const [q1, setQ1] = useState(-1); // -1 = 아직 안 고름. 기본 선택을 두지 않습니다
  /** 발급된 링크 토큰 — **주소에 실리는 값**입니다 (ADR-039) */
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [fail, setFail] = useState<LoadFail | null>(null);

  /**
   * 고른 자료 — **아직 안 올라갔습니다.** [다음]으로 사건이 만들어진 뒤에 함께
   * 올라갑니다. 파일을 골랐다고 사건이 생기지는 않습니다 (관문은 동의 하나).
   */
  const [picked, setPicked] = useState<readonly Picked[]>([]);
  /** 못 받는 종류를 골랐을 때. **막지 않고 그 파일만 안 받습니다** */
  const [rejected, setRejected] = useState<string | null>(null);
  /** 지금 몇 번째를 올리는 중인가. `0` 이면 안 올리는 중 */
  const [sending, setSending] = useState(0);
  /** 사건은 만들어졌는데 못 올린 자료. **되돌리지 않습니다** — 사건은 그대로 진행됩니다 */
  const [notSent, setNotSent] = useState<readonly string[]>([]);
  /** 올리기가 끝났나. 끝나기 전과 「하나도 못 올렸다」를 가릅니다 */
  const [sentDone, setSentDone] = useState(false);
  const seq = useRef(0);

  /**
   * 슬롯에서 파일을 골랐다.
   *
   * **여기서 아무것도 안 보냅니다.** 올릴 주소가 아직 없습니다 — 들고만 있습니다.
   * 종류가 표 밖이면 그 파일만 안 받고 **나머지는 그대로 둡니다** (불변 규칙 5).
   */
  const pick = (slot: number, file: File) => {
    if (kindOf(file.type) === null) {
      setRejected("이 종류의 파일은 아직 받지 못합니다. 사진이나 녹음 파일로 올려 주세요.");
      return;
    }
    setRejected(null);
    seq.current += 1;
    // **이름도 경계를 지납니다** — 「입금내역_110-2345-678901.png」가 실제로 흔합니다
    const name = screenName(file.name).safe;
    setPicked((prev) => [...prev, { id: seq.current, slot, name, file }]);
  };

  const unpick = (id: number) => setPicked((prev) => prev.filter((one) => one.id !== id));

  const checkedCount = checks.filter(Boolean).length;
  const canAgree = checkedCount === checks.length; // 다섯을 모두 확인해야 동의 성립 (ADR-031)
  const toggle = (i: number) => setChecks((c) => c.map((v, j) => (j === i ? !v : v)));
  const agree = () => {
    if (!canAgree) return;
    setAgreed(true);
    setModalOpen(false);
  };
  /**
   * 사건을 만듭니다. **성공한 뒤에만 국면을 넘깁니다** — 먼저 넘기면
   * 주소 없는 발급 화면이 뜨고, 사용자는 무엇을 보관해야 할지 모릅니다.
   */
  const issue = async () => {
    if (opening) return;
    setOpening(true);
    setFail(null);
    const made = await openCase(trackOf(q1));
    setOpening(false);
    if (!made.ok) {
      setFail(made.fail);
      return;
    }

    // **주소를 먼저 보여줍니다** → §S-05 「발급 즉시 복사할 수 있어야」.
    //
    // 자료를 다 올린 뒤에 국면을 넘기면, 올리는 동안 창을 닫은 사용자는 **이미
    // 만들어진 사건의 주소를 영영 잃습니다** — 계정이 없어 되찾아 드릴 수
    // 없습니다 (ADR-021). 자료보다 주소가 급합니다
    setLinkToken(made.linkToken);
    setPhase("issued");

    void sendPicked(made.linkToken);
  };

  /**
   * 고른 자료를 올립니다 — **사건이 생긴 뒤에야 올릴 주소가 생깁니다**
   * (§3.2 의 경로가 `{case_token}`). 그 전에는 브라우저가 들고만 있었습니다.
   *
   * **막지 않습니다.** 하나가 실패해도 나머지를 계속 올리고, 못 올린 것은
   * 발급 화면에서 이름으로 말합니다 — 사건은 그대로 진행됩니다 (불변 규칙 5).
   */
  const sendPicked = async (caseToken: string) => {
    if (picked.length === 0) return;

    const failed: string[] = [];
    for (const [i, one] of picked.entries()) {
      setSending(i + 1);
      const sent = await uploadFile({ caseToken, file: one.file });
      if (!sent.ok) failed.push(one.name);
    }
    setSending(0);
    setNotSent(failed);
    setSentDone(true);
  };
  // 주소 복사는 `case-opener` 의 `LinkHandoff` 안으로 옮겼습니다

  /** 사건 화면으로. **링크 토큰이 없으면 가지 않습니다** — 갈 곳이 없습니다 */
  const enter = () => {
    if (linkToken) router.push(`/c/${linkToken}`);
  };

  const issued = phase === "issued";

  return (
    <main className="relative isolate flex min-h-svh flex-col">
      {/* 화면 바닥의 호라이즌 — 장식. 검정 한 색이던 배경에 온기만 더합니다.
          `isolate` 가 글 아래에 깔리게 하고, `overflow-hidden` 은 두지 않습니다(레일 sticky) */}
      <HorizonGlow attach="viewport" />
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
            <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
              <span aria-hidden className="size-[5px] rounded-full bg-pii" />
              사건 {linkToken?.slice(0, 5) ?? ""}
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
        <aside className="border-b border-hairline bg-[oklch(1_0_0/1.5%)] md:border-b-0 md:border-r">
          {/* 레일은 스크롤을 따라옵니다 — 문진·업로드 슬롯이 길어져 화면을 넘겨도
              몇 걸음 남았는지가 시야에서 사라지지 않게. 바깥 <aside> 는 그리드 행
              높이를 다 차지해 오른쪽 선이 끝까지 그어지고, 안쪽 상자만 붙습니다 */}
          <div className="p-[26px_26px_28px] md:sticky md:top-0">
            <div className="mb-4 text-[13px] tracking-[0.12em] text-ink-4">시작하기</div>
            <div className="grid grid-cols-[16px_1fr] gap-[11px]">
              <RailDot state={agreed ? "done" : "now"} tail />
              <div className="pb-4">
                <div className="text-[14px] font-[580] text-ink-1">동의</div>
                {agreed ? (
                  <div className="text-[13px] text-ink-3">완료 · 180일 파기 · 주민번호 미수집</div>
                ) : (
                  <div className="text-[13px] text-deadline-urgent">전문 확인이 필요합니다</div>
                )}
              </div>
              <RailDot state={issued ? "done" : agreed ? "now" : "todo"} tail />
              <div className="pb-4">
                <div className={`text-[14px] font-[580] ${issued || agreed ? "text-ink-1" : "text-ink-2"}`}>
                  무슨 일이 있었는지
                </div>
                <div className="text-[13px] text-ink-3">
                  {issued ? (Q1[q1]?.[0] ?? "고르지 않음") : "하나만 고르면 됩니다"}
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
                  <div className="text-[13px] text-ink-3">회원가입 없음</div>
                )}
              </div>
            </div>
            <div className="mt-[26px] rounded-[12px] border border-dashed border-hairline p-[13px_15px] text-[13px] leading-[1.6] text-ink-3">
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
              <p className="mb-4 mt-[7px] text-[14px] text-ink-3">하나만 골라 주세요.</p>
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

              <EvidenceSlots
                picked={picked}
                busy={opening}
                rejected={rejected}
                onPick={pick}
                onUnpick={unpick}
              />

              {/* 못 만들었으면 앰버로. **스스로 다시 부르지 않습니다** — 누르는 것은
                  사용자입니다 (에러 §3.1) */}
              {fail && (
                <div
                  role="alert"
                  style={step(4)}
                  className="rise mt-6 rounded-[12px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] p-[13px_15px]"
                >
                  <p className="text-[14px] leading-[1.6] text-ink-1">{fail.message}</p>
                  {fail.retryAfterSec !== undefined && (
                    <p data-numeric className="mt-1.5 text-[13px] text-deadline-urgent">
                      {fail.retryAfterSec}초 뒤 다시 시도할 수 있습니다
                    </p>
                  )}
                  <p className="mt-1.5 text-[13px] leading-[1.6] text-ink-3">
                    아직 아무것도 저장되지 않았습니다. 다시 눌러 주세요.
                  </p>
                </div>
              )}

              <div style={step(5)} className="rise mt-7 flex gap-[11px]">
                {agreed ? (
                  <button
                    type="button"
                    onClick={() => void issue()}
                    disabled={opening}
                    className={`${btnPrimary} flex-1 disabled:opacity-60`}
                  >
                    {opening ? "사건을 만들고 있습니다" : "다음"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex min-h-[50px] flex-1 items-center justify-center gap-2.5 rounded-[12px] bg-[oklch(1_0_0/10%)] text-[15.5px] font-[660] text-ink-3"
                  >
                    다음
                    <span className="text-[13px] font-[560]">동의가 필요합니다</span>
                  </button>
                )}
                {/* 관문은 동의 하나입니다 (ADR-031) — 이 버튼도 **동의 뒤에는 바로
                    사건을 만듭니다.** Q1 을 안 고른 채로 갑니다 */}
                <button
                  type="button"
                  onClick={() => (agreed ? void issue() : setModalOpen(true))}
                  disabled={opening}
                  className={`${btnGhost} flex-1 disabled:opacity-60`}
                >
                  건너뛰고 바로 시작
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── 본문 2/2 · 링크 발급 (시안 1a) ───────────── */}
        {issued && (
          <section className="relative overflow-hidden p-[clamp(24px,4vw,44px)]">
            {/* 카드 뒤의 가까운 오렌지 글로우 — 발급 순간에만. 장식이며 의미 없음.
                바닥의 호라이즌(HorizonGlow)과 겹쳐 이 순간이 가장 밝습니다 */}
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

              {/* 자료가 어떻게 됐는지를 **여기서 말합니다.** 안 말하면 사용자는 자기
                  파일이 올라갔는지 알 방법이 없습니다 — 발급 화면은 되돌아갈 수 없고,
                  올린 자료를 보는 자리는 사건 화면에 있습니다.
                  **못 올렸어도 되돌리지 않습니다** — 사건은 이미 있습니다 (불변 규칙 5) */}
              {picked.length > 0 && <UploadNote total={picked.length} sending={sending} done={sentDone} notSent={notSent} />}

              {/* 주소 카드는 `case-opener` 가 그립니다 — 재발급 경로가 없어(ADR-039 ⑥)
                  「이 순간에 확실히 넘기기」가 그 모듈의 규칙이기 때문입니다 */}
              {/* 주소는 **지금 열려 있는 곳**을 기준으로 만듭니다 — 도메인을
                  하드코딩하면 배포 주소가 바뀔 때 조용히 틀립니다 */}
              <div style={step(1)} className="rise mt-4">
                <LinkHandoff
                  url={
                    linkToken
                      ? `${typeof window === "undefined" ? "" : window.location.origin}/c/${linkToken}`
                      : ""
                  }
                />
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
                  <p className="mt-2 text-[13px] leading-[1.6] text-ink-3">
                    기한이 다가오면 알려드립니다. 확인 메일은 보내지 않습니다.
                  </p>
                </div>
                {/* ADR-021 — 경고는 선택지 옆에 같은 크기로 */}
                <div className="rounded-[12px] border border-[oklch(0.77_0.117_70.9/42%)] bg-[oklch(0.77_0.117_70.9/8%)] p-[13px_15px] text-[13.5px] leading-[1.6] text-ink-2">
                  <b className="font-[620] text-deadline-urgent">이메일을 안 주시면</b> 기한 알림을
                  보내드릴 수 없습니다. 이 주소를 잃어버리면 사건을 다시 찾을 방법도 없습니다.
                </div>
              </div>

              {/* ⚠️ **이메일은 아직 아무 데도 안 갑니다** — 보낼 곳이 없습니다
                  (`case` 표에 칸도, 라우트도, §3 계약도 없음 → Task 9 ⑤).
                  버튼 둘은 같은 곳으로 갑니다 */}
              <div style={step(3)} className="rise mt-6 flex gap-[11px]">
                <button type="button" onClick={enter} className={`${btnPrimary} flex-1`}>
                  저장하고 시작하기
                </button>
                <button type="button" onClick={enter} className={`${btnGhost} flex-1`}>
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
            className="rise flex max-h-[84vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[18px] border border-[oklch(0.305_0.013_267.1/80%)] bg-stage shadow-[0_40px_90px_-30px_oklch(0_0_0/90%)]"
          >
            <div className="flex items-center justify-between gap-4 border-b border-[oklch(0.305_0.013_267.1/72%)] px-6 py-[18px]">
              <div>
                <div className="text-[16.5px] font-[660] tracking-[-0.015em] text-ink-1">
                  개인정보 수집·이용 동의 (필수)
                </div>
                <div className="mt-0.5 text-[13px] text-ink-3">
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
                  className="grid size-[34px] place-items-center rounded-[10px] border border-[oklch(0.305_0.013_267.1/72%)] text-[15px] text-ink-3 transition-colors hover:border-[oklch(1_0_0/25%)] hover:text-ink-1"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-2 pt-5">
              {/* 약속 네 가지 요약 — 전문과 다르면 전문이 기준 */}
              <div className="grid gap-2 md:grid-cols-2">
                <div className="rounded-[12px] border border-[oklch(0.305_0.013_267.1/72%)] bg-surface p-[12px_14px]">
                  <div className="text-[13.5px] font-[640] text-ink-1">180일 뒤 자동 파기</div>
                  <p className="mt-1 text-[13px] leading-[1.55] text-ink-3">
                    마지막 활동일 기준입니다.
                  </p>
                </div>
                <div className="rounded-[12px] border border-[oklch(0.305_0.013_267.1/72%)] bg-surface p-[12px_14px]">
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
                <div className="rounded-[12px] border border-[oklch(0.305_0.013_267.1/72%)] bg-surface p-[12px_14px]">
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

            <div className="flex gap-2.5 border-t border-[oklch(0.305_0.013_267.1/72%)] bg-stage px-6 py-4">
              {canAgree ? (
                <button type="button" onClick={agree} className={`${btnPrimary} flex-1 text-[15px]`}>
                  동의하고 계속하기
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="inline-flex min-h-[50px] flex-1 cursor-not-allowed items-center justify-center gap-2.5 rounded-[12px] bg-[oklch(1_0_0/10%)] text-[15px] font-[660] text-ink-3"
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
