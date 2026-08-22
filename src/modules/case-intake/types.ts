/**
 * case-intake — 사건을 생성하고 파일을 접수한다
 *
 * 계약: spec/common/08-14-api.md §3.1 §3.2 §1.3 · spec/backend/08-16-data-model.md §2 §3
 * 근거: ADR-016(보관 180일) · ADR-026(원본 보관) · ADR-028(자원을 인터페이스로 받음)
 *
 * 절대 하지 않는 것: 플랜을 만들기 · 파일 내용을 읽기 · 원문 전사를 저장하기 ·
 * 식별자와 업로드 자리를 직접 만들기
 */

/** 09-data-model.md §2. 통장묶기는 절차가 완전히 다릅니다 */
export type Track = 'victim' | 'frozen_account'

/** 09-data-model.md §2 */
export type CaseStatus = 'intake' | 'in_progress' | 'waiting' | 'closed'

/** 09-data-model.md §3 */
export type EvidenceKind = 'audio' | 'image' | 'text'

/** 09-data-model.md §3 */
export type IngestStatus = 'pending' | 'processing' | 'done' | 'failed'

/** 08-14-api.md §3.1 의 응답. 플랜은 여기 없습니다 — 붙이는 것은 부른 쪽입니다 */
export interface OpenedCase {
  readonly caseId: string
  readonly track: Track
  readonly status: CaseStatus
  /** ISO 8601 · Asia/Seoul */
  readonly openedAt: string
  /**
   * 이 날짜 이후 파기 대상. `YYYY-MM-DD`.
   *
   * **이 값 하나가 사건에 딸린 모든 것의 수명입니다** — 토큰화 상태·업로드 원본·
   * 복원 매핑 암호문이 같은 날 함께 사라집니다 → 09-data-model.md §2.
   */
  readonly purgeAfter: string
}

/** 파일 하나를 접수해 달라는 요청 → 08-14-api.md §3.2 1단계 */
export interface EvidenceRequest {
  readonly kind: EvidenceKind
  readonly mimeType: string
  readonly byteSize: number
}

/** 업로드 자리 → 08-14-api.md §3.2 응답 */
export interface UploadSlot {
  readonly evidenceId: string
  readonly uploadUrl: string
  readonly uploadMethod: 'PUT'
  readonly expiresAt: string
}

/** `evidence` 한 행 → 09-data-model.md §3 */
export interface EvidenceRow {
  readonly evidenceId: string
  readonly caseId: string
  readonly kind: EvidenceKind
  readonly objectKey: string
  readonly mimeType: string
  readonly byteSize: number
  readonly ingestStatus: IngestStatus
}

/** 사건당 얼마나 받았나. 한도 판정에 씁니다 */
export interface EvidenceTotals {
  readonly count: number
  readonly bytes: number
}

/**
 * 사건당 상한 → 08-14-api.md §1.3.
 *
 * **보호가 목적이지 절약이 목적이 아닙니다.** 이 서비스의 사용자는 피해 직후라
 * 급합니다 — 정상 사용을 막는 값을 넣지 마세요.
 */
export interface IntakeLimits {
  /** 사건당 파일 개수. 정본 기본값 30 */
  readonly maxFiles: number
  /** 사건당 합계 바이트. 정본 기본값 300MB */
  readonly maxTotalBytes: number
}

/**
 * 이 모듈이 밖에 요구하는 것 — 정렬 가능한 식별자.
 *
 * **직접 만들지 않습니다.** 시험에서 값을 고정할 수 있어야 하고,
 * ULID 구현을 이 모듈이 고를 이유가 없습니다.
 */
export interface IdSource {
  /** `CHAR(26)` ULID */
  next(): string
}

/** 이 모듈이 밖에 요구하는 것 — 서버 시계. **클라이언트 시계를 믿지 않습니다** */
export interface Clock {
  /** ISO 8601 · Asia/Seoul */
  now(): string
  /** `YYYY-MM-DD` · Asia/Seoul */
  today(): string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 보관 기한 날짜 셈.
 *
 * `date-checker` 의 `addDays` 를 그대로 넣습니다. 밖에서 `Date` 로 더하면
 * 서버 위치에 따라 하루가 어긋납니다.
 */
export interface DateShifter {
  addDays(date: string, amount: number): string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 업로드 자리 발급.
 *
 * **파일이 API 함수를 통과하지 않습니다.** 녹음이 수십 MB라 서버리스 본문 한계에
 * 걸립니다 → 08-14-api.md §3.2. 객체 저장소 제품이 아직 미정이라 인터페이스로 둡니다.
 */
export interface UploadSlotSource {
  issue(req: {
    caseId: string
    evidenceId: string
    mimeType: string
    byteSize: number
  }): Promise<{ objectKey: string; url: string; expiresAt: string }>
}

/** 이 모듈이 밖에 요구하는 것 — 사건 저장소 */
export interface CaseStore {
  createCase(row: OpenedCase): Promise<void>
  /** 사건이 지금까지 받은 파일 수와 합계 바이트 */
  evidenceTotals(caseId: string): Promise<EvidenceTotals>
  addEvidence(row: EvidenceRow): Promise<void>
  /** 업로드가 끝났다고 표시한다. `pending` → `processing` */
  markUploaded(caseId: string, evidenceId: string): Promise<IngestStatus>
  /** 활동이 있었으니 파기 예정일을 다시 민다 */
  touchPurgeAfter(caseId: string, purgeAfter: string): Promise<void>
}

export interface CaseIntake {
  /**
   * 사건 한 행을 **만들기만** 한다. 저장하지 않는다.
   *
   * 사건 생성 경로는 플랜까지 만든 뒤 **둘을 한 번에** 저장합니다 → ADR-046.
   * 먼저 저장하면 플랜이 실패했을 때 **되돌아갈 수 없는 빈 사건**이 남습니다 —
   * 에러 봉투에 `case_id` 를 담을 칸이 없기 때문입니다(10-errors.md §3).
   *
   * @throws IngestError 갈래가 목록 밖일 때
   */
  draft(input: { track: Track }): OpenedCase

  /**
   * 사건을 열고 **바로 저장한다.**
   *
   * **플랜은 붙이지 않습니다.** T0 공통 안전 절차는 KB 인용이 필요하고,
   * 인용을 붙이는 것은 `planner` 의 일입니다 → 12-module-names.md 층 3.
   *
   * 사건 생성 경로는 이것을 쓰지 않습니다 — `draft` 를 보세요.
   */
  open(input: { track: Track }): Promise<OpenedCase>

  /**
   * 파일 접수 자리를 낸다.
   *
   * @throws RateLimitedError 사건당 상한을 넘으면 → 08-14-api.md §1.3
   * @throws IngestError 종류·크기가 말이 안 되면
   */
  acceptEvidence(caseId: string, req: EvidenceRequest): Promise<UploadSlot>

  /** 업로드가 끝났음을 통지받는다 → 08-14-api.md §3.2 3단계 */
  completeUpload(caseId: string, evidenceId: string): Promise<IngestStatus>
}
