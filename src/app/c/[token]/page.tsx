"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { openCase } from "@/modules/case-opener";
import { ddayLabel, groupDeadlines } from "@/modules/deadline-viewer";
import { HorizonGlow } from "@/components/HorizonGlow";
import { currentStep, isOpen, pickStep, Workspace } from "@/modules/work-handler";
import type { FullStep, PlanStep as WorkStep } from "@/modules/work-handler";
import type { Focus, Side } from "./state";
import type { DOMRectLike } from "./absorb";
import { ABSORB_MS, absorbKeyframes, fadeKeyframes, prefersReducedMotion, rectOf } from "./absorb";
import ChatView, { MiniChat } from "./chat";
import { FIXTURE_BUNDLE, FIXTURE_EVIDENCE, FIXTURE_MAPPINGS } from "./fixtures";
import { CaseFailed, CaseLoading } from "./gate";
import { useCaseBundle, type CaseBundle, type CaseSlot } from "./load";
import { useChatSend } from "./send";
import { useArtifact } from "./artifact";
import { useUploads } from "./upload";
import T0Overlay from "./safety";
import TodoRail from "./todo";
import PlanView from "./plan";
import EvidenceView from "./evidence";
import DocGuide from "./doc";

/**
 * 사건 화면 — `/c/{token}`. **세 화면이 아니라 한 화면의 두 축**입니다 (ADR-035).
 *
 * 계약: spec/frontend/08-14-screens.md 「화면 상태는 두 축입니다」 · §S-06 §S-07 §S-08
 * 시안: assets/artifacts/handoff/08-19-s06-chat/ · 08-19-s07-board-motion/ · 08-19-s08-evidence/
 *
 *   focus: 'chat' | 'plan' | 'evidence' | 'doc'   본문
 *   side:  'casefile' | 'work'             오른쪽 350px
 *
 * ⚠️ **순차가 아닙니다.** 「다음 단계로 넘긴다」는 코드를 쓰지 마세요 —
 * 며칠 뒤 재진입하면 `case-opener` 가 곧장 `focus: "plan"` 으로 엽니다.
 * 두 축을 한 값으로 합치지 마세요(그 순간 다시 순차가 됩니다).
 *
 * 전환은 **바뀐 축**을 따릅니다
 *  · `side` 만 바뀜 → 오른쪽 열이 밖에서 들어옴 (`.side-in`)
 *  · `focus` 만 바뀜 → 본문 교차 (`.view-out` / `.view-in`) — 빈 화면을 만들지 않습니다
 *  · `chat` ↔ 그 밖 → **흡수**: 챗이 우하단 미니 챗 자리로 빨려듭니다 (`absorb.ts`)
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다. 아래 「국면 고르기」는 **개발용 스위치**이고,
 * 실제로는 서버 시그널이 축을 정합니다
 *  · **첫 로드는 `GET /api/cases/{case_token}` 하나입니다** (§3.10) — 슬롯·플랜·기한 합본.
 *    셋을 따로 부르면 첫 화면까지 왕복이 넷이고, 그동안 빈 화면입니다
 *  · 이후 갱신 — POST …/messages §3.9 · PATCH …/slots §3.5 · POST …/artifacts §3.8
 *  · `referenced_steps` → `side: "work"` (work-handler)
 *
 * **어느 화면으로 열지는 서버가 지목하지 않습니다** (§3.10 · 2026-08-21 확정).
 * 응답의 사실로 `case-opener` 가 고릅니다
 *
 *     focus  plan.steps 가 비어 있지 않으면 → 'plan',  그 밖 → 'chat'
 *     side   지금 할 단계가 있으면          → 'work',  그 밖 → 'casefile'
 *
 * **`focus: "evidence"` 로는 열지 않습니다** — 증거함은 눌러서 가는 곳이지
 * 재진입의 도착지가 아닙니다. 시그널이 없는 것이 맞습니다
 *
 *  · 링크 토큰은 **ADR-039 로 확정**됐습니다 — 128비트 · Crockford Base32 · 26자이고
 *    `case_id` 와 **다른 칸**입니다. 모양 검사는 `case-opener` 가 합니다
 *  · **첫 화면은 `case-opener` 가 고릅니다.** 값은 `load.ts` 가 §3.10 을
 *    **한 번** 불러 가져옵니다 — `?view=` 가 붙어 있을 때만 픽스처로 그립니다
 */

/** 유령을 띄워 두는 시간 — 흡수(1.5s)와 `.view-out`(0.3s 지연 + 0.7s) 중 긴 쪽 */
const GHOST_MS = ABSORB_MS;

/**
 * 사건 파일 카드가 보여주는 줄 — §S-06 「사건 파일 — 채워지는 것이 보입니다」.
 *
 * 슬롯 이름의 정본은 `spec/backend/08-16-data-model.md` §5.1 이고, 여기 라벨은
 * 그 표의 슬롯을 사용자 말로 옮긴 것입니다. **문진 문구(`lib/questions.ts`)는
 * 서버 것이라 화면이 못 봅니다** — 그래서 짧은 라벨만 여기 둡니다.
 *
 * ⚠️ **2026-08-27 까지 이 자리가 값까지 박힌 상수였습니다** — 「피해 유형: 기관 사칭
 * (검찰)」·「피해 금액: 300만원」. 카드 제목이 「진술에서 파악한 것」이고 옆에 진행 중
 * 점까지 맥동해서, **아무 말도 안 한 사람이 그것을 자기 사건의 사실로 읽었습니다.**
 * 서버는 §3.4 `slots[]` 로 실제 값을 보내고 있었고 화면이 그것을 버렸습니다.
 */
