/**
 * pii-masker — 입출력 타입.
 *
 * 정본: spec/common/08-14-pii-boundary.md 「2중 스크러빙」·「토큰화 제외 목록」
 * 근거: ADR-011 (토큰화 제외) · ADR-021 (이름·모듈 모양)
 *
 * 원문이 네트워크를 타기 전에 브라우저에서 도는 1차 걸름입니다.
 * 잔여는 서버의 `pii-tokenizer` 가 NER 로 잡습니다 — **1차가 있다고 2차를 건너뛸 수 없고,
 * 2차가 있다고 1차를 생략할 수 없습니다.**
 *
 * `client-only` 를 달지 않습니다. 브라우저에서 도는 것이 목적이지만, 서버에 같은 정규식이
 * 있어도 규칙 위반은 아닙니다 — `pii-restorer` 와 다른 점입니다.
 */

/**
 * 1차에서 잡는 종류 넷 → 08-14-pii-boundary.md 「2중 스크러빙」.
 *
 * **이름은 여기 없습니다.** 정규식으로 사람 이름을 가릴 수 없어 2차(NER)의 몫입니다.
 */
export type MaskedKind = 'resident_id' | 'card' | 'phone' | 'account'

/** 토큰 하나와 그 원문. **원문은 브라우저를 떠나지 않습니다** */
export interface TokenMapping {
  /** `[계좌-1]` 처럼 대괄호까지 포함한 표기 */
  readonly token: string
  readonly kind: MaskedKind
  readonly value: string
}

export interface MaskResult {
  /** 토큰으로 바뀐 텍스트. **이것만 네트워크로 나갑니다** */
  readonly text: string
  /**
   * 이번 호출까지 누적된 매핑 전부. 넘겨준 기존 매핑이 앞에 그대로 있고 새것이 뒤에 붙습니다.
   */
  readonly mappings: readonly TokenMapping[]
}

export interface PiiMasker {
  /**
   * 텍스트에서 개인정보 패턴을 찾아 토큰으로 바꾼다.
   *
   * @param existing 앞선 호출에서 받은 매핑. 넘기면 **같은 값이 같은 토큰을 유지**합니다 —
   *                 챗은 매 턴 마스킹하는데 `[계좌-1]` 이 턴마다 달라지면 안 됩니다.
   */
  mask(text: string, existing?: readonly TokenMapping[]): MaskResult
}
