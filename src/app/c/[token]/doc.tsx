"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/**
 * S-10 서류 기재 안내 — `/c/{token}` 의 `focus: "doc"` 일 때의 본문.
 *
 * 계약: spec/frontend/08-14-screens.md §S-10 · ADR-037(서류를 만들지 않는다)
 * 시안: assets/artifacts/handoff/08-20-s10-doc-guide/ 「S-10 Doc Guide Options」 1a + 1c
 *
 * **신청서를 대신 만들어 주지 않습니다.** 법정 서식(시행령 별지 제1호서식)의 칸과
 * 우리가 아는 값을 짝지어 보여주고, **값을 눌러 복사하게** 합니다.
 * 앱 폼을 채우든 창구에서 손으로 쓰든 같은 화면이 그대로 쓰입니다.
 *
 * 절대 하지 않는 것
 *  · **문서를 조판하지 않습니다.** `.docx`·PDF 버튼을 두지 마세요 (ADR-037 · PII 경계 규칙 6)
 *  · **제출처를 화면이 단정하지 않습니다** — 서버가 준 `submit` 배열을 **순서 그대로** 그립니다.
 *    「앱이 먼저」를 코드에 박지 마세요. KB·NH 는 공식 안내가 **영업점 서면**이고
 *    나머지 다섯은 확인 실패입니다 (ADR-042 · docs/research/04-기관정보.md §0.1)
 *  · **모름을 실패로 그리지 않습니다.** 빈 칸이 몇이든 신청은 진행됩니다
 *  · 빨강 없음 · 화면이 날짜를 세지 않음
 *
 * ⚠️ **`--color-icon` 을 글자에 쓰지 마세요.** 시안이 본문 아홉 곳에 썼던 것을 여기서
 * `ink-3`·`ink-4` 로 옮겼습니다 — `--surface` 위 4.43:1 로 AA 미달입니다
 * (spec/frontend/design-system/08-16-tokens.md).
 *
 * TODO(연결) — 지금은 UI 상태만 돕니다
 *  · SECTIONS → `GET …/doc-guide` (⬜ 계약 없음). **필드 상태 판정은 서버**입니다
 *  · submit → **`org.contact.submit`** (배열) · submitNote → `report_hours`·`caution` (§11.1)
 *    ⚠️ **비어 있으면 이 카드를 아예 그리지 않습니다.** 확인 못 한 것과 「앱으로 안 된다」는
 *    다릅니다 — 배열에 없는 것이 「모른다」입니다 (ADR-042 ③)
 *  · restored → PII 로컬 복원 성공 여부. 실패는 **에러가 아닙니다**(다른 기기)
 *  · 층 C: doc-filler · key-handler
 */

type FieldState = "confirmed" | "unread" | "unknown" | "staff";

type Field = {
  id: string;
  /** 서식 칸 이름 **그대로**. 다듬지 마세요 — 사용자가 실물과 대조합니다 */
  label: string;
  state: FieldState;
  /** 읽기 좋게 끊은 것 */
  display?: string;
  /** 복사되는 원문 — **끊지 않습니다** */
  raw?: string;
  /** 다른 기기에서 보이는 칩 */
  masked?: string;
  note?: string;
};

type Section = { id: string; name: string; fields: Field[] };

/**
 * 신청서를 내는 길. **하나가 아닙니다** → ADR-042 · 데이터 모델 §11.1 ④
 *
 * ⚠️ **배열 순서가 곧 권장 순서입니다. 여기서 정렬하지 마세요** —
 * 기관마다 무엇이 먼저인지가 다르고 그건 KB 가 압니다.
 */
type SubmitPath = { how: "branch" | "app"; text: string; url?: string };

/**
 * 서식 구획 그대로입니다 — 사용자가 실물과 1:1 로 대조할 수 있어야 합니다.
 * 칸 이름의 근거는 docs/research/01-환급절차-기한.md §5.1 (서식 실물 확인).
 *
 * ⚠️ **주민등록번호 칸은 없습니다. 생년월일입니다.**
 */
