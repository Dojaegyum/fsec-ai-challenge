/**
 * work-handler — 어느 작업 패널을 열지 정하고 그 패널을 맡는다 (층 C · 브라우저)
 *
 * 계약: spec/frontend/08-17-workspace-panels.md ·
 *       spec/common/08-14-api.md §3.6 `steps[]` · §3.9 `referenced_steps`
 * 근거: ADR-023(층 C · 판정과 렌더를 한 모듈로) · ADR-024(`body.action` 신설)
 *
 * ⚠️ **판정을 렌더와 섞지 마세요.** 둘을 한 모듈로 합친 대가라, 경계가 이름이 아니라
 * 모듈 안의 규칙으로만 남습니다. 섞이면 "왜 이 패널이 떴나"를 짚을 수 없습니다.
 * 이 폴더에서 `panel.ts`·`signal.ts`가 판정이고, 렌더는 그 결과만 받습니다.
 */

/** 서버가 주는 값. **프론트가 추론하지 않습니다** → ADR-024 */
export type StepAction =
  | "call"
  | "visit"
  | "write"
  | "upload"
  | "download"
  | "wait"
  | "read";

/** 화면 계약의 ID. **재사용·재정렬하지 않습니다** */
export type PanelId =
  | "WS-call"
  | "WS-visit"
  | "WS-write"
  | "WS-upload"
  | "WS-download"
  | "WS-wait"
  | "WS-read";

/** `plan_step.state` → 데이터 모델 §6 */
export type StepState =
  | "not_started"
  | "in_progress"
  | "done_verified"
  | "unconfirmed"
  | "skipped";

/** `GET /plan`의 `steps[]` 중 이 모듈이 쓰는 부분만 */
export interface PlanStep {
  step_id: string;
  seq: number;
  state: StepState | string;
  body: {
    /** 일곱 중 하나. 서버가 적재 시 검증합니다 → 데이터 모델 §11.4.5 */
    action?: string;
    /** `contact_ref`를 서버가 푼 값. 기관을 특정 못 했으면 `null` */
    contact?: string | null;
    /** 기관과 무관한 고정 주소일 때만 */
    url?: string | null;
    url_label?: string | null;
  };
}

/** 지금 무엇이 열려 있나 */
export interface PanelState {
  stepId: string | null;
  panel: PanelId | null;
}

/** 사용자를 밖으로 내보낼 때 어디로 가나 */
export type Exit =
  /** 기관별 — `body.contact` */
  | { kind: "contact"; value: string }
  /** 기관 무관 — `body.url` */
  | { kind: "url"; value: string; label: string | null }
  /** 기관을 특정 못 했거나 아직 확인 안 됨. **그때도 절차는 나갑니다** */
  | { kind: "none" };

/** 유형마다 다른 것. 렌더가 이걸 보고 화면을 고릅니다 */
export interface PanelRule {
  /** 완료라는 개념이 있는가. `WS-read`는 없습니다 — **체크박스를 두지 마세요** */
  hasCompletion: boolean;
  /** 사용자가 직접 하는 일이 있는가. `WS-wait`은 없습니다 */
  userActs: boolean;
  /** 사용자를 밖으로 내보내는가 */
  exits: boolean;
  /** **PII 전체 복원이 허용되는가.** `WS-download` 하나뿐입니다 */
  allowsFullRestore: boolean;
  /** 렌더가 지켜야 할 것. 화면을 짤 때 읽으라고 문장으로 둡니다 */
  note: string;
}

export interface SignalOptions {
  /**
   * 후보에서 밀려난 단계를 알립니다.
   *
   * 서버가 새 `action`을 추가했는데 프론트가 모를 때 조용히 넘어가면
   * **"왜 이 패널이 떴나"를 짚을 수 없습니다.**
   */
  onSkipped?: (event: { stepId: string; reason: SkipReason }) => void;
}

export type SkipReason =
  /** 이미 끝났거나 건너뛴 단계 */
  | "already_done"
  /** 이 사건의 플랜에 없는 step_id */
  | "not_in_plan"
  /** 일곱 밖의 `action` — 프론트가 모르는 값 */
  | "unknown_action";
