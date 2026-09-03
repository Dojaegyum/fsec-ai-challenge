/**
 * 실제 Postgres 에 붙어서 보는 시험 → QA 계획 Task 9 ⑥ ⓒ.
 *
 * ## 왜 따로 있나
 *
 * `schema-names` 게이트는 **이름만** 봅니다. 그 위 칸에 있는 것들 —
 * 정렬 순서, `ON CONFLICT` 가 실제로 갈아끼우는지, `GREATEST` 가 파기일을
 * 뒤로 못 당기게 하는지, `AND case_id =` 가 남의 사건을 막는지 — 는
 * **문장을 실제로 보내 봐야** 압니다.
 *
 * 2026-08-24 에 한 턴 안에서 사용자·비서 순서가 뒤집혀 있었습니다.
 * 시험 1047건이 전부 통과하는 상태였고, 이름은 다 맞았습니다.
 * **모델이 대화를 거꾸로 읽고 있었습니다.** 이 파일이 그것을 겨눕니다.
 *
 * ## 왜 `npm test` 에 안 들어가나
 *
 * 파일 이름이 `.dbtest.ts` 라 기본 include(`*.test.ts`)에 안 걸립니다.
 * 따로 돌립니다:
 *
 * ```
 * cd src && npm run test:db
 * ```
 *
 * 붙을 DB 가 없으면 **조용히 건너뜁니다**(실패가 아닙니다). 접속 문자열은
 * `DATABASE_URL` 환경변수 → 없으면 `src/.env.local` 순으로 찾습니다.
 *
 * ⚠️ **CI 에서 안 돕니다.** 풀러가 몰려서 터지는 구간이 있고(2026-08-24 실측:
 * 찬 연결 10개 중 4개가 `08006`), 그걸 PR 게이트에 넣으면 남의 인프라 사정으로
 * 빨간불이 켜집니다. 게이트가 랜덤하게 깨지면 사람이 게이트를 안 봅니다.
 * **손으로 돌리는 검사입니다** → rfc/001-repo-structure.md 「CI가 강제합니다」.
 *
 * ⚠️ **개발 DB 를 함께 씁니다.** 사건을 새로 만들어 그 안에서만 놀고 끝에
 * 지웁니다. 남의 행을 읽지도 고치지도 않습니다.
 */

import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  createCaseReader,
  createCaseStore,
  createCaseTokenResolver,
  createChannelWriter,
  createContactWriter,
  createDeadlineReader,
  createDeadlineWriter,
  createEvidenceReader,
  createEvidenceWriter,
  createKbStore,
  createMessageStore,
  createPurgeCaseStore,
  createSlotReader,
  createSlotWriter,
  createSql,
  createVaultMappings,
  createVaultStore,
} from './db'
import { createCasePlanStore } from './db-plan'
import { createReminderSource, createSentLog } from './db-reminder'
import { readEnv } from './env'
import { newLinkToken, newUlid } from './ids'

/** `.env.local` 을 아주 얇게 읽습니다 — 시험 하나 때문에 로더를 들이지 않습니다 */
function fromEnvLocal(key: string): string | undefined {
  try {
    const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at < 0 || line.trimStart().startsWith('#')) continue
      if (line.slice(0, at).trim() !== key) continue
      return line
        .slice(at + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  } catch {
    // 파일이 없으면 그냥 건너뜁니다 — 없는 것이 정상인 환경이 있습니다
  }
  return undefined
}

const URL_ = process.env.DATABASE_URL ?? fromEnvLocal('DATABASE_URL')

if (!URL_) {
  console.warn('DATABASE_URL 이 없어 DB 통합시험을 건너뜁니다 (실패가 아닙니다).')
}

