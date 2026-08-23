/**
 * plan-viewer — 타임라인·단계·배지를 그린다 (층 C · 브라우저)
 *
 * 계약: spec/frontend/08-14-screens.md §S-07 · spec/common/08-14-api.md §3.6
 * 근거: ADR-023(층 C) · ADR-035(화면 상태 두 축)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · 사용자 체크만으로 완료 표시하기 (완료는 부산물이 판정합니다)
 *  · 조건부 단계를 지우기
 *  · T0 를 다른 것에 종속시키기 (T0 는 셸의 레일입니다 — ADR-036)
 */

/** `plan_step.state` 다섯 → 데이터 모델 §6 */
export type StepState =
  | "not_started"
  | "in_progress"
  | "done_verified"
  | "unconfirmed"
  | "skipped";

/** 화면 어휘 → 화면 설계 §S-07 「단계 상태 어휘」 */
export type StepTone = "done" | "now" | "todo" | "anytime" | "na";

/** `GET /plan` 의 `steps[]` 중 이 모듈이 쓰는 것만 */
export interface PlanStep {
  step_id: string;
  /** 내부 정렬값. **사용자에게 보이는 번호가 아닙니다** — 10·20·25 처럼 띄엄띄엄합니다 */
  seq: number;
  title: string;
  state: StepState | string;
  /** 슈퍼셋 플랜의 조건 라벨. 「카카오페이로 보냈다면」 */
  conditional: string | null;
  body: {
    text?: string;
    action?: string;
    /** KB 항목 식별자. 사슬을 잇는 열쇠입니다 */
    step_key?: string;
    /** 선행 사슬. **§3.6 예시에 없어 없을 수 있습니다** → 계획 Task 1 */
    after?: readonly string[];
  };
}
