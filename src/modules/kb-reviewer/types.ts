/**
 * kb-reviewer — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-16-data-model.md §12 §12.2
 *       spec/backend/08-14-kb-operations.md 원칙 4 「사람 검수는 생략 불가」
 *       rfc/002-kb-authoring.md 「수집 파이프라인과 어디서 만나나」
 * 근거: ADR-012 · ADR-028
 *
 * ## 승인이 곧 반영이 아닙니다
 *
 * `RFC-002` 가 파이프라인을 네 구간으로 갈랐습니다.
 *
 * ```
 * 1. 수집   source_snapshot   자동 · 하루 1회
 * 2. 검수   source_change     사람 — 무엇이 바뀌었나        ← 이 모듈
 * 3. 반영   src/kb/*.json     사람 — 승인된 변경을 파일에 옮긴다
 *    릴리스 kb_entry          적재기 — kb_version 을 찍는다
 * ```
 *
 * **이 모듈은 2번까지입니다.** *"파이프라인이 `kb_entry` 를 직접 쓰지 않습니다.
 * 승인이 곧 반영이 되면 무엇이 어떻게 바뀌었는지가 어디에도 남지 않고,
 * 「사람 검수 생략 불가」가 승인 버튼 한 번으로 축소됩니다.
 * **검수의 산출물은 diff 입니다.**"*
 *
 * 릴리스가 실제로 끝나면 그 버전을 이 모듈이 **기록**합니다(`released_version`) —
 * 하는 것이 아니라 적는 것입니다. `12-module-names.md` 도 같은 말로 적혀 있습니다.
 *
 * 절대 하지 않는 것: `kb_entry` 에 쓰기 · 승인을 자동으로 하기 ·
 * 확신도가 낮다고 자동으로 버리기 · 승인 없이 반영된 것으로 표시하기
 */

/** 09-data-model.md §12.2 */
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'deferred'

/** 검수 큐의 한 줄 → `source_change` */
export interface SourceChange {
  readonly changeId: string
  readonly sourceKey: string
  /** 최초 수집이면 `null` */
  readonly snapshotBefore: string | null
  readonly snapshotAfter: string
  /** ISO 8601 */
  readonly detectedAt: string
  /**
   * 같은 제도 변경을 묶는 키.
   *
   * 금융위는 게시판을 넷 운영해서 **같은 발표가 보도자료·보도설명자료·공지사항에
   * 함께 올라옵니다.** 본문이 달라 해시로는 안 걸립니다 → §12.2.
   *
   * ⬜ **이 값을 넣는 자리가 아직 없습니다.** 수집기는 원문만 보므로 계산할 수
   * 없고(본문이 다릅니다), 정본도 누가 채우는지 정하지 않았습니다. 지금은 늘
   * `null` 이라 **모든 변경이 각자 한 묶음으로 나갑니다** — `impact` 와 같은 자리입니다.
   */
  readonly dedupeKey: string | null
  /** LLM 영향 분석. 어느 항목에 영향인지·확신도·개정 초안 */
  readonly impact: ImpactAnalysis | null
  readonly reviewStatus: ReviewStatus
  readonly reviewedBy: string | null
  readonly reviewedAt: string | null
  readonly reviewNote: string | null
  /** 승인 뒤 실제로 반영된 KB 버전. **릴리스가 끝나야 채워집니다** */
  readonly releasedVersion: string | null
}

/**
 * LLM 이 낸 영향 분석.
 *
 * **판정이 아니라 참고입니다.** 릴리스 판단은 사람의 몫입니다
 * → 12-module-names.md *"LLM 은 영향 분석까지이고 릴리스 판단은 사람의 몫"*.
 */
export interface ImpactAnalysis {
  /** 영향받는 매뉴얼 항목들 */
  readonly affectedEntries?: readonly string[]
  /** 0~1 */
  readonly confidence?: number
  /** 개정 초안. **사람이 파일에 옮길 때 참고합니다** */
  readonly draft?: string
}

