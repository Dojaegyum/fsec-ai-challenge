/**
 * pii-restorer — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/common/08-14-pii-boundary.md 「복원 위치와 범위」·「복원 전 검사」
 *       spec/backend/08-16-chat-context.md §8
 * 근거: ADR-009 (복호화 키는 클라이언트에만) · ADR-011 (복원 위치를 코드가 지정) ·
 *       ADR-013 (챗 답변은 부분 복원) · ADR-021
 *
 * ⚠️ 이 모듈은 브라우저에서만 돕니다. 서버에 두면 CLAUDE.md 불변 규칙 3 위반입니다.
 */

/**
 * 복원을 시도하는 자리. **코드가 목록을 갖는 것이 이 설계의 핵심입니다** —
 * 프롬프트 격리는 부탁이고 우회될 수 있지만, 목록에 없는 자리는 구조적으로
 * 복원되지 않습니다 → 08-14-pii-boundary.md 「인젝션 방어」.
 */
export type RestoreSite =
  /** 슬롯 확인 화면의 값 칸 (F-05b) — 전체 복원 */
  | 'slot_value'
  /** 서류 초안의 정해진 필드 (F-08) — 전체 복원. 주민번호가 실제로 필요한 곳 */
  | 'document_field'
  /** 사용자가 직접 입력한 값 — 전체 복원 */
  | 'user_input'
  /** 전사 뷰의 원문 대조 (F-02) — 전체 복원 */
  | 'transcript_view'
  /** 챗 답변 문장 (F-07) — 종류별 부분 복원 */
  | 'chat_reply'
  /** 수법 판별 결과의 자유 텍스트 (F-04) — 복원 안 함 */
  | 'analysis_text'
  /** 플랜 설명 문장 (F-05) — 복원 안 함 */
  | 'plan_text'

/**
 * 토큰의 종류. 정본에서 확인된 넷을 적어 두되, 그 밖의 값도 올 수 있어 열어 둡니다.
 *
 * **부분 복원 규칙이 없는 종류는 복원하지 않습니다** — 「위 목록에 없는 모든 자리는
 * 복원 안 함」과 같은 원칙입니다.
 */
export type TokenKind =
  | 'account'
  | 'name'
  | 'phone'
  | 'resident_id'
  | (string & {})

/** 토큰 하나와 그 원문. 브라우저가 세션키로 볼트 암호문을 복호해 얻은 것입니다 */
export interface TokenMapping {
  /** `[계좌-1]` 처럼 대괄호까지 포함한 표기 */
  readonly token: string
  readonly kind: TokenKind
  /** 원문. **이 값은 브라우저 밖으로 나가지 않습니다** */
  readonly value: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 이 사건의 토큰 매핑.
 *
 * 볼트 제품이 아직 미정이고(ARCHITECTURE §10) 복호도 이 모듈의 일이 아니라,
 * 이미 복호된 매핑을 조회하는 것만 인터페이스로 받습니다.
 */
export interface TokenMappingSource {
  /** 없으면 undefined. **없다는 것이 곧 지어낸 토큰이라는 뜻입니다** */
  lookup(token: string): TokenMapping | undefined
}

/** 왜 거부했나 */
export type DenyReason =
  /** 이 사건의 매핑에 없는 토큰. 모델이 지어냈을 수 있다 → §8.3 */
  | 'not_in_mapping'

export interface DenyEvent {
  readonly token: string
  readonly site: RestoreSite
  readonly reason: DenyReason
}

/**
 * 거부를 기록하는 자리. `pii.restore_denied` 로 남깁니다 —
 * **반복되면 공격 시도의 신호입니다** → 09-data-model.md §10.2.
 */
export interface RestoreAuditSink {
  denied(event: DenyEvent): void
}

export interface PiiRestorer {
  /**
   * 텍스트 안의 토큰을 그 자리의 규칙에 맞게 되돌립니다.
   * 되돌리지 않기로 한 것은 토큰 표기 그대로 남습니다 — 화면에서 파란 토큰으로 보입니다.
   */
  restore(text: string, site: RestoreSite): string
}
