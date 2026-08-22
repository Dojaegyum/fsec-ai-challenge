/**
 * 관계형 저장소에 붙는 자리 — 모듈이 선언한 포트를 실제 SQL 로 채웁니다.
 *
 * 정본: spec/backend/08-16-data-model.md (표·칼럼) ·
 *       spec/common/08-14-api.md §1.2 (`DATABASE_URL`)
 * 근거: ADR-016(Supabase Postgres · 서울) · ADR-028(자원 접근 구현은 `src/lib/`) ·
 *       ADR-039(링크 토큰을 `case_id` 와 분리)
 *
 * ## ORM 을 안 쓰는 이유
 *
 * 스키마의 정본은 `src/migrations/*.sql` 입니다. ORM 을 들이면 같은 DDL 이
 * 두 곳에 생기고, 어긋났을 때 어느 쪽이 맞는지 알 수 없게 됩니다
 * → `docs/plans/08-20-api-routes.md` 「DB 드라이버」.
 *
 * ## 연결을 왜 이렇게 잡나
 *
 * 서버 함수는 요청마다 뜨고 사라집니다. 연결을 많이 열면 Postgres 쪽이 먼저
 * 무너지므로, **연결 모으는 곳(pooler)에 붙고 함수당 하나만** 씁니다.
 * `prepare: false` 는 그 pooler 가 준비된 구문을 지원하지 않기 때문입니다.
 */

import 'server-only'

import postgres from 'postgres'

import type { Env } from './env'

import type { AuditRecord, AuditStore } from '@/modules/audit-logger'
import type {
  CaseStore,
  EvidenceRow,
  EvidenceTotals,
  IngestStatus,
  OpenedCase,
} from '@/modules/case-intake'
import type { KbQuery, KbRow, KbStore } from '@/modules/kb-finder'

export type Sql = ReturnType<typeof postgres>

/**
 * 연결을 만든다. **접속 정보가 없으면 `null`** — 조립이 성공해야 하기 때문입니다.
 *
 * 자원 하나가 없다고 서버가 안 뜨면 붙어 있는 것도 못 씁니다 → `container.ts`.
 */
export function createSql(env: Env): Sql | null {
  const url = env.values.DATABASE_URL
  if (!url) return null

  return postgres(url, {
    // pooler 가 준비된 구문(prepared statement)을 지원하지 않습니다
    prepare: false,
    // 함수 하나가 연결을 여럿 쥐면 동시 요청이 늘 때 pooler 가 먼저 막힙니다
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // ⚠️ **쿼리 내용을 로그로 내보내지 않습니다.** 사건 데이터가 지나갑니다
    onnotice: () => {},
  })
}

/**
 * 주소에 실린 링크 토큰을 내부 사건 식별자로 바꾼다.
 *
 * **이 조회가 신분 확인입니다.** 둘은 규격이 같아서(둘 다 26자 Crockford Base32)
 * 형식 검사로는 못 가릅니다 → ADR-039 · `lib/ids.ts` 의 `isTokenShaped`.
 *
 * 못 찾으면 `null` 입니다. 부르는 쪽이 404 로 바꿉니다 — 여기서 던지면
 * 「없는 사건」과 「저장소 장애」가 같은 모양이 됩니다.
 */
export interface CaseTokenResolver {
  toCaseId(linkToken: string): Promise<string | null>
}

export function createCaseTokenResolver(sql: Sql): CaseTokenResolver {
  return {
    async toCaseId(linkToken: string): Promise<string | null> {
      const rows = await sql<{ case_id: string }[]>`
        SELECT case_id FROM "case" WHERE link_token = ${linkToken}
      `
      return rows[0]?.case_id ?? null
    },
  }
}

/**
 * 사건과 증거를 다루는 자리 → `case-intake`.
 *
 * `createCase` 가 링크 토큰을 함께 넣습니다. 칸이 `NOT NULL` 이라 빠뜨리면
 * 삽입이 실패하고, **토큰 없이 만들어진 사건은 영영 열 수 없습니다**
 * (0002 마이그레이션의 경고와 같은 이유).
 */
export function createCaseStore(sql: Sql): CaseStore {
  return {
    async createCase(row: OpenedCase): Promise<void> {
      await sql`
        INSERT INTO "case" (case_id, link_token, track, status, opened_at, purge_after)
        VALUES (${row.caseId}, ${row.linkToken}, ${row.track}, ${row.status},
                ${row.openedAt}, ${row.purgeAfter})
      `
    },

    async evidenceTotals(caseId: string): Promise<EvidenceTotals> {
      // COALESCE 로 감싸는 이유: 한 건도 없으면 SUM 이 NULL 을 냅니다.
      // 그대로 두면 상한 검사가 NaN 과 비교하게 되고 **언제나 통과합니다**
      const rows = await sql<{ count: number; bytes: number }[]>`
        SELECT COUNT(*)::int AS count, COALESCE(SUM(byte_size), 0)::bigint AS bytes
        FROM evidence WHERE case_id = ${caseId}
      `
      const row = rows[0]
      return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) }
    },

    async addEvidence(row: EvidenceRow): Promise<void> {
      await sql`
        INSERT INTO evidence
          (evidence_id, case_id, kind, object_key, mime_type, byte_size, ingest_status)
        VALUES (${row.evidenceId}, ${row.caseId}, ${row.kind}, ${row.objectKey},
                ${row.mimeType}, ${row.byteSize}, ${row.ingestStatus})
      `
    },

    async markUploaded(caseId: string, evidenceId: string): Promise<IngestStatus> {
      // **`pending` 일 때만 옮깁니다.** 조건을 빼면 이미 끝난 전사를 되돌립니다 —
      // 같은 요청이 두 번 오는 것은 정상이고(재시도), 그때 상태가 뒷걸음치면 안 됩니다
      const rows = await sql<{ ingest_status: IngestStatus }[]>`
        UPDATE evidence SET ingest_status = 'processing'
        WHERE case_id = ${caseId} AND evidence_id = ${evidenceId}
          AND ingest_status = 'pending'
        RETURNING ingest_status
      `
      if (rows[0]) return rows[0].ingest_status

      // 안 바뀌었으면 지금 상태를 그대로 돌려줍니다
      const current = await sql<{ ingest_status: IngestStatus }[]>`
        SELECT ingest_status FROM evidence
        WHERE case_id = ${caseId} AND evidence_id = ${evidenceId}
      `
      if (!current[0]) throw new Error('증거를 찾지 못했습니다')
      return current[0].ingest_status
    },

    async touchPurgeAfter(caseId: string, purgeAfter: string): Promise<void> {
      // **앞으로만 밉니다.** GREATEST 를 빼면 늦게 도착한 요청이 파기일을
      // 당겨서, 아직 쓰는 사건이 먼저 지워질 수 있습니다
      await sql`
        UPDATE "case"
        SET purge_after = GREATEST(purge_after, ${purgeAfter}::date),
            updated_at = now()
        WHERE case_id = ${caseId}
      `
    },
  }
}