describe.skipIf(!URL_)('실제 Postgres 에 붙어서', () => {
  const sql = createSql(readEnv({ DATABASE_URL: URL_ }))!

  const cases = createCaseStore(sql)
  const resolver = createCaseTokenResolver(sql)
  const reader = createCaseReader(sql)
  const messages = createMessageStore(sql, newUlid)
  const slots = createSlotWriter(sql)
  const slotReader = createSlotReader(sql)
  const evidenceWriter = createEvidenceWriter(sql)
  const evidenceReader = createEvidenceReader(sql)
  const vault = createVaultMappings(sql)
  const vaultStore = createVaultStore(sql)
  const kb = createKbStore(sql)
  const deadlines = createDeadlineReader(sql)
  const deadlineWriter = createDeadlineWriter(sql)
  const channelWriter = createChannelWriter(sql)
  const plans = createCasePlanStore(sql, newUlid)

  /** 이 시험만 쓰는 KB 릴리스. 실제 릴리스와 안 섞이게 이름을 따로 둡니다 */
  const KB_VERSION = 'dbtest.0'

  // 이 시험이 쓰는 사건 둘. `other` 는 **경계를 확인하는 쪽**입니다 —
  // 남의 사건 증거가 안 읽히는지, 빈 사건의 합계가 0 인지
  const caseId = newUlid()
  const linkToken = newLinkToken()
  const otherId = newUlid()
  const otherToken = newLinkToken()

  const OPENED_AT = '2026-08-24T10:00:00.000Z'
  const PURGE_AFTER = '2027-02-20'

  beforeAll(async () => {
    for (const [id, token] of [
      [caseId, linkToken],
      [otherId, otherToken],
    ] as const) {
      await cases.createCase({
        caseId: id,
        linkToken: token,
        track: 'victim',
        status: 'intake',
        openedAt: OPENED_AT,
        purgeAfter: PURGE_AFTER,
      })
    }
  })

  afterAll(async () => {
    // **볼트 먼저, 사건 나중** — 파기 순서가 그렇습니다 (ADR-016 · 0004 마이그레이션).
    // 사건을 먼저 지우면 외래키가 없어 볼트 줄만 남습니다
    for (const id of [caseId, otherId]) await vaultStore.delete(id)
    // 나머지(증거·슬롯·대화·단계·기한)는 `ON DELETE CASCADE` 로 따라 지워집니다
    await sql`DELETE FROM "case" WHERE case_id IN (${caseId}, ${otherId})`
    await sql`DELETE FROM kb_entry WHERE kb_version = ${KB_VERSION}`
    await sql.end({ timeout: 5 })
  })

  describe('링크 토큰이 신분 확인이다', () => {
    it('맡긴 토큰으로 사건을 찾는다', async () => {
      expect(await resolver.toCaseId(linkToken)).toBe(caseId)
    })

    it('없는 토큰은 `null` 이다 — 던지지 않는다', async () => {
      // 던지면 「없는 사건」과 「저장소 장애」가 같은 모양이 됩니다
      expect(await resolver.toCaseId(newLinkToken())).toBeNull()
    })

    it('`case_id` 를 토큰 자리에 넣어도 안 열린다', async () => {
      // 둘 다 26자 Crockford Base32 라 **형식으로는 못 가릅니다** → ADR-039
      expect(await resolver.toCaseId(caseId)).toBeNull()
    })
  })

  describe('사건을 다시 읽으면 넣은 값이 그대로다', () => {
    it('갈래·상태·파기일', async () => {
      const row = await reader.read(caseId)
      expect(row).not.toBeNull()
      expect(row?.track).toBe('victim')
      expect(row?.status).toBe('intake')
      // **날짜가 하루 어긋나면 안 됩니다.** `DATE` 를 시각으로 되돌리는 자리라
      // 시간대에 따라 앞뒤로 밀립니다 — 그게 「언제 지워지나」입니다
      expect(row?.purgeAfter).toBe(PURGE_AFTER)
    })

    it('없는 사건은 `null`', async () => {
      expect(await reader.read(newUlid())).toBeNull()
    })
  })

  describe('한 턴 안에서 사용자가 먼저다 — 2026-08-24 에 뒤집혀 있었다', () => {
    beforeAll(async () => {
      // 순번은 표가 셉니다 — `write` 가 더 이상 받지 않습니다(`db.ts` §9).
      // 세 번 부르면 1·2·3 이고, 그 순서를 아래 시험이 봅니다
      for (const turnNo of [1, 2, 3]) {
        await messages.write({
          messageId: newUlid(),
          caseId,
          role: 'assistant',
          contentMasked: `답 ${turnNo}`,
          promptMasked: `프롬프트 ${turnNo}`,
          reasoningMasked: `근거 ${turnNo}`,
          citations: [{ id: `kb-${turnNo}` }],
          kbContextRefs: [{ kb_entry_id: `kb-${turnNo}`, kb_version: '2026.07.9' }],
          insufficient: false,
          // 답이 가리킨 단계 → §9.4. 아래 시험이 비서 줄에서 되읽습니다
          referencedSteps: [`01JSTEP${turnNo}`],
          referencedDeadlines: [],
          utteranceMasked: `발화 ${turnNo}`,
        })
      }
    })

    it('화면용(`turns`)이 사용자 → 비서 순서로 낸다', async () => {
      const { turns } = await messages.turns(caseId, 10)
      expect(turns.map((one) => one.role)).toEqual([
        'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
      ])
      expect(turns.map((one) => one.contentMasked)).toEqual([
        '발화 1', '답 1', '발화 2', '답 2', '발화 3', '답 3',
      ])
    })

    it('맥락용(`history`)도 같다 — 여기가 뒤집히면 모델이 거꾸로 읽는다', async () => {
      const talk = await messages.history(caseId)
      expect(talk.map((one) => one.speaker)).toEqual([
        'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
      ])
      expect(talk[0]?.text).toBe('발화 1')
    })

    it('넘치면 **오래된 것부터** 버린다', async () => {
      const { turns, truncated } = await messages.turns(caseId, 2)
      expect(truncated).toBe(true)
      expect(turns).toHaveLength(2)
      // 최근 대화가 남아야 합니다 — 앞에서 자르면 화면이 옛날 것만 보여줍니다
      expect(turns.map((one) => one.contentMasked)).toEqual(['발화 3', '답 3'])
    })

    it('프롬프트와 판단 근거는 안 나온다', async () => {
      const { turns } = await messages.turns(caseId, 10)
      const flat = JSON.stringify(turns)
      // 사용자 응답에 넣지 않는 것들입니다 → ADR-022 · §5.4
      expect(flat).not.toContain('프롬프트')
      expect(flat).not.toContain('근거 1')
    })

    it('사용자 줄에는 근거가 안 붙는다', async () => {
      const { turns } = await messages.turns(caseId, 10)
      const user = turns.find((one) => one.role === 'user')
      expect(user?.citations).toEqual([])
    })

    it('비서 줄에 가리킨 단계가 **그대로** 되돌아온다 — §9.4 · ADR-065', async () => {
      // 새로고침 뒤에도 챗↔단계 연결이 남아야 합니다. `citations` 로는 되짚을 수
      // 없어 따로 남긴 값입니다 — 실제로 JSONB 를 지나 배열로 돌아오는지 봅니다
      const { turns } = await messages.turns(caseId, 10)
      const assistant = turns.filter((one) => one.role === 'assistant')
      expect(assistant.map((one) => one.referencedSteps)).toEqual([
        ['01JSTEP1'], ['01JSTEP2'], ['01JSTEP3'],
      ])
      expect(assistant.map((one) => one.referencedDeadlines)).toEqual([[], [], []])
    })

    it('사용자 줄은 빈 배열 — `NULL` 을 그대로 내리지 않는다', async () => {
      const { turns } = await messages.turns(caseId, 10)
      const user = turns.find((one) => one.role === 'user')
      expect(user?.referencedSteps).toEqual([])
      expect(user?.referencedDeadlines).toEqual([])
    })
  })

  describe('볼트 — 맡기고 되받고 덮어쓰고 지운다', () => {
    it('맡긴 것을 그대로 되받는다', async () => {
      const stored = await vault.put(caseId, [
        { token: '[계좌-1]', ciphertext: 'AAAA' },
        { token: '[전화-1]', ciphertext: 'BBBB' },
      ])
      expect(stored).toBe(2)

      const back = await vault.list(caseId)
      expect(back).toHaveLength(2)
      expect(Object.fromEntries(back.map((one) => [one.token, one.ciphertext]))).toEqual({
        '[계좌-1]': 'AAAA',
        '[전화-1]': 'BBBB',
      })
    })

    it('같은 토큰을 다시 맡기면 **늘지 않고 갈린다**', async () => {
      // AES-GCM 은 매번 다른 IV 를 쓰므로 같은 값이라도 암호문이 달라집니다 —
      // 다르다고 해서 다른 값이 아닙니다. 그래서 덮어쓰기입니다 (§3.11)
      await vault.put(caseId, [{ token: '[계좌-1]', ciphertext: 'CCCC' }])

      const back = await vault.list(caseId)
      expect(back).toHaveLength(2)
      expect(back.find((one) => one.token === '[계좌-1]')?.ciphertext).toBe('CCCC')
    })

    it('빈 목록은 왕복하지 않는다', async () => {
      expect(await vault.put(caseId, [])).toBe(0)
    })

    it('남의 사건 것은 안 보인다', async () => {
      expect(await vault.list(otherId)).toEqual([])
    })

    it('지운 뒤 **다시 봐서** 없는 것을 확인한다', async () => {
      // 지웠다고 믿지 않습니다 → ADR-016
      expect(await vaultStore.remains(caseId)).toBe(true)
      await vaultStore.delete(caseId)
      expect(await vaultStore.remains(caseId)).toBe(false)
    })
  })

  describe('슬롯은 같은 이름에 갈아끼운다', () => {
    it('두 번 답하면 한 줄이고 나중 값이 남는다', async () => {
      await slots.write({
        caseId,
        slotKey: 'transfer_amount',
        tier: 'T0',
        state: 'extracted',
        valueType: 'decimal',
        valueMasked: '1000000',
        source: 'auto',
        confidence: 0.7,
      })
      await slots.write({
        caseId,
        slotKey: 'transfer_amount',
        tier: 'T0',
        state: 'confirmed',
        valueType: 'decimal',
        valueMasked: '2500000',
        source: 'user',
        confidence: 1,
      })

      const rows = await slotReader.read(caseId)
      const one = rows.filter((row) => row.slotKey === 'transfer_amount')
      expect(one).toHaveLength(1)
      expect(one[0]?.state).toBe('confirmed')
      expect(one[0]?.valueMasked).toBe('2500000')
      // NUMERIC 은 드라이버가 문자열로 줍니다 — 화면이 `"0.91" > 0.9` 를
      // 문자열로 비교하면 안 됩니다
      expect(one[0]?.confidence).toBe(1)
      expect(typeof one[0]?.confidence).toBe('number')
    })

    it('「모름」은 값이 `null` 인 줄로 남는다 — 없는 것과 다르다', async () => {
      await slots.write({
        caseId,
        slotKey: 'victim_bank',
        tier: 'T1',
        state: 'unknown',
        valueType: 'string',
        valueMasked: null,
        source: 'user',
      })

      const row = (await slotReader.read(caseId)).find((one) => one.slotKey === 'victim_bank')
      expect(row?.state).toBe('unknown')
      expect(row?.valueMasked).toBeNull()
    })

    it('0003 이 더한 `pii_pending` 이 실제로 들어간다', async () => {
      // `CHECK` 제약이라 마이그레이션이 안 돌았으면 **여기서 터집니다**
      await slots.write({
        caseId,
        slotKey: 'victim_account',
        tier: 'T1',
        state: 'pii_pending',
        valueType: 'string',
        valueMasked: '[계좌-1]',
        source: 'auto',
      })

      const row = (await slotReader.read(caseId)).find((one) => one.slotKey === 'victim_account')
      expect(row?.state).toBe('pii_pending')
    })
  })

  describe('증거 상태는 뒷걸음치지 않는다', () => {
    const evidenceId = newUlid()

    it('올렸다고 두 번 알려도 같은 자리에 있다', async () => {
      await cases.addEvidence({
        evidenceId,
        caseId,
        kind: 'audio',
        objectKey: `case/${caseId}/${evidenceId}.m4a`,
        mimeType: 'audio/mp4',
        byteSize: 1234,
        ingestStatus: 'pending',
      })

      expect(await cases.markUploaded(caseId, evidenceId)).toBe('processing')
      // 같은 요청이 두 번 오는 것은 정상입니다(재시도). 그때 뒷걸음치면 안 됩니다
      expect(await cases.markUploaded(caseId, evidenceId)).toBe('processing')
    })

    it('다 읽은 뒤에는 되돌지 않는다', async () => {
      await evidenceWriter.finish({
        caseId,
        evidenceId,
        transcriptMasked: JSON.stringify({ lines: [{ speaker: '상대', text: '[계좌-1] 로' }] }),
      })
      expect((await evidenceReader.read(caseId, evidenceId))?.ingestStatus).toBe('done')

      // 늦게 도착한 알림이 끝난 전사를 되돌리면 화면이 다시 기다립니다
      expect(await cases.markUploaded(caseId, evidenceId)).toBe('done')
      expect((await evidenceReader.read(caseId, evidenceId))?.ingestStatus).toBe('done')
    })

    it('실패도 상태다 — 「모름」은 실패가 아니다', async () => {
      const failed = newUlid()
      await cases.addEvidence({
        evidenceId: failed,
        caseId,
        kind: 'image',
        objectKey: `case/${caseId}/${failed}.png`,
        mimeType: 'image/png',
        byteSize: 10,
        ingestStatus: 'pending',
      })
      await evidenceWriter.fail({ caseId, evidenceId: failed, reason: '읽을 수 없는 파일' })

      expect((await evidenceReader.read(caseId, failed))?.ingestStatus).toBe('failed')
    })

    it('**남의 사건 번호로는 안 열린다** — 증거 번호는 비밀이 아니다', async () => {
      expect(await evidenceReader.read(otherId, evidenceId)).toBeNull()
    })

    it('전사문은 **토큰화된 것만** 나온다', async () => {
      const lines = await messages.transcript(caseId)
      expect(lines.length).toBeGreaterThan(0)
      expect(lines[0]?.text).toContain('[계좌-1]')
    })
  })

  describe('KB 조회 — **2026-08-24 에 이것이 통째로 죽어 있었습니다**', () => {
    // 조각을 다른 질의에 끼워 넣고 있었는데(`${select(q)}`), 재시도 Proxy 가
    // 그 조각을 보통 Promise 로 바꿔 **매개변수로 실려** 나갔습니다 —
    // `syntax error at or near "$1"`. 사건 생성이 전부 503 이었고,
    // 타입 검사도 시험 1110건도 못 잡았습니다. **질의를 실제로 보내야 보입니다.**
    const seed = (over: Record<string, unknown>) => ({
      kb_entry_id: `dbtest-${String(over.step_key ?? 'x')}`,
      kb_version: KB_VERSION,
      step_key: 'x',
      step_seq: 10,
      channel_id: null,
      org_id: null,
      track: 'victim',
      title: '무언가',
      legal_basis: '어느 조문',
      source_url: 'https://www.law.go.kr/',
      effective_from: '2016-07-28',
      effective_until: null,
      verified_at: '2026-08-24',
      ...over,
    })

    beforeAll(async () => {
      const rows = [
        seed({ step_key: 'common', step_seq: 10 }),
        seed({ step_key: 'bank', step_seq: 20, channel_id: 'CH-bank' }),
        seed({ step_key: 'crypto', step_seq: 30, channel_id: 'CH-crypto' }),
        // 아직 시행 전 — 오늘 조회에는 안 나와야 합니다
        seed({ step_key: 'future', step_seq: 40, effective_from: '2099-01-01' }),
        // 이미 닫힌 항목
        seed({ step_key: 'closed', step_seq: 50, effective_until: '2020-01-01' }),
      ]
      for (const row of rows) {
        await sql`
          INSERT INTO kb_entry
            (kb_entry_id, kb_version, step_key, step_seq, channel_id, org_id, track,
             title, body, legal_basis, source_url, effective_from, effective_until,
             verified_at, released_at)
          VALUES
            (${row.kb_entry_id}, ${row.kb_version}, ${row.step_key}, ${row.step_seq},
             ${row.channel_id}, ${row.org_id}, ${row.track}, ${row.title},
             ${sql.json({ steps: [] } as never)}, ${row.legal_basis}, ${row.source_url},
             ${row.effective_from}, ${row.effective_until}, ${row.verified_at}, now())
          ON CONFLICT (kb_entry_id, kb_version) DO NOTHING
        `
      }
    })

    it('유형 기본과 전 유형 공통을 한 번에 가져온다', async () => {
      const rows = await kb.findApplied({
        kbVersion: KB_VERSION,
        track: 'victim',
        channelId: 'CH-bank',
        orgId: null,
        asOf: '2026-08-24',
      })
      expect(rows.map((r) => r.stepKey)).toEqual(['common', 'bank'])
    })

    it('**시행 전 항목은 안 나온다** — 제도가 바뀌는 서비스라 미래 항목이 먼저 들어옵니다', async () => {
      const rows = await kb.findApplied({
        kbVersion: KB_VERSION,
        track: 'victim',
        channelId: null,
        orgId: null,
        asOf: '2026-08-24',
      })
      expect(rows.map((r) => r.stepKey)).not.toContain('future')
    })

    it('닫힌 항목도 안 나온다', async () => {
      const rows = await kb.findApplied({
        kbVersion: KB_VERSION,
        track: 'victim',
        channelId: null,
        orgId: null,
        asOf: '2026-08-24',
      })
      expect(rows.map((r) => r.stepKey)).not.toContain('closed')
    })

    it('버전을 못 박아 읽는다 — 다른 버전은 안 섞인다 (ADR-045)', async () => {
      const rows = await kb.findApplied({
        kbVersion: 'dbtest.없는버전',
        track: 'victim',
        channelId: null,
        orgId: null,
        asOf: '2026-08-24',
      })
      expect(rows).toEqual([])
    })

    it('곁들이는 항목은 **다른 유형**만 낸다', async () => {
      const rows = await kb.findReference({
        kbVersion: KB_VERSION,
        track: 'victim',
        channelId: 'CH-bank',
        orgId: null,
        asOf: '2026-08-24',
      })
      // 내 유형(CH-bank)도, 전 유형 공통(channel_id NULL)도 아닌 것만
      expect(rows.map((r) => r.stepKey)).toEqual(['crypto'])
    })

    it('날짜가 하루 어긋나지 않는다', async () => {
      const rows = await kb.findApplied({
        kbVersion: KB_VERSION,
        track: 'victim',
        channelId: null,
        orgId: null,
        asOf: '2026-08-24',
      })
      expect(rows[0]?.effectiveFrom).toBe('2016-07-28')
      expect(rows[0]?.verifiedAt).toBe('2026-08-24')
    })
  })

  describe('기한 — 계산 근거에서 꺼내 오는 값들', () => {
    // 읽는 쪽만 보는 시험이라 손으로 심습니다. 쓰는 쪽은 아래 묶음이 봅니다.
    //
    // **단계 번호를 매번 새로 뽑습니다** — 0005 의 열쇠가
    // `(case_id, plan_step_id, kind)` 라, 같은 자리에 두 줄을 심으면 거부됩니다.
    // 그게 이 열쇠가 하려는 일입니다
    const seed = async (over: Record<string, unknown>) => {
      const row = {
        deadline_id: newUlid(),
        plan_step_id: newUlid(),
        kind: 'primary',
        due_at: '2026-08-20T23:59:59+09:00',
        computed_from: 'relief_applied_at',
        snapshot: {},
        ...over,
      }
      await sql`
        INSERT INTO deadline
          (deadline_id, case_id, plan_step_id, kind, due_at, computed_from,
           computed_at, rule_snapshot, kb_version, status)
        VALUES
          (${row.deadline_id as string}, ${caseId}, ${row.plan_step_id as string},
           ${row.kind as string},
           ${row.due_at as string}, ${row.computed_from as string}, now(),
           ${sql.json(row.snapshot as never)}, ${'dbtest.0'}, 'open')
      `
      return row.deadline_id as string
    }

    it('`starts_at`·`condition` 이 `rule_snapshot` 에서 나온다', async () => {
      const id = await seed({
        kind: 'info',
        due_at: '2026-10-20T23:59:59+09:00',
        snapshot: {
          starts_at: '2026-08-20T00:00:00+09:00',
          note: '금융감독원이 진행합니다. 사용자가 할 일은 없습니다',
        },
      })
      const graceId = await seed({
        kind: 'grace',
        due_at: '2026-09-03T23:59:59+09:00',
        snapshot: { condition: '3영업일을 넘겼을 때 주어지는 기간입니다' },
      })

      const rows = await deadlines.read(caseId)
      const info = rows.find((r) => r.deadlineId === id)
      const grace = rows.find((r) => r.deadlineId === graceId)

      expect(info?.startsAt).toBe('2026-08-20T00:00:00+09:00')
      expect(info?.note).toContain('금융감독원')
      expect(grace?.condition).toContain('3영업일')
      // 없는 것은 `null` — 빈 문자열로 채우면 화면이 빈 칸을 그립니다
      expect(info?.condition).toBeNull()
      expect(grace?.startsAt).toBeNull()
    })

    it('**`due_at` 이 서울 표기로 나온다** — `Z` 로 찍으면 자정 근처가 하루 앞으로', async () => {
      // 공고 시작 `00:00+09:00` 은 UTC 로 전날 15:00 입니다.
      // `toISOString()` 을 쓰면 화면의 달력 앵커가 하루 당겨집니다
      await seed({ kind: 'info', due_at: '2026-10-20T00:30:00+09:00', snapshot: {} })

      const rows = await deadlines.read(caseId)
      for (const row of rows) {
        expect(row.dueAt).toContain('+09:00')
        expect(row.dueAt).not.toContain('Z')
      }
      const midnight = rows.find((r) => r.dueAt.startsWith('2026-10-20T00:30'))
      expect(midnight).toBeDefined()
    })

    it('기한이 없는 사건은 빈 목록', async () => {
      expect(await deadlines.read(otherId)).toEqual([])
    })
  })

  /**
   * 쓰는 쪽 — **여기가 2026-08-25 까지 통째로 없던 자리입니다.**
   *
   * `otherId` 를 씁니다. 위 묶음이 `caseId` 에 손으로 심어 둔 줄들이 있어서,
   * 「목록이 곧 전부」인 `apply` 가 그것들까지 내려 버립니다.
   */
  describe('기한을 적는다 — 다시 계산해도 줄이 안 는다', () => {
    const stepA = newUlid()
    const stepB = newUlid()

    const row = (over: Record<string, unknown> = {}) => ({
      deadlineId: newUlid(),
      planStepId: stepA,
      kind: 'primary',
      dueAt: '2026-08-20T23:59:59+09:00',
      computedFrom: 'relief_applied_at',
      ruleSnapshot: { kb_entry_id: 'common-relief-documents', estimated: false },
      kbVersion: KB_VERSION,
      ...over,
    })

    it('처음 적으면 새로 생긴 것으로 나온다 — 옮겨지기 전 날짜가 없다', async () => {
      const changes = await deadlineWriter.apply(otherId, [row()])
      expect(changes).toHaveLength(1)
      expect(changes[0]?.changedFrom).toBeNull()
      expect(await deadlines.read(otherId)).toHaveLength(1)
    })

    it('**같은 값을 다시 적어도 줄이 안 늘고, 바뀐 것도 없다**', async () => {
      const changes = await deadlineWriter.apply(otherId, [row()])
      expect(changes).toEqual([])
      expect(await deadlines.read(otherId)).toHaveLength(1)
    })

    it('날짜가 옮겨지면 옮겨지기 전 날짜를 함께 낸다 — §3.5', async () => {
      const changes = await deadlineWriter.apply(otherId, [
        row({ dueAt: '2026-08-21T23:59:59+09:00' }),
      ])
      expect(changes).toHaveLength(1)
      // 표에서 읽어 온 값이라 밀리초가 붙습니다 — 칼럼이 `TIMESTAMPTZ(3)` 입니다.
      // **글자로 견주면 매번 바뀐 것이 됩니다** → createDeadlineWriter 의 경고
      expect(changes[0]?.changedFrom).toBe('2026-08-20T23:59:59.000+09:00')
      expect(changes[0]?.dueAt).toBe('2026-08-21T23:59:59+09:00')
    })

    it('식별자를 지킨다 — 다시 계산할 때마다 번호가 바뀌면 새 기한으로 보인다', async () => {
      const before = (await deadlines.read(otherId))[0]!.deadlineId
      await deadlineWriter.apply(otherId, [row({ dueAt: '2026-08-24T23:59:59+09:00' })])
      expect((await deadlines.read(otherId))[0]?.deadlineId).toBe(before)
    })

    it('한 단계에 본 기한과 유예가 나란히 선다 — §8.1', async () => {
      await deadlineWriter.apply(otherId, [
        row({ dueAt: '2026-08-20T23:59:59+09:00' }),
        row({ kind: 'grace', dueAt: '2026-09-03T23:59:59+09:00' }),
      ])
      const rows = await deadlines.read(otherId)
      expect(rows.map((one) => one.kind)).toEqual(['primary', 'grace'])
    })

    it('목록에서 빠진 기한은 내려간다 — 근거가 사라진 것이다', async () => {
      await deadlineWriter.apply(otherId, [row({ dueAt: '2026-08-20T23:59:59+09:00' })])
      const rows = await deadlines.read(otherId)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.kind).toBe('primary')
    })

    it('내렸던 자리에 새 기한이 다시 들어간다 — 부분 열쇠가 막지 않는다', async () => {
      await deadlineWriter.apply(otherId, [
        row({ dueAt: '2026-08-20T23:59:59+09:00' }),
        row({ kind: 'grace', dueAt: '2026-09-03T23:59:59+09:00' }),
      ])
      expect(await deadlines.read(otherId)).toHaveLength(2)
    })

    it('지난 기한은 `missed` 로 옮긴다 — 화면이 알아챌 신호가 그것뿐이다', async () => {
      await deadlineWriter.apply(otherId, [
        row({ planStepId: stepB, dueAt: '2020-01-01T23:59:59+09:00' }),
      ])
      const moved = await deadlineWriter.sweepOverdue(otherId, '2026-08-25T10:00:00+09:00')
      expect(moved).toBe(1)

      const rows = await deadlines.read(otherId)
      expect(rows.find((one) => one.stepId === stepB)?.status).toBe('missed')
    })

    it('두 번 쓸어도 다시 안 센다 — `open` 인 것만 옮깁니다', async () => {
      expect(await deadlineWriter.sweepOverdue(otherId, '2026-08-25T10:00:00+09:00')).toBe(0)
    })

    it('지난 기한의 기산점이 뒤로 밀리면 다시 `open` 이다', async () => {
      await deadlineWriter.apply(otherId, [
        row({ planStepId: stepB, dueAt: '2027-01-01T23:59:59+09:00' }),
      ])
      const rows = await deadlines.read(otherId)
      expect(rows.find((one) => one.stepId === stepB)?.status).toBe('open')
    })

    it('빈 목록을 주면 전부 내려간다 — 기산 슬롯을 지웠을 때가 그 경우다', async () => {
      expect(await deadlineWriter.apply(otherId, [])).toEqual([])
      expect(await deadlines.read(otherId)).toEqual([])
    })
  })

  describe('경유 서비스 — 쌓인 줄이 화면이 읽을 목록으로 접힌다', () => {
    beforeEach(async () => {
      await sql`DELETE FROM case_channel WHERE case_id = ${caseId}`
    })

    it('금액과 확신도가 **숫자**로 온다 — 드라이버는 `NUMERIC` 을 문자열로 줍니다', async () => {
      // 문자열로 새어 나가면 화면이 `"3000000"` 을 받습니다. 눈으로는 멀쩡해
      // 보이고 합계를 낼 때 `"3000000500000"` 이 됩니다
      await channelWriter.write({
        caseId,
        channelId: 'CH-bank',
        orgId: 'kb-bank',
        orgNameRaw: '국민은행',
        source: 'auto',
        confidence: 0.94,
      })
      await sql`
        UPDATE case_channel SET amount = 3000000 WHERE case_id = ${caseId}
      `

      const rows = await plans.readChannels(caseId)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.amount).toBe(3_000_000)
      expect(rows[0]!.confidence).toBe(0.94)
    })

    it('유형만 답한 줄은 기관이 붙은 줄에 흡수된다 — 문진을 순서대로 답하면 늘 생깁니다', async () => {
      // 실제 순서 그대로입니다: 「시중은행 계좌이체」 뒤에 「국민은행이요」.
      // 둘 다 문진 답이라 확신도가 같고, 그때 갈리는 것은 적힌 시각뿐입니다
      await channelWriter.write({
        caseId,
        channelId: 'CH-bank',
        orgId: null,
        orgNameRaw: null,
        source: 'user',
      })
      await channelWriter.write({
        caseId,
        channelId: 'CH-bank',
        orgId: 'kb-bank',
        orgNameRaw: '국민은행',
        source: 'user',
      })

      const rows = await plans.readChannels(caseId)
      expect(rows).toEqual([
        {
          channelId: 'CH-bank',
          orgId: 'kb-bank',
          orgNameRaw: '국민은행',
          amount: null,
          confidence: 1,
        },
      ])
    })

    it('유형이 다르면 두 줄로 남는다 — 계좌이체 뒤 상품권을 산 사건이 있습니다', async () => {
      await channelWriter.write({
        caseId,
        channelId: 'CH-bank',
        orgId: 'kb-bank',
        orgNameRaw: '국민은행',
        source: 'user',
      })
      await channelWriter.write({
        caseId,
        channelId: 'CH-giftcard',
        orgId: null,
        orgNameRaw: null,
        source: 'user',
      })

      const rows = await plans.readChannels(caseId)
      expect(rows.map((one) => one.channelId).sort()).toEqual(['CH-bank', 'CH-giftcard'])
    })

    it('한 줄도 없으면 빈 배열이다 — 유형을 아직 안 물은 사건이 정상입니다', async () => {
      expect(await plans.readChannels(otherId)).toEqual([])
    })
  })

  describe('합계와 파기일 — 코드가 아니라 SQL 이 정하는 것들', () => {
    it('증거가 없으면 0 이다 — `NULL` 이 아니다', async () => {
      // `SUM` 은 한 건도 없으면 `NULL` 을 냅니다. 그대로 두면 상한 검사가
      // `NaN` 과 비교하게 되고 **언제나 통과합니다**
      const totals = await cases.evidenceTotals(otherId)
      expect(totals).toEqual({ count: 0, bytes: 0 })
      expect(Number.isFinite(totals.bytes)).toBe(true)
    })

    it('올린 만큼 센다', async () => {
      const totals = await cases.evidenceTotals(caseId)
      expect(totals.count).toBe(2)
      expect(totals.bytes).toBe(1244)
    })

    it('파기일은 **앞으로만** 민다', async () => {
      // 늦게 도착한 요청이 파기일을 당기면 아직 쓰는 사건이 먼저 지워집니다
      await cases.touchPurgeAfter(caseId, '2026-01-01')
      expect((await reader.read(caseId))?.purgeAfter).toBe(PURGE_AFTER)

      await cases.touchPurgeAfter(caseId, '2027-06-30')
      expect((await reader.read(caseId))?.purgeAfter).toBe('2027-06-30')
    })

    it('파기일을 밀면 마지막 활동 시각도 올라간다', async () => {
      // 재방문 화면이 「마지막 활동이 언제인가」를 이 값으로 보여줍니다
      const row = await reader.read(caseId)
      expect(new Date(row!.lastActivityAt).getTime()).toBeGreaterThan(
        new Date(row!.createdAt).getTime(),
      )
    })
  })

  describe('알림용 이메일 — 넣고 되읽고 지운다 (§2 notify_email · §3.13)', () => {
    const contacts = createContactWriter(sql)
    const source = createReminderSource(sql)

    /**
     * ⚠️ **`linkToken` 이 세 번째 칸으로 늘었는데 이 시험 셋이 안 따라왔습니다**
     * (2026-09-03 에 발견). 알림 메일이 「돌아오는 길」을 실어야 해서 붙은 값인데
     * (`db-reminder.ts` 의 주석), 시험이 두 칸만 기대해 `npm run test:db` 가
     * **세 건 빨간불**이었습니다. 빨간불을 두면 진짜 회귀를 아무도 안 봅니다.
     */
    it('넣은 값이 그대로 되읽힌다 — 형식 검사 없이 (ADR-021)', async () => {
      await contacts.saveNotifyEmail(caseId, 'name@example.com')

      const found = await source.findContacts([caseId])
      expect(found).toEqual([{ caseId, email: 'name@example.com', linkToken }])
    })

    it('안 준 사건은 null 로 온다 — 없는 것도 정상 사건입니다', async () => {
      const found = await source.findContacts([otherId])
      expect(found).toEqual([{ caseId: otherId, email: null, linkToken: otherToken }])
    })

    it('null 이면 지워진다', async () => {
      await contacts.saveNotifyEmail(caseId, null)

      const found = await source.findContacts([caseId])
      expect(found).toEqual([{ caseId, email: null, linkToken }])
    })
  })

  /**
   * 파기 — **`purge_after` 가 지난 사건을 집고, 지우고, 지워졌는지 확인한다.**
   *
   * ⚠️ **2026-09-03 까지 이 포트가 미설정 대역이었습니다.** `case-purger` 모듈도
   * 조립도 다 서 있는데 관계형 DB 쪽 셋만 없어서, 파기를 부르면 그 자리에서
   * 터졌습니다. 그래서 「마지막 활동일부터 180일 뒤 파기」(§14 · ADR-016)를
   * 코드가 한 번도 지킨 적이 없습니다.
   *
   * **여기만 실제로 행을 지웁니다.** 위 시험들이 쓰는 사건 둘을 건드리지 않도록
   * 이 절 전용 사건을 따로 엽니다.
   */
  describe('파기 대상 조회와 삭제 (§14)', () => {
    const purger = createPurgeCaseStore(sql)
    const doomedId = newUlid()

    beforeAll(async () => {
      await cases.createCase({
        caseId: doomedId,
        linkToken: newLinkToken(),
        track: 'victim',
        status: 'intake',
        openedAt: OPENED_AT,
        // 이미 지난 날짜입니다 — 오늘이 언제든 대상이 됩니다
        purgeAfter: '2020-01-01',
      })
    })

    it('파기일이 지난 사건을 집는다 — 안 지난 것은 안 집는다', async () => {
      const due = await purger.findDue('2026-09-03', 200)
      const ids = due.map((one) => one.caseId)

      expect(ids).toContain(doomedId)
      // 위 시험들이 쓰는 사건은 파기일이 2027 이라 아직 아닙니다
      expect(ids).not.toContain(caseId)
    })

    it('파기일을 `YYYY-MM-DD` 로 돌려준다 — 드라이버가 주는 `Date` 그대로가 아니라', async () => {
      const due = await purger.findDue('2026-09-03', 200)
      const found = due.find((one) => one.caseId === doomedId)

      expect(found?.purgeAfter).toBe('2020-01-01')
    })

    it('한 번에 가져올 수를 제한한다 — 서버리스는 실행 시간 상한이 있습니다', async () => {
      const due = await purger.findDue('2026-09-03', 1)

      expect(due.length).toBeLessThanOrEqual(1)
    })

    it('지우면 남지 않는다 — 지웠다고 믿지 않고 다시 봅니다 (ADR-016)', async () => {
      expect(await purger.remains(doomedId)).toBe(true)

      await purger.delete(doomedId)

      expect(await purger.remains(doomedId)).toBe(false)
      // 지운 뒤에는 대상 목록에서도 사라집니다
      const due = await purger.findDue('2026-09-03', 200)
      expect(due.map((one) => one.caseId)).not.toContain(doomedId)
    })
  })

  describe('발송 이력 — 같은 열쇠는 한 번만 (§8.4 reminder_sent)', () => {
    const sentLog = createSentLog(sql)
    // 실제 열쇠와 같은 모양(가변 길이)입니다 — send.ts 의 dedupeKey
    const KEY = `${caseId}|d:01J8DL00000000000000000000:2026-08-21`

    it('적기 전에는 안 보낸 것이다', async () => {
      expect(await sentLog.sentAlready(KEY)).toBe(false)
    })

    it('적으면 보낸 것이 된다', async () => {
      await sentLog.markSent(KEY, caseId)
      expect(await sentLog.sentAlready(KEY)).toBe(true)
    })

    it('같은 열쇠를 두 번 적어도 터지지 않는다 — 크론이 겹쳐 돌 수 있습니다', async () => {
      await sentLog.markSent(KEY, caseId)
      expect(await sentLog.sentAlready(KEY)).toBe(true)
    })

    it('열쇠가 다르면 새 알림이다 — 알릴 것이 늘면 다시 나가야 합니다', async () => {
      expect(await sentLog.sentAlready(`${caseId}|d:다른기한:2026-09-03`)).toBe(false)
    })

    it('사건이 지워지면 이력도 함께 사라진다 — 파기 연쇄 (불변 규칙 3)', async () => {
      // 일회용 사건을 하나 만들어 바로 지워 봅니다 — 본 사건은 afterAll 이 씁니다
      const shortLived = newUlid()
      await cases.createCase({
        caseId: shortLived,
        linkToken: newLinkToken(),
        track: 'victim',
        status: 'intake',
        openedAt: OPENED_AT,
        purgeAfter: PURGE_AFTER,
      })
      const key = `${shortLived}|d:D1:2026-08-21`
      await sentLog.markSent(key, shortLived)
      expect(await sentLog.sentAlready(key)).toBe(true)

      await sql`DELETE FROM "case" WHERE case_id = ${shortLived}`
      expect(await sentLog.sentAlready(key)).toBe(false)
    })
  })
})