const SECTIONS: Section[] = [
  {
    id: "victim",
    name: "피해자",
    fields: [
      { id: "v-name", label: "성명", state: "confirmed", display: "이영희", raw: "이영희", masked: "이름·3" },
      { id: "v-birth", label: "생년월일", state: "unknown", note: "직접 적으셔야 합니다 — 주민등록번호가 아닙니다" },
      { id: "v-addr", label: "주소", state: "unknown", note: "직접 적으셔야 합니다" },
      { id: "v-tel", label: "전화번호", state: "unknown", note: "직접 적으셔야 합니다 — 없으면 비워 두세요" },
      { id: "v-mobile", label: "휴대전화번호", state: "confirmed", display: "010-4321-8765", raw: "01043218765", masked: "전화·1" },
      { id: "v-email", label: "전자우편주소", state: "confirmed", display: "younghee@naver.com", raw: "younghee@naver.com", masked: "메일·1" },
    ],
  },
  {
    id: "out",
    name: "피해자 계좌의 송금·이체 내역",
    fields: [
      { id: "o-bank", label: "금융회사", state: "confirmed", display: "국민은행", raw: "국민은행" },
      { id: "o-branch", label: "개설점포", state: "unknown", note: "직접 적으셔야 합니다 — 모르시면 창구에서 알려줍니다" },
      { id: "o-type", label: "예금종별", state: "unknown", note: "직접 적으셔야 합니다 — 통장 표지에 있습니다" },
      { id: "o-acct", label: "계좌번호", state: "unread", display: "352-0912-3456-73", raw: "3520912345673", masked: "계좌·2", note: "이체내역에서 읽은 값 — 확인해 주세요" },
      { id: "o-holder", label: "명의인", state: "confirmed", display: "이영희", raw: "이영희", masked: "이름·3" },
      { id: "o-when", label: "송금·이체일시", state: "unread", display: "2026. 8. 14. 14:02", raw: "2026-08-14 14:02", note: "읽은 값 — 확인해 주세요" },
      { id: "o-amount", label: "금액", state: "confirmed", display: "3,000,000원", raw: "3000000", masked: "금액·1" },
    ],
  },
  {
    id: "fraud",
    name: "사기이용계좌 입금내역",
    fields: [
      { id: "f-bank", label: "금융회사", state: "confirmed", display: "국민은행", raw: "국민은행" },
      { id: "f-acct", label: "계좌번호", state: "confirmed", display: "110-2345-678901", raw: "1102345678901", masked: "계좌·1" },
      { id: "f-holder", label: "명의인", state: "unread", display: "김민수", raw: "김민수", masked: "이름·1", note: "통화에서 들은 값 — 확인해 주세요" },
      { id: "f-when", label: "입금일시", state: "unread", display: "2026. 8. 14. 14:02", raw: "2026-08-14 14:02", note: "읽은 값 — 확인해 주세요" },
      { id: "f-amount", label: "금액", state: "confirmed", display: "3,000,000원", raw: "3000000", masked: "금액·1" },
    ],
  },
  {
    id: "refund",
    name: "피해환급금 입금계좌",
    fields: [
      { id: "r-bank", label: "금융회사", state: "unknown", note: "환급받을 본인 계좌를 적으세요" },
      { id: "r-acct", label: "계좌번호", state: "unknown", note: "직접 적으셔야 합니다" },
      { id: "r-holder", label: "명의인", state: "unknown", note: "본인 이름" },
    ],
  },
  {
    id: "reason",
    name: "피해구제 신청사유",
    fields: [
      {
        id: "s-reason",
        label: "피해구제 신청사유",
        state: "unread",
        display: "검사를 사칭한 전화로 안전계좌 확인이 필요하다는 말에 속아 계좌이체로 송금함",
        raw: "검사를 사칭한 전화로 안전계좌 확인이 필요하다는 말에 속아 계좌이체로 송금함",
        note: "대화에서 정리한 문장 — 확인해 주세요",
      },
    ],
  },
  {
    id: "tail",
    name: "말미 — 날짜·서명·수신처",
    fields: [
      { id: "t-date", label: "신청 연월일", state: "unknown", note: "내는 날 적습니다" },
      { id: "t-sign", label: "신청인 서명 또는 인", state: "unknown", note: "직접 서명하시거나 도장을 찍습니다" },
      { id: "t-to", label: "○○○ 금융회사 귀하", state: "confirmed", display: "국민은행", raw: "국민은행" },
    ],
  },
];

