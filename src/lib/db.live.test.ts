/**
 * 저장소 어댑터가 **실제 Postgres 에서** 도는지.
 *
 * 검증 대상: spec/backend/08-16-data-model.md §2·§3·§9 ·
 *            decisions/039-link-token.md (링크 토큰 → `case_id` 조회)
 *
 * ## 왜 진짜 DB 에 붙나
 *
 * 여기서 틀리는 것은 타입이 아니라 **SQL 의 뜻**입니다 — `SUM` 이 NULL 을 내는지,
 * `GREATEST` 가 날짜를 어떻게 비교하는지, 조건부 `UPDATE` 가 몇 줄을 돌려주는지.
 * 가짜 저장소로는 하나도 안 걸립니다.
 *
 * **접속 정보가 없으면 통째로 건너뜁니다** — CI 에는 DB 가 없고, 그때 빨갛게
 * 뜨면 진짜 실패와 구분이 안 됩니다.
 *
 * ⚠️ **시험이 만든 행은 끝나고 지웁니다.** 실제 저장소입니다.
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createAuditStore, createCaseStore, createCaseTokenResolver, createSql } from './db'
import { createCasePlanStore } from './db-plan'
import { createAuditLogger, hashOf } from '@/modules/audit-logger'
import { readEnv } from './env'
import { linkTokenSource, ulidSource } from './ids'

const sql = createSql(readEnv())
const live = sql ? describe : describe.skip
afterAll(async () => { await sql?.end() })

live('실제 데이터베이스에 붙는다', () => {
  const caseId = ulidSource.next()
  const token = linkTokenSource.next()

  it('사건을 만들고 링크 토큰으로 되찾는다', async () => {
    const store = createCaseStore(sql!)
    await store.createCase({
      caseId, linkToken: token, track: 'victim', status: 'intake',
      openedAt: new Date().toISOString(), purgeAfter: '2027-01-01',
    })
    const resolver = createCaseTokenResolver(sql!)
    expect(await resolver.toCaseId(token)).toBe(caseId)
    // 없는 토큰은 null — 「없는 사건」과 「장애」를 가르기 위해
    expect(await resolver.toCaseId(linkTokenSource.next())).toBe(null)
  })

  it('증거를 더하고 합계를 센다', async () => {
    const store = createCaseStore(sql!)
    expect(await store.evidenceTotals(caseId)).toEqual({ count: 0, bytes: 0 })
    const evidenceId = ulidSource.next()
    await store.addEvidence({
      evidenceId, caseId, kind: 'audio', objectKey: `${caseId}/a.wav`,
      mimeType: 'audio/wav', byteSize: 1234, ingestStatus: 'pending',
    })
    expect(await store.evidenceTotals(caseId)).toEqual({ count: 1, bytes: 1234 })
    expect(await store.markUploaded(caseId, evidenceId)).toBe('processing')
    // 두 번 불러도 뒷걸음치지 않는다
    expect(await store.markUploaded(caseId, evidenceId)).toBe('processing')
  })

  it('파기일은 앞으로만 민다', async () => {
    const store = createCaseStore(sql!)
    await store.touchPurgeAfter(caseId, '2027-06-01')
    const a = await sql!`SELECT purge_after FROM "case" WHERE case_id = ${caseId}`
    await store.touchPurgeAfter(caseId, '2026-01-01')
    const b = await sql!`SELECT purge_after FROM "case" WHERE case_id = ${caseId}`
    expect(String(b[0].purge_after)).toBe(String(a[0].purge_after))
  })

  it('감사 기록이 사슬로 이어진다 — **다시 읽어 검증까지**', async () => {
    const store = createAuditStore(sql!)
    const first = ulidSource.next()
    // **앞줄을 읽는 것도 이 한 번에 들어 있습니다** — 잠금 안에서 읽습니다
    const written = await store.appendChained((prev) => ({
      auditId: first, caseId, eventType: 'case.opened', actorType: 'system',
      detail: { note: '시험', prev }, prevHash: prev, hash: 'H1'.padEnd(64, '0'),
      createdAt: new Date().toISOString(),
    }))
    expect(written.hash).toBe('H1'.padEnd(64, '0'))
    // 다음 줄이 방금 것을 앞줄로 봅니다
    const second = await store.appendChained((prev) => ({
      auditId: ulidSource.next(), caseId, eventType: 'case.opened', actorType: 'system',
      detail: { note: '시험2' }, prevHash: prev, hash: 'H2'.padEnd(64, '0'),
      createdAt: new Date().toISOString(),
    }))
    expect(second.prevHash).toBe('H1'.padEnd(64, '0'))
  })

  it('저장한 기록을 다시 읽어도 해시가 그대로다', async () => {
    // **이것이 `created_at` 을 받은 값으로 넣는 이유입니다.** 해시 재료 다섯 중
    // 하나가 그 값이라(§10.1 · `hashOf`), DB 기본값에 맡기면 저장할 때와 읽을
    // 때가 달라져 다시 계산한 해시가 안 맞습니다 — 터지지 않고 「위조됨」으로
    // 보이는 종류라 시험으로 박습니다
    const logger = createAuditLogger({
      store: createAuditStore(sql!),
      now: () => new Date().toISOString(),
      newId: () => ulidSource.next(),
    })
    const written = await logger.record({
      caseId,
      eventType: 'case.opened',
      actorType: 'system',
      detail: { note: '왕복 시험' },
    })

    const rows = await sql!`
      SELECT audit_id, event_type, detail, prev_hash, hash, created_at
      FROM audit_log WHERE audit_id = ${written.auditId}
    `
    expect(rows).toHaveLength(1)
    const read = rows[0]

    // 읽어온 값으로 다시 계산한 해시가 저장된 해시와 같아야 합니다
    const recomputed = hashOf({
      prevHash: (read.prev_hash as string | null) ?? null,
      auditId: String(read.audit_id),
      eventType: String(read.event_type),
      detail: read.detail as Record<string, unknown>,
      createdAt: (read.created_at as Date).toISOString(),
    })
    expect(recomputed).toBe(String(read.hash))
    expect(recomputed).toBe(written.hash)
  })

  /**
   * 지우지 않고 `skipped` 로 두는 이유가 **되살아나기 위해서**인데, 되살리는
   * 자리가 없었습니다 → §6.1.
   *
   * 대면편취의 지급정지가 실제로 이 길을 지납니다 — 경유 서비스가 정해지며
   * 한 번 꺼졌다가(그쪽은 `after: ["report-112"]`), 112 를 끝내면 「수사기관이
   * 계좌를 특정한 뒤」로 다시 켜져야 합니다. 안 켜지면 보드가 **「해당 없음」**
   * 으로 그립니다.
   *
   * **가짜 저장소로는 안 걸립니다** — `ON CONFLICT DO UPDATE SET` 이 `state` 를
   * 안 적던 것이라 SQL 의 뜻입니다.
   */
  const planned = (over: Record<string, unknown> = {}) => ({
    caseId,
    seq: 1,
    stepKey: 'live-resurrect',
    title: '지급정지를 요청합니다',
    actor: 'victim' as const,
    body: { actor: 'victim', action: 'call' } as never,
    conditional: null,
    state: 'not_started' as const,
    kbEntryId: 'live-kb',
    kbVersion: '0000.00.0',
    sourceUrl: 'https://example.invalid/',
    effectiveFrom: '2020-01-01',
    generatedAt: new Date().toISOString(),
    ...over,
  })

  const rowNow = async () => {
    const rows = await sql!`
      SELECT state, title FROM plan_step
      WHERE case_id = ${caseId} AND step_key = 'live-resurrect'
    `
    return { state: String(rows[0]?.state), title: String(rows[0]?.title) }
  }

  it('**건너뛴 단계가 다시 플랜에 들어오면 되살아난다** — §6.1', async () => {
    const store = createCasePlanStore(sql!, () => ulidSource.next())

    await store.applyPlan(caseId, { upsert: [planned()], preserved: [], skipped: [] })
    expect((await rowNow()).state).toBe('not_started')

    // 조건이 안 맞아 플랜에서 빠졌습니다
    await store.applyPlan(caseId, { upsert: [], preserved: [], skipped: ['live-resurrect'] })
    expect((await rowNow()).state).toBe('skipped')

    // 조건이 다시 맞았습니다 — **여기서 `skipped` 에 갇혀 있었습니다**
    await store.applyPlan(caseId, { upsert: [planned()], preserved: [], skipped: [] })
    expect((await rowNow()).state).toBe('not_started')
  })

  it('진행 중이던 단계는 재생성이 되돌리지 않는다 — SQL 쪽 그물은 그대로', async () => {
    await sql!`
      UPDATE plan_step SET state = 'in_progress'
      WHERE case_id = ${caseId} AND step_key = 'live-resurrect'
    `
    const store = createCasePlanStore(sql!, () => ulidSource.next())
    await store.applyPlan(caseId, {
      upsert: [planned({ title: '바뀐 제목' })],
      preserved: [],
      skipped: [],
    })

    // 내용은 갈리고 상태는 남습니다
    expect(await rowNow()).toEqual({ state: 'in_progress', title: '바뀐 제목' })
  })

  afterAll(async () => {
    // 시험이 남긴 것을 지웁니다 — 실제 저장소입니다
    await sql!`DELETE FROM plan_step WHERE case_id = ${caseId}`
    await sql!`DELETE FROM audit_log WHERE case_id = ${caseId}`
    await sql!`DELETE FROM evidence WHERE case_id = ${caseId}`
    await sql!`DELETE FROM "case" WHERE case_id = ${caseId}`
  })
})