const CASE_FILE_ROWS: readonly { readonly key: string; readonly label: string }[] = [
  { key: "transferred", label: "돈이 나갔나" },
  { key: "channel", label: "보낸 방법" },
  { key: "org_name", label: "어느 기관" },
  { key: "amount", label: "피해 금액" },
  { key: "occurred_at", label: "보낸 시각" },
];

/** 토큰이 붙은 값인가 — `[계좌-1]` 처럼. **파랗게 그립니다** (§S-06 「PII」) */
const hasToken = (value: string) => /\[[^\]\s]+-\d+\]/.test(value);

/**
 * 사건 파일 한 줄이 지금 무엇인가.
 *
 * **「아직」과 「모름으로 넘어감」을 가릅니다.** 둘 다 값이 없지만 뜻이 다릅니다 —
 * 앞엣것은 아직 안 물은 것이고, 뒤엣것은 **답을 받은 것**입니다 (불변 규칙 5).
 */
function caseFileTone(
  slot: CaseSlot | undefined,
  asking: boolean,
): "asking" | "filled" | "unknown" | "future" {
  if (asking) return "asking";
  if (!slot) return "future";
  if (slot.state === "unknown") return "unknown";
  // `pii_pending` 은 확인 전이라 **없는 값과 같습니다** (ADR-041)
  if (slot.value && (slot.state === "confirmed" || slot.state === "extracted")) return "filled";
  return "future";
}

/**
 * 화면을 오가는 자리 — 헤더의 네 칸.
 *
 * 계약: spec/frontend/08-14-screens.md §S-06 「화면을 오가는 자리」
 *
 * ⚠️ **2026-08-27 까지 프로덕션에 이 길이 하나도 없었습니다.** `focus` 를 바꾸는
 * 코드가 저장소 전체에서 아래 개발용 스위치 하나였고, 그 블록이
 * `process.env.NODE_ENV !== "production"` 안이라 배포 빌드에서 통째로 사라졌습니다.
 *
 * 그래서 **자료함(S-08)과 기재 안내(S-10)에 어떤 경로로도 못 갔습니다.** 워크스페이스에서
 * 파일을 올려도 전사 결과를 볼 화면에 갈 수 없었고, QA 목표로 잡아 둔 한 바퀴 중
 * 「전사가 뜨고 파란 토큰이 보임」이 배포본에서 완주 불가였습니다.
 * `case-opener` 가 *"증거함은 눌러서 가는 곳"* 이라고 전제한 그 「눌러서」가 없었습니다.
 *
 * **`?view=` 는 대체 경로가 아닙니다** — 그쪽은 픽스처를 그리는 개발 경로라
 * 사용자 자기 사건을 보는 길이 아닙니다.
 */
/** 「할 일」 탭이 없습니다 — 할 일은 왼쪽 레일에 **상시**입니다 (ADR-063).
 *  플랜 화면 자체는 개발 경로(`?view=plan`)에만 남습니다 */
const VIEWS: readonly [Focus, string][] = [
  ["chat", "대화"],
  ["evidence", "자료함"],
  ["doc", "기재 안내"],
];

/** 개발용 — 서버 시그널이 붙기 전까지 축을 손으로 옮겨 봅니다 */
const DEV_VIEWS: readonly [Focus, string][] = [
  ["chat", "챗"],
  ["plan", "플랜"],
  ["evidence", "증거함"],
  ["doc", "기재 안내"],
];

/**
 * 사건 파일 카드 — §S-06 「사건 파일 — 채워지는 것이 보입니다」.
 *
 * **서버가 준 슬롯을 그립니다.** 화면이 값을 만들지 않습니다.
 *
 * 떼어 둔 이유는 **시험이 마운트할 수 있어야** 하기 때문입니다. `CaseScreen` 은
 * `useRouter`·`useSearchParams` 를 부르므로 라우터 문맥 없이는 못 그리는데,
 * 이 자리에 붙어 있던 결함(**값까지 박힌 상수를 「진술에서 파악한 것」으로 그리던 것**)은
 * 정확히 렌더 시험이 잡는 종류입니다 → `page.test.tsx`.
 */
