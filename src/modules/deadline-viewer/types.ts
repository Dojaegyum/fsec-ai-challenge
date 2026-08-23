/**
 * deadline-viewer — 기한을 표시한다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.7 · spec/common/08-16-deadline-rules.md
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **날짜를 계산하기** (기준 시계는 서버입니다. 기기 시계가 틀리면 기한을 놓칩니다)
 *  · 지난 기한을 지우기 (유예 14일이 남아 있을 수 있습니다)
 *  · 환급을 카운트다운으로 만들기 (통상 3~6개월 — 매일 실망을 줍니다)
 */

/** §3.7 · 데이터 모델 §8.1 */
export type DeadlineKind = "primary" | "grace" | "info";

export interface Deadline {
  deadline_id: string;
  step_id?: string;
  title: string;
  kind: DeadlineKind | string;
  /** 서버가 계산한 만료 시점 */
  due_at: string;
  status: string;
  /** 본 기한을 넘겼을 때 무슨 일이 생기는지 */
  on_miss?: string;
  /** 추가 기간이 주어지는 조건 */
  condition?: string;
  /** `info` 가 사용자 기한이 아님을 밝히는 자리 */
  note?: string;
  /**
   * 서버가 센 잔여일. 지난 기한은 음수.
   *
   * ⬜ **아직 §3.7 에 없습니다** → 계획 Task 1.
   * **없으면 D-day 를 그리지 않습니다** — 화면이 대신 세면 기기 시계를 믿게 됩니다.
   */
  days_left?: number;
}

export interface DeadlineGroups {
  /** 놓치면 되돌릴 수 없는 것 */
  readonly primary: readonly Deadline[];
  /** 본 기한을 넘겼을 때 주어지는 기간. **본 기한과 합치지 않습니다** */
  readonly grace: readonly Deadline[];
  /** 사용자가 지킬 기한이 아닌 것 */
  readonly info: readonly Deadline[];
}