/** 한 묶음 — 같은 제도 변경으로 본 것들 */
export interface ChangeGroup {
  /** `dedupeKey`. 없는 것은 각자 한 묶음이고 이 값이 `null` 입니다 */
  readonly dedupeKey: string | null
  readonly changes: readonly SourceChange[]
  /**
   * 이 묶음에서 가장 높은 확신도. 없으면 `null`.
   *
   * **낮다고 버리지 않습니다** — 아래 참고.
   */
  readonly confidence: number | null
  /** 이 묶음이 건드린다고 본 매뉴얼 항목 전부 */
  readonly affectedEntries: readonly string[]
}

/** 사람이 내린 판단 하나 */
export interface ReviewDecision {
  readonly changeId: string
  /**
   * `pending` 으로 되돌리지 않습니다 — 아래 `review` 참고.
   *
   * **`deferred` 는 「아직 판단하지 않았다」입니다** → ADR-039. 시행일이 안 정해진
   * 발표처럼 지금은 판단할 수 없는 것에 쓰고, `note` 에 왜 미뤘는지를 남깁니다.
   * 이것만 다시 판단할 수 있습니다.
   */
  readonly status: Exclude<ReviewStatus, 'pending'>
  /** 누가 봤나. **사람입니다** */
  readonly reviewedBy: string
  readonly note?: string
}

/** 이 모듈이 밖에 요구하는 것 — 검수 큐 */
export interface ChangeStore {
  /** 상태로 걸러 가져온다 */
  listByStatus(status: ReviewStatus): Promise<readonly SourceChange[]>
  findById(changeId: string): Promise<SourceChange | null>
  /** 판단을 기록한다 */
  applyDecision(input: {
    changeId: string
    status: ReviewStatus
    reviewedBy: string
    reviewedAt: string
    note: string | null
  }): Promise<void>
  /** 릴리스가 끝난 뒤 그 버전을 적는다 */
  markReleased(changeId: string, kbVersion: string): Promise<void>
}

export interface Clock {
  /** ISO 8601 · Asia/Seoul */
  now(): string
}

export interface KbReviewer {
  /**
   * 사람이 봐야 할 것을 묶어서 내놓는다.
   *
   * **확신도가 낮은 것을 자동으로 버리지 않습니다** → §12.2
   * *"확신도가 낮은 판정을 자동으로 버리지 않습니다. `impact.confidence` 가
   * 낮으면 `pending` 으로 사람에게 갑니다."*
   *
   * 같은 제도 변경은 한 묶음으로 냅니다. **원문 스냅샷은 전부 남습니다** —
   * 근거가 여럿인 편이 낫습니다.
   *
   * **미룬 것은 안 나옵니다** → §12.2 · ADR-039. 큐는 `pending` 인 행이고,
   * 미룬 것까지 담으면 「아직 안 본 것」이 묻힙니다. 따로 찾아 엽니다.
   */
  queue(): Promise<readonly ChangeGroup[]>

  /**
   * 사람의 판단을 기록한다.
   *
   * `pending` 과 `deferred` 를 받습니다. **`approved`·`rejected` 는 잠깁니다**
   * → ADR-039.
   *
   * @throws KbError 없는 항목이거나, 승인·거절이 끝난 것을 다시 판단하려 할 때.
   *         **덮어쓰지 않습니다** — 검수 이력이 사라지면 「사람 검수 생략 불가」를
   *         지켰는지 확인할 방법이 없어집니다.
   */
  review(decision: ReviewDecision): Promise<void>

  /**
   * 릴리스가 끝난 것을 기록한다.
   *
   * **이 모듈이 릴리스를 하는 것이 아닙니다.** 사람이 파일에 옮기고 적재기가
   * 버전을 찍은 뒤, 그 사실을 검수 큐에 남기는 것입니다 → RFC-002.
   *
   * @throws KbError 승인되지 않은 변경을 반영된 것으로 표시하려 할 때.
   *         **승인 없이 매뉴얼에 들어가는 경로를 만들지 않습니다.**
   */
  markReleased(changeId: string, kbVersion: string): Promise<void>
}