/** 색이 어두운 란 — 신청인이 적지 않습니다 */
const STAFF_FIELDS = "접수번호 · 접수일자";

/** 이웃 화면과 같은 등장 리듬 (부모 `.view-in` 0.5s 지연 뒤에 시작) */
const step = (i: number) => ({ animationDelay: `${520 + i * 90}ms` });

const copyTargets = SECTIONS.flatMap((s) =>
  s.fields.filter((f) => f.state === "confirmed" || f.state === "unread"),
);

/* ── 「어디까지 옮겼는지」 ───────────────────────────────────
 *
 * 은행 앱에 갔다 돌아와도 남아야 하므로 **이 기기의 localStorage** 가 정본입니다.
 * ⚠️ 값이 아니라 **어느 칸을 옮겼는지**만 남깁니다 — 원문은 저장하지 않습니다.
 *
 * effect 안에서 `setState` 로 씨앗을 심으면 서버가 그린 빈 값과 어긋나고,
 * React 의 `set-state-in-effect` 가 그 패턴을 막습니다. `useSyncExternalStore` 는
 * **서버 스냅샷을 따로 받아** 그 문제를 없앱니다.
 *
 * 메모리 사본을 한 겹 두는 이유는 둘입니다.
 *  · `getSnapshot` 은 값이 안 바뀌면 **같은 값**을 돌려줘야 합니다 (무한 렌더 방지)
 *  · 사파리 프라이빗처럼 저장이 막힌 기기에서도 **이번 화면에서는 표시돼야** 합니다
 *
 * ⬜ 이 자리는 `case-purger` 밖입니다 → 핸드오프 08-20-s10-doc-guide 「미결」
 */
const copiedMem = new Map<string, string>();
const copiedSubs = new Set<() => void>();

function readCopied(key: string): string {
  const cached = copiedMem.get(key);
  if (cached !== undefined) return cached;
  let raw = "[]";
  try {
    raw = localStorage.getItem(key) ?? "[]";
  } catch {
    /* 저장소가 막힌 기기 */
  }
  copiedMem.set(key, raw);
  return raw;
}

function writeCopied(key: string, ids: string[]) {
  const raw = JSON.stringify(ids);
  copiedMem.set(key, raw);
  try {
    localStorage.setItem(key, raw);
  } catch {
    /* 저장 실패해도 이번 화면에서는 표시됩니다 */
  }
  copiedSubs.forEach((fn) => fn());
}

