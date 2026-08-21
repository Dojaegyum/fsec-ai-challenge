/**
 * kb-collector — 입출력 타입과 이 모듈이 요구하는 것.
 *
 * 정본: spec/backend/08-16-data-model.md §12 §12.1 §12.3 §12.4 §12.5
 *       spec/backend/08-14-kb-operations.md (운영 파이프라인)
 *       spec/common/08-16-module-names.md 층 4
 * 근거: ADR-012(소스 넷·조문 단위) · ADR-025(Vercel Cron) · ADR-028
 *
 * **`kb_entry` 를 쓰지 않습니다.** 수집기는 원문을 스냅샷으로 보관할 뿐이고,
 * 매뉴얼에 반영되려면 사람 승인을 거쳐야 합니다
 * → 07-kb-operations.md 원칙 4 「사람 검수는 생략 불가」.
 *
 * **사건 데이터에 닿지 않습니다.** 층 4 의 다른 둘(`reminder-sender`·`case-purger`)과
 * 다른 점입니다 → 12-module-names.md.
 *
 * 절대 하지 않는 것: `kb_entry` 에 쓰기 · 승인 없이 반영하기 ·
 * 고정 쪽수만 읽고 멈추기 · 수집 실패를 조용히 넘기기
 */

/** 09-data-model.md §12.1 */
export type SourceType = 'law' | 'pre_notice' | 'press' | 'manual'

/** 09-data-model.md §12.3 */
export type WatchMethod = 'api' | 'rss' | 'board' | 'human'

/**
 * 가져온 원문 하나 → `source_snapshot` 한 행.
 *
 * **법령은 조문 단위입니다.** 전체를 한 행에 넣지 않습니다 — 시행령 본문이
 * 223KB 인데 조문 하나가 바뀔 때마다 전체를 다시 저장하면 그만큼 늘어납니다.
 * 조문 단위면 약 8KB 이고, **변경 지점이 조문까지 좁혀집니다** → §12.1.
 */
export interface Snapshot {
  readonly snapshotId: string
  readonly sourceType: SourceType
  /**
   * 무엇을 가져온 것인가.
   *
   * | `source_type` | 모양 |
   * | --- | --- |
   * | `law` | 법령ID:조문번호:조문가지번호 |
   * | `press` | 게시글 URL |
   * | `manual` | org_id:field |
   */
  readonly sourceKey: string
  /** ISO 8601 · Asia/Seoul */
  readonly fetchedAt: string
  /** **원문 그대로.** 요약하거나 다듬지 않습니다 */
  readonly content: string
  /** SHA-256 소문자 16진수 64자 */
  readonly contentHash: string
  /** 시행일·공포일·부처·게시일 등 */
  readonly meta: Readonly<Record<string, unknown>>
}

/** 소스에서 막 가져온 것. 아직 식별자도 해시도 없습니다 */
export interface FetchedItem {
  readonly sourceKey: string
  readonly content: string
  readonly meta?: Readonly<Record<string, unknown>>
  /**
   * 게시물 날짜 `YYYY-MM-DD`. **게시판에서만** 옵니다.
   *
   * 「겹칠 때까지 읽기」의 멈춤 조건이 이 값입니다 → §12.5.
   */
  readonly postedDate?: string
}

/** 감시 소스 하나 → `source_registry` 한 행 */
export interface WatchedSource {
  readonly sourceKeyPrefix: string
  readonly sourceType: SourceType
  readonly watchMethod: WatchMethod
  /** `human` 이면 없습니다 */
  readonly intervalDays: number | null
  readonly lastSuccessAt: string | null
  /** 게시판에서 마지막으로 수집한 게시물 날짜 `YYYY-MM-DD` */
  readonly lastSeenDate: string | null
  readonly lastError: string | null
}

/**
 * 이 모듈이 밖에 요구하는 것 — 소스에서 가져오는 자리.
 *
 * ⬜ **구현이 아직 없습니다.** 국가법령정보 API 는 `OC` 키 승인 대기 중이고
 * (`docs/research/05-미확인-목록.md` `U-17`), 입법예고 API 는 응답 형식 미확인,
 * 게시판은 목록 페이지를 읽어야 합니다 → 07-kb-operations.md 「소스 주소」.
 *
 * **쪽 번호를 받습니다.** 게시판은 겹칠 때까지 여러 쪽을 읽어야 하기 때문입니다.
 * 쪽이 없는 소스(API)는 1쪽만 부르고 빈 배열을 돌려주면 멈춥니다.
 */
export interface SourceFetcher {
  fetch(input: {
    sourceKeyPrefix: string
    watchMethod: WatchMethod
    /** 1부터 */
    page: number
  }): Promise<readonly FetchedItem[]>
}

/** 검수 큐에 함께 남길 것 → `source_change` */
export interface PendingChange {
  /**
   * 직전 스냅샷. **최초 수집이면 `null`** → §12.2.
   *
   * ⬜ 지금은 늘 `null` 입니다 — 아래 `append` 참고.
   */
  readonly snapshotBefore: string | null
  /** ISO 8601 */
  readonly detectedAt: string
}

