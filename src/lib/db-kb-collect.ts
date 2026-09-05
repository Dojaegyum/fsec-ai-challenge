/**
 * 수집 파이프라인 표 셋의 저장소 — `source_snapshot` · `source_change` · `source_registry`.
 *
 * 정본: spec/backend/08-16-data-model.md §12 · 마이그레이션 0010
 * 근거: ADR-012 · ADR-072
 *
 * `kb-collector`(층 4)가 원문을 보존하고 변경을 `pending` 으로 쌓는 자리와, `kb-reviewer` 가
 * 사람의 판단을 기록하는 자리입니다. **`kb_entry` 를 건드리는 문장은 여기 없습니다** —
 * 승인이 곧 반영이 아닙니다(RFC-002).
 */

import 'server-only'

import { seoulDay, seoulIso } from './clock'
import type { Sql } from './db'
import { newUlid } from './ids'

import type { RegistryStore, SnapshotStore, WatchedSource } from '@/modules/kb-collector'
import type { ChangeStore, ReviewStatus, SourceChange } from '@/modules/kb-reviewer'

/**
 * 원문 보존 + 변경 감지.
 *
 * §12.1 의 `uk_source_hash` 가 판정 장치입니다 — 같은 `(source_key, content_hash)` 가 이미 있으면
 * 「변경 없음」이고, 없으면 원문과 `pending` 변경을 **한 트랜잭션**으로 넣습니다. 둘을 따로 넣으면
 * 원문만 남고 변경이 빠지는 순간이 생기고, 그러면 다음 회차는 「이미 있다」고 보아 영영 검수에
 * 안 오릅니다.
 */
export function createSnapshotStore(sql: Sql): SnapshotStore {
  return {
    async append({ snapshot, change }) {
      return sql.begin(async (tx) => {
        const seen = await tx<{ ok: number }[]>`
          SELECT 1 AS ok FROM source_snapshot
          WHERE source_key = ${snapshot.sourceKey} AND content_hash = ${snapshot.contentHash}
          LIMIT 1
        `
        if (seen.length > 0) return false

        await tx`
          INSERT INTO source_snapshot
            (snapshot_id, source_type, source_key, fetched_at, content, content_hash, meta)
          VALUES (${snapshot.snapshotId}, ${snapshot.sourceType}, ${snapshot.sourceKey},
                  ${snapshot.fetchedAt}, ${snapshot.content}, ${snapshot.contentHash},
                  ${tx.json(snapshot.meta as never)})
        `
        await tx`
          INSERT INTO source_change
            (change_id, source_key, snapshot_before, snapshot_after, detected_at)
          VALUES (${newUlid()}, ${snapshot.sourceKey}, ${change.snapshotBefore},
                  ${snapshot.snapshotId}, ${change.detectedAt})
        `
        return true
      })
    },
  }
}

function dayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return seoulDay(value)
  return String(value).slice(0, 10)
}

function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return value instanceof Date ? seoulIso(value) : String(value)
}

/** 감시 소스 목록과 생존 기록 → §12.3 */
export function createRegistryStore(sql: Sql): RegistryStore {
  return {
    async list() {
      const rows = await sql<
        {
          source_key_prefix: string
          source_type: WatchedSource['sourceType']
          watch_method: WatchedSource['watchMethod']
          interval_days: number | null
          last_success_at: Date | string | null
          last_seen_date: Date | string | null
          last_error: string | null
        }[]
      >`
        SELECT source_key_prefix, source_type, watch_method, interval_days,
               last_success_at, last_seen_date, last_error
        FROM source_registry
        ORDER BY source_key_prefix
      `
      return rows.map((one) => ({
        sourceKeyPrefix: one.source_key_prefix,
        sourceType: one.source_type,
        watchMethod: one.watch_method,
        intervalDays: one.interval_days,
        lastSuccessAt: isoOf(one.last_success_at),
        lastSeenDate: dayOf(one.last_seen_date),
        lastError: one.last_error,
      }))
    },

    async update(sourceKeyPrefix, patch) {
      if (patch.lastSuccessAt !== undefined || patch.lastSeenDate !== undefined) {
        await sql`
          UPDATE source_registry SET
            last_success_at = COALESCE(${patch.lastSuccessAt ?? null}::timestamptz, last_success_at),
            last_seen_date  = COALESCE(${patch.lastSeenDate ?? null}::date, last_seen_date)
          WHERE source_key_prefix = ${sourceKeyPrefix}
        `
      }
      // `null` 은 「오류 없음」으로 지우라는 뜻이라, 키가 있을 때만 씁니다
      if ('lastError' in patch) {
        await sql`
          UPDATE source_registry SET last_error = ${patch.lastError ?? null}
          WHERE source_key_prefix = ${sourceKeyPrefix}
        `
      }
    },
  }
}

