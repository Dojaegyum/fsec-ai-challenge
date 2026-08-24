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

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  createCaseReader,
  createCaseStore,
  createCaseTokenResolver,
  createEvidenceReader,
  createEvidenceWriter,
  createMessageStore,
  createSlotReader,
  createSlotWriter,
  createSql,
  createVaultMappings,
  createVaultStore,
} from './db'
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
      for (const turnNo of [1, 2, 3]) {
        await messages.write({
          messageId: newUlid(),
          caseId,
          turnNo,
          role: 'assistant',
          contentMasked: `답 ${turnNo}`,
          promptMasked: `프롬프트 ${turnNo}`,
          reasoningMasked: `근거 ${turnNo}`,
          citations: [{ id: `kb-${turnNo}` }],
          kbContextRefs: [{ kb_entry_id: `kb-${turnNo}`, kb_version: '2026.07.9' }],
          insufficient: false,
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
})
