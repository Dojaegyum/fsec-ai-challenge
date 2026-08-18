/**
 * pii-restorer — 복원해도 되는지 심사하고 되돌린다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-pii-boundary.md 「복원 위치와 범위」 ·
 *       spec/backend/08-16-chat-context.md §8
 * 근거: ADR-011(복원 위치를 코드가 지정) · ADR-013(챗 답변은 부분 복원) · ADR-023(층 C)
 *
 * 절대 하지 않는 것: **복원 가능 목록 밖의 자리에서 펼치기.**
 *
 * ⚠️ **서버에 이 모듈을 두면 규칙 위반입니다.** 서버에는 복호화 키가 없어
 * 복원 자체가 불가능합니다 → ADR-009.
 */

/**
 * 복원이 일어나는 자리.
 *
 * **위치마다 범위가 다른 것은 우연이 아니라 「인젝션으로 끌려 나올 수 있는 자리인가」로
 * 가른 결과입니다** → chat-context §8.1. 챗 답변은 사기범이 심은 문장으로 끌어낼 수
 * 있는 자리라 부분만, 서류 초안과 슬롯 확인은 사용자가 직접 연 자리라 전체를 복원합니다.
 */
export type RestoreSite =
  /** 슬롯 확인 화면의 값 칸 (`F-05b`) — 전체 */
  | "slot-value"
  /** 서류 초안의 정해진 필드 (`F-08`) — 전체. 주민번호가 실제로 필요한 곳 */
  | "doc-field"
  /** 사용자가 직접 입력한 값 — 전체 */
  | "user-input"
  /** 전사 뷰의 원문 대조 (`F-02`) — 전체 */
  | "transcript"
  /** 챗 답변 문장 (`F-07`) — **종류별 부분 복원** */
  | "chat-answer"
  /** 분석 결과의 자유 텍스트 (`F-04`) — 복원 안 함 */
  | "analysis-text"
  /** 플랜 설명 문장 (`F-05`) — 복원 안 함 */
  | "plan-text";

/** 그 자리에서 어디까지 펼치나 */
export type RestoreScope = "full" | "partial" | "none";

/**
 * 복원할 재료. `key-handler`가 볼트를 열어 만든 것입니다.
 *
 * `pii-masker`의 `PiiMapping`을 그대로 넘겨도 됩니다 — 필요한 두 칸이 같습니다.
 */
export interface RestorableMapping {
  /** `[계좌-1]` */
  token: string;
  original: string;
  /**
   * 부분 복원에서 앞에 붙는 말. 계좌의 기관명(`국민 ****7890`)이 이것입니다.
   *
   * **매핑 자체에는 기관명이 없습니다** — 계좌 원문은 숫자뿐입니다.
   * 사건의 기관 정보를 아는 호출자가 넣어 줍니다.
   */
  label?: string;
}

/** 왜 거부했나. 감사 로그 `pii.restore_denied`의 `reason` → 데이터 모델 §10.2 */
export type DenialReason =
  /** 그 자리가 복원 가능 목록에 없다 */
  | "field_not_allowed"
  /** 그 종류는 이 자리에서 펼치지 않는다 (챗 답변의 주민번호 등) */
  | "kind_not_allowed"
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
