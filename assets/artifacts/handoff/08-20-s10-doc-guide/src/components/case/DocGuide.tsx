"use client";

import { useEffect, useState } from "react";

/**
 * S-10 서류 기재 안내 — /c/{token} 본문 열 (시안 1a 확정)
 *
 * 계약: 이 화면은 신청서를 만들지 않습니다. 법정 서식(별지 제1호서식)의
 * 칸과 우리가 아는 값을 짝지어 보여주고, 값을 눌러 복사하게 합니다.
 *
 * 지킨 것
 *  · 시트 아님 — 본문 열을 채우는 뷰. T0·오른쪽 열은 그대로
 *  · 서식 칸 이름 그대로 (생년월일 — 주민등록번호 칸은 없습니다)
 *  · 상태 넷: confirmed(복사) / unread(복사+확인해 주세요, 앰버+!) /
 *    unknown(직접 적으셔야 합니다 — 막지 않음) / staff(흐림, 눌리지 않음)
 *  · 표시는 끊어 보여주고(display) 복사는 끊지 않은 원문(raw)
 *  · 복사됨은 localStorage 에 기억 — 앱 갔다 돌아와도 유지
 *  · 제출처는 서버 값(submitTarget)만 표시 — 화면이 단정하지 않습니다
 *  · .docx/PDF 버튼 없음 · 빨강 없음 · 12.5px 미만 없음
 *  · 다른 기기(restored=false): 가려진 칩 + 「고장 아님」 — S-11과 같은 어휘
 *
 * TODO(연결)
 *  · FIELDS — GET …/doc-guide 응답으로 교체 (필드 id·상태·raw 는 서버 판정)
 *  · submitTarget — 서버 확인값 문자열 (예: "국민은행 — 가까운 영업점에 서면 제출")
 *  · restored — PII 로컬 복원 성공 여부 (실패 = 다른 기기, 에러 아님·info 로깅)
 */

type FieldState = "confirmed" | "unread" | "unknown" | "staff";
type Field = {
  id: string;
  label: string; // 서식 칸 이름 그대로
  state: FieldState;
  display?: string; // 끊어 읽기 좋게
  raw?: string; // 복사되는 원문 (끊지 않음)
  masked?: string; // 다른 기기에서 보이는 칩 텍스트 (PII 필드만)
  note?: string; // 모름·미확인 보조 문구
};
type Section = { id: string; name: string; fields: Field[]; count?: string };

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
      { id: "s-reason", label: "피해구제 신청사유", state: "unread", display: "검사를 사칭한 전화로 안전계좌 확인이 필요하다는 말에 속아 계좌이체로 송금함", raw: "검사를 사칭한 전화로 안전계좌 확인이 필요하다는 말에 속아 계좌이체로 송금함", note: "대화에서 정리한 문장 — 확인해 주세요" },
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

const STAFF_FIELDS = "접수번호 · 접수일자"; // 색이 어두운 란 — 은행이 적습니다

function copyTargets(sections: Section[]) {
  return sections.flatMap((s) => s.fields.filter((f) => f.state === "confirmed" || f.state === "unread"));
}

