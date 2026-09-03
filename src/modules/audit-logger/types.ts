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
  /**
   * 앞줄을 읽고 그 뒤에 잇는다.
   *
   * ## ⚠️ 읽기와 쓰기가 **한 덩어리**여야 합니다
   *
   * 2026-09-03 까지 이 자리가 `lastHash()` 와 `append()` 둘이었습니다. 그래서
   * 요청 둘이 겹치면 —
   *
   * ```
   * A: lastHash() → H0        B: lastHash() → H0      (둘 다 같은 앞줄을 봅니다)
   * A: append(prev=H0)        B: append(prev=H0)      ← 사슬이 두 갈래로 갈립니다
   * ```
   *
   * `verifyChain` 은 이것을 **「위조됨」으로 읽습니다.** 아무도 손대지 않았는데
   * 사슬이 끊어진 것으로 보이고, 그러면 사슬을 두는 이유 자체가 사라집니다 —
   * 진짜 위조와 구분이 안 되니까요. 사슬은 사건별이 아니라 **표 하나에 하나**라
   * (§10.1) 사용자 둘이 동시에 쓰기만 해도 납니다.
   *
   * 그래서 「앞줄을 보고 → 그것으로 만들고 → 붙인다」를 **저장소가 통째로**
   * 맡습니다. 관계형 저장소는 트랜잭션과 잠금으로, 시험용 메모리 저장소는
   * `build` 를 부르는 사이에 `await` 를 두지 않는 것으로 지킵니다.
   *
   * **update·delete 가 없습니다** — 감사 로그는 고치지도 지우지도 않습니다 → §10.1.
   *
   * @param build 앞줄의 hash 를 받아 이번 줄을 만든다. **동기 함수입니다** —
   *              여기서 `await` 하면 잠금을 그만큼 오래 쥡니다
   */
  appendChained(build: (prevHash: string | null) => AuditRecord): Promise<AuditRecord>
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
