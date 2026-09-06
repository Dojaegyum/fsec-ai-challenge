/**
 * 저장소에서 읽은 시각이 **`+09:00` 표기**로 나간다 — 시험.
 *
 * 검증 대상: spec/common/08-14-api.md §1 「시각 — ISO 8601, 시간대 포함 (+09:00)」 ·
 *            §3.10(`created_at`·`last_activity_at`) · §3.2(`evidence[].created_at`) · §3.12
 *
 * 2026-09-06 배포본 점검에서 한 응답 안에 `2026-09-06T23:27:05+09:00`(opened_at)과
 * `2026-09-06T14:27:05.379Z`(created_at)가 섞여 나왔습니다. 드라이버가 `Date` 로 주는
 * 칸을 `toISOString()` 으로 찍은 자리들입니다 — `lib/clock.ts` 가 「쓰지 마세요」라고
 * 적어 둔 바로 그것이고, 자정 근처 값은 **날짜가 하루 앞으로** 보입니다.
 *
 * 실제 DB 에는 붙지 않습니다. 질의 결과를 응답 모양으로 옮기는 자리만 봅니다 —
 * `db-plan.test.ts` 와 같은 방식입니다.
 */

import { describe, expect, it } from 'vitest'

import {
  createCaseReader,
  createEvidenceReader,
  createMessageStore,
  type Sql,
} from './db'

const CASE_ID = '01J8XKQZ3M7N2P4R6T8V0W2Y4A'

/** 한국 시각 2026-09-06 23:27:05.379 — 표는 UTC 로 들고 있습니다 */
const AT = new Date('2026-09-06T14:27:05.379Z')
const SEOUL = '2026-09-06T23:27:05.379+09:00'

/** 질의문을 보고 갈라 답하는 가짜 연결 */
function sqlOf(answer: (text: string) => unknown[]): Sql {
  const fake = Object.assign(
    (strings: TemplateStringsArray, ...params: unknown[]) => {
      void params
      return Promise.resolve(answer(strings.join('?')))
    },
    { json: (value: unknown) => value },
  )
  return fake as unknown as Sql
}

describe('사건 합본의 시각 — §3.10', () => {
  it('created_at · last_activity_at 이 +09:00 으로 나간다', async () => {
    const reader = createCaseReader(
      sqlOf(() => [
        {
          track: 'victim',
          status: 'intake',
          created_at: AT,
          updated_at: AT,
          purge_after: new Date('2027-03-05T00:00:00.000Z'),
        },
      ]),
    )

    const read = await reader.read(CASE_ID)

    expect(read?.createdAt).toBe(SEOUL)
    expect(read?.lastActivityAt).toBe(SEOUL)
    // 파기일은 날짜뿐입니다 — 시각을 붙이면 「언제 지워지나」가 시간대에 따라 하루 어긋납니다
    expect(read?.purgeAfter).toBe('2027-03-05')
  })
})

describe('자료의 시각 — §3.2 · §3.3', () => {
  it('목록의 created_at 이 +09:00 으로 나간다', async () => {
    const reader = createEvidenceReader(
      sqlOf((text) =>
        text.includes('has_transcript')
          ? [
              {
                evidence_id: '01J8XKR60000000000000000AA',
                kind: 'audio',
                mime_type: 'audio/m4a',
                byte_size: '4210553',
                ingest_status: 'done',
                ingest_error: null,
                created_at: AT,
                has_transcript: true,
              },
            ]
          : [],
      ),
    )

    const listed = await reader.list(CASE_ID)

    expect(listed[0]?.createdAt).toBe(SEOUL)
  })

  it('한 건 조회의 createdAt 도 같은 표기다', async () => {
    const reader = createEvidenceReader(
      sqlOf((text) =>
        text.includes('transcript_masked, created_at')
          ? [
              {
                kind: 'image',
                object_key: 'k',
                mime_type: 'image/png',
                ingest_status: 'pending',
                transcript_masked: null,
                created_at: AT,
              },
            ]
          : [],
      ),
    )

    const one = await reader.read(CASE_ID, '01J8XKR60000000000000000AA')

    expect(one?.createdAt).toBe(SEOUL)
    // 오래 멈춘 pending 판정이 이 값을 `Date.parse` 로 읽습니다 — 표기가 바뀌어도 읽혀야 합니다
    expect(Number.isFinite(Date.parse(one?.createdAt ?? ''))).toBe(true)
  })
})

describe('대화 이력의 시각 — §3.12', () => {
  it('turns 의 createdAt 이 +09:00 으로 나간다', async () => {
    const store = createMessageStore(
      sqlOf((text) =>
        text.includes('FROM message')
          ? [
              {
                message_id: '01J8XKRE000000000000000000',
                role: 'assistant',
                content_masked: '지급정지를 거셨으면 다음은 피해구제 신청서 제출입니다.',
                citations: [],
                insufficient: false,
                referenced_steps: [],
                referenced_deadlines: [],
                created_at: AT,
              },
            ]
          : [],
      ),
      () => '01J8NEW000000000000000000',
    )

    const { turns } = await store.turns(CASE_ID, 50)

    expect(turns[0]?.createdAt).toBe(SEOUL)
  })
})
