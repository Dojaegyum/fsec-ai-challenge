/**
 * 검수 큐 흐름 — API §7 · ADR-088. 라우트 다섯이 여기 함수 다섯을 부릅니다.
 *
 * **`kb_entry` 에 쓰는 자리가 없습니다.** 반영은 파일을 고쳐 릴리스하는 것입니다(RFC-002).
 * 닿는 매뉴얼은 읽을 때 규칙으로 계산합니다(§7.4) — `impact` 에 저장하지 않습니다.
 */
import 'server-only'
import type { Container } from '@/lib/container'
import { KbChangeNotFoundError } from '@/lib/errors'
import type { KbRow } from '@/modules/kb-finder'
import { linkEntries, parseSourceKey, sourceLabelOf } from '@/modules/kb-reviewer'
import type { ChangeGroup, ReviewStatus, SourceChange } from '@/modules/kb-reviewer'

export type DecisionStatus = Exclude<ReviewStatus, 'pending'>

export interface ChangeView {
  readonly change_id: string
  readonly source_key: string
  readonly source: { readonly prefix: string; readonly label: string }
  readonly article: string | null
  readonly title: string | null
  readonly first_seen: boolean
  readonly detected_at: string
  readonly meta: Readonly<Record<string, unknown>>
  readonly affected: readonly string[]
  readonly review_status: ReviewStatus
}
export interface ReviewView {
  readonly status: ReviewStatus
  readonly by: string | null
  readonly at: string | null
  readonly note: string | null
  readonly released_version: string | null
}
export interface QueueBody {
  readonly kb_version: string | null
  readonly counts: { readonly pending: number; readonly deferred: number }
  readonly groups: readonly { readonly dedupe_key: string | null; readonly changes: readonly ChangeView[] }[]
}
export interface EntryView {
  readonly kb_entry_id: string
  readonly title: string
  readonly file: string
  readonly track: KbRow['track']
  readonly channel_id: string | null
  readonly org_id: string | null
  readonly legal_basis: string
  readonly effective_from: string
  readonly verified_at: string
  readonly pending_changes: readonly string[]
}
export interface SnapshotView {
  readonly snapshot_id: string
  readonly content: string
  readonly meta: Readonly<Record<string, unknown>>
}
export interface ChangeBody {
  readonly change: ChangeView
  readonly before: SnapshotView | null
  readonly after: SnapshotView | null
  readonly affected: readonly Omit<EntryView, 'pending_changes'>[]
  readonly review: ReviewView
}
export interface DecisionBody {
  readonly change_id: string
  readonly review_status: ReviewStatus
  readonly reviewed_at: string | null
}
export interface EntriesBody {
  readonly kb_version: string | null
  readonly entries: readonly EntryView[]
}
export interface HistoryBody {
  readonly changes: readonly (ChangeView & { readonly review: ReviewView })[]
}

const HISTORY_LIMIT = 200

/** RFC-002 의 파일 규약을 뒤집어 계산합니다 — 저장된 칼럼이 아닙니다 (§7.3) */
export function fileOf(row: Pick<KbRow, 'track' | 'channelId'>): string {
  if (row.track === 'frozen_account') return 'frozen-account.json'
  if (row.channelId) return `${row.channelId.toLowerCase()}.json`
  return 'common.json'
}

async function entriesOf(container: Container): Promise<{ kbVersion: string | null; rows: readonly KbRow[] }> {
  const kbVersion = container.env.values.KB_VERSION ?? null
  if (!kbVersion) return { kbVersion: null, rows: [] }
  return { kbVersion, rows: await container.ports.kbStore.listEntries(kbVersion) }
}

function affectedOf(sourceKey: string, rows: readonly KbRow[]): readonly string[] {
  return linkEntries(sourceKey, rows)
}

function reviewOf(one: SourceChange): ReviewView {
  return {
    status: one.reviewStatus,
    by: one.reviewedBy,
    at: one.reviewedAt,
    note: one.reviewNote,
    released_version: one.releasedVersion,
  }
}

async function viewsOf(
  container: Container,
  changes: readonly SourceChange[],
  rows: readonly KbRow[],
): Promise<readonly ChangeView[]> {
  if (changes.length === 0) return []
  const snaps = await container.kbSnapshots.byIds(changes.map((one) => one.snapshotAfter))
  const metaOf = new Map(snaps.map((one) => [one.snapshotId, one.meta]))
  return changes.map((one) => {
    const parsed = parseSourceKey(one.sourceKey)
    const meta = metaOf.get(one.snapshotAfter) ?? {}
    const title = typeof meta['조문제목'] === 'string' ? (meta['조문제목'] as string) : null
    return {
      change_id: one.changeId,
      source_key: one.sourceKey,
      source: {
        prefix: parsed ? `law:${parsed.lawId}` : one.sourceKey.split(':').slice(0, 2).join(':'),
        label: sourceLabelOf(one.sourceKey),
      },
      article: parsed?.article ?? null,
      title,
      first_seen: one.snapshotBefore === null,
      detected_at: one.detectedAt,
      meta,
      affected: affectedOf(one.sourceKey, rows),
      review_status: one.reviewStatus,
    }
  })
}