interface ChangeRow {
  change_id: string
  source_key: string
  snapshot_before: string | null
  snapshot_after: string
  detected_at: Date | string
  dedupe_key: string | null
  impact: SourceChange['impact']
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: Date | string | null
  review_note: string | null
  released_version: string | null
}

function changeOf(row: ChangeRow): SourceChange {
  return {
    changeId: row.change_id,
    sourceKey: row.source_key,
    snapshotBefore: row.snapshot_before,
    snapshotAfter: row.snapshot_after,
    detectedAt: isoOf(row.detected_at) ?? '',
    dedupeKey: row.dedupe_key,
    impact: row.impact,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by,
    reviewedAt: isoOf(row.reviewed_at),
    reviewNote: row.review_note,
    releasedVersion: row.released_version,
  }
}

const CHANGE_COLUMNS = `change_id, source_key, snapshot_before, snapshot_after, detected_at,
  dedupe_key, impact, review_status, reviewed_by, reviewed_at, review_note, released_version`

/** 검수 큐 → §12.2. 사람의 판단만 적습니다 — 반영은 파일과 적재기의 몫입니다 */
export function createChangeStore(sql: Sql): ChangeStore {
  return {
    async listByStatus(status) {
      const rows = await sql<ChangeRow[]>`
        SELECT ${sql.unsafe(CHANGE_COLUMNS)} FROM source_change
        WHERE review_status = ${status}
        ORDER BY detected_at, source_key
      `
      return rows.map(changeOf)
    },

    async findById(changeId) {
      const rows = await sql<ChangeRow[]>`
        SELECT ${sql.unsafe(CHANGE_COLUMNS)} FROM source_change WHERE change_id = ${changeId}
      `
      return rows[0] ? changeOf(rows[0]) : null
    },

    async applyDecision(input) {
      await sql`
        UPDATE source_change SET
          review_status = ${input.status},
          reviewed_by   = ${input.reviewedBy},
          reviewed_at   = ${input.reviewedAt},
          review_note   = ${input.note}
        WHERE change_id = ${input.changeId}
      `
    },

    async markReleased(changeId, kbVersion) {
      await sql`
        UPDATE source_change SET released_version = ${kbVersion} WHERE change_id = ${changeId}
      `
    },
  }
}

/** 검수 명령이 원문을 보여줄 때 씁니다 — 모듈 포트가 아니라 조립 층의 도우미입니다 */
export interface SnapshotView {
  readonly snapshotId: string
  readonly sourceKey: string
  readonly content: string
  readonly meta: Readonly<Record<string, unknown>>
}

export function createSnapshotReader(sql: Sql): {
  byIds(ids: readonly string[]): Promise<readonly SnapshotView[]>
} {
  return {
    async byIds(ids) {
      if (ids.length === 0) return []
      const rows = await sql<
        { snapshot_id: string; source_key: string; content: string; meta: Record<string, unknown> }[]
      >`
        SELECT snapshot_id, source_key, content, meta FROM source_snapshot
        WHERE snapshot_id IN ${sql([...ids])}
      `
      return rows.map((one) => ({
        snapshotId: one.snapshot_id,
        sourceKey: one.source_key,
        content: one.content,
        meta: one.meta,
      }))
    },
  }
}
