/**
 * kb-finder — KB 를 `applied`·`reference` 두 묶음으로 조회한다
 *
 * 계약: spec/backend/08-16-chat-context.md §2 · spec/backend/08-16-data-model.md §11.2
 * 근거: ADR-014 · ADR-028
 *
 * 절대 하지 않는 것: 참조 번호 붙이기(prompt-builder) · 모델 부르기 ·
 * KB 에 쓰기 · 조회 결과가 0건인 것을 실패로 처리하기
 */

/** 09-data-model.md §2 */
export type Track = 'victim' | 'frozen_account'

/**
 * KB 한 행. `kb_entry` 표의 칼럼을 그대로 옮긴 것입니다
 * → 09-data-model.md §11.
 */
export interface KbRow {
  readonly kbEntryId: string
  readonly kbVersion: string
  /** 절차 단계 식별자. **우선순위 병합의 키입니다** */
  readonly stepKey: string
  /** 기본 표시 순서. 유형마다 다를 수 있습니다 — CH-facetoface 는 순서가 역전됩니다 */
  readonly stepSeq: number
  /** `CH-xxx`. 비면 전 유형 공통 */
  readonly channelId: string | null
  /** 기관 전용 항목. 비면 유형 기본 */
  readonly orgId: string | null
  readonly track: Track
  readonly title: string
  readonly body: unknown
  readonly legalBasis: string
  readonly sourceUrl: string
  /** `YYYY-MM-DD` */
  readonly effectiveFrom: string
  /** `YYYY-MM-DD`. 비면 현재 유효 */
  readonly effectiveUntil: string | null
  /**
   * 사람이 근거를 눈으로 본 날. Staleness Guard 90일의 기준입니다.
   *
   * **이 모듈은 이 값으로 거르지 않습니다.** 낡았다고 조회에서 빼면 사용자에게
   * 아무것도 못 내놓습니다 — 재검증은 KB 운영 파이프라인(`F-11`)의 일입니다.
   */
  readonly verifiedAt: string
}

/**
 * 조회 조건.
 *
 * **전부 서버가 이미 아는 값입니다** → 09-data-model.md §11.2.
 * 모델에게 조회 조건을 묻지 않습니다.
 */
export interface KbQuery {
  /** 현재 릴리스 */
  readonly kbVersion: string
  /** `case.track` */
  readonly track: Track
  /** `case_channel.channel_id`. **비면 슬롯 T1 미충족입니다** */
  readonly channelId: string | null
  /** `case_channel.org_id`. 비면 기관 미특정 */
  readonly orgId: string | null
  /** 조회 기준일 `YYYY-MM-DD`. **서버 시각입니다** */
  readonly asOf: string
}

/**
 * 조회 결과 두 묶음.
 *
 * **섞지 않습니다.** 섞으면 은행 이체 사건에서 가상자산 거래소 절차를
 * 그냥 안내하게 됩니다 → 11-chat-context.md §2.3.
 */
export interface KbGroups {
  /**
   * 이 사건에 적용되는 절차. **실행 보드에 뜨는 것과 같은 것을 봅니다.**
   * 우선순위 병합을 마친 상태이고 `stepSeq` 순입니다.
   */
  readonly applied: readonly KbRow[]
  /**
   * 다른 유형의 기본 절차. **조건 라벨을 붙여 안내할 근거입니다.**
   * `channelId` · `stepSeq` 순입니다.
   */
  readonly reference: readonly KbRow[]
}

/**
 * 이 모듈이 밖에 요구하는 것 — KB 조회.
 *
 * **SQL 은 밖에 있습니다.** 정본(09-data-model.md §11.2 · 11-chat-context.md §2.2)이
 * 쿼리를 그대로 적어 두었고, 이 모듈은 그 결과를 **병합**하는 규칙만 갖습니다.
 *
 * 두 메서드 모두 **0건을 정상으로 돌려줍니다.** 없다고 던지지 마세요.
 */
export interface KbStore {
  /** 기관 전용 · 유형 기본 · 전 유형 공통을 한꺼번에 */
  findApplied(query: KbQuery): Promise<readonly KbRow[]>
  /** 다른 유형의 기본 항목만 (`org_id IS NULL` · `channel_id IS NOT NULL`) */
  findReference(query: KbQuery): Promise<readonly KbRow[]>
}

export interface KbFinder {
  /**
   * 두 묶음을 조회한다.
   *
   * **0건은 실패가 아닙니다.** 빈 묶음을 돌려주고, 절차를 말하지 않고 1332 를
   * 안내할지는 부른 쪽이 정합니다 → 10-errors.md §4.1.
   *
   * @throws KbUnavailableError 조회 자체가 실패했을 때. **근거 없는 답변보다
   *         멈추는 편이 낫습니다** → 10-errors.md.
   */
  find(query: KbQuery): Promise<KbGroups>
}
