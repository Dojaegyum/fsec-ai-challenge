/**
 * pii-tokenizer — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/common/08-14-pii-boundary.md (경계·2중 스크러빙·토큰화 제외 목록)
 *       spec/common/08-16-module-boundaries.md (서버 표)
 * 근거: ADR-011(제외 목록) · ADR-026(파일까지) · ADR-028(모듈 모양)
 *
 * **이 모듈이 격리 경계입니다.** 여기를 지나지 않은 텍스트는 외부 LLM 으로 나갈 수
 * 없습니다 → 12-module-names.md 층 1.
 *
 * 절대 하지 않는 것: 여기를 우회하는 경로를 만들기 · 원문을 돌려주기 ·
 * 제외 목록의 값을 토큰화하기 · 토큰화 실패를 통과시키기
 */

import type { PiiKind } from '@/modules/pii-masker'

/**
 * 서버가 만드는 토큰의 종류.
 *
 * 1차(브라우저)가 만드는 넷에 **`이름` 하나가 더해집니다.**
 * 정규식으로 한국 이름을 잡으면 오탐이 폭발해 1차에서 뺐고, 그 자리가 여기입니다
 * → 04-pii-boundary.md 「1차가 잡는 것 — 네 종류」.
 */
export type TokenKind = PiiKind | '이름'

/**
 * 계측 헤더와 감사 기록에 쓰는 이름.
 *
 * 토큰 자체는 한국어(`[계좌-1]`)인데 **헤더는 영문**입니다 —
 * 08-14-api.md §1.1 이 `account=1;name=2`, 08-16-errors.md §6 이
 * `{"counts":{"resident_id":1}}` 로 못 박았습니다.
 *
 * ⬜ **카드·전화의 영문 이름은 정본에 없습니다.** 위 두 자리에 안 나와 골랐습니다.
 */
export const WIRE_NAME: Readonly<Record<TokenKind, string>> = {
  주민번호: 'resident_id',
  카드: 'card',
  전화: 'phone',
  계좌: 'account',
  이름: 'name',
}

/**
 * 이미 쓰인 토큰 하나.
 *
 * **`original` 이 선택 항목입니다.** 두 가지 쓰임이 있기 때문입니다.
 *
 * | 쓰임 | `original` |
 * | --- | --- |
 * | 이어 부를 때 **번호를 이어 붙이려고** | **없어도 됩니다.** 종류와 번호만 있으면 됩니다 |
 * | 같은 값에 **같은 토큰을 다시 쓰려고** | 있어야 합니다 |
 *
 * ⚠️ **브라우저가 만든 매핑의 원문을 서버로 보내지 마세요.** 그러면 계좌·주민번호
 * 원문 표가 요청 본문에 실려 서버 메모리와 로그에 남고, *"서버가 통째로 유출돼도
 * 원문을 읽을 수 없다"* 는 이 서비스의 신뢰 근거가 무너집니다
 * → 04-pii-boundary.md 불변 규칙 1.
 *
 * **번호를 이어 붙이는 데는 원문이 필요 없습니다.** 브라우저는 `token`·`kind`·`seq`
 * 만 보내면 됩니다.
 */
export interface TokenMapping {
  /** `[이름-1]` 형태 */
  readonly token: string
  readonly kind: TokenKind
  /** 종류별 일련번호. 1부터 */
  readonly seq: number
  /**
   * 원문. **브라우저가 만든 것은 보내지 않습니다** — 위 경고 참고.
   *
   * 서버가 이번 요청 안에서 만든 것에만 채워집니다.
   */
  readonly original?: string
}