/**
 * 이 모듈이 밖에 요구하는 것 — 스냅샷 보관과 검수 큐 등록.
 *
 * **`append` 만 있고 고치거나 지우는 자리가 없습니다.** 원문은 근거라
 * 나중에 바뀌면 안 됩니다.
 *
 * ## 왜 둘을 한 자리에서 받나
 *
 * §12.1 이 감지 장치를 **삽입 하나**에 걸었습니다 — 해시가 저장되는 순간
 * 「바뀌었다」는 신호가 소멸합니다. 그래서 **저장과 검수 큐 등록이 갈라지면
 * 그 사이에서 끊겼을 때 개정이 영영 사라집니다.** 해시는 남아 다음 바퀴부터
 * `append` 가 거짓을 돌려주고, 검수 큐에는 그 조문이 끝내 나타나지 않습니다.
 *
 * 재수집으로 복구되지 않습니다. 그래서 **한 번의 쓰기로 묶어 요구합니다** —
 * 포트를 둘로 두면 어떤 저장소 구현도 이 구멍을 막을 수 없습니다.
 */
export interface SnapshotStore {
  /**
   * 스냅샷과 검수 큐 한 줄을 **함께** 저장한다.
   * **이미 있는 내용이면 아무것도 쓰지 않고 거짓을 돌려줍니다.**
   *
   * `uk_source_hash` 가 `(source_key, content_hash)` 를 잠그고 있어,
   * **삽입에 성공하면 그것이 곧 변경입니다** → §12.1.
   * 별도 비교 로직을 만들지 마세요 — 두 곳에 두면 어긋납니다.
   *
   * 검수 큐 행은 `review_status='pending'` 으로 쌓입니다. **여기서 매뉴얼에
   * 반영하지 않습니다** — 사람이 승인해야 그다음이 있습니다.
   *
   * @returns 새로 저장했으면 참. 둘 다 썼거나 둘 다 안 썼거나입니다.
   */
  append(input: {
    snapshot: Snapshot
    /** `source_change.snapshot_after` 는 `snapshot.snapshotId` 입니다 */
    change: PendingChange
  }): Promise<boolean>
}

/**
 * 이 모듈이 밖에 요구하는 것 — 감시 목록.
 *
 * **`update` 가 실패해도 수집은 계속합니다.** 기록을 못 남긴 것이 나머지
 * 소스를 못 돌게 할 이유는 아닙니다 — 수집 실패의 가장 흔한 원인이
 * 저장소·네트워크라 그때 `update` 도 함께 실패합니다.
 */
export interface RegistryStore {
  /** **이것만은 던집니다** — 돌 소스를 모르면 결과를 만들 수 없습니다 */
  list(): Promise<readonly WatchedSource[]>
  /** 한 소스의 수집 결과를 기록한다 */
  update(
    sourceKeyPrefix: string,
    patch: {
      lastSuccessAt?: string
      lastSeenDate?: string
      lastError?: string | null
    },
  ): Promise<void>
}

/** 이 모듈이 밖에 요구하는 것 — 식별자·시각·해시 */
export interface IdSource {
  next(): string
}

export interface Clock {
  /** ISO 8601 · Asia/Seoul */
  now(): string
  /** `YYYY-MM-DD` */
  today(): string
}

export interface Hasher {
  /** SHA-256 소문자 16진수 64자 */
  hash(text: string): string
}

/** 소스 하나를 수집한 결과 */
export interface SourceResult {
  readonly sourceKeyPrefix: string
  /** 새로 저장된 스냅샷 수. **이 값이 곧 변경 건수입니다** */
  readonly added: number
  /** 이미 있어서 안 저장된 수 */
  readonly unchanged: number
  /** 읽은 쪽 수 */
  readonly pages: number
  /**
   * 안전장치에 걸려 멈췄는가.
   *
   * 겹치는 지점을 못 찾고 20쪽을 넘긴 경우입니다. **구멍이 남았을 수 있습니다**
   * → §12.5.
   *
   * **이때는 `last_seen_date` 를 밀지 않습니다.** 밀면 다음 바퀴가 1쪽에서 바로
   * 겹쳐 멈추고, 구멍이 남았다는 사실이 결과에서도 저장소에서도 사라집니다.
   * 사람이 손댈 때까지 같은 경고가 계속 뜨는 편이 낫습니다.
   */
  readonly hitPageLimit: boolean
  /** 실패했으면 그 사유. 값은 담지 않습니다 */
  readonly error?: string
}

export interface CollectResult {
  readonly results: readonly SourceResult[]
  /**
   * **조용히 멈춘 수집기.**
   *
   * `last_success_at` 이 `interval_days` 의 두 배를 넘긴 소스입니다.
   * 정본이 *"조용히 멈춘 수집기가 가장 위험합니다 — 아무 일도 안 일어나므로
   * 아무도 모릅니다"* 라고 적었습니다 → §12.3.
   */
  readonly stale: readonly string[]
}

export interface KbCollector {
  /**
   * 감시 소스를 한 바퀴 돈다.
   *
   * **한 소스가 실패해도 나머지를 계속합니다.** 법령 API 가 죽었다고 게시판
   * 수집까지 멈추면, 그날 나온 정책 발표를 통째로 놓칩니다.
   *
   * **소스 하나의 실패로는 던지지 않습니다.** 실패는 결과에 담겨 나오고,
   * 부르는 쪽(크론 라우트)이 무엇을 남길지 정합니다.
   *
   * **감시 목록 자체를 못 읽으면 던집니다.** 돌 소스를 모르면 결과를 만들 수
   * 없고, 빈 결과를 돌려주면 「전부 정상」으로 읽혀 §12.3 이 경고한
   * 「조용히 멈춘 수집기」를 새로 만드는 셈입니다.
   */
  collect(): Promise<CollectResult>
}
