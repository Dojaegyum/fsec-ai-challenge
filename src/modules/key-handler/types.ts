/**
 * key-handler — 세션키를 만들고 지키며, 매핑을 봉하고 연다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-pii-boundary.md 불변 규칙 1 ·
 *       spec/common/08-16-module-boundaries.md
 * 근거: ADR-009(매핑은 볼트에, 키는 클라이언트에) · ADR-023(층 C)
 *
 * 절대 하지 않는 것: **키를 서버·로그·DB로 보내기.**
 * 이 모듈에는 fetch·XHR이 없고, 세션키는 `extractable: false`로 만들어
 * **꺼내는 것 자체가 브라우저 수준에서 막혀 있습니다.**
 */

/**
 * 사건 하나의 세션키.
 *
 * `key`는 `extractable: false`인 `CryptoKey`입니다 — `crypto.subtle.exportKey`가
 * 던집니다. XSS가 들어와도 **키 자체를 몸에 실어 나갈 수 없습니다.**
 *
 * 대가는 기기 이전입니다. 브라우저를 바꾸거나 저장소를 지우면 서류를 못 만듭니다
 * (절차 안내는 그대로 돕니다). 2026-08-18 확정.
 */
export interface SessionKey {
  /**
   * `case.session_key_id`로 서버에 올라가는 값. ULID.
   *
   * ⚠️ **키에서 파생하지 않습니다.** 파생값이 DB에 있으면 DB 유출이
   * 볼트 유출로 이어져 저장소를 나눈 뜻이 사라집니다
   * → 데이터 모델 §2 `session_key_id`.
   */
  keyId: string;
  key: CryptoKey;
}

/**
 * 볼트에 들어가는 한 칸. 서버가 보는 것은 이것뿐입니다.
 *
 * 볼트 키 모양은 `vault:{case_id}:{token}` 입니다 → 데이터 모델.
 */
export interface VaultEntry {
  /** `[계좌-1]` — 토큰은 개인정보가 아니므로 평문입니다 */
  token: string;
  /** `iv || 암호문`을 base64로. AES-GCM */
  ciphertext: string;
}

/**
 * 세션키를 어디에 두는가.
 *
 * 인터페이스로 뺀 이유는 **테스트에서 IndexedDB를 흉내 내지 않으려는** 것입니다.
 * 브라우저에서는 `indexedDbKeyStore()`, 테스트에서는 `memoryKeyStore()`.
 */
export interface KeyStore {
  put(caseToken: string, key: SessionKey): Promise<void>;
  get(caseToken: string): Promise<SessionKey | null>;
  drop(caseToken: string): Promise<void>;
}