function subscribeCopied(onChange: () => void) {
  copiedSubs.add(onChange);
  /** 다른 탭에서 바뀌면 사본을 버리고 다시 읽습니다 */
  const onStorage = (e: StorageEvent) => {
    if (e.key === null) copiedMem.clear();
    else copiedMem.delete(e.key);
    onChange();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    copiedSubs.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export default function DocGuide({
  caseToken = "7fK2p",
  restored = true,
  orgName = "국민은행",
  // KB국민은 공식 안내가 **영업점 서면**입니다. 앱 경로는 「확인 실패」가 아니라
  // 「아니오」라 배열에 넣지 않습니다 (ADR-042 ③ · research/04 §0.1).
  // ⬜ 지점 찾기 URL 은 아직 어느 은행도 확인 못 했습니다 → research/05 U-31
  submit = [{ how: "branch", text: "가까운 영업점에 서면 제출" }],
  submitNote = "은행 확인값입니다 (2026-08-20 확인) · 긴급 지급정지 전화와는 다른 단계입니다",
}: {
  /** URL 의 링크 토큰. **`case_id` 가 아닙니다** → ADR-039 */
  caseToken?: string;
  restored?: boolean;
  orgName?: string;
  submit?: SubmitPath[];
  submitNote?: string;
}) {
  /** 슬러그는 `fin-ally` 입니다 — `finally` 는 JS 예약어라 쓰지 않습니다 (CLAUDE.md) */
  const storageKey = `fin-ally:doc-copied:${caseToken}`;
  const copiedRaw = useSyncExternalStore(
    subscribeCopied,
    () => readCopied(storageKey),
    () => "[]", // 서버에는 이 기기의 기록이 없습니다
  );
  const copied = useMemo(() => {
    try {
      const v: unknown = JSON.parse(copiedRaw);
      return new Set(Array.isArray(v) ? (v as string[]) : []);
    } catch {
      return new Set<string>(); // 첫 방문이거나 값이 깨졌습니다
    }
  }, [copiedRaw]);
  const [flash, setFlash] = useState<string | null>(null);
  /** 복사가 거부됐을 때 — 값을 골라 주고 그 사실을 알립니다 */
  const [failed, setFailed] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(["victim", "out"]));
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(flashTimer.current), []);

  /**
   * 복사가 실패했을 때 **아무 일도 일어나지 않으면 안 됩니다.**
   *
   * 이 화면은 복사가 전부인데, `navigator.clipboard` 는 문서에 포커스가 없거나
   * 비보안 컨텍스트면 거부합니다. 그때 조용히 삼키면 사용자는 눌렀는데 안 되는 이유를
   * 알 수 없습니다 — **값을 골라 줘서 직접 옮길 수 있게** 합니다.
   */
  const selectValue = (id: string) => {
    const el = document.getElementById(`docval-${id}`);
    const sel = window.getSelection();
    if (!el || !sel) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const copy = async (f: Field) => {
    if (!restored && f.masked) return; // 가려진 값은 이 기기에서 복사할 수 없습니다
    const text = f.raw ?? f.display ?? "";

    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 옛 경로 — 클립보드 API 가 거부하는 환경이 아직 있습니다
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }

    clearTimeout(flashTimer.current);
    if (!ok) {
      // 마지막 수단 — 값을 골라 둡니다. 누르면 바로 복사할 수 있습니다
      selectValue(f.id);
      setFailed(f.id);
      flashTimer.current = setTimeout(() => setFailed(null), 6000);
      return;
    }

    setFailed(null);
    writeCopied(storageKey, [...new Set(copied).add(f.id)]);
    setFlash(f.id);
    flashTimer.current = setTimeout(() => setFlash(null), 1600);
  };

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const done = copyTargets.filter((f) => copied.has(f.id)).length;

  return (
    <div className="mx-auto w-full max-w-[860px]">
      {/* ── 머리 ─────────────────────────────────────────── */}
      <header style={step(0)} className="rise flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-[660] tracking-[-0.018em] text-ink-1">
            피해구제신청서 — 기재 안내
          </h1>
          <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
            신청서를 대신 만들어 드리지 않습니다.{" "}
            <b className="font-[620] text-ink-1">어느 칸에 무엇을 적을지</b> 짝지어 드립니다 —
            값을 누르면 복사됩니다.
          </p>
          {/* ⚠️ 접힌 구획이 세로로 쌓이면 「위에서부터 다 채워야」로 읽힙니다.
              칸 순서는 서식에서 온 것이고, 채우는 순서는 없습니다 */}
          <p className="mt-1 text-[13px] leading-[1.6] text-ink-3">
            <b className="font-[620] text-ink-2">칸 순서는 서식에 적힌 그대로</b>라 실물과 나란히
            대조하실 수 있습니다. 채우는 순서는 없습니다 — 아는 것부터 하셔도 됩니다.
          </p>
        </div>
        <span
          data-numeric
          className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[oklch(0.697_0.16_258.2/42%)] bg-[oklch(0.697_0.16_258.2/10%)] px-[11px] py-1 text-[12.5px] font-[620] text-pii"
        >
          옮겨 적음 {done} / {copyTargets.length}
        </span>
      </header>

      {/* ── 제출처 — 서버 값 슬롯. **화면이 단정하지 않습니다** ──
          비어 있으면 **카드를 아예 그리지 않습니다.** 「모른다」를 「없다」로
          그리지 않기 위해서입니다 → ADR-042 ③ */}
      {submit.length > 0 && (
        <div
          style={step(1)}
          className="rise mt-3.5 flex items-start gap-3 rounded-[12px] border border-hairline bg-surface px-[15px] py-3"
        >
          <span
            aria-hidden
            className="grid size-[21px] shrink-0 place-items-center rounded-full border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/22%)] text-[11px] font-bold text-pii"
          >
            ◆
          </span>
          <div className="min-w-0">
            <div className="text-[14px] font-[620] text-ink-1">
              어디에 내나요 — <span className="text-pii">{orgName}</span>
            </div>

            {/* 길이 여럿일 때만 「먼저 / 안 되면」이 붙습니다 —
                하나뿐인데 「먼저」라고 쓰면 다른 길이 있는 것처럼 읽힙니다 */}
            <ul className="mt-2 grid gap-1">
              {submit.map((path, i) => (
                <li
                  key={path.how}
                  className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13.5px] leading-[1.6] text-ink-2"
                >
                  {submit.length > 1 && (
                    <span className="inline-flex shrink-0 items-center rounded-full border border-hairline bg-chip px-2 py-px text-[12.5px] text-ink-3">
                      {i === 0 ? "먼저" : "안 되면"}
                    </span>
                  )}
                  <span className="min-w-0">{path.text}</span>
                  {path.url && (
                    <a
                      href={path.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-[var(--size-touch)] items-center text-[13px] text-pii"
                    >
                      {path.how === "branch" ? "지점 찾기 ↗" : "안내 열기 ↗"}
                    </a>
                  )}
                </li>
              ))}
            </ul>

            <div className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-3">{submitNote}</div>
          </div>
        </div>
      )}

      {/* ── 다른 기기 — **고장이 아닙니다** (S-11 과 같은 어휘) ── */}
      {!restored && (
        <div
          style={step(2)}
          className="rise mt-3 flex items-start gap-2.5 rounded-[12px] border border-hairline bg-surface px-[15px] py-3"
        >
          <span
            aria-hidden
            className="grid size-[21px] shrink-0 place-items-center rounded-full border border-[oklch(0.305_0.013_267.1/70%)] text-[11px] text-icon"
          >
            ○
          </span>
          <p className="text-[13px] leading-[1.6] text-ink-3">
            <b className="font-[620] text-ink-1">이 기기에서는 값이 가려져 보입니다.</b> 원문은
            처음 올린 기기에서만 보입니다 — 고장이 아닙니다. 가려지지 않는 값(날짜·은행명)은
            여기서도 복사됩니다.
          </p>
        </div>
      )}

      {/* ── 구획 — 서식 그대로 접습니다 ─────────────────── */}
      <div style={step(3)} className="rise mt-[18px]">
        {SECTIONS.map((sec) => {
          const isOpen = open.has(sec.id);
          const filled = sec.fields.filter(
            (f) => f.state === "confirmed" || f.state === "unread",
          ).length;
          return (
            <div key={sec.id} className="border-t border-hairline">
              <button
                type="button"
                onClick={() => toggle(sec.id)}
                aria-expanded={isOpen}
                className="flex min-h-[46px] w-full items-center justify-between gap-3 px-0.5 text-left"
              >
                <span className="flex items-center gap-2 text-[15px] font-[620] text-ink-1">
                  <span aria-hidden className="text-[12px] text-icon">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  {sec.name}
                </span>
                {/* 「저희가 채운 값 0」 은 우리가 실패한 것처럼 읽힙니다 —
                    환급받을 계좌처럼 **원래 알 수 없는** 구획이 있습니다 */}
                <span data-numeric className="shrink-0 text-[12.5px] text-ink-4">
                  {filled === 0
                    ? `${sec.fields.length}칸 · 전부 직접 적습니다`
                    : `${sec.fields.length}칸 · 복사할 값 ${filled}`}
                </span>
              </button>

              {isOpen && (
                <div>
                  {sec.fields.map((f, i) => (
                    <div
                      key={f.id}
                      className={`grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 py-[11px] ${
                        i < sec.fields.length - 1
                          ? "border-b border-[oklch(0.305_0.013_267.1/40%)]"
                          : ""
                      }`}
                    >
                      {/* 서식 칸 이름 — 이 화면에서 가장 중요한 글자입니다.
                          ⚠️ `icon`(4.43:1) 으로 내리지 마세요 */}
                      <span className="text-[13px] leading-[1.45] text-ink-3">{f.label}</span>

                      {f.state === "unknown" ? (
                        <>
                          <span className="justify-self-start border-b border-dashed border-[oklch(0.305_0.013_267.1/70%)] pb-0.5 text-[13.5px] text-ink-3">
                            {f.note}
                          </span>
                          <span />
                        </>
                      ) : !restored && f.masked ? (
                        <>
                          <span>
                            <span className="inline-flex rounded-[6px] border border-[oklch(0.697_0.16_258.2/36%)] bg-pii-bg px-2 py-px text-[13px] text-pii">
                              {f.masked}
                            </span>
                          </span>
                          <span className="text-[12.5px] text-ink-4">이 기기에선 복사 안 됨</span>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0">
                            <span
                              id={`docval-${f.id}`}
                              data-numeric
                              className="text-[15px] font-[600] leading-[1.45] text-ink-1 selection:bg-[oklch(0.697_0.16_258.2/35%)]"
                            >
                              {f.display}
                            </span>
                            {/* 색만으로 가르지 않습니다 — 앰버 + `!` + 글자 */}
                            {f.state === "unread" && (
                              <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] leading-[1.5] text-deadline-urgent">
                                <span
                                  aria-hidden
                                  className="grid size-[14px] shrink-0 place-items-center rounded-full border border-[oklch(0.77_0.117_70.9/50%)] bg-[oklch(0.77_0.117_70.9/20%)] text-[10px] font-bold"
                                >
                                  !
                                </span>
                                {f.note ?? "읽은 값 — 확인해 주세요"}
                              </span>
                            )}
                            {failed === f.id && (
                              <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-2">
                                이 브라우저가 복사를 막았습니다. <b className="font-[620] text-ink-1">값을
                                골라 뒀으니</b> 그대로 옮겨 주세요.
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => copy(f)}
                            className={`inline-flex min-h-[var(--size-touch)] shrink-0 items-center rounded-[9px] border px-3.5 text-[13px] transition-colors duration-200 ${
                              copied.has(f.id)
                                ? "border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/14%)] font-[620] text-pii"
                                : "border-hairline bg-chip text-ink-2 hover:border-[oklch(1_0_0/25%)]"
                            }`}
                          >
                            {failed === f.id
                              ? "직접 복사"
                              : flash === f.id
                                ? "복사됨 ✓"
                                : copied.has(f.id)
                                  ? "✓ 복사됨"
                                  : "복사"}
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  {/* 서식에 인쇄된 경고문 — **빼지 않되 겁주지 않습니다** */}
                  {sec.id === "tail" && (
                    <div className="my-3 rounded-[10px] border border-dashed border-hairline px-[13px] py-[11px] text-[13px] leading-[1.65] text-ink-3">
                      <span className="text-ink-4">서식에 인쇄돼 있는 문구입니다 — </span>
                      「거짓으로 피해구제를 신청하는 경우에는 법 제16조제1호에 따라 3년 이하의
                      징역 또는 3천만원 이하의 벌금을 받을 수 있습니다.」{" "}
                      <b className="font-[620] text-ink-2">사실대로 적으셨다면 해당하지 않습니다.</b>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 접수 — 은행이 적는 칸 */}
        <div className="border-t border-hairline opacity-60">
          <div className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 py-[11px]">
            <span className="text-[13px] leading-[1.45] text-ink-3">{STAFF_FIELDS}</span>
            <span className="justify-self-start text-[13.5px] text-ink-3">
              색이 어두운 란 — 은행이 적습니다
            </span>
            <span className="text-[12.5px] text-ink-4">적지 않음</span>
          </div>
        </div>

        {/* 첨부서류 */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-hairline px-0.5 py-[13px] text-[13.5px]">
          <span
            aria-hidden
            className="grid size-[19px] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-icon bg-[oklch(1_0_0/10%)]"
          />
          <span className="text-ink-2">
            챙길 것 — <b className="font-[620] text-ink-1">신분증 사본 1부</b>
          </span>
          <span className="ml-auto text-[12.5px] text-ink-4">수수료 없음</span>
        </div>

        {/* 2쪽 — **분명히 낮은 무게**. 자율 협력이고 안 내도 불이익이 없습니다 */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[oklch(0.305_0.013_267.1/40%)] px-0.5 py-3 opacity-75">
          <span className="text-[13px] text-ink-3">
            <span aria-hidden className="text-icon">
              ▸
            </span>{" "}
            2쪽 · 전화번호 이용중지 신고 — 선택입니다
          </span>
          <span className="text-[12.5px] text-ink-4">
            내지 않아도 피해구제에 불이익이 없습니다
          </span>
        </div>
      </div>
    </div>
  );
}