export async function readQueue(container: Container, status: 'pending' | 'deferred'): Promise<QueueBody> {
  const { kbVersion, rows } = await entriesOf(container)
  const [pending, deferred] = await Promise.all([
    container.kbChanges.listByStatus('pending'),
    container.kbChanges.listByStatus('deferred'),
  ])
  // pending 은 kbReviewer.queue() 의 묶음을 그대로, deferred 는 낱개로 — 미룬 것은 큐가 아닙니다(ADR-044)
  const groups: readonly ChangeGroup[] =
    status === 'pending'
      ? await container.kbReviewer.queue()
      : deferred.map((one) => ({ dedupeKey: one.dedupeKey, changes: [one], confidence: null, affectedEntries: [] }))
  // 스냅샷 조회는 묶음마다가 아니라 한 번 — 최초 수집 58건은 묶음이 58개라 왕복이 58번이었습니다
  const views = await viewsOf(container, groups.flatMap((group) => group.changes), rows)
  const viewOf = new Map(views.map((view) => [view.change_id, view]))
  const made = groups.map((group) => ({
    dedupe_key: group.dedupeKey,
    changes: group.changes.map((one) => viewOf.get(one.changeId)!),
  }))
  return { kb_version: kbVersion, counts: { pending: pending.length, deferred: deferred.length }, groups: made }
}

export async function readChange(container: Container, changeId: string): Promise<ChangeBody> {
  const found = await container.kbChanges.findById(changeId)
  if (!found) throw new KbChangeNotFoundError('그 변경을 찾지 못했습니다', { changeId })
  const { rows } = await entriesOf(container)
  const ids = [found.snapshotAfter, ...(found.snapshotBefore ? [found.snapshotBefore] : [])]
  const snaps = await container.kbSnapshots.byIds(ids)
  const snap = (id: string | null): SnapshotView | null => {
    const hit = id ? snaps.find((one) => one.snapshotId === id) : undefined
    return hit ? { snapshot_id: hit.snapshotId, content: hit.content, meta: hit.meta } : null
  }
  const [view] = await viewsOf(container, [found], rows)
  const affectedIds = new Set(view!.affected)
  return {
    change: view!,
    before: snap(found.snapshotBefore),
    after: snap(found.snapshotAfter),
    affected: rows.filter((row) => affectedIds.has(row.kbEntryId)).map((row) => entryViewOf(row)),
    review: reviewOf(found),
  }
}

export async function decide(
  container: Container,
  changeId: string,
  input: { status: DecisionStatus; reviewedBy: string; note: string | null },
): Promise<DecisionBody> {
  await container.kbReviewer.review({
    changeId,
    status: input.status,
    reviewedBy: input.reviewedBy,
    ...(input.note ? { note: input.note } : {}),
  })
  const after = await container.kbChanges.findById(changeId)
  if (!after) throw new KbChangeNotFoundError('그 변경을 찾지 못했습니다', { changeId })
  return { change_id: changeId, review_status: after.reviewStatus, reviewed_at: after.reviewedAt }
}

function entryViewOf(row: KbRow): Omit<EntryView, 'pending_changes'> {
  return {
    kb_entry_id: row.kbEntryId,
    title: row.title,
    file: fileOf(row),
    track: row.track,
    channel_id: row.channelId,
    org_id: row.orgId,
    legal_basis: row.legalBasis,
    effective_from: row.effectiveFrom,
    verified_at: row.verifiedAt,
  }
}

export async function readEntries(container: Container): Promise<EntriesBody> {
  const { kbVersion, rows } = await entriesOf(container)
  const pending = await container.kbChanges.listByStatus('pending')
  const touching = new Map<string, string[]>()
  for (const one of pending) {
    for (const id of affectedOf(one.sourceKey, rows)) {
      const list = touching.get(id) ?? []
      list.push(one.changeId)
      touching.set(id, list)
    }
  }
  return {
    kb_version: kbVersion,
    entries: rows.map((row) => ({ ...entryViewOf(row), pending_changes: touching.get(row.kbEntryId) ?? [] })),
  }
}

export async function readHistory(container: Container): Promise<HistoryBody> {
  const { rows } = await entriesOf(container)
  const [approved, rejected, deferred] = await Promise.all([
    container.kbChanges.listByStatus('approved'),
    container.kbChanges.listByStatus('rejected'),
    container.kbChanges.listByStatus('deferred'),
  ])
  const all = [...approved, ...rejected, ...deferred]
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
    .slice(0, HISTORY_LIMIT)
  const views = await viewsOf(container, all, rows)
  return { changes: views.map((view, i) => ({ ...view, review: reviewOf(all[i]!) })) }
}
