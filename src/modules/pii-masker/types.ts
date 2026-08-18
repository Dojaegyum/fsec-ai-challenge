/**
 * pii-masker — 층 C (브라우저)
 *
 * 계약: spec/common/08-14-pii-boundary.md · spec/common/08-16-module-boundaries.md
 *
 * 절대 하지 않는 것: 마스킹 전 원문을 네트워크로 보내기.
 * 이 모듈에는 fetch·XHR·WebSocket이 없습니다. 순수 함수만 둡니다.
 */

/**
 * 1차(정규식)에서 잡는 종류.
 *
 * 이름은 여기 없습니다 — 정규식으로 한국 이름을 잡으면 오탐이 폭발합니다.
 * `[이름-1]`은 서버의 `pii-tokenizer`(NER 2차)가 만듭니다.
 */
export type PiiKind = "주민번호" | "카드" | "전화" | "계좌";

/** 토큰 하나와 그 원문. 이 짝이 복원 매핑의 단위입니다. */
export interface PiiMapping {
  /** `[계좌-1]` 형태. 화면과 프롬프트에 이 문자열이 그대로 나갑니다 */
  token: string;
  kind: PiiKind;
  /** 종류별 일련번호. 1부터 */
  seq: number;
  /**
   * 원문.
   *
   * ⚠️ 이 값은 브라우저를 떠나지 않습니다. 서버로 보낼 때는 `key-handler`가
   * 세션키로 암호화한 뒤 볼트로 보냅니다 → ADR-009.
   */
  original: string;
}

/**
 * 마스킹을 이어서 할 때 넘기는 상태.
 *
 * 한 사건에서 여러 번 마스킹하는데 매번 일련번호가 1로 리셋되면,
 * 서로 다른 발화의 `[계좌-1]`이 다른 계좌를 가리키게 됩니다.
 */
export interface MaskContext {
  /** 이미 만들어진 매핑들. 같은 원문이 다시 나오면 같은 토큰을 씁니다 */
  mappings: PiiMapping[];
}

export interface MaskResult {
  /** 마스킹된 텍스트. 네트워크로 나가도 되는 것은 이것뿐입니다 */
  masked: string;
  /** 이번 호출에서 **새로** 만들어진 매핑 */
  added: PiiMapping[];
  /** 기존 것까지 합친 전체 매핑. 다음 호출에 `MaskContext`로 넘깁니다 */
  mappings: PiiMapping[];
}

/** 한 패턴이 텍스트에서 찾아낸 자리 */
export interface Hit {
  kind: PiiKind;
  start: number;
  end: number;
  value: string;
}
