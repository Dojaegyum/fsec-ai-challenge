/**
 * case-purger — `purge_after` 가 지난 사건의 세 층을 함께 지우고 확인한다
 *
 * 계약: spec/backend/08-16-data-model.md §14 §2 · spec/common/08-14-pii-boundary.md 불변 규칙 3
 * 근거: ADR-016(세 층 같은 수명) · ADR-025(앱 안에서 돈다) · ADR-028
 *
 * 절대 하지 않는 것: **한 층만 지우고 성공으로 처리하기** · 확인 없이 끝내기 ·
 * 감사 로그를 함께 지우기
 */

/**
 * 사건 하나에 딸린 세 층 → ADR-016.
 *
 * **같은 날 함께 사라집니다.** 수명이 서로 다른 층을 두면 어느 하나만 남는 상태가
 * 생기고, 그게 무엇인지 아무도 추적하지 못합니다.
 */
export type Layer = 'vault' | 'objects' | 'database'

/** 파기 대상 사건 하나 */
export interface PurgeTarget {
  readonly caseId: string
  /** `YYYY-MM-DD`. 이 날짜가 지나면 대상입니다 */
  readonly purgeAfter: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 복원 매핑 암호문이 있는 볼트.
 *
 * **비어 있을 수 있습니다**(매핑을 안 맡긴 사건) → §14. 없는 것은 실패가 아닙니다.
 * 만료(TTL)는 없습니다 — ADR-049 로 같은 Postgres 에 왔고, 지우는 길은 파기 하나입니다.
 */
export interface VaultStore {
  delete(caseId: string): Promise<void>
  /** 지운 뒤 확인용. 남아 있으면 참 */
  remains(caseId: string): Promise<boolean>
}

/**
 * ⚠️ **위 `VaultStore` 에 쓰기(`put`)를 더하지 마세요.**
 *
 * 이건 **파기하는 쪽이 보는 볼트**입니다 — 지우고, 지워졌는지 확인하는 둘만 필요합니다.
 * 매핑을 **맡는** 자리는 `POST …/vault` 이고(08-14-api.md §3.11), 그 포트는
 * 쓰는 쪽이 자기 것으로 선언합니다.
 *
 * 한 인터페이스에 둘을 합치면 **파기 모듈이 쓰기 능력을 갖게 됩니다.** 지우는 것만
 * 하는 모듈이 넣을 수도 있으면, 「무엇이 볼트에 들어가나」를 볼 자리가 둘로 늘어납니다.
 */

/**
 * 이 모듈이 밖에 요구하는 것 — 업로드 원본이 있는 객체 저장소.
 *
 * **네이티브 만료가 없어 실제로 지워졌는지 검증해야 합니다** → ADR-016.
 */
export interface ObjectStore {
  deleteAll(caseId: string): Promise<void>
  remains(caseId: string): Promise<boolean>
}

/** 이 모듈이 밖에 요구하는 것 — 토큰화된 사건 상태가 있는 관계형 DB */
export interface CaseStore {
  /** `purge_after` 가 지난 사건. 한 번에 처리할 수를 제한합니다 */
  findDue(asOf: string, limit: number): Promise<readonly PurgeTarget[]>
  /** 사건 행 삭제. 딸린 것은 외래키로 연쇄됩니다 → 09-data-model.md §1 */
  delete(caseId: string): Promise<void>
  remains(caseId: string): Promise<boolean>
}

/**
 * 이 모듈이 밖에 요구하는 것 — 감사 기록.
 *
 * **`audit_log` 에는 외래키가 없습니다.** 사건이 파기돼도 기록은 남아야 하고,
 * 연쇄 삭제가 걸려 있으면 파기가 곧 감사 기록의 소멸이 됩니다 → 09-data-model.md §1.
 */
export interface AuditSink {
  record(event: {
    eventType: 'case.purged'
    /** 사용자 요청 없이 도는 모듈이라 언제나 `system` 입니다 */
    actorType: 'system'
    caseId: string
    detail: Record<string, unknown>
  }): Promise<void>
}

/** 이 모듈이 밖에 요구하는 것 — 서버 시계 */
export interface Clock {
  /** `YYYY-MM-DD` · Asia/Seoul */
  today(): string
}

/** 사건 하나의 파기 결과 */
export interface CasePurge {
  readonly caseId: string
  /** 세 층이 전부 지워졌는가 */
  readonly purged: boolean
  /**
   * 아직 남아 있는 층. 비어 있으면 성공입니다.
   *
   * **여기가 비지 않았는데 성공으로 처리하면 안 됩니다** — ADR-016 이 층마다
   * 수명을 다르게 두지 않기로 한 이유가 그것입니다.
   */
  readonly remaining: readonly Layer[]
  /** 지우다 멈춘 이유. 성공이면 없습니다 */
  readonly error?: string
}

/** 한 번 돌린 결과 */
export interface PurgeRun {
  /** 대상으로 집은 사건 수 */
  readonly scanned: number
  readonly purged: readonly string[]
  readonly failed: readonly CasePurge[]
}

export interface CasePurger {
  /**
   * `purge_after` 가 지난 사건을 지운다.
   *
   * **한 사건이 실패해도 나머지를 계속합니다.** 하나 때문에 전부 밀리면
   * 파기가 무한정 늦어집니다.
   *
   * **예외를 던지지 않습니다.** 무엇이 남았는지를 결과로 돌려줍니다 —
   * 던지면 어느 사건에서 멈췄는지, 그 앞의 것들은 지워졌는지 알 수 없습니다.
   */
  run(options?: { limit?: number }): Promise<PurgeRun>
}