export function CaseFileCard({
  slots,
  /** 지금 묻는 중인 슬롯. 없으면 `null` */
  asking,
}: {
  slots: readonly CaseSlot[];
  asking: string | null;
}) {
  return (
    <div className="rounded-[14px] border border-[oklch(0.305_0.013_267.1/60%)] bg-stage p-[14px_15px]">
      <div className="flex items-center gap-2 text-[13.5px] font-[620] text-ink-1">
        진술에서 파악한 것
        <span
          aria-hidden
          className="size-1.5 rounded-full bg-pii [animation:pulse-dot_1.6s_ease-in-out_infinite]"
        />
      </div>
      {/* **서버가 준 슬롯을 그립니다** — 화면이 값을 만들지 않습니다 (§3.4) */}
      <dl className="mt-2.5 grid gap-px">
        {CASE_FILE_ROWS.map(({ key, label }) => {
          const slot = slots.find((one) => one.slot_key === key);
          const tone = caseFileTone(slot, asking === key);
          return (
            <div
              key={key}
              className={`flex items-baseline justify-between gap-3 rounded-[7px] px-1.5 py-[7px] text-[13.5px] ${
                /* 「지금 묻는 중」은 앰버 배경 — **사용자 기한이 아니라
                   「여기 답하는 중」**입니다 (§S-06) */
                tone === "asking" ? "bg-[oklch(0.77_0.117_70.9/6%)]" : ""
              } ${tone === "future" ? "opacity-55" : ""}`}
            >
              <dt className="shrink-0 text-ink-3">{label}</dt>
              <dd className="min-w-0 text-right">
                {tone === "filled" && slot?.value ? (
                  /* 토큰이면 **파랗게** — 서버로 안 갔다는 뜻입니다.
                     흐리지 않습니다 (§S-06 「PII」) */
                  <span
                    className={`font-[580] ${
                      hasToken(slot.value) ? "text-pii" : "text-ink-1"
                    }`}
                  >
                    {slot.value}
                  </span>
                ) : (
                  <span className="text-[13px] text-ink-3">
                    {tone === "asking"
                      ? "지금 여쭤보는 중"
                      : tone === "unknown"
                        ? "모름으로 넘어감"
                        : "모름이어도 진행"}
                  </span>
                )}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-3 border-t border-hairline pt-2.5 text-[12.5px] leading-[1.6] text-ink-3">
        채워지는 만큼 절차가 정확해집니다.{" "}
        <b className="font-[620] text-ink-2">모름도 답입니다.</b> 빈 칸이어도
        진행됩니다.
      </p>
    </div>
  );
}

/**
 * 문 — 사건을 **한 번** 읽고, 읽히면 화면을 세웁니다.
 *
 * 셋으로 갈라 두는 이유는 아래 `CaseScreen` 이 **첫 렌더에 값을 다 갖고 있어야**
 * 하기 때문입니다. 상태 기계의 초기값이 `openCase()` 의 결과라, 값이 나중에
 * 오면 「챗으로 열었다가 플랜으로 튀는」 화면이 됩니다.
 */
export default function CasePage() {
  /** URL 의 토큰. **도메인을 하드코딩하지 않습니다** — 지금 열려 있는 주소가 곧 그 주소입니다 */
  const token = String(useParams().token ?? "");

  // 개발용 — `?view=plan` 처럼 주소로 열 수 있습니다 (스크린샷·시연용).
  // **이때는 서버를 부르지 않고 픽스처로 그립니다** — 시연에 DB 에 사건을 심어
  // 둘 필요가 없습니다. 제품 경로는 아래 `fetch` 뿐입니다
  const wanted = useSearchParams().get("view");
  const dev = wanted !== null;

  const { state, reload, refresh } = useCaseBundle(token, !dev);

  if (dev)
    return (
      <CaseScreen token={token} bundle={FIXTURE_BUNDLE} wanted={wanted} onPlanChanged={refresh} />
    );
  if (state.phase === "loading") return <CaseLoading />;
  if (state.phase === "failed") return <CaseFailed fail={state.fail} onRetry={reload} />;
  return (
    <CaseScreen token={token} bundle={state.bundle} wanted={null} onPlanChanged={refresh} />
  );
}

function CaseScreen({
  token,
  bundle,
  wanted,
  onPlanChanged,
}: {
  token: string;
  bundle: CaseBundle;
  wanted: string | null;
  /** 슬롯에 답해 플랜이 다시 만들어졌을 때 — **화면을 비우지 않고** 값만 갈아끼웁니다 */
  onPlanChanged: () => void;
}) {
  // 효과에서 setState 하면 한 번 그린 뒤 다시 그리게 되므로 **처음부터 초기값**으로 씁니다
  const devFocus: Focus =
    wanted === "plan" || wanted === "evidence" || wanted === "doc" ? wanted : "chat";

  // `?view=` 가 없으면 **규칙**이 첫 화면을 고릅니다 — 서버가 지목하지 않습니다 (§3.10)
  const opened = openCase(bundle.case);
  // `case-opener` 는 단계가 있으면 `plan` 을 고르지만, 챗이 중앙에 고정되면서
  // (ADR-063) 그 역할은 왼쪽 할 일 레일의 「지금 카드」가 맡습니다 — 본문은 챗.
  // `case-opener` 를 안 고친 것은 `?view=plan` 개발 경로가 그 값을 아직 쓰기 때문입니다
  const openedFocus: Focus = opened.focus === "plan" ? "chat" : opened.focus;

  /** 증거함·챗이 서버를 부를 때 쓰는 토큰. **개발 경로에서는 `null`** — 픽스처로 그립니다 */
  const dataToken = wanted === null ? token : null;

  /**
   * 대화는 **셸이 한 벌만** 들고 있습니다 — 전환 중 유령도 같은 것을 봐야 합니다.
   * 질문 자리도 여기 있습니다 — 슬롯 답과 발화가 **같은 매핑 목록**을 써야
   * 같은 계좌에 같은 번호가 붙습니다 (PII 경계).
   */
  /**
   * 사용자가 직접 연 단계. **누르지 않았으면 `null`** 이고, 그때는 아래
   * 기본 규칙이 고릅니다 → `work-handler` 의 `openStep`.
   */
  const [picked, setPicked] = useState<string | null>(null);

  const chat = useChatSend(dataToken, bundle.question, onPlanChanged, (stepIds) => {
    // **언급이 여럿이어도 패널은 하나**입니다 — 「지급정지를 걸고 3영업일 안에
    // 신청하세요」는 둘을 가리키지만 지금 할 것은 앞의 하나입니다.
    // 고를 것이 없으면 `null` 이고, 그때는 **패널을 그대로 둡니다** —
    // 「감사합니다」에서 작업 자리가 사라지면 적던 접수번호를 잃습니다
    const next = pickStep(stepIds, bundle.steps as unknown as WorkStep[]);
    if (next) setPicked(next.step_id);
  });
  /** 자료 레일도 같은 이유로 여기 있습니다. 개발 경로에서는 픽스처를 씨앗으로 둡니다 */
  const uploads = useUploads(dataToken, dataToken === null ? FIXTURE_EVIDENCE.files : []);
  /**
   * **부산물을 내는 자리** — 완료는 사용자의 체크가 아니라 이것으로 판정합니다
   * (불변 규칙 6). 여기 없으면 사슬도 기한도 멈춥니다 → `artifact.ts`
   */
  const artifact = useArtifact(dataToken, onPlanChanged);

  /**
   * 지금 손댈 단계 하나.
   *
   * | | |
   * | --- | --- |
   * | 보드에서 눌렀으면 | **그 단계** — 사용자의 뜻이 우선입니다 |
   * | 안 눌렀으면 | 아직 안 끝난 것 중 **앞선 것** |
   *
   * ⬜ 챗의 `referenced_steps` 로 옮기는 것(`applySignal`)은 아직입니다 —
   * **서버가 그 값을 빈 배열로만 냅니다**(§3.9 · `flows/chat-turn.ts`).
   * 모델이 돌려준 `ref` 를 단계 번호로 되짚는 자리가 먼저 필요합니다.
   */
  const activeStep = useMemo(() => {
    const open = bundle.steps.filter((one) => isOpen(one as WorkStep));
    if (open.length === 0) return null;

    // §3.6 이 `title` 과 `body` 를 보장합니다 — 두 모듈의 타입이 각자
    // 필요한 만큼만 선언해 놓아서 여기서 한 번 넓힙니다
    const chosen =
      (picked && open.find((one) => one.step_id === picked)) ||
      open.reduce((best, one) => (one.seq < best.seq ? one : best));
    return chosen as unknown as FullStep;
  }, [bundle.steps, picked]);

  /**
   * 파일을 부산물로 냅니다 — **두 걸음입니다.**
   *
   * 증거로 올려 `evidence_id` 를 받고(§3.2), 그것으로 §3.8 을 부릅니다.
   * 못 올렸으면 두 번째 걸음을 안 밟습니다 — 자료 레일에 실패가 남습니다.
   */
  const submitFile = async (stepId: string, file: File) => {
    const evidenceId = await uploads.add(file);
    if (!evidenceId) return;
    await artifact.submit(stepId, { kind: "receipt_doc", evidenceId });
  };

  const [focus, setFocus] = useState<Focus>(wanted ? devFocus : openedFocus);
  /**
   * 오른쪽 열은 **문진이 끝났는가 하나로만** 갈립니다 (2026-09-03 결정 —
   * TODO·챗·사건파일|WS 구조). 탭을 오가도 오른쪽이 안 바뀌니, 챗이
   * 중앙으로 미끄러지는 동안 사건 파일이 먼저 그려지던 것이 사라집니다.
   * 상태가 아니라 파생값인 이유입니다 — 손으로 옮길 수 있으면 또 어긋납니다.
   * `devSide` 는 개발 스위치 전용입니다.
   */
  const [devSide, setDevSide] = useState<Side | null>(null);
  const side: Side = devSide ?? (bundle.steps.length > 0 ? "work" : "casefile");
  const [copied, setCopied] = useState(false);

  const atWork = side === "work";
  const chatIsMain = focus === "chat";

  /**
   * 헤더의 기한 배지 — **서버가 센 값이 있을 때만** 뜹니다.
   *
   * ⚠️ **2026-08-27 까지 이 자리에 칩 셋이 하드코딩돼 있었습니다.**
   * 「국민은행 계좌이체」·「✓ 지급정지 완료」·「피해구제 신청까지 D-2」가 데이터가
   * 아니라 **지금 어느 화면을 보고 있는지**(`focus !== "chat"`)로 켜졌습니다 —
   * 아무것도 안 한 사람에게 지급정지가 끝났다고 말하고 있었습니다.
   *
   * 「국민은행 계좌이체」는 아예 뺐습니다. **경유 서비스를 내리는 칸이 §3.10 에
   * 없습니다** — 없는 값을 지어내지 않습니다 (불변 규칙 1).
   *
   * **화면이 날짜를 세지 않습니다** (불변 규칙 7). `days_left` 가 없으면 배지가
   * 통째로 안 뜹니다 — 히어로가 D-day 를 다루는 방식과 같습니다 (`plan.tsx`).
   */
  const headerDue = useMemo(() => {
    // ⚠️ **`in_progress` 만 찾아 갓 만든 사건에서는 배지가 아예 안 떴습니다.**
    // 그 상태는 접수번호가 L1 을 통과 못 했을 때만 생기고, 새 플랜은 전부
    // `not_started` 입니다 — 3영업일이 걸린 사건인데 헤더는 조용했습니다.
    // 히어로·워크스페이스와 **같은 판정**을 씁니다 (`currentStep`)
    // §3.6 이 `title` 을 보장합니다 — 두 모듈의 타입이 각자 필요한 만큼만
    // 선언해 놓아서 `activeStep` 과 같은 자리에서 한 번 넓힙니다
    const running = currentStep(bundle.steps as unknown as readonly WorkStep[]) as
      | FullStep
      | null;
    if (!running) return null;
    const due = groupDeadlines(bundle.deadlines).primary.find(
      (one) => one.step_id === running.step_id,
    );
    const dday = due ? ddayLabel(due) : null;
    return dday ? { title: running.title, dday } : null;
  }, [bundle.deadlines, bundle.steps]);

  // ── 흡수 ────────────────────────────────────────────────
  // 챗 본문과 미니 챗 자리의 **실제 위치를 재서** 그 사이를 잇습니다.
  // 시안은 1280×720 고정 캔버스라 픽셀이 박혀 있지만 우리는 반응형이라
  // 그 숫자를 그대로 못 씁니다 — 곡선만 가져오고 끝점은 잽니다 (absorb.ts).
  const mainRef = useRef<HTMLElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<Focus>(focus);
  /** 유령은 **화면에 있던 그대로**여야 합니다 — side 가 같은 턴에 바뀌므로 직전 값을 씁니다 */
  const sideAtChange = useRef<boolean>(atWork);
  /** 나가는 쪽은 이미 언마운트된 뒤라, 마지막으로 본 자리를 들고 있어야 합니다 */
  const lastRects = useRef<{ main?: DOMRectLike; mini?: DOMRectLike }>({});
  /**
   * **바뀌기 직전** 본문의 자리. 유령은 이걸 써야 합니다.
   *
   * `lastRects.main` 을 쓰면 안 됩니다 — 그건 이미 **새 본문**의 자리입니다.
   * 플랜이 챗보다 길어서, 그 높이로 유령을 만들면 화면 아래로 늘어나고
   * **맨 아래 컴포저가 잘려 나갑니다.** 챗이 떨어져 나가는 동안 입력창이
   * 사라져 보이던 것이 이것 때문이었습니다.
   */
  const prevMain = useRef<DOMRectLike | undefined>(undefined);
  /**
   * 전환이 도는 동안만 **나가는 본문**을 유령으로 띄웁니다.
   * 없으면 새 본문이 뜨기 전에 빈 화면이 한 박자 생깁니다 — 시안이 금지한 것입니다.
   *  · 챗에서 나갈 때 → 슬롯으로 빨려들며 사라집니다 (흡수)
   *  · 플랜 ↔ 증거함 → 겹쳐 지나갑니다 (`.view-out`)
   */
  const [ghost, setGhost] = useState<{ rect: DOMRectLike; from: Focus; atWork: boolean } | null>(
    null,
  );
  const ghostRef = useRef<HTMLDivElement>(null);

  // 자리를 계속 기억해 둡니다 (그려져 있을 때만 잴 수 있으므로).
  // 본문은 **직전 것도** 남겨야 합니다 — 아래 focus 효과가 그걸 씁니다.
  // 미니 챗은 반대로 **방금 마운트된 것**이 필요해서 덮어씁니다.
  useEffect(() => {
    if (mainRef.current) {
      prevMain.current = lastRects.current.main;
      lastRects.current.main = rectOf(mainRef.current);
    }
    if (miniRef.current) lastRects.current.mini = rectOf(miniRef.current);
  });

  useEffect(() => {
    const was = prevFocus.current;
    prevFocus.current = focus;
    if (was === focus) return;

    if (prefersReducedMotion()) return;

    const miniBox = lastRects.current.mini;
    // 유령은 **바뀌기 직전** 자리로, 복귀는 **지금** 본문 자리로 재야 합니다
    const ghostBox = prevMain.current;
    const mainBox = lastRects.current.main;
    if (!ghostBox || !mainBox) return;

    const enteringChat = was !== "chat" && focus === "chat";

    // 나가는 본문을 그 자리에 유령으로 남깁니다 — 겹쳐야 공백이 없습니다
    setGhost({ rect: ghostBox, from: was, atWork: sideAtChange.current });
    const t = setTimeout(() => setGhost(null), GHOST_MS);

    // 복귀 — 들어오는 본문에 같은 곡선을 거꾸로 겁니다 (뱉어내듯 펴짐)
    let anim: Animation | undefined;
    let fade: Animation | undefined;
    if (enteringChat && miniBox && mainRef.current) {
      anim = mainRef.current.animate(absorbKeyframes(mainBox, miniBox, "emit"), {
        duration: ABSORB_MS,
        easing: "linear",
      });
      // 슬롯에서 나올 때 톡 튀지 않게 앞머리만 살짝 — 카드 배경은
      // `ghost-card-shed`(아래 className)가 입힙니다. 길게 페이드하면
      // 카드가 반투명해져 지나가는 자료함 글자와 또 뒤엉킵니다
      fade = mainRef.current.animate(
        [
          { offset: 0, opacity: 0 },
          { offset: 0.12, opacity: 1 },
          { offset: 1, opacity: 1 },
        ],
        { duration: ABSORB_MS, easing: "linear" },
      );
    }
    return () => {
      clearTimeout(t);
      anim?.cancel();
      fade?.cancel();
    };
  }, [focus]);

  // 유령이 챗이면 슬롯으로 빨아들입니다. 그 밖은 CSS(`.view-out`)가 합니다
  useEffect(() => {
    const el = ghostRef.current;
    const miniBox = lastRects.current.mini;
    if (!ghost || ghost.from !== "chat" || !el || !miniBox) return;
    el.animate(absorbKeyframes(ghost.rect, miniBox, "absorb"), {
      duration: ABSORB_MS,
      easing: "linear",
      fill: "forwards",
    });
    el.animate(fadeKeyframes("out"), { duration: ABSORB_MS, easing: "linear", fill: "forwards" });
  }, [ghost]);

  // ⚠️ **맨 마지막 효과**여야 합니다. 효과는 선언 순서로 도니, 위의 focus 효과가
  // 「바뀌기 직전 side」를 읽고 난 뒤에 갱신돼야 유령이 화면에 있던 그대로 나옵니다
  useEffect(() => {
    sideAtChange.current = atWork;
  });

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* 미지원 — 주소는 헤더에 보이므로 손으로 옮길 수 있습니다 */
    }
  };

  return (
    // `overflow-x-clip` 은 전환 중 변형된 요소가 문서를 넓히지 못하게 하는 안전장치입니다.
    // 유령은 제 겹에서 가두지만, 여기가 마지막 방어선입니다
    <main className="relative isolate flex min-h-svh flex-col overflow-x-clip">
      {/* 화면 바닥의 호라이즌 — 장식. 랜딩·/start 와 같은 것이되 **그 7할** — 오래 머무는
          화면이고 보드에는 앰버(기한)·horizon(공고 대기) 이 이미 있어 한 단계 죽였습니다
          (2026-08-25 검수). 2026-08-27 에 전부 40% 연해져 0.7 → 0.42 입니다.
          `isolate` 가 있어야 세 열 아래에 깔립니다 (HorizonGlow 머리말) */}
      <HorizonGlow attach="viewport" opacity={0.55} />
      {/* ── 헤더 ─────────────────────────────────────────── */}
      <header className="border-b border-hairline bg-stage">
        <div className="mx-auto flex min-h-[56px] w-full max-w-shell flex-wrap items-center justify-between gap-x-4 gap-y-2 px-[clamp(16px,3vw,32px)] py-2">
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

          <div className="flex flex-wrap items-center gap-2">
            <span
              data-numeric
              className="inline-flex items-center gap-2 rounded-full border border-hairline bg-chip px-3 py-[5px] text-[13px] text-ink-3"
            >
              <span aria-hidden className="size-[5px] rounded-full bg-pii" />
              사건 {token.slice(0, 5)}…
            </span>
            {/* **화면을 오가는 자리** — 배포에서 이 길이 없으면 자료함·기재 안내에
                못 갑니다. 지금 보고 있는 칸은 눌러도 아무 일이 없습니다 */}
            <nav
              aria-label="화면"
              className="inline-flex items-center gap-0.5 rounded-full border border-hairline bg-chip p-0.5"
            >
              {VIEWS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  // 오른쪽 열은 안 건드립니다 — 문진이 끝났는가로만 갈립니다 (위 side)
                  onClick={() => setFocus(id)}
                  aria-current={focus === id ? "page" : undefined}
                  className={`inline-flex min-h-[var(--size-touch)] items-center rounded-full px-3 text-[13px] transition-colors duration-200 ${
                    focus === id
                      ? "bg-[oklch(1_0_0/12%)] font-[620] text-ink-1"
                      : "text-ink-3 hover:text-ink-1"
                  }`}
                >
                  {label}
                  {/* 올린 자료 수는 **브라우저가 들고 있는 목록**입니다 —
                      못 올린 것도 세어야 사용자가 자기가 고른 것을 다 봅니다 */}
                  {id === "evidence" && uploads.files.length > 0 && (
                    <span data-numeric className="ml-1.5 text-[12px] text-ink-4">
                      {uploads.files.length}
                    </span>
                  )}
                </button>
              ))}
            </nav>
            {/* 기한은 **서버가 계산한 값**입니다 — 화면이 날짜를 세지 않습니다
                (불변 규칙 7). 없으면 배지가 통째로 안 뜹니다 */}
            {headerDue && (
              <span className="inline-flex max-w-[260px] items-center gap-2 rounded-full border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/10%)] px-3 py-[5px] text-[13px] font-[620] text-deadline-urgent">
                <span className="min-w-0 truncate font-[560] text-ink-2">{headerDue.title}</span>
                <span data-numeric>{headerDue.dday}</span>
              </span>
            )}
            <button
              type="button"
              onClick={copyUrl}
              className="inline-flex min-h-[var(--size-touch)] items-center rounded-full border border-hairline bg-chip px-3 text-[13px] text-ink-3 transition-colors duration-200 hover:border-[oklch(1_0_0/25%)] hover:text-ink-1"
            >
              {copied ? "복사됨 ✓" : "가족에게 링크 보내기"}
            </button>
          </div>
        </div>
      </header>

      {/* 셸은 **세 열**입니다 — 할 일 레일 · 본문 · 오른쪽 열 (ADR-036 · ADR-063).
          T0 안전 절차는 열이 아니라 **본문 위 오버레이 알약**입니다(2026-09-03
          자리 정정 → safety.tsx 머리말). 단계가 서기 전에는 왼쪽 열을 통째로
          접습니다 — 문진 중에 빈 레일이 서 있으면 자리만 먹습니다 */}
      <div
        className={`mx-auto grid w-full max-w-shell flex-1 gap-0 ${
          bundle.steps.length > 0
            ? "md:grid-cols-[320px_minmax(0,1fr)_350px]"
            : "md:grid-cols-[minmax(0,1fr)_350px]"
        }`}
      >
        {bundle.steps.length > 0 && (
          <div
            className={`flex flex-col gap-3 px-[clamp(16px,3vw,32px)] pt-[clamp(18px,3vh,28px)] md:border-r md:border-hairline md:px-5 md:pb-[clamp(18px,3vh,28px)] md:order-none ${
              atWork ? "order-3" : "order-1"
            }`}
          >
            <div className="md:sticky md:top-[clamp(18px,3vh,28px)]">
              <TodoRail
                steps={bundle.steps}
                deadlines={bundle.deadlines}
                activeStepId={activeStep?.step_id ?? null}
                /* side 는 파생이라 옮길 것이 없습니다 — 단계가 있는 한 오른쪽은 WS 입니다 */
                onPickStep={(id) => setPicked(id)}
                /* 「무엇을 적는지 보기」의 도착지 — 제출처를 가진 유일한 화면 (ADR-042) */
                onOpenDoc={() => setFocus("doc")}
                /* 통지·우편을 올리면 그 결과를 볼 수 있어야 합니다 — 자료함으로 넘깁니다 */
                onPickFile={
                  dataToken
                    ? (file) => void uploads.add(file).then(() => setFocus("evidence"))
                    : undefined
                }
                busy={uploads.busy}
              />
            </div>
          </div>
        )}

        {/* ── 본문 ───────────────────────────────────────── */}
        <section
          ref={mainRef}
          key={focus}
          // ⚠️ `absorb.ts` 의 좌표는 **왼쪽 위 기준**으로 계산합니다.
          // 기본값(가운데)으로 두면 축소 기준이 어긋나 화면 밖으로 나갑니다.
          // 복귀 중에는 카드 껍질을 입고 옵니다 — 나가는 유령의 `ghost-card` 거울.
          // 맨몸으로 날리면 지나가는 화면 글자와 뒤엉킵니다 (2026-09-03 실측)
          style={{
            transformOrigin: "top left",
            ...(ghost && focus === "chat"
              ? { animation: `ghost-card-shed ${ABSORB_MS}ms linear both`, border: "1px solid transparent" }
              : {}),
          }}
          className={`order-2 flex min-w-0 flex-col px-[clamp(16px,3vw,32px)] py-[clamp(18px,3vh,28px)] md:order-none ${
            /* 챗은 읽기 폭으로 가운데에 — 「중앙 고정」의 고정감은 폭에서 옵니다 (ADR-063) */
            focus === "chat" ? "mx-auto w-full max-w-[760px]" : "view-in"
          }`}
        >
          {/* T0 는 본문 위에 뜹니다 — 어느 국면이든 같은 자리 (ADR-063 · 2026-09-03) */}
          <T0Overlay />
          {focus === "chat" && (
            <ChatView
              atWork={atWork}
              token={dataToken}
              chat={chat}
              /* 답해도 오른쪽은 그대로입니다 — 플랜이 생기는 순간 side 가
                 파생으로 work 가 됩니다. 손으로 옮길 것이 없습니다 */
              onPickChoice={() => undefined}
            />
          )}
          {focus === "plan" && (
            <PlanView
              steps={bundle.steps}
              deadlines={bundle.deadlines}
              onPickStep={(id) => setPicked(id)}
              /* 「무엇을 적는지 보기」의 도착지 — 제출처를 가진 유일한 화면 (ADR-042) */
              onOpenDoc={() => setFocus("doc")}
              /* 통지·우편을 올리면 그 결과를 볼 수 있어야 합니다 — 자료함으로 넘깁니다 */
              onPickFile={
                dataToken
                  ? (file) => void uploads.add(file).then(() => setFocus("evidence"))
                  : undefined
              }
              busy={uploads.busy}
            />
          )}
          {focus === "evidence" && (
            /* **셸이 볼트에서 열어 온 매핑을 그대로 내려줍니다** — 안 내려주면
               증거함이 픽스처로 떨어져 이 사건에 없는 값을 원문으로 그립니다 */
            <EvidenceView
              token={dataToken}
              uploads={uploads}
              restorable={chat.restorable}
              // **한 번뿐인 대응표를 받는 자리** — 안 이으면 여기서 버려집니다 (ADR-063)
              onMappings={(fresh) => void chat.absorb(fresh)}
              locked={chat.locked}
              /* 「없이 진행」의 도착지 — 「사건은 그대로 진행됩니다」를 참으로 만듭니다 */
              onContinue={() => setFocus("chat")}
            />
          )}
          {focus === "doc" && (
            /* **사건의 슬롯과 볼트 매핑을 내려줍니다** — 안 내려주면 이 화면이
               자기 값을 만들어 냅니다. 전에 여기 남의 이름과 계좌번호가
               상수로 박혀 있었고, 헤더에 화면 이동이 붙으면서 보이게 됐습니다 */
            <DocGuide
              caseToken={token}
              slots={bundle.slots}
              /* 개발 경로(`?view=`)에서만 픽스처입니다 — 증거함과 같은 규칙입니다.
                 실서버 경로에서 픽스처를 쓰면 **이 사건에 없는 값이 서류 칸에
                 원문으로 그려집니다** (`evidence.tsx` 의 같은 자리 참고) */
              restorable={dataToken === null ? FIXTURE_MAPPINGS : chat.restorable}
            />
          )}
        </section>

        {/* ── 오른쪽 열 — 자리는 하나, 내용이 바뀝니다 ──────
            본문이 챗이면 사건 파일 ↔ 워크스페이스,
            본문이 챗이 아니면 워크스페이스 **위** + 미니 챗 **아래** */}
        <aside
          className={`flex min-w-0 flex-col border-t border-hairline bg-stage p-[clamp(16px,3vw,20px)] md:order-none md:border-l md:border-t-0 ${
            atWork ? "order-1 border-t-0 border-b" : "order-3"
          } ${atWork ? "side-in" : ""}`}
        >
          {atWork ? (
            <>
              <div className="mb-3 text-[12.5px] tracking-[0.12em] text-ink-4">워크스페이스</div>
              {/* **서버가 준 단계를 그립니다** — 어느 패널인지는 `body.action` 이
                  정합니다(ADR-024). 전에는 시안 값이 하드코딩돼 있어 사용자가
                  무엇을 해도 부산물이 안 만들어졌습니다 */}
              <Workspace
                step={activeStep}
                // **판정을 돌려줍니다** — 낸 것이 확인돼야 입력칸이 비워집니다.
                // 삼켜 버리면 못 낸 접수번호가 낸 것처럼 사라집니다 (§3.1)
                onSubmit={(stepId, one) => artifact.submit(stepId, one)}
                busy={artifact.sendingStepId !== null || uploads.busy}
                // **그 단계의 판정만** 그립니다 — 앞 단계의 「끝났습니다」가
                // 다음 단계에 붙어 있으면 안 한 일이 한 것처럼 보입니다
                verdict={
                  artifact.verdictStepId === activeStep?.step_id ? artifact.verdict : null
                }
                fail={artifact.fail}
                onPickFile={dataToken ? (id, file) => void submitFile(id, file) : undefined}
              />
              {chatIsMain && ghost ? (
                /* 복귀 중 — 미니 챗이 떠나는 챗에게 자리를 돌려줍니다 (mini-take 거울).
                   즉시 힌트로 갈아끼우면 슬롯이 한 프레임에 비어 눈에 걸립니다 */
                <div
                  style={{ animation: `mini-give ${ABSORB_MS}ms linear both` }}
                  className="mt-4 flex min-h-[220px] flex-col border-t border-hairline pt-4"
                >
                  <MiniChat chat={chat} token={dataToken} />
                </div>
              ) : chatIsMain ? (
                <p className="mt-3 text-[12.5px] leading-[1.6] text-ink-3">
                  챗이 다른 단계를 가리키면 이 패널이 바뀝니다. 언급이 없으면{" "}
                  <b className="font-[620] text-ink-2">그대로 둡니다.</b> 적던 접수번호가
                  사라지지 않습니다.
                </p>
              ) : (
                <div
                  ref={miniRef}
                  style={
                    ghost?.from === "chat"
                      ? { animation: `mini-take ${ABSORB_MS}ms linear both` }
                      : undefined
                  }
                  className="mt-4 flex min-h-[220px] flex-col border-t border-hairline pt-4"
                >
                  {/* **셸이 든 대화 한 벌을 그대로 내려줍니다** — 본문 챗과 같은 것을
                      봐야 두 자리가 어긋나지 않습니다. 문진도 여기 뜹니다 */}
                  <MiniChat chat={chat} token={dataToken} />
                </div>
              )}
            </>
          ) : (
            <>
              <div className="mb-3 text-[12.5px] tracking-[0.12em] text-ink-4">
                사건 파일
              </div>
              <CaseFileCard slots={bundle.slots} asking={bundle.question?.slot_key ?? null} />
            </>
          )}
        </aside>
      </div>

      {/* 개발용 축 스위치 — 제품이 아닙니다. 서버 시그널이 붙으면 통째로 지웁니다.
          화면 흐름을 가리지 않도록 오른쪽 아래에 떠 있게 두고, `?view=` 로도 받습니다.

          ⚠️ **프로덕션 빌드에서는 렌더하지 않습니다.** 「제품이 아니다」라고 주석만
          달아 두고 조건 없이 그리고 있어서, **심사위원 화면에 그대로 떴습니다.**
          `?view=` 는 남겨 둡니다 — 화면이 없어질 뿐 시연·스크린샷 경로는 필요합니다 */}
      {process.env.NODE_ENV !== "production" && (
      <div className="pointer-events-auto fixed bottom-3 right-3 z-50 flex items-center gap-1 rounded-full border border-hairline bg-stage/90 px-1.5 py-1 text-[12.5px] backdrop-blur">
        <span className="px-1.5 text-icon">dev</span>
        {DEV_VIEWS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setFocus(id);
              if (id !== "chat") setDevSide("work");
            }}
            aria-pressed={focus === id}
            className={`rounded-full px-2.5 py-1 transition-colors duration-200 ${
              focus === id ? "bg-[oklch(1_0_0/14%)] text-ink-1" : "text-ink-3 hover:text-ink-1"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setDevSide(atWork ? "casefile" : "work")}
          disabled={!chatIsMain}
          className="rounded-full px-2.5 py-1 text-ink-3 transition-colors duration-200 hover:text-ink-1 disabled:opacity-30"
        >
          {atWork ? "사건파일" : "WS"}
        </button>
      </div>
      )}

      {/* 나가는 본문의 유령 — 새 본문과 **겹쳐** 지나갑니다.
          바깥 겹은 반드시 있어야 합니다: 유령이 기울고 늘어나며 화면 밖으로 나가는데,
          가두지 않으면 **문서가 넓어져 아래 레이아웃이 통째로 오른쪽으로 밀립니다** */}
      {ghost && (
        <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
          <div
            ref={ghostRef}
            aria-hidden
            className={`absolute overflow-hidden ${
              ghost.from === "chat" ? "border border-transparent" : "view-out"
            }`}
            style={{
              ...(ghost.from === "chat"
                ? { animation: `ghost-card ${ABSORB_MS}ms linear both` }
                : null),
              left: ghost.rect.x,
              top: ghost.rect.y,
              width: ghost.rect.w,
              height: ghost.rect.h,
              transformOrigin: "top left",
            }}
          >
            {/* `[&_.rise]:animate-none` — 나가는 중인데 내용이 새로 등장하면 안 됩니다 */}
            <div className="flex h-full flex-col overflow-hidden px-[clamp(16px,3vw,32px)] py-[clamp(18px,3vh,28px)] [&_.rise]:animate-none">
              {ghost.from === "chat" && (
                <ChatView
                  atWork={ghost.atWork}
                  token={dataToken}
                  chat={chat}
                  onPickChoice={() => undefined}
                />
              )}
              {ghost.from === "plan" && (
                <PlanView
              steps={bundle.steps}
              deadlines={bundle.deadlines}
              onPickStep={(id) => setPicked(id)}
              onOpenDoc={() => setFocus("doc")}
            />
              )}
              {ghost.from === "evidence" && (
                <EvidenceView
                  token={dataToken}
                  uploads={uploads}
                  restorable={chat.restorable}
              // **한 번뿐인 대응표를 받는 자리** — 안 이으면 여기서 버려집니다 (ADR-063)
              onMappings={(fresh) => void chat.absorb(fresh)}
                  locked={chat.locked}
                  onContinue={() => setFocus("chat")}
                />
              )}
              {ghost.from === "doc" && (
                <DocGuide
                  caseToken={token}
                  slots={bundle.slots}
                  restorable={dataToken === null ? FIXTURE_MAPPINGS : chat.restorable}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
