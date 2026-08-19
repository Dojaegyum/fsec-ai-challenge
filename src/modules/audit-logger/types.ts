/**
 * audit-logger — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-16-data-model.md §10 · §10.1 · §10.2
 *       spec/common/08-14-pii-boundary.md 「감사」
 * 근거: ADR-028
 *
 * **서버 전용입니다.** 해시 계산에 node:crypto 를 씁니다.
 *
 * 절대 하지 않는 것: 원문이나 토큰을 detail 에 담기 · 기록을 고치거나 지우기
 */

/** 08-16-data-model.md §10.2 의 목록. 여기 없는 것을 쓰지 않습니다 */
export type AuditEventType =
  | 'case.opened'
  | 'evidence.ingested'
  | 'pii.scrubbed'
  | 'pii.egress_blocked'
  | 'pii.restore_denied'
  | 'slot.confirmed'
  | 'plan.generated'
  | 'deadline.computed'
  | 'chat.context_built'
  | 'artifact.verified'
  | 'llm.called'
  | 'case.purged'

export type ActorType = 'user' | 'system' | 'model'

export interface AuditEvent {
  readonly eventType: AuditEventType
  readonly actorType: ActorType
  /** 사건과 무관한 기록도 있습니다 (KB 릴리스 등) */
  readonly caseId?: string
  /**
   * **원문도 토큰도 넣지 않습니다** → §10.1.
   * 토큰을 막는 이유는, 볼트가 살아 있는 동안 토큰으로 원문을 얻을 수 있기 때문입니다.
   */
  readonly detail: Readonly<Record<string, unknown>>
}

/** 실제로 남는 한 줄 */
export interface AuditRecord {
  readonly auditId: string
  readonly caseId: string | null
  readonly eventType: AuditEventType
  readonly actorType: ActorType
  readonly detail: Readonly<Record<string, unknown>>
  /** 첫 기록이면 null */
  readonly prevHash: string | null
  /** SHA-256 (소문자 16진수 64자) */
  readonly hash: string
  readonly createdAt: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 기록을 어디에 쌓는가.
 *
 * 저장소 제품이 아직 미정이라(ARCHITECTURE §10) 인터페이스로 받습니다.
 * **append 만 있고 update·delete 가 없습니다** — 감사 로그는 고치지도 지우지도
 * 않습니다 → §10.1.
 */
export interface AuditStore {
  /** 가장 최근 기록의 hash. 하나도 없으면 null */
  lastHash(): Promise<string | null>
  append(record: AuditRecord): Promise<void>
}

export interface AuditLogger {
  /**
   * 한 줄을 남기고 그 기록을 돌려준다.
   *
   * @throws PiiBoundaryError detail 에 개인정보 토큰이 들어 있으면.
   *         **통과시키고 로그만 남기는 경로를 만들지 않습니다** → 08-16-errors.md 원칙 1.
   */
  record(event: AuditEvent): Promise<AuditRecord>
}

/**
 * 사슬이 끊기지 않았는지 확인한다. 사후 조작 검출용.
 *
 * 저장된 기록을 시간순으로 넘기면, 각 줄의 hash 를 다시 계산해 대조합니다.
 */
export interface ChainVerdict {
  readonly intact: boolean
  /** 처음 어긋난 자리. intact 가 참이면 없습니다 */
  readonly brokenAt?: { readonly index: number; readonly auditId: string }
}
