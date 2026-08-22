/**
 * 수집 한 바퀴.
 *
 * 계약: spec/backend/08-16-data-model.md §12.1 §12.3 §12.5
 *
 * ## 변경 감지에 비교 로직이 없습니다
 *
 * `source_snapshot` 이 `(source_key, content_hash)` 를 잠그고 있어
 * **삽입에 성공하면 그것이 곧 변경입니다** → §12.1. 앞엣것과 견주는 코드를
 * 따로 만들지 않습니다 — 두 곳에 두면 어긋나고, 어긋난 쪽이 조용히 놓치는 쪽이 됩니다.
 *
 * 그래서 **스냅샷 저장과 검수 큐 등록을 한 번의 쓰기로 요구합니다.** 둘로 갈라
 * 두면 사이에서 끊겼을 때 해시만 남아, 그 개정이 영영 검수 큐에 못 올라옵니다
 * → `SnapshotStore.append`.
 *
 * ## 게시판은 겹칠 때까지 읽습니다
 *
 * 보도자료 RSS 는 최근 10건만 주고 그 10건이 4일치입니다. **수집이 며칠 멈추면
 * 그 사이 게시물이 밀려나 영구히 사라집니다.** 게시글 번호로도 못 잡습니다 —
 * 번호가 게시판별 연속이 아니라 전체 게시판이 공유합니다.
 *
 * 그래서 **고정 쪽수를 읽지 않습니다.** 마지막으로 본 게시물 날짜와 겹칠 때까지
 * 쪽을 넘깁니다. 수집이 한 달 멈췄다 재개돼도 그 구간이 자동으로 복구됩니다.
 *
 * ## 한 소스가 실패해도 나머지를 계속합니다
 *
 * 법령 API 가 죽었다고 게시판 수집까지 멈추면 그날 나온 정책 발표를 통째로
 * 놓칩니다. **이 서비스에서 가장 중요한 정보가 「곧 바뀐다」입니다** → ADR-012.
 */

import type {
  Clock,
  CollectResult,
  FetchedItem,
  Hasher,
  IdSource,
  KbCollector,
  RegistryStore,
  Snapshot,
  SnapshotStore,
  SourceFetcher,
  SourceResult,
  WatchedSource,
} from './types'

/**
 * 겹치는 지점을 못 찾을 때 멈추는 쪽 수 → §12.5 의 안전장치.
 *
 * 목록 페이지는 쪽당 10건이고 2쪽이면 약 2주치라, 20쪽은 반년 가까이입니다.
 * **여기 걸리면 구멍이 남았을 수 있어 결과에 밝힙니다.**
 */
const PAGE_LIMIT = 20

/** 자동 감시가 안 되는 층 → §12.6. 사람이 확인합니다 */
function isWatchable(source: WatchedSource): boolean {
  return source.watchMethod !== 'human'
}

/**
 * 이 소스가 조용히 멈췄는가.
 *
 * *"조용히 멈춘 수집기가 가장 위험합니다 — 아무 일도 안 일어나므로 아무도
 * 모릅니다"* → §12.3. 주기의 **두 배**를 넘으면 알립니다.
 */
function isStale(source: WatchedSource, nowMs: number): boolean {
  if (!isWatchable(source) || source.intervalDays === null) return false
  if (!source.lastSuccessAt) return true

  const last = Date.parse(source.lastSuccessAt)
  if (!Number.isFinite(last)) return true

  return nowMs - last > source.intervalDays * 2 * 24 * 60 * 60 * 1000
}

/** 이 쪽에서 가장 오래된 게시물 날짜 */
function oldestDate(items: readonly FetchedItem[]): string | null {
  let oldest: string | null = null
  for (const one of items) {
    if (!one.postedDate) continue
    if (oldest === null || one.postedDate < oldest) oldest = one.postedDate
  }
  return oldest
}

/** 이 쪽에서 가장 최근 게시물 날짜 */
function newestDate(items: readonly FetchedItem[]): string | null {
  let newest: string | null = null
  for (const one of items) {
    if (!one.postedDate) continue
    if (newest === null || one.postedDate > newest) newest = one.postedDate
  }
  return newest
}

