/**
 * 선별기의 후보 풀 — 절차 전부 · 기관 연락처 · 법령 조문 원문을 한 번에 읽는다.
 *
 * 정본: spec/backend/08-16-chat-context.md §2.6 · 근거: ADR-089 ② ⑥
 * 근거: ADR-028(자원 접근 구현은 `src/lib/`)
 *
 * ## 한 턴에 한 번, 전부 읽습니다
 *
 * 절차 35개 · 기관 51곳 · 조문 58개 — 세 표를 세 번 읽고 끝입니다. 항목이 수백 개로
 * 늘어 무거워지면 트랙으로 먼저 자릅니다(ADR-089 「재검토 트리거」).
 *
 * ## 조문은 검수 여부를 보지 않습니다
 *
 * `source_type = 'law'` 의 **최신 스냅샷**입니다. 국가법령정보 API 에서 글자 그대로
 * 가져온 것이라 우리의 해석이 없고, `source_change` 의 승인 여부와 무관하게 후보에
 * 듭니다 → ADR-089 ⑥. 입법예고·보도자료는 넣지 않습니다.
 *
 * ## 후보 한 줄과 본문은 다릅니다
 *
 * 선별기에는 `[번호] 종류 · 이름: 앞 200자` 만 갑니다. 고른 뒤 프롬프트에 넣는 본문은
 * `src/lib/adapters.ts` 가 여기서 돌려준 행으로 만듭니다 — 절차는 다섯 줄, 기관은 연락처
 * 넷, 조문은 원문.
 */

import 'server-only'

import type { Sql } from './db'

import type { KbRow } from '@/modules/kb-finder'
import type { SelectorCandidate } from '@/modules/kb-selector'

/** 기관 한 곳 — `org` 표의 연락처가 있는 행만 */
export interface OrgContactRow {
  readonly orgId: string
  readonly channelId: string | null
  readonly name: string
  /** `org.contact` 그대로 — `report_tel` · `report_hours` · `submit[]` · `caution` */
  readonly contact: Readonly<Record<string, unknown>>
}

/** 조문 하나 — `source_snapshot` 의 `law` 최신본 */
export interface LawSnapshotRow {
  readonly snapshotId: string
  /** `law:{법령ID}:{조문번호}[:{가지번호}]` */
  readonly sourceKey: string
  /** `YYYY-MM-DD` */
  readonly fetchedAt: string
  readonly content: string
  readonly meta: Readonly<Record<string, unknown>>
}

export type PoolEntry =
  | { readonly kind: 'kb'; readonly row: KbRow }
  | { readonly kind: 'org'; readonly org: OrgContactRow }
  | { readonly kind: 'law'; readonly law: LawSnapshotRow }

export interface PoolSnapshot {
  readonly candidates: readonly SelectorCandidate[]
  /** 열쇠 → 본문. 고른 것의 본문을 여기서 꺼낸다 */
  readonly entries: ReadonlyMap<string, PoolEntry>
}

export interface SelectorPool {
  load(input: { kbVersion: string; asOf: string }): Promise<PoolSnapshot>
}

const PREVIEW_CHARS = 200

/**
 * `kb_entry` 한 행 → `KbRow`. `db.ts` 의 `createKbStore` 와 같은 변환입니다 — 그쪽은
 * 내부 함수라 여기 한 번 더 둡니다. 칸이 늘면 두 곳을 같이 고칩니다.
 */
function kbRowOf(one: Record<string, unknown>): KbRow {
  return {
    kbEntryId: String(one.kb_entry_id),
    kbVersion: String(one.kb_version),
    stepKey: String(one.step_key),
    stepSeq: Number(one.step_seq),
    channelId: (one.channel_id as string | null) ?? null,
    orgId: (one.org_id as string | null) ?? null,
    track: String(one.track) as KbRow['track'],
    title: String(one.title),
    body: one.body as KbRow['body'],
    legalBasis: String(one.legal_basis),
    sourceUrl: String(one.source_url),
    effectiveFrom: dateOnly(one.effective_from as Date | string),
    effectiveUntil: one.effective_until ? dateOnly(one.effective_until as Date | string) : null,
    verifiedAt: dateOnly(one.verified_at as Date | string),
  }
}

export const keyOf = {
  kb: (kbEntryId: string) => `kb:${kbEntryId}`,
  org: (orgId: string) => `org:${orgId}`,
  law: (sourceKey: string) => `law:${sourceKey}`,
} as const

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 절차 후보 한 줄 — 제목과 요약 앞부분 */
export function kbCandidateOf(row: KbRow): SelectorCandidate {
  const body = (row.body ?? {}) as { summary?: unknown }
  return {
    key: keyOf.kb(row.kbEntryId),
    kind: 'kb',
    tag: row.title,
    preview: text(body.summary).slice(0, PREVIEW_CHARS),
  }
}

