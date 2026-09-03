/**
 * pii-restorer — 복원해도 되는지 심사하고 되돌린다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-pii-boundary.md 「복원 위치와 범위」 ·
 *       spec/backend/08-16-chat-context.md §8
 * 근거: ADR-011(복원 위치를 코드가 지정) · **ADR-034(브라우저 화면에는 원문)** ·
 *       ADR-023(층 C). ADR-013 결정 B(챗 답변은 부분 복원)는 **대체됐습니다**
 *
 * 절대 하지 않는 것: **복원 가능 목록 밖의 자리에서 펼치기.**
 *
 * ⚠️ **서버에 이 모듈을 두면 규칙 위반입니다.** 서버에는 복호화 키가 없어
 * 복원 자체가 불가능합니다 → ADR-009.
 */

/**
 * 복원이 일어나는 자리 — **전부 브라우저입니다.**
 *
 * ⚠️ **2026-09-03 까지 자리마다 범위가 달랐습니다.** 챗 답변만 종류별 부분
 * 복원(`국민 ****7890`)이었고 분석 결과·플랜 설명은 아예 복원 안 했습니다.
 * [ADR-034](../../../decisions/034-browser-shows-plaintext.md)가 2026-08-19 에
 * 그것을 **폐기하고 「브라우저가 보여주는 것은 전부 원문」 한 줄로** 줄였는데,
 * 이 모듈이 안 따라왔습니다 — 스펙(「복원 위치와 범위」)은 이미 한 줄입니다.
 *
 * 그래서 **같은 계좌번호가 자료함에서는 온전히, 챗에서는 `****6789` 로** 보였고,
 * 사용자는 그것을 「보안」이 아니라 고장으로 읽습니다. 더 나쁜 것은 **자기가 준
 * 값을 자기가 검토하지 못한다**는 것입니다 — 틀린 계좌번호로 서류가 나가도
 * 알아차릴 방법이 없습니다.
 *
 * **가리는 목적은 사용자에게서 숨기는 것이 아니라 외부로 새지 않게 하는 것**이고,
 * 외부로 나가는 것은 화면 표시와 무관하게 언제나 토큰입니다 (불변 규칙 2 그대로).
 *
 * 목록을 남겨 두는 이유는 **기본값이 「복원 안 함」이기 때문**입니다 — 여기
 * 없는 이름이 오면 펼치지 않습니다. 이 모듈이 하는 일은 이제 「부분이냐
 * 전체냐」가 아니라 **「이 자리가 브라우저인가」** 확인입니다 (ADR-034).
 */
export type RestoreSite =
  /** 슬롯 확인 화면의 값 칸 (`F-05b`) */
  | "slot-value"
  /** 서류 초안의 정해진 필드 (`F-08`). 주민번호가 실제로 필요한 곳 */
  | "doc-field"
  /** 사용자가 직접 입력한 값 */
  | "user-input"
  /** 전사 뷰의 원문 대조 (`F-02`) */
  | "transcript"
  /** 챗 답변 문장 (`F-07`) */
  | "chat-answer"
  /** 분석 결과의 자유 텍스트 (`F-04`) */
  | "analysis-text"
  /** 플랜 설명 문장 (`F-05`) */
  | "plan-text";

/**
 * 그 자리에서 어디까지 펼치나.
 *
 * **둘뿐입니다** — `partial` 은 ADR-034 로 사라졌습니다. 값을 남겨 두면
 * 새 화면을 붙이는 사람이 그것을 고를 수 있고, 그 순간 폐기된 규칙이
 * 되살아납니다.
 */
export type RestoreScope = "full" | "none";

/**
 * 복원할 재료. `key-handler`가 볼트를 열어 만든 것입니다.
 *
 * `pii-masker`의 `PiiMapping`을 그대로 넘겨도 됩니다 — 필요한 두 칸이 같습니다.
 */
export interface RestorableMapping {
  /** `[계좌-1]` */
  token: string;
  original: string;
}

/** 왜 거부했나. 감사 로그 `pii.restore_denied`의 `reason` → 데이터 모델 §10.2 */
export type DenialReason =
  /** 그 자리가 복원 가능 목록에 없다 */
  | "field_not_allowed"
  /** 이 사건의 매핑에 없는 토큰이다 — 모델이 지어낸 것일 수 있다 */
  | "not_in_mapping";

export interface DenialEvent {
  token: string;
  site: RestoreSite | string;
  reason: DenialReason;
}

export interface RestoreOptions {
  site: RestoreSite | string;
  /**
   * 거부될 때마다 불립니다. **반복되면 공격 시도의 신호입니다** → chat-context §8.2.
   *
   * 이 모듈은 기록하지 않고 알리기만 합니다 — 보내는 것은 호출자의 일이고,
   * 여기에 네트워크가 들어오면 모듈 경계가 무너집니다.
   */
  onDenied?: (event: DenialEvent) => void;
}

/** 토큰 하나를 뜯어본 결과 */
export interface ParsedToken {
  kind: string;
  seq: number;
}
