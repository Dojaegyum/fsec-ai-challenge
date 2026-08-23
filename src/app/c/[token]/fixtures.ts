/**
 * 화면용 견본 — **전부 예시 값입니다.** 전화번호·금액·기관명은 실제가 아닙니다
 * (`CLAUDE.md` 「목업·기획서에 등장하는 … 전부 예시입니다」).
 *
 * **모양은 API 계약 §3 그대로입니다.** 라우트가 서는 날 이 파일을 부르던 자리가
 * `fetch` 로 바뀌는 것이 배선의 전부입니다 — 그러라고 모양을 미리 맞춰 둡니다.
 *
 * 값의 출처는 지금 화면의 상수들입니다(`plan.tsx` STEPS · `evidence.tsx` TRANSCRIPT·FILES ·
 * `chat.tsx` CHOICES). **새 값을 짓지 마세요.**
 *
 * **모듈이 서는 대로 하나씩 늘어납니다.** 지금은 `plan-viewer` 몫 둘뿐입니다 —
 * 나머지는 그 모듈의 타입이 생긴 뒤에 붙입니다
 * (→ `docs/plans/08-22-layer-c-viewers.md` Task 1b).
 *
 * **`doc.tsx` 의 `SECTIONS` 는 옮기지 않습니다.** `doc-filler` 가 계획에서 빠졌고,
 * 그 목업이 S-10 을 살아 있게 하는 유일한 것입니다.
 */

import type { PlanStep } from "@/modules/plan-viewer";

/** §3.6 `GET /api/cases/{case_token}/plan` — 지금 `plan.tsx` 의 `STEPS` 여섯 줄 */
export const FIXTURE_PLAN: { steps: PlanStep[] } = {
  steps: [
    {
      step_id: "m1",
      seq: 10,
      title: "국민은행에 지급정지 요청",
      state: "done_verified",
      conditional: null,
      body: { step_key: "bank-freeze-request" },
    },
    {
      step_id: "m2",
      seq: 20,
      title: "112 신고",
      state: "done_verified",
      conditional: null,
      body: { step_key: "report-112" },
    },
    {
      step_id: "m3",
      seq: 30,
      title: "피해구제 신청서 제출",
      state: "in_progress",
      conditional: null,
      body: { step_key: "relief-application" },
    },
    {
      step_id: "m4",
      seq: 40,
      title: "접수증 올리기",
      state: "not_started",
      conditional: null,
      body: { step_key: "receipt-upload", after: ["relief-application"] },
    },
    {
      step_id: "m5",
      seq: 50,
      title: "명의도용 점검",
      state: "not_started",
      conditional: null,
      body: { step_key: "identity-check" },
    },
    {
      step_id: "m6",
      seq: 60,
      title: "가상자산 환급 신청",
      state: "skipped",
      conditional: null,
      body: {},
    },
  ],
};

/**
 * §3.7 `GET /api/cases/{case_token}/deadlines` — 계약의 예시 셋 그대로.
 *
 * **`days_left` 를 넣지 않았습니다.** 아직 계약에 없는 칸입니다(계획 Task 1) —
 * 넣으면 D-day 가 화면에 떠서 「없으면 안 그린다」를 시험할 수 없게 됩니다.
 *
 * ⬜ 타입은 `deadline-viewer` 가 서면 붙입니다 (계획 Task 5).
 */
export const FIXTURE_DEADLINES = {
  deadlines: [
    {
      deadline_id: "01J8XKR8",
      step_id: "m3",
      title: "피해구제 신청서 제출",
      kind: "primary",
      due_at: "2026-08-20T23:59:59+09:00",
      status: "open",
      computed_from: "freeze_requested_at",
      on_miss: "이 날짜를 넘기면 금융회사가 14일을 추가로 통지합니다",
    },
    {
      deadline_id: "01J8XKR9",
      step_id: "m3",
      title: "피해구제 신청서 제출 (추가 기간)",
      kind: "grace",
      due_at: "2026-09-03T23:59:59+09:00",
      status: "open",
      condition: "3영업일을 넘겼을 때 주어지는 기간입니다. 이때도 안 내면 지급정지가 무효가 됩니다",
    },
    {
      deadline_id: "01J8XKRA",
      title: "채권소멸공고",
      kind: "info",
      due_at: "2026-10-20T23:59:59+09:00",
      status: "open",
      note: "금융감독원이 진행합니다. 사용자가 할 일은 없습니다",
    },
  ],
};