/**
 * 감사 기록 → `audit-logger`.
 *
 * **줄을 사슬로 잇습니다** — 각 줄이 앞줄의 hash 를 들고 있어, 중간을 지우면
 * 사슬이 끊어진 것이 보입니다.
 */
export function createAuditStore(sql: Sql): AuditStore {
  return {
    async lastHash(): Promise<string | null> {
      const rows = await sql<{ hash: string }[]>`
        SELECT hash FROM audit_log ORDER BY created_at DESC, audit_id DESC LIMIT 1
      `
      return rows[0]?.hash ?? null
    },

    async append(record: AuditRecord): Promise<void> {
      // ⚠️ **`created_at` 을 반드시 받은 값으로 넣습니다.** 칼럼에 `DEFAULT now()`
      // 가 있어서 빼도 삽입은 되지만, **그 순간 사슬이 통째로 깨집니다** —
      // 해시 재료 다섯 중 하나가 `created_at` 이라(§10.1 · `hashOf`), DB 가 찍은
      // 시각으로 덮이면 `verifyChain` 이 다시 계산한 값과 영영 안 맞습니다.
      // 터지지 않고 「위조됨」으로 보이는 종류라 더 나쁩니다
      await sql`
        INSERT INTO audit_log
          (audit_id, case_id, event_type, actor_type, detail,
           prev_hash, hash, created_at)
        VALUES (${record.auditId}, ${record.caseId ?? null}, ${record.eventType},
                ${record.actorType}, ${sql.json(record.detail as never)},
                ${record.prevHash ?? null}, ${record.hash}, ${record.createdAt})
      `
    },
  }
}

/**
 * 절차 지식 조회 → `kb-finder`.
 *
 * **버전을 못 박아 읽습니다.** 최신을 고르면 아직 사람이 검수하지 않은 다음
 * 릴리스가 피해자에게 나갈 수 있습니다 → ADR-045 · `pinnedKbVersion`.
 *
 * **시행일이 지난 것만 봅니다.** 제도가 바뀌는 서비스라 `effective_from` 이
 * 미래인 항목이 KB 에 먼저 들어옵니다(예: 가상자산 환급 2026.10 시행).
 */
export function createKbStore(sql: Sql): KbStore {
  const select = (query: KbQuery) => sql`
    SELECT kb_entry_id, kb_version, step_key, step_seq, channel_id, org_id,
           track, title, body, legal_basis, source_url,
           effective_from, effective_until, verified_at
    FROM kb_entry
    WHERE kb_version = ${query.kbVersion}
      AND track = ${query.track}
      AND effective_from <= CURRENT_DATE
      AND (effective_until IS NULL OR effective_until >= CURRENT_DATE)
  `

  const toRow = (one: Record<string, unknown>): KbRow => ({
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
    effectiveFrom: String(one.effective_from).slice(0, 10),
    effectiveUntil: one.effective_until ? String(one.effective_until).slice(0, 10) : null,
    // 사람이 마지막으로 근거를 확인한 날. 「언제 기준 정보인가」를 답에 붙입니다
    verifiedAt: String(one.verified_at).slice(0, 10),
  })

  return {
    async findApplied(query: KbQuery): Promise<readonly KbRow[]> {
      // 기관 전용 · 유형 기본 · 전 유형 공통을 한 번에.
      // 셋을 따로 부르면 왕복이 세 번이고, 서버 함수에서 그 값이 큽니다
      const rows = await sql<Record<string, unknown>[]>`
        ${select(query)}
        AND (
          (org_id = ${query.orgId ?? null} AND channel_id = ${query.channelId ?? null})
          OR (org_id IS NULL AND channel_id = ${query.channelId ?? null})
          OR (org_id IS NULL AND channel_id IS NULL)
        )
        ORDER BY step_seq
      `
      return rows.map(toRow)
    },

    async findReference(query: KbQuery): Promise<readonly KbRow[]> {
      // 다른 유형의 기본 항목만 — 「이 경우엔 이렇습니다」로 곁들이는 것입니다
      const rows = await sql<Record<string, unknown>[]>`
        ${select(query)}
        AND org_id IS NULL
        AND channel_id IS NOT NULL
        AND channel_id IS DISTINCT FROM ${query.channelId ?? null}
        ORDER BY channel_id, step_seq
      `
      return rows.map(toRow)
    },
  }
}