export function createKbCollector(deps: {
  fetcher: SourceFetcher
  snapshots: SnapshotStore
  registry: RegistryStore
  ids: IdSource
  clock: Clock
  hasher: Hasher
}): KbCollector {
  const { fetcher, snapshots, registry, ids, clock, hasher } = deps

  /**
   * 감시 목록에 결과를 남긴다. **던지지 않습니다.**
   *
   * 수집 실패의 가장 흔한 원인이 저장소·네트워크라, 실패를 기록하려는 이 호출도
   * 함께 실패합니다. 그것이 새어 나가면 **뒤 소스가 통째로 안 돕니다.**
   *
   * @returns 못 남겼으면 그 사유. 남겼으면 `null`
   */
  async function note(
    sourceKeyPrefix: string,
    patch: { lastSuccessAt?: string; lastSeenDate?: string; lastError?: string | null },
  ): Promise<string | null> {
    try {
      await registry.update(sourceKeyPrefix, patch)
      return null
    } catch (error) {
      return error instanceof Error ? error.name : 'unknown'
    }
  }

  /** 한 항목을 저장하고 검수 큐에 남긴다. **둘은 함께 일어납니다** */
  async function keep(source: WatchedSource, item: FetchedItem): Promise<boolean> {
    const now = clock.now()
    const snapshot: Snapshot = {
      snapshotId: ids.next(),
      sourceType: source.sourceType,
      sourceKey: item.sourceKey,
      fetchedAt: now,
      // 원문 그대로. 요약하거나 다듬지 않습니다 — 근거이기 때문입니다
      content: item.content,
      contentHash: hasher.hash(item.content),
      meta: item.meta ?? {},
    }

    // **삽입에 성공한 것이 곧 변경입니다.** 여기서 매뉴얼에 반영하지 않습니다 —
    // review_status='pending' 으로 쌓이고 사람이 승인해야 그다음이 있습니다
    return snapshots.append({
      snapshot,
      change: {
        // **비워 둡니다.** 직전 원문은 검수 화면이 그때 조회합니다 → §12.2.
        // 화면이 어차피 원문 둘을 다 읽어야 해서 여기서 한 번 더 찾을 이유가 없습니다
        snapshotBefore: null,
        detectedAt: now,
      },
    })
  }

  async function collectOne(source: WatchedSource): Promise<SourceResult> {
    let added = 0
    let unchanged = 0
    let pages = 0
    let hitPageLimit = false
    let seenDate = source.lastSeenDate

    try {
      for (let page = 1; page <= PAGE_LIMIT; page += 1) {
        const items = await fetcher.fetch({
          sourceKeyPrefix: source.sourceKeyPrefix,
          watchMethod: source.watchMethod,
          page,
        })
        pages = page

        // 더 줄 것이 없으면 끝입니다. 쪽이 없는 소스(API)도 여기서 멈춥니다
        if (items.length === 0) break

        for (const item of items) {
          if (await keep(source, item)) added += 1
          else unchanged += 1
        }

        const newest = newestDate(items)
        if (newest && (seenDate === null || newest > seenDate)) seenDate = newest

        // 게시판이 아니면 한 쪽으로 끝냅니다 — 쪽 개념이 없습니다
        if (source.watchMethod !== 'board') break

        const oldest = oldestDate(items)
        // **겹쳤습니다. 구멍 없음이 확인됐습니다** → §12.5
        if (oldest && source.lastSeenDate && oldest <= source.lastSeenDate) break

        if (page === PAGE_LIMIT) hitPageLimit = true
      }

      // **잘렸으면 커서를 밀지 않습니다.** 밀면 다음 바퀴가 1쪽에서 바로 겹쳐
      // 멈추고, 구멍이 남았다는 사실이 어디에도 안 남습니다. 그대로 두면
      // 사람이 손댈 때까지 같은 경고가 계속 뜹니다
      const advance =
        !hitPageLimit && seenDate !== null && seenDate !== source.lastSeenDate
          ? seenDate
          : null
      const failed = await note(source.sourceKeyPrefix, {
        lastSuccessAt: clock.now(),
        ...(advance ? { lastSeenDate: advance } : {}),
        // 잘린 바퀴에 lastError 를 지우지 않습니다 — 상태를 잃는 쪽입니다
        ...(hitPageLimit ? {} : { lastError: null }),
      })

      return {
        sourceKeyPrefix: source.sourceKeyPrefix,
        added,
        unchanged,
        pages,
        hitPageLimit,
        // 가져오기는 됐지만 결과를 못 남겼습니다. 다음 바퀴에서 stale 로 보입니다
        ...(failed ? { error: failed } : {}),
      }
    } catch (error) {
      // **조용히 넘기지 않습니다.** 실패를 기록해야 다음 바퀴에서 보입니다.
      // 값이 아니라 종류만 남깁니다 — 원문에 무엇이 들었는지 모릅니다
      const reason = error instanceof Error ? error.name : 'unknown'
      await note(source.sourceKeyPrefix, { lastError: reason })

      return {
        sourceKeyPrefix: source.sourceKeyPrefix,
        added,
        unchanged,
        pages,
        hitPageLimit,
        error: reason,
      }
    }
  }

  return {
    async collect(): Promise<CollectResult> {
      // 여기만 던집니다 — 돌 소스를 모르면 결과를 만들 수 없습니다
      const sources = await registry.list()
      const nowMs = Date.parse(clock.now())
      const results: SourceResult[] = []

      for (const source of sources) {
        // 자동 감시가 안 되는 층은 건너뜁니다 → §12.6.
        // 다만 「멈췄나」 판정에서도 빼야 합니다 — 원래 안 도는 것입니다
        if (!isWatchable(source)) continue
        results.push(await collectOne(source))
      }

      // **이번 바퀴에 성공한 소스는 멈춘 것이 아닙니다.** 바퀴 시작 시점의
      // last_success_at 으로만 판정하면 복구된 첫 바퀴와 최초 배포 바퀴에
      // 「전부 멈춤」이 뜨고, 그런 경고가 상시로 뜨면 진짜 멈춘 소스가 묻힙니다
      const freshly = new Set(
        results.filter((one) => !one.error).map((one) => one.sourceKeyPrefix),
      )

      return {
        results,
        stale: sources
          .filter((one) => !freshly.has(one.sourceKeyPrefix) && isStale(one, nowMs))
          .map((one) => one.sourceKeyPrefix),
      }
    },
  }
}