/** 기관 후보 한 줄 — 신고 전화 · 운영 시간 · 제출 경로를 한 줄로 */
export function orgCandidateOf(org: OrgContactRow): SelectorCandidate {
  const parts = [
    text(org.contact.report_tel),
    text(org.contact.report_hours),
    ...(Array.isArray(org.contact.submit)
      ? org.contact.submit.map((one) => text((one as { text?: unknown } | null)?.text))
      : []),
  ].filter((one) => one.length > 0)
  return {
    key: keyOf.org(org.orgId),
    kind: 'org',
    tag: `${org.name} 연락처`,
    preview: parts.join(' · ').slice(0, PREVIEW_CHARS),
  }
}

/** 조문의 이름 — `법령명 제n조(제목)`. meta 가 비면 source_key 로 */
export function lawTagOf(law: LawSnapshotRow): string {
  const name = text(law.meta.법령명)
  const title = text(law.meta.조문제목)
  const matched = /^law:\d+:(\d+)(?::(\d+))?$/.exec(law.sourceKey)
  const article = matched
    ? `제${matched[1]}조${matched[2] ? `의${matched[2]}` : ''}`
    : law.sourceKey
  const head = name ? `${name} ${article}` : article
  return title ? `${head}(${title})` : head
}

export function lawCandidateOf(law: LawSnapshotRow): SelectorCandidate {
  return {
    key: keyOf.law(law.sourceKey),
    kind: 'law',
    tag: lawTagOf(law),
    preview: law.content.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS),
  }
}

export function createSelectorPool(sql: Sql): SelectorPool {
  return {
    async load(input) {
      const [kbRows, orgRows, lawRows] = await Promise.all([
        sql<Record<string, unknown>[]>`
          SELECT kb_entry_id, kb_version, step_key, step_seq, channel_id, org_id,
                 track, title, body, legal_basis, source_url,
                 effective_from, effective_until, verified_at
          FROM kb_entry
          WHERE kb_version = ${input.kbVersion}
            AND effective_from <= ${input.asOf}::date
            AND (effective_until IS NULL OR effective_until >= ${input.asOf}::date)
          ORDER BY track, channel_id NULLS FIRST, step_seq
        `,
        sql<{ org_id: string; channel_id: string | null; name: string; contact: Record<string, unknown> | null }[]>`
          SELECT org_id, channel_id, name, contact
          FROM org
          WHERE kb_version = ${input.kbVersion}
          ORDER BY channel_id, name
        `,
        // 조문마다 최신 한 판 — 같은 source_key 가 여러 날 쌓여 있어도 하나만
        sql<{ snapshot_id: string; source_key: string; fetched_at: Date | string; content: string; meta: Record<string, unknown> | null }[]>`
          SELECT DISTINCT ON (source_key) snapshot_id, source_key, fetched_at, content, meta
          FROM source_snapshot
          WHERE source_type = 'law'
          ORDER BY source_key, fetched_at DESC
        `,
      ])

      const entries = new Map<string, PoolEntry>()
      const candidates: SelectorCandidate[] = []

      for (const one of kbRows) {
        const row = kbRowOf(one)
        entries.set(keyOf.kb(row.kbEntryId), { kind: 'kb', row })
        candidates.push(kbCandidateOf(row))
      }
      for (const one of orgRows) {
        // 연락처가 하나도 없는 기관은 고를 이유가 없습니다
        if (!one.contact || Object.keys(one.contact).length === 0) continue
        const org: OrgContactRow = {
          orgId: one.org_id,
          channelId: one.channel_id ?? null,
          name: one.name,
          contact: one.contact,
        }
        entries.set(keyOf.org(org.orgId), { kind: 'org', org })
        candidates.push(orgCandidateOf(org))
      }
      for (const one of lawRows) {
        const law: LawSnapshotRow = {
          snapshotId: one.snapshot_id,
          sourceKey: one.source_key,
          fetchedAt: dateOnly(one.fetched_at),
          content: one.content,
          meta: one.meta ?? {},
        }
        entries.set(keyOf.law(law.sourceKey), { kind: 'law', law })
        candidates.push(lawCandidateOf(law))
      }

      return { candidates, entries }
    },
  }
}

function dateOnly(value: Date | string): string {
  const iso = value instanceof Date ? value.toISOString() : String(value)
  return iso.slice(0, 10)
}