/** 이 모듈이 밖에 요구하는 것 — 이름을 찾아 주는 자리 */
export interface NerSpan {
  /** 모델이 붙인 이름표. `PERSON`·`ORG` 처럼 모델마다 다릅니다 */
  readonly label: string
  readonly start: number
  readonly end: number
  readonly value: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 2차 탐지 모델.
 *
 * ⬜ **모델·서비스가 미선정입니다** → ARCHITECTURE.md §10 「경계 그 자체라
 * 우선순위가 높습니다」.
 *
 * **없어도 이 모듈은 섭니다.** 착수 기준선이 *"③ 에서 NER 을 기다리지 않습니다.
 * 1차 정규식만으로 경계가 섭니다. NER 은 2차 방어라 나중에 끼워 넣어도 구조가
 * 안 바뀝니다"* 라고 정했습니다. 다만 그 상태를 **숨기지 않습니다** —
 * 결과의 `nerApplied` 가 거짓으로 나갑니다.
 *
 * ⚠️ **원격 API 를 고르면 그 API 가 원문을 봅니다.** 이 자리는 아직 토큰화 이전이라,
 * 외부로 나가는 모델을 쓰면 경계가 그쪽으로 옮겨 갑니다 — STT·OCR 에 붙은 경고와
 * 같은 성질입니다 → ARCHITECTURE.md §6.
 */
export interface NerModel {
  /**
   * @throws 모델을 쓸 수 없으면. 부르는 쪽이 `PiiTokenizerUnavailableError` 로
   *         바꿉니다 — **토큰화 없이 LLM 을 부르는 우회 경로를 만들지 않습니다.**
   */
  find(text: string): Promise<readonly NerSpan[]>
}

/** 이어서 토큰화할 때 넘기는 상태 */
export interface TokenizeContext {
  /**
   * 이미 쓰인 토큰들. **1차(브라우저)가 만든 것도 함께 넘깁니다** —
   * 다만 **원문은 빼고 종류와 번호만** 넘깁니다(위 경고).
   *
   * 안 넘기면 일련번호가 1로 리셋돼, 서로 다른 발화의 `[계좌-1]` 이 다른 계좌를
   * 가리킵니다. 그러면 **복원이 엉뚱한 값을 되살립니다** → 04-pii-boundary.md.
   */
  readonly mappings?: readonly TokenMapping[]
  /**
   * 토큰화하지 않을 낱말.
   *
   * 기관명·공공기관명이 여기 들어갑니다 → 04-pii-boundary.md 「토큰화 제외 목록」.
   * **비어 있어도 동작합니다** — 아래 「제외 목록」 참고.
   */
  readonly allowedTerms?: readonly string[]
}

export interface TokenizeResult {
  /** 토큰화된 텍스트. **밖으로 나가도 되는 것은 이것뿐입니다** */
  readonly masked: string
  /** 이번에 새로 만들어진 매핑 */
  readonly added: readonly TokenMapping[]
  /** 기존 것까지 합친 전체. 다음 호출에 그대로 넘깁니다 */
  readonly mappings: readonly TokenMapping[]
  /** 종류별 건수. 계측 헤더가 이 값을 씁니다 → 08-14-api.md §1.1 */
  readonly counts: Readonly<Record<string, number>>
  /**
   * 2차(NER)가 실제로 돌았는가.
   *
   * **거짓이면 경계가 1차 정규식뿐입니다.** 이름이 안 걸립니다.
   * 숨기지 않고 밖으로 냅니다 — 설정 현황이 이 값을 봅니다.
   */
  readonly nerApplied: boolean
  /**
   * 입력에 **우리가 만들지 않은 토큰 모양 문자열**이 몇 개 있었나.
   *
   * ⬜ **어떻게 다룰지 정본에 없습니다.** 사기범이 보낸 캡처에 `[계좌-1]` 이라는
   * 글자가 적혀 있고 OCR 이 그대로 읽으면, 그 자리가 나중에 **피해자 본인의
   * 계좌번호로 복원돼 보입니다.** 지금은 세어서 알리기만 합니다 —
   * 지우거나 바꾸면 사용자가 쓴 글자를 우리가 고치는 것이라 규칙이 필요합니다.
   */
  readonly foreignTokens: number
}

export interface PiiTokenizer {
  /**
   * 텍스트를 토큰화한다.
   *
   * @throws PiiTokenizerUnavailableError 2차 모델을 부르다 실패했을 때.
   *         **통과시키지 않습니다** — 토큰화 없이 외부로 나가는 경로를 만들지
   *         않는 것이 이 모듈의 존재 이유입니다.
   * @throws PiiBoundaryError 토큰화했는데도 원문이 남아 있을 때.
   *         패턴을 늘리다 실수하면 조용히 새는데, 이 검사가 그 자리에서 멈춥니다.
   */
  tokenize(text: string, ctx?: TokenizeContext): Promise<TokenizeResult>

  /**
   * 나가기 직전에 남은 개인정보를 센다 → 08-14-api.md §1.1 · 08-16-errors.md §6.
   *
   * **종류별 건수만 돌려줍니다. 값을 담지 않습니다** — 무엇이 남았는지 값으로
   * 알려주지 않는 것이 규칙입니다.
   *
   * `chat-publisher` 의 `ResidualPiiScanner` 자리에 그대로 들어갑니다.
   * **같은 규칙으로 두 번 봅니다** — 토큰화할 때 한 번, 나갈 때 한 번.
   */
  scan(text: string): Readonly<Record<string, number>>
}