export default function DocGuide({
  caseId = "7fK2p",
  restored = true,
  submitTarget = "국민은행 — 가까운 영업점에 서면 제출",
  submitTargetNote = "은행 확인값입니다 (2026.08.20 확인) · 긴급 지급정지 전화와는 다른 단계입니다",
}: {
  caseId?: string;
  restored?: boolean;
  submitTarget?: string;
  submitTargetNote?: string;
}) {
  const storageKey = `finally:doc-copied:${caseId}`;
  const [copied, setCopied] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set(["victim", "out"]));

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(saved)) setCopied(new Set(saved));
    } catch { /* 첫 방문 */ }
  }, [storageKey]);

  const copy = async (f: Field) => {
    if (!restored && f.masked) return; // 가려진 값은 이 기기에서 복사 불가
    try {
      await navigator.clipboard.writeText(f.raw ?? f.display ?? "");
      const next = new Set(copied).add(f.id);
      setCopied(next);
      localStorage.setItem(storageKey, JSON.stringify([...next]));
      setFlash(f.id);
      setTimeout(() => setFlash((cur) => (cur === f.id ? null : cur)), 1600);
    } catch { /* 클립보드 미지원 — 값이 화면에 있으므로 수동 복사 가능 */ }
  };

  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const targets = copyTargets(SECTIONS);
  const done = targets.filter((f) => copied.has(f.id)).length;

  return (
    <section className="px-[clamp(20px,3.4vw,26px)] py-[22px]">
      {/* 머리 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-[660] tracking-[-0.018em] text-ink-1">피해구제신청서 — 기재 안내</h1>
          <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
            신청서를 대신 만들어 드리지 않습니다. <b className="font-[620] text-ink-1">어느 칸에 무엇을 적을지</b> 짝지어
            드립니다 — 값을 누르면 복사됩니다.
          </p>
        </div>
        <span data-numeric className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-[oklch(0.697_0.16_258.2/42%)] bg-[oklch(0.697_0.16_258.2/10%)] px-[11px] py-1 text-[12.5px] font-[620] text-pii">
          옮겨 적음 {done} / {targets.length}
        </span>
      </div>

      {/* 제출처 — 서버 값 슬롯. 화면이 단정하지 않습니다 */}
      <div className="mt-3.5 flex items-start gap-3 rounded-[12px] border border-hairline bg-surface px-[15px] py-3">
        <span aria-hidden className="grid size-[21px] shrink-0 place-items-center rounded-full border border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/22%)] text-[11px] font-bold text-pii">◆</span>
        <div>
          <div className="text-[14px] font-[620] text-ink-1">
            어디에 내나요 — <span className="text-pii">{submitTarget}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-icon">{submitTargetNote}</div>
        </div>
      </div>

      {/* 다른 기기 안내 — 고장 아님 (S-11·WS-review 와 같은 어휘) */}
      {!restored && (
        <div className="mt-3 flex items-start gap-2.5 rounded-[12px] border border-hairline bg-surface px-[15px] py-3">
          <span aria-hidden className="grid size-[21px] shrink-0 place-items-center rounded-full border border-[oklch(0.305_0.013_267.1/70%)] text-[11px] text-icon">○</span>
          <p className="text-[13px] leading-[1.6] text-ink-3">
            <b className="font-[620] text-ink-1">이 기기에서는 값이 가려져 보입니다.</b> 원문은 처음 올린 기기에서만
            보입니다 — 고장이 아닙니다. 가려지지 않는 값(날짜·은행명)은 여기서도 복사됩니다.
          </p>
        </div>
      )}

      {/* 구획 — 서식 그대로 접기 */}
      <div className="mt-[18px]">
        {SECTIONS.map((sec) => {
          const isOpen = open.has(sec.id);
          const filled = sec.fields.filter((f) => f.state === "confirmed" || f.state === "unread").length;
          return (
            <div key={sec.id} className="border-t border-hairline">
              <button type="button" onClick={() => toggle(sec.id)} aria-expanded={isOpen}
                className="flex min-h-[46px] w-full items-center justify-between gap-3 px-0.5 text-left">
                <span className="flex items-center gap-2 text-[15px] font-[620] text-ink-1">
                  <span aria-hidden className="text-[12px] text-icon">{isOpen ? "▾" : "▸"}</span>
                  {sec.name}
                </span>
                <span data-numeric className="text-[12.5px] text-icon">
                  {sec.fields.length}칸 · 저희가 채운 값 {filled}
                </span>
              </button>
              {isOpen && (
                <div>
                  {sec.fields.map((f, i) => (
                    <div key={f.id}
                      className={`grid grid-cols-[150px_1fr_auto] items-center gap-3 py-[11px] ${i < sec.fields.length - 1 ? "border-b border-[oklch(0.305_0.013_267.1/40%)]" : ""}`}>
                      <span className="text-[13px] text-icon">{f.label}</span>
                      {f.state === "unknown" ? (
                        <>
                          <span className="justify-self-start border-b border-dashed border-[oklch(0.305_0.013_267.1/70%)] pb-0.5 text-[13.5px] text-ink-3">{f.note}</span>
                          <span />
                        </>
                      ) : !restored && f.masked ? (
                        <>
                          <span><span className="inline-flex rounded-[6px] border border-[oklch(0.697_0.16_258.2/36%)] bg-pii-bg px-2 py-px text-[13px] text-pii">{f.masked}</span></span>
                          <span className="text-[12.5px] text-icon">이 기기에선 복사 안 됨</span>
                        </>
                      ) : (
                        <>
                          <span>
                            <span data-numeric className="text-[15px] font-[600] leading-[1.45] text-ink-1">{f.display}</span>
                            {f.state === "unread" && (
                              <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-deadline-urgent">
                                <span aria-hidden className="grid size-[14px] place-items-center rounded-full border border-[oklch(0.77_0.117_70.9/50%)] bg-[oklch(0.77_0.117_70.9/20%)] text-[10px] font-bold">!</span>
                                {f.note ?? "읽은 값 — 확인해 주세요"}
                              </span>
                            )}
                          </span>
                          <button type="button" onClick={() => copy(f)}
                            className={`inline-flex min-h-[44px] items-center rounded-[9px] border px-3.5 text-[13px] transition-colors duration-200 ${
                              copied.has(f.id)
                                ? "border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/14%)] font-[620] text-pii"
                                : "border-hairline bg-chip text-ink-2 hover:border-[oklch(1_0_0/25%)]"
                            }`}>
                            {flash === f.id ? "복사됨 ✓" : copied.has(f.id) ? "✓ 복사됨" : "복사"}
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                  {/* 말미 구획에만 — 서식에 인쇄된 경고문 (겁주지 않는 프레임) */}
                  {sec.id === "tail" && (
                    <div className="my-3 rounded-[10px] border border-dashed border-hairline px-[13px] py-[11px] text-[13px] leading-[1.65] text-ink-3">
                      <span className="text-icon">서식에 인쇄돼 있는 문구입니다 — </span>
                      「거짓으로 피해구제를 신청하는 경우에는 법 제16조제1호에 따라 3년 이하의 징역 또는 3천만원 이하의
                      벌금을 받을 수 있습니다.」 <b className="font-[620] text-ink-2">사실대로 적으셨다면 해당하지 않습니다.</b>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* 접수 — 은행이 적는 칸 */}
        <div className="border-t border-hairline opacity-50">
          <div className="grid grid-cols-[150px_1fr_auto] items-center gap-3 py-[11px]">
            <span className="text-[13px] text-icon">{STAFF_FIELDS}</span>
            <span className="justify-self-start text-[13.5px] text-ink-3">색이 어두운 란 — 은행이 적습니다</span>
            <span className="text-[12.5px] text-icon">적지 않음</span>
          </div>
        </div>

        {/* 첨부서류 */}
        <div className="flex items-center gap-2.5 border-t border-hairline px-0.5 py-[13px] text-[13.5px]">
          <span aria-hidden className="grid size-[19px] shrink-0 place-items-center rounded-[5px] border-[1.5px] border-icon bg-[oklch(1_0_0/10%)]" />
          <span className="text-ink-2">챙길 것 — <b className="font-[620] text-ink-1">신분증 사본 1부</b></span>
          <span className="ml-auto text-[12.5px] text-icon">수수료 없음</span>
        </div>

        {/* 2쪽 — 분명히 낮은 무게 */}
        <div className="flex items-center justify-between gap-3 border-t border-[oklch(0.305_0.013_267.1/40%)] px-0.5 py-3 opacity-60">
          <span className="text-[13px] text-ink-3"><span aria-hidden className="text-icon">▸</span> 2쪽 · 전화번호 이용중지 신고 — 선택입니다</span>
          <span className="text-[12.5px] text-icon">내지 않아도 피해구제에 불이익이 없습니다</span>
        </div>
      </div>
    </section>
  );
}
