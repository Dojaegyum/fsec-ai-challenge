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
  EvidenceKind,
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
/**
 * 이미 만든 연결을 접속 문자열마다 하나씩 들고 있습니다.
 *
 * **부르는 자리가 여럿이라 필요합니다** — 포트 셋과 링크 토큰 조회가 각각
 * 부르는데, 그때마다 새로 만들면 요청 하나가 연결을 넷 쥡니다. 연결 모으는
 * 곳이 먼저 막히는 것이 그런 식입니다.
 *
 * 모듈 범위에 두는 것이 서버 함수에서 맞습니다 — 같은 인스턴스가 다음 요청을
 * 받으면 연결을 다시 안 엽니다.
 */
const pool = new Map<string, Sql>()

export function createSql(env: Env): Sql | null {
  const url = env.values.DATABASE_URL
  if (!url) return null

  const existing = pool.get(url)
  if (existing) return existing

  const made = postgres(url, {
    // pooler 가 준비된 구문(prepared statement)을 지원하지 않습니다
    prepare: false,
    // 함수 하나가 연결을 여럿 쥐면 동시 요청이 늘 때 pooler 가 먼저 막힙니다
    max: 1,
    idle_timeout: 20,
    connect_timeout: 10,
    // ⚠️ **쿼리 내용을 로그로 내보내지 않습니다.** 사건 데이터가 지나갑니다
    onnotice: () => {},
  })

  pool.set(url, made)
  return made
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

/**
 * 증거 한 건의 갈래와 경로 → 09-data-model.md §3.
 *
 * `CaseStore` 에 넣지 않은 이유는 **모듈이 요구한 것이 아니기 때문**입니다.
 * `case-intake` 는 쓰기만 하고, 이 조회는 **라우트가 「무엇을 읽어야 하나」를
 * 알려고** 부릅니다. 모듈 인터페이스에 없는 것을 끼워 넣으면 그 모듈이
 * 안 쓰는 메서드를 들고 있게 됩니다 → `caseTokenResolver` 와 같은 판단.
 */
export interface EvidenceReader {
  read(
    caseId: string,
    evidenceId: string,
  ): Promise<{
    readonly kind: EvidenceKind
    readonly objectKey: string
    readonly mimeType: string
    readonly ingestStatus: IngestStatus
    /** 다 읽었으면 **토큰화된 결과**. 아직이면 `null` */
    readonly transcriptMasked: string | null
  } | null>
}

/**
 * 읽은 결과를 적는다 → 09-data-model.md §3.
 *
 * ## ⚠️ 토큰화를 통과한 것만 넣습니다
 *
 * 정본이 *"`transcript_masked` 에 `pii-tokenizer` 를 통과한 문자열만 저장합니다.
 * 전사·OCR 원문을 저장하지 않습니다"* 로 못 박았습니다.
 *
 * ## 왜 저장해야 하나 — 세 가지가 걸립니다
 *
 * 1. **챗이 전사를 못 봅니다.** `caseTalk` 이 이 칸에서 옵니다
 * 2. **폴링할 때마다 다시 토큰화됩니다.** 그러면 같은 계좌번호에 매번 다른
 *    번호가 붙어, 브라우저가 들고 있는 매핑과 어긋나 **복원이 깨집니다**
 * 3. **`ingest_status` 가 `done` 에 영영 못 갑니다** — 화면이 계속 물어봅니다
 */
export interface EvidenceWriter {
  /** 다 읽었다. **토큰화된 것만** */
  finish(input: {
    readonly caseId: string
    readonly evidenceId: string
    readonly transcriptMasked: string
  }): Promise<void>

  /** 못 읽었다. **오류가 아니라 상태입니다** → 불변 규칙 5 */
  fail(input: {
    readonly caseId: string
    readonly evidenceId: string
    readonly reason: string
  }): Promise<void>
}

export function createEvidenceWriter(sql: Sql): EvidenceWriter {
  return {
    async finish(input) {
      // **`done` 이 아닐 때만 씁니다.** 폴링이 겹쳐 들어오면 같은 값을 두 번
      // 쓰게 되는데, 그 사이 사용자가 확인 화면에서 고친 것을 덮을 수 있습니다
      await sql`
        UPDATE evidence
        SET transcript_masked = ${input.transcriptMasked},
            ingest_status = 'done',
            ingest_error = NULL
        WHERE case_id = ${input.caseId} AND evidence_id = ${input.evidenceId}
          AND ingest_status <> 'done'
      `
    },

    async fail(input) {
      await sql`
        UPDATE evidence
        SET ingest_status = 'failed',
            ingest_error = ${input.reason.slice(0, 255)}
        WHERE case_id = ${input.caseId} AND evidence_id = ${input.evidenceId}
          AND ingest_status <> 'done'
      `
    },
  }
}

export function createEvidenceReader(sql: Sql): EvidenceReader {
  return {
    async read(caseId, evidenceId) {
      // **`case_id` 를 함께 봅니다.** 증거 번호만으로 찾으면 남의 사건 증거를
      // 자기 주소로 열 수 있습니다 — 증거 번호는 비밀이 아닙니다
      const rows = await sql<
        {
          kind: EvidenceKind
          object_key: string | null
          mime_type: string | null
          ingest_status: IngestStatus
          transcript_masked: string | null
        }[]
      >`
        SELECT kind, object_key, mime_type, ingest_status, transcript_masked
        FROM evidence WHERE case_id = ${caseId} AND evidence_id = ${evidenceId}
      `
      const row = rows[0]
      if (!row) return null

      return {
        kind: row.kind,
        objectKey: row.object_key ?? '',
        mimeType: row.mime_type ?? '',
        ingestStatus: row.ingest_status,
        transcriptMasked: row.transcript_masked,
      }
    },
  }
}

/**
 * 슬롯을 **값까지** 읽는다 → 계약 §3.4.
 *
 * `CasePlanStore.readSlots` 와 나눈 이유는 **요구가 다르기 때문**입니다.
 * 플랜을 만드는 데는 상태와 티어면 충분하고, 그래서 그쪽 인터페이스가
 * 그렇게 정의됐습니다. 화면은 값도 보여줘야 합니다.
 *
 * ⚠️ **`value_masked` 는 토큰화된 값입니다.** 서버에는 복호화 키가 없어
 * 원문을 만들 수 없고, 만들어서도 안 됩니다 → 04-pii-boundary.md 규칙 3.
 */
export interface SlotReader {
  read(caseId: string): Promise<readonly SlotView[]>
}

export interface SlotView {
  readonly slotKey: string
  readonly tier: string
  readonly state: string
  /** **토큰화된 값.** 복원은 브라우저가 합니다 */
  readonly valueMasked: string | null
  readonly valueType: string | null
  readonly confidence: number | null
  /** 어느 증거에서 나왔나 → 09-data-model.md §5 */
  readonly sourceRef: string | null
}

export function createSlotReader(sql: Sql): SlotReader {
  return {
    async read(caseId) {
      const rows = await sql<
        {
          slot_key: string
          tier: string
          state: string
          value_masked: string | null
          value_type: string | null
          confidence: string | number | null
          source_ref: string | null
        }[]
      >`
        SELECT slot_key, tier, state, value_masked, value_type, confidence, source_ref
        FROM case_slot WHERE case_id = ${caseId} ORDER BY tier, slot_key
      `
      return rows.map((one) => ({
        slotKey: one.slot_key,
        tier: one.tier,
        state: one.state,
        valueMasked: one.value_masked,
        valueType: one.value_type,
        // NUMERIC 은 드라이버가 문자열로 줍니다. 그대로 내보내면 화면이
        // `"0.91" > 0.9` 를 문자열로 비교합니다
        confidence: one.confidence === null ? null : Number(one.confidence),
        sourceRef: one.source_ref,
      }))
    },
  }
}

/**
 * 계산해 둔 기한을 읽는다 → 계약 §3.7.
 *
 * **제목이 `deadline` 표에 없습니다.** 딸린 단계(`plan_step.title`)에서
 * 가져옵니다 — 기한은 언제나 어떤 단계의 기한이고, 제목을 복사해 두면
 * 단계 제목이 바뀔 때 둘이 어긋납니다.
 *
 * **`on_miss` · `note` 는 계산 근거 안에 있습니다** (`rule_snapshot`).
 * 계산 시점의 KB 항목 전체를 그 안에 담아 두기 때문에(§8.2), KB 가 개정돼도
 * 「그때 무엇을 근거로 이 날짜가 나왔나」가 남습니다.
 */
export interface DeadlineReader {
  read(caseId: string): Promise<readonly DeadlineView[]>
}

export interface DeadlineView {
  readonly deadlineId: string
  readonly stepId: string | null
  readonly title: string
  readonly kind: string
  readonly dueAt: string
  readonly status: string
  readonly computedFrom: string | null
  /** 넘겼을 때 무슨 일이 생기나. 없으면 `null` */
  readonly onMiss: string | null
  /** 사용자가 할 일이 없는 기한(`kind: info`)에 붙습니다 */
  readonly note: string | null
}

export function createDeadlineReader(sql: Sql): DeadlineReader {
  return {
    async read(caseId) {
      const rows = await sql<
        {
          deadline_id: string
          plan_step_id: string | null
          kind: string
          due_at: Date
          status: string
          computed_from: string | null
          rule_snapshot: Record<string, unknown> | null
          title: string | null
        }[]
      >`
        SELECT d.deadline_id, d.plan_step_id, d.kind, d.due_at, d.status,
               d.computed_from, d.rule_snapshot, s.title
        FROM deadline d
        LEFT JOIN plan_step s ON s.plan_step_id = d.plan_step_id
        WHERE d.case_id = ${caseId}
        ORDER BY d.due_at
      `
      return rows.map((one) => {
        const snap = one.rule_snapshot ?? {}
        return {
          deadlineId: one.deadline_id,
          stepId: one.plan_step_id,
          // 단계가 지워졌으면 제목이 없습니다. 빈 문자열보다 그렇다고 말합니다
          title: one.title ?? '(단계를 찾지 못했습니다)',
          kind: one.kind,
          dueAt: one.due_at.toISOString(),
          status: one.status,
          computedFrom: one.computed_from,
          onMiss: typeof snap.on_miss === 'string' ? snap.on_miss : null,
          note: typeof snap.note === 'string' ? snap.note : null,
        }
      })
    },
  }
}

/**
 * 사건 자체의 값 → 계약 §3.10.
 *
 * `CasePlanStore.readCase` 는 갈래만 돌려줍니다 — 플랜을 만드는 데 그것만
 * 필요해서입니다. 재방문 화면은 **언제 만들었나 · 마지막 활동이 언제인가 ·
 * 언제 지워지나**도 보여줘야 합니다.
 */
export interface CaseReader {
  read(caseId: string): Promise<{
    readonly track: string
    readonly status: string
    readonly createdAt: string
    readonly lastActivityAt: string
    readonly purgeAfter: string
  } | null>
}

export function createCaseReader(sql: Sql): CaseReader {
  return {
    async read(caseId) {
      const rows = await sql<
        {
          track: string
          status: string
          created_at: Date
          updated_at: Date
          purge_after: Date
        }[]
      >`
        SELECT track, status, created_at, updated_at, purge_after
        FROM "case" WHERE case_id = ${caseId}
      `
      const row = rows[0]
      if (!row) return null

      return {
        track: row.track,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        // **`updated_at` 이 마지막 활동입니다.** 파기일을 미는 것도 이 값을
        // 함께 올립니다 → `touchPurgeAfter`
        lastActivityAt: row.updated_at.toISOString(),
        // 날짜입니다. 시각을 붙이면 「언제 지워지나」가 시간대에 따라 하루 어긋납니다
        purgeAfter: row.purge_after.toISOString().slice(0, 10),
      }
    },
  }
}

/**
 * 슬롯 하나를 쓴다 → 계약 §3.5.
 *
 * ## ⚠️ 여기 오는 값은 이미 토큰화돼 있어야 합니다
 *
 * 칼럼 이름이 `value_masked` 인 것이 그 뜻입니다 → ADR-040. 원문을 넣으면
 * **저장소가 유출되는 순간 그대로 읽힙니다** — 볼트를 따로 둔 의미가
 * 없어집니다. 토큰화는 `flows/answer-slot.ts` 가 하고, 이 자리는 검사하지
 * 않습니다. 두 곳에서 막으면 어느 쪽이 진짜 경계인지 흐려집니다.
 */
export interface SlotWriter {
  write(input: {
    readonly caseId: string
    readonly slotKey: string
    readonly tier: string
    readonly state: string
    /** `case_slot.value_type` 의 다섯 중 하나 → 09-data-model.md §5.1 */
    readonly valueType: string
    /** **토큰화된 값.** 「모름」이면 `null` */
    readonly valueMasked: string | null
    readonly source: 'auto' | 'user' | 'system'
    readonly sourceRef?: string | null
    readonly confidence?: number | null
  }): Promise<void>
}

export function createSlotWriter(sql: Sql): SlotWriter {
  return {
    async write(input) {
      // 같은 슬롯에 다시 답하면 **갈아끼웁니다.** 사용자가 고칠 수 있어야 하고,
      // 이력은 감사 기록이 따로 남깁니다.
      //
      // **`case_slot_id` 를 넣지 않습니다** — 이 표만 `BIGINT GENERATED BY
      // DEFAULT AS IDENTITY` 입니다(09-data-model.md §5). 다른 표의 키가
      // 전부 `CHAR(26)` 이라 여기도 그런 줄 알고 발급기를 넘기면
      // `invalid input syntax for type bigint` 로 터집니다
      await sql`
        INSERT INTO case_slot
          (case_id, slot_key, tier, value_type, value_masked, state,
           source, source_ref, confidence)
        VALUES (${input.caseId}, ${input.slotKey}, ${input.tier}, ${input.valueType},
                ${input.valueMasked}, ${input.state}, ${input.source},
                ${input.sourceRef ?? null}, ${input.confidence ?? null})
        ON CONFLICT (case_id, slot_key) DO UPDATE SET
          tier = EXCLUDED.tier,
          value_type = EXCLUDED.value_type,
          value_masked = EXCLUDED.value_masked,
          state = EXCLUDED.state,
          source = EXCLUDED.source,
          source_ref = EXCLUDED.source_ref,
          confidence = EXCLUDED.confidence,
          updated_at = now()
      `
    },
  }
}

/**
 * 단계의 부산물을 적는다 → 계약 §3.8 · 08-14-completion-hook.md.
 *
 * **완료는 사용자의 체크가 아니라 부산물로 판정합니다** → CLAUDE.md 불변
 * 규칙 6. 이 표에 줄이 생기는 것이 「했다」의 근거입니다.
 *
 * ⚠️ **`value_masked` 는 토큰화된 값입니다.** 접수번호에 개인정보가 섞여
 * 들어올 수 있습니다 → ADR-040.
 */
export interface ArtifactWriter {
  write(input: {
    readonly artifactId: string
    readonly caseId: string
    readonly planStepId: string
    readonly kind: string
    /** **토큰화된 값.** 파일로 올린 것이면 `null` */
    readonly valueMasked: string | null
    readonly objectKey: string | null
    readonly verifyLevel: string
    readonly verifyResult: string
    readonly verifyDetail: Readonly<Record<string, unknown>> | null
  }): Promise<void>

  /** 단계의 상태를 옮긴다 — 부산물이 붙으면 완료로 판정됩니다 */
  markStep(caseId: string, planStepId: string, state: string): Promise<boolean>
}

export function createArtifactWriter(sql: Sql): ArtifactWriter {
  return {
    async write(input) {
      await sql`
        INSERT INTO artifact
          (artifact_id, plan_step_id, case_id, kind, value_masked, object_key,
           verify_level, verify_result, verify_detail)
        VALUES (${input.artifactId}, ${input.planStepId}, ${input.caseId},
                ${input.kind}, ${input.valueMasked}, ${input.objectKey},
                ${input.verifyLevel}, ${input.verifyResult},
                ${input.verifyDetail === null ? null : sql.json(input.verifyDetail as never)})
      `
    },

    async markStep(caseId, planStepId, state) {
      // **사건과 함께 찾습니다.** 단계 번호만으로 옮기면 남의 사건 단계를
      // 자기 주소로 완료 처리할 수 있습니다
      const rows = await sql<{ plan_step_id: string }[]>`
        UPDATE plan_step
        SET state = ${state},
            done_at = CASE WHEN ${state} = 'done_verified' THEN now() ELSE done_at END,
            updated_at = now()
        WHERE case_id = ${caseId} AND plan_step_id = ${planStepId}
        RETURNING plan_step_id
      `
      return rows.length > 0
    },
  }
}

/**
 * 챗 기록을 읽고 쓴다 → 계약 §3.9 · 11-chat-context.md.
 *
 * ## ⚠️ 여기 있는 것은 전부 토큰화된 상태여야 합니다
 *
 * 칼럼 이름이 `content_masked` · `prompt_masked` · `reasoning_masked` 인
 * 것이 그 뜻입니다. **`caseTalk` 은 매 턴 모델에 다시 갑니다** — 원문이
 * 한 번 들어가면 그 뒤로 계속 나갑니다.
 */
export interface MessageStore {
  write(input: {
    readonly messageId: string
    readonly caseId: string
    readonly turnNo: number
    readonly role: string
    readonly contentMasked: string
    readonly promptMasked: string
    readonly reasoningMasked: string | null
    readonly citations: readonly unknown[]
    readonly kbContextRefs: readonly unknown[]
    readonly insufficient: boolean
    /** 사용자 발화. 다음 턴의 맥락이 됩니다 */
    readonly utteranceMasked: string
  }): Promise<void>

  /** 앞선 대화 — 모델에 맥락으로 갑니다 */
  history(
    caseId: string,
  ): Promise<readonly { speaker: 'user' | 'assistant'; text: string }[]>

  /** 전사문 — **이미 토큰화된 것만** */
  transcript(caseId: string): Promise<readonly { speaker: string; text: string }[]>
}

/** 맥락에 넣을 앞 대화의 최대 턴 수 */
const HISTORY_TURNS = 20

export function createMessageStore(sql: Sql, newId: () => string): MessageStore {
  return {
    async write(input) {
      // 사용자 발화와 답을 **두 줄로** 남깁니다. 한 줄에 합치면 다음 턴에
      // 맥락으로 되돌릴 때 누가 말한 것인지가 사라집니다
      await sql`
        INSERT INTO message
          (message_id, case_id, turn_no, role, content_masked, citations,
           kb_context_refs, insufficient, prompt_masked, reasoning_masked)
        VALUES
          (${newId()}, ${input.caseId}, ${input.turnNo}, 'user',
           ${input.utteranceMasked}, ${sql.json([] as never)},
           ${sql.json([] as never)}, false, '', NULL),
          (${input.messageId}, ${input.caseId}, ${input.turnNo}, ${input.role},
           ${input.contentMasked}, ${sql.json(input.citations as never)},
           ${sql.json(input.kbContextRefs as never)}, ${input.insufficient},
           ${input.promptMasked}, ${input.reasoningMasked})
      `
    },

    async history(caseId) {
      // 최근 것부터 잘라 온 뒤 되돌립니다 — 오래된 것을 버려야 하는데
      // 모델에는 시간순으로 줘야 합니다
      const rows = await sql<{ role: string; content_masked: string }[]>`
        SELECT role, content_masked FROM message
        WHERE case_id = ${caseId}
        ORDER BY turn_no DESC, created_at DESC
        LIMIT ${HISTORY_TURNS * 2}
      `
      return rows
        .reverse()
        .map((one) => ({
          speaker: one.role === 'user' ? ('user' as const) : ('assistant' as const),
          text: one.content_masked,
        }))
    },

    async transcript(caseId) {
      // ⚠️ **`transcript_masked` 입니다.** 이름이 「토큰화된 것」이라는 뜻이고,
      // 이 값이 매 턴 모델에 갑니다
      const rows = await sql<{ transcript_masked: string | null }[]>`
        SELECT transcript_masked FROM evidence
        WHERE case_id = ${caseId} AND transcript_masked IS NOT NULL
        ORDER BY created_at
      `
      // 저장된 것은 구조입니다 → `flows/read-evidence.ts` 의 `finish`.
      // 칸이 `TEXT` 하나라 담아 넣었고, 여기서 풀어 줄 단위로 되돌립니다
      const out: { speaker: string; text: string }[] = []
      for (const row of rows) {
        const raw = row.transcript_masked
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw) as {
            lines?: readonly { speaker: string | null; text: string }[]
          }
          for (const line of parsed.lines ?? []) {
            if (line.text) out.push({ speaker: line.speaker ?? '?', text: line.text })
          }
        } catch {
          // 옛 형식이거나 깨졌으면 통째로 한 줄로 넣습니다 —
          // **버리지 않습니다.** 맥락이 사라지면 챗이 사건을 모릅니다
          out.push({ speaker: '?', text: raw })
        }
      }
      return out
    },
  }
}
