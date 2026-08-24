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

import type { Deadline } from "@/modules/deadline-viewer";
import type { PlanStep } from "@/modules/plan-viewer";
import type { RestorableMapping } from "@/modules/pii-restorer";
import type { CaseResponse } from "@/modules/case-opener";
import type { NextQuestion } from "@/modules/chat-handler";
import type { RailFile } from "@/modules/file-sender";
import type { PiiToken, RawLine } from "@/modules/transcript-viewer";
import type { CaseBundle } from "./load";

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
      required_artifact: { kind: "call_receipt", label: "통화 접수번호" },
    },
    {
      step_id: "m2",
      seq: 20,
      title: "112 신고",
      state: "done_verified",
      conditional: null,
      body: { step_key: "report-112" },
      required_artifact: { kind: "report_number", label: "사건접수번호" },
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
 */
export const FIXTURE_DEADLINES: { deadlines: Deadline[] } = {
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
      // §3.7 예시는 10월 20일인데 시안 「wait-card」가 10월 30일을 그립니다.
      // 한 화면에 두 날짜가 나오지 않게 시안 쪽으로 맞췄습니다 — 둘 다 예시 값입니다
      due_at: "2026-10-30T23:59:59+09:00",
      status: "open",
      note: "금융감독원이 진행합니다. 사용자가 할 일은 없습니다",
    },
  ],
};

/**
 * 공고 대기 카드가 쓰는 값 둘 — 시안 「wait-card」(2a).
 *
 * **§3.7 에 `starts_at`·`elapsed` 로 넣기로 확정됐고(2026-08-23) 서버는 아직 미구현입니다.**
 * 화면이 대신 만들 수 없습니다 — 만들려면 기기 시계를 읽어야 하고 그건
 * 「화면이 날짜를 세지 않는다」 위반입니다 (불변 규칙 7).
 */
export const FIXTURE_NOTICE = {
  /** §3.7 `starts_at` — 공고가 시작된 시점 */
  startAt: "2026-08-30T00:00:00+09:00",
  /** §3.7 `elapsed` — 시작~만료 사이에서 지금이 어디인가. 0~1 */
  progress: 0.45,
};

/**
 * §3.3 `GET /api/cases/{case_token}/evidence/{evidence_id}` 완료 응답.
 *
 * **전사는 토큰화된 상태로 내려옵니다** — 원문은 `FIXTURE_MAPPINGS` 가 갖고 있고,
 * 펼치는 것은 브라우저 안에서만 일어납니다 (ADR-009 · ADR-034).
 *
 * 값의 출처는 지금 `evidence.tsx` 의 `TRANSCRIPT` 넷입니다. 「00:12」 같은 시각은
 * `start_ms` 로 옮겼습니다 — 계약에 시각 문자열 칸이 없습니다.
 *
 * ⬜ 시안의 「사칭 정황 구간」·「미확인」 표기는 옮기지 못했습니다.
 * 근거 스팬은 `case-reader`(층 1)가 내는데 미구현이고 §3.3 에도 자리가 없습니다.
 */
export const FIXTURE_EVIDENCE: {
  evidence_id: string;
  ingest_status: string;
  transcript: RawLine[];
  pii_tokens: PiiToken[];
  /** 자료 레일이 그리는 목록. **§3.3 응답이 아니라 브라우저가 들고 있는 것**입니다 —
   *  못 가려서 안 올린 파일도 여기 남아야 해서 `evidence_id` 가 없을 수 있습니다 */
  files: RailFile[];
} = {
  evidence_id: "01J8XKR6",
  ingest_status: "done",
  transcript: [
    {
      speaker: "A",
      text: "서울중앙지검 수사관입니다. [이름-1] 씨 명의 계좌가 범죄에 연루되어 확인이 필요합니다.",
      start_ms: 12_000,
    },
    { speaker: "B", text: "제가요? 저는 그런 적이 없는데요.", start_ms: 64_000 },
    {
      speaker: "A",
      text: "안전계좌로 옮기셔야 합니다. 지금 불러드리는 [계좌-1] 로 이체해 주세요.",
      start_ms: 167_000,
    },
    {
      speaker: "A",
      text: "확인되면 24시간 안에 돌려드립니다. 절대 다른 곳에 말하지 마세요.",
      start_ms: 271_000,
    },
  ],
  pii_tokens: [
    { token: "[이름-1]", kind: "name" },
    { token: "[계좌-1]", kind: "account" },
  ],
  files: [
    { id: "a", evidence_id: "01J8XKR6", name: "0812_수신전화.m4a", status: "done" },
    { id: "b", name: "0813_재통화.m4a", status: "processing", percent: 74 },
    { id: "c", evidence_id: "01J8XKR7", name: "지급정지_접수문자.png", status: "done" },
    { id: "d", name: "신분증_사진.jpg", status: "failed" },
    { id: "e", name: "이체내역_0812.png", status: "pending" },
  ],
};

/**
 * 볼트에서 열어 온 복원 매핑 — **브라우저에만 있습니다.**
 *
 * 실제로는 `key-handler` 가 볼트를 열어 만듭니다. 여기 있는 값은 **예시**이고,
 * 서버·로그·DB 어디에도 같은 것을 두지 마세요 (`CLAUDE.md` 불변 규칙 3).
 */
export const FIXTURE_MAPPINGS: RestorableMapping[] = [
  { token: "[이름-1]", original: "김민수" },
  { token: "[계좌-1]", original: "110-2345-678901" },
];

/**
 * §3.4 `next_question` — 지금 `chat.tsx` 의 `CHOICES` 넷을 옮긴 것.
 *
 * **「모름」 선택지를 빼지 마세요.** 계약이 항상 싣기로 한 것이라,
 * 픽스처에서 빠지면 화면이 그걸 안 그리게 되고 위반이 가려집니다 (§3.4).
 */
export const FIXTURE_QUESTION: NextQuestion = {
  slot_key: "channel",
  text: "돈이 어떻게 나갔나요?",
  input: "buttons",
  options: [
    "계좌로 이체했어요",
    "간편송금 앱으로 보냈어요",
    "직접 만나서 현금으로",
    "기억이 안 나요",
  ],
};

/**
 * §3.10 `GET /api/cases/{case_token}` 중 **첫 화면을 고르는 데 쓰는 부분만**.
 *
 * `case-opener` 가 이 값으로 `focus`·`side` 를 정합니다 — **서버가 지목하지 않습니다.**
 * 단계는 `FIXTURE_PLAN` 과 같은 것을 가리킵니다.
 */
export const FIXTURE_CASE: CaseResponse = {
  case_id: "01J8XKR5000000000000000000",
  track: "victim",
  plan: {
    steps: FIXTURE_PLAN.steps.map((s) => ({ step_id: s.step_id, state: s.state })),
  },
};

/**
 * `?view=` 개발 경로가 먹는 한 벌 — 위의 조각들을 §3.10 이 내리는 모양으로 묶은 것.
 *
 * **픽스처를 지우지 않는 이유가 이것입니다.** 라우트가 서도 시연·스크린샷은
 * 사건 하나를 DB 에 심어 두는 것보다 이 경로가 쌉니다. `?view=` 가 붙어 있으면
 * 서버를 부르지 않고 이 값으로 그립니다 (→ `page.tsx`).
 */
export const FIXTURE_BUNDLE: CaseBundle = {
  case: FIXTURE_CASE,
  steps: FIXTURE_PLAN.steps,
  deadlines: FIXTURE_DEADLINES.deadlines,
  question: FIXTURE_QUESTION,
};
