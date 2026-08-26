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
  /** 무엇을 기점으로 셌는가 — 「지급정지 요청 시각부터」 (§3.7 · 데이터 모델 §8) */
  computed_from?: string;
  /** 본 기한을 넘겼을 때 무슨 일이 생기는지 */
  on_miss?: string;
  /** 추가 기간이 주어지는 조건 */
  condition?: string;
  /** `info` 가 사용자 기한이 아님을 밝히는 자리 */
  note?: string;
  /**
   * 서버가 센 잔여일. **지난 기한에는 안 옵니다** — `status: "missed"` 하나로 말합니다.
   *
   * **없으면 D-day 를 그리지 않습니다** — 화면이 대신 세면 기기 시계를 믿게 됩니다.
   */
  days_left?: number;
  /**
   * 그 기간이 **시작된** 시점. `kind: "info"` 에만 옵니다 (§3.7 · ADR-048).
   *
   * 공고 대기 카드의 달력 앵커 왼쪽 끝입니다. 응답에 만료 시점밖에 없으면
   * 「8월 20일 시작 · 지금 · 10월 20일 만료」의 왼쪽을 못 그립니다.
   */
  starts_at?: string;
  /**
   * 시작~만료 사이에서 지금이 어디인가. `0`~`1`. `kind: "info"` 에만 옵니다.
   *
   * **화면이 만들 수 없습니다** — 만들려면 기기 시계를 읽어야 하고, 기기
   * 날짜가 틀린 사용자에게 「공고가 끝났다」를 잘못 보여줍니다.
   * 기준 시계는 서버입니다 → spec/common/08-16-deadline-rules.md.
   */
  elapsed?: number;
}

export interface DeadlineGroups {
  /** 놓치면 되돌릴 수 없는 것 */
  readonly primary: readonly Deadline[];
  /** 본 기한을 넘겼을 때 주어지는 기간. **본 기한과 합치지 않습니다** */
  readonly grace: readonly Deadline[];
  /** 사용자가 지킬 기한이 아닌 것 */
  readonly info: readonly Deadline[];
}
