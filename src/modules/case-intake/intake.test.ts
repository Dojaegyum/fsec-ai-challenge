/**
 * case-intake 시험.
 *
 * 검증 대상은 spec/common/08-14-api.md §3.1 §3.2 §1.3 과
 * spec/backend/08-16-data-model.md §2 §3 입니다.
 */

import { describe, expect, it } from 'vitest'

import { IngestError, RateLimitedError } from '@/lib/errors'

import { createCaseIntake, DEFAULT_LIMITS } from './intake'
import type {
  CaseStore,
  EvidenceRow,
  EvidenceTotals,
  IngestStatus,
  IntakeLimits,
  OpenedCase,
} from './types'

const TODAY = '2026-08-18'
const NOW = '2026-08-18T14:30:00+09:00'

/** 무엇이 저장됐는지 볼 수 있는 저장소 */
function fakeStore(totals: EvidenceTotals = { count: 0, bytes: 0 }) {
  const cases: OpenedCase[] = []
  const evidence: EvidenceRow[] = []
  const purges: string[] = []
  let uploaded = 0

  const store: CaseStore = {
    async createCase(row) {
      cases.push(row)
    },
    async evidenceTotals() {
      return totals
    },
    async addEvidence(row) {
      evidence.push(row)
    },
    async markUploaded(): Promise<IngestStatus> {
      uploaded += 1
      return 'processing'
    },
    async touchPurgeAfter(_caseId, purgeAfter) {
      purges.push(purgeAfter)
    },
  }

  return {
    store,
    cases,
    evidence,
    purges,
    uploadedCount: () => uploaded,
  }
}

/** 부른 순서대로 값을 내주는 식별자 발급기 */
function fakeIds(...values: string[]) {
  let i = 0
  return { next: () => values[i++] ?? `id-${i}` }
}

function fakeUploads() {
  const seen: unknown[] = []
  return {
    seen,
    source: {
      async issue(req: { caseId: string; evidenceId: string }) {
        seen.push(req)
        return {
          objectKey: `cases/${req.caseId}/${req.evidenceId}`,
          url: 'https://storage.example/put?sig=abc',
          expiresAt: '2026-08-18T14:35:00+09:00',
        }
      },
    },
  }
}

/** 말일 이월을 걸지 않는 단순 날짜 셈 — date-checker 의 addDays 와 같은 계약 */
const dates = {
  addDays(date: string, amount: number) {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + amount)
    return d.toISOString().slice(0, 10)
  },
}

function intake(opts: {
  totals?: EvidenceTotals
  limits?: IntakeLimits
  ids?: string[]
} = {}) {
  const s = fakeStore(opts.totals)
  const u = fakeUploads()
  const checker = createCaseIntake({
    ids: fakeIds(...(opts.ids ?? ['CASE01', 'EV01'])),
    // 실제로는 추측 불가능한 난수입니다 → ADR-039. 시험에서는 단언을 쓰려고 고정합니다
    linkTokens: { next: () => 'TOKEN01' },
    clock: { now: () => NOW, today: () => TODAY },
    dates,
    store: s.store,
    uploads: u.source,
    limits: opts.limits,
  })
  return { checker, ...s, uploads: u }
}

describe('사건을 연다', () => {
  it('접수 상태로 시작한다', async () => {
    const { checker } = intake()
    const opened = await checker.open({ track: 'victim' })

    expect(opened.caseId).toBe('CASE01')
    expect(opened.track).toBe('victim')
    expect(opened.status).toBe('intake')
    expect(opened.openedAt).toBe(NOW)
  })

  it('파기 예정일을 생성 시점에 채운다 — 180일 뒤', async () => {
    // 파기 시점이 정해지지 않은 데이터가 생기면 안 됩니다 → 09-data-model.md §2
    const { checker } = intake()
    const opened = await checker.open({ track: 'victim' })

    expect(opened.purgeAfter).toBe('2027-02-14')
  })

  it('통장묶기 트랙도 연다', async () => {
    const { checker } = intake()
    const opened = await checker.open({ track: 'frozen_account' })

    expect(opened.track).toBe('frozen_account')
  })

  it('목록 밖 track 은 거부한다', async () => {
    const { checker } = intake()
    await expect(
      // @ts-expect-error 목록 밖 값이 들어오는 경우를 본다
      checker.open({ track: 'whatever' }),
    ).rejects.toBeInstanceOf(IngestError)
  })

  it('저장소에 그대로 넘긴다', async () => {
    const { checker, cases } = intake()
    const opened = await checker.open({ track: 'victim' })

    expect(cases).toEqual([opened])
  })

  it('플랜을 만들지 않는다', async () => {
    // T0 안전 절차는 KB 인용이 필요하고, 인용은 planner 의 일입니다.
    // 여기서 붙이면 근거 없는 절차가 이 모듈에서 나가게 됩니다
    const { checker } = intake()
    const opened = await checker.open({ track: 'victim' })

    expect(opened).not.toHaveProperty('plan')
    expect(opened).not.toHaveProperty('steps')
  })
})

describe('파일 접수 자리를 낸다', () => {
  it('업로드 자리를 돌려준다', async () => {
    const { checker } = intake({ ids: ['EV01'] })
    const slot = await checker.acceptEvidence('CASE01', {
      kind: 'audio',
      mimeType: 'audio/m4a',
      byteSize: 4_210_553,
    })

    expect(slot.evidenceId).toBe('EV01')
    expect(slot.uploadUrl).toBe('https://storage.example/put?sig=abc')
    expect(slot.uploadMethod).toBe('PUT')
  })

  it('아직 안 올라왔으므로 pending 으로 적는다', async () => {
    const { checker, evidence } = intake()
    await checker.acceptEvidence('CASE01', {
      kind: 'image',
      mimeType: 'image/png',
      byteSize: 120_000,
    })

    expect(evidence[0].ingestStatus).toBe('pending')
    expect(evidence[0].kind).toBe('image')
  })

  it('파일 내용을 요구하지 않는다', async () => {
    // 파일은 API 함수를 통과하지 않습니다. 이 모듈은 종류와 크기만 봅니다
    const { checker, evidence } = intake()
    await checker.acceptEvidence('CASE01', {
      kind: 'audio',
      mimeType: 'audio/m4a',
      byteSize: 1,
    })

    expect(evidence[0]).not.toHaveProperty('content')
    expect(evidence[0]).not.toHaveProperty('transcript')
  })

  it('접수도 활동이므로 파기 예정일을 다시 민다', async () => {
    const { checker, purges } = intake()
    await checker.acceptEvidence('CASE01', {
      kind: 'text',
      mimeType: 'text/plain',
      byteSize: 500,
    })

    expect(purges).toEqual(['2027-02-14'])
  })
})

describe('사건당 상한 — 08-14-api.md §1.3', () => {
  it('파일 수가 넘으면 429 로 막는다', async () => {
    const { checker } = intake({ totals: { count: 30, bytes: 0 } })

    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 1,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('29개까지는 받는다 — 경계에서 한 개를 잃지 않는다', async () => {
    const { checker } = intake({ totals: { count: 29, bytes: 0 } })

    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 1,
      }),
    ).resolves.toHaveProperty('uploadMethod', 'PUT')
  })

  it('합계 용량이 넘으면 429 로 막는다', async () => {
    const { checker } = intake({
      totals: { count: 1, bytes: DEFAULT_LIMITS.maxTotalBytes },
    })

    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'audio',
        mimeType: 'audio/m4a',
        byteSize: 1,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError)
  })

  it('딱 맞게 채우는 것은 받는다', async () => {
    const { checker } = intake({
      totals: { count: 1, bytes: DEFAULT_LIMITS.maxTotalBytes - 100 },
    })

    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'audio',
        mimeType: 'audio/m4a',
        byteSize: 100,
      }),
    ).resolves.toHaveProperty('uploadMethod', 'PUT')
  })

  it('막을 때는 업로드 자리를 내주지 않는다', async () => {
    // 자리를 내주고 막으면 아무도 안 쓰는 서명 URL 이 남습니다
    const { checker, uploads, evidence } = intake({
      totals: { count: 30, bytes: 0 },
    })

    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'image',
        mimeType: 'image/png',
        byteSize: 1,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError)

    expect(uploads.seen).toEqual([])
    expect(evidence).toEqual([])
  })

  it('상한은 밖에서 바꿀 수 있다', async () => {
    const { checker } = intake({
      totals: { count: 2, bytes: 0 },
      limits: { maxFiles: 2, maxTotalBytes: 1_000 },
    })

    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'text',
        mimeType: 'text/plain',
        byteSize: 1,
      }),
    ).rejects.toBeInstanceOf(RateLimitedError)
  })
})

describe('말이 안 되는 요청은 자리를 내기 전에 막는다', () => {
  it('목록 밖 kind', async () => {
    const { checker } = intake()
    await expect(
      // @ts-expect-error 목록 밖 값이 들어오는 경우를 본다
      checker.acceptEvidence('CASE01', { kind: 'video', mimeType: 'x', byteSize: 1 }),
    ).rejects.toBeInstanceOf(IngestError)
  })

  it('크기가 0 이하', async () => {
    const { checker } = intake()
    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'audio',
        mimeType: 'audio/m4a',
        byteSize: 0,
      }),
    ).rejects.toBeInstanceOf(IngestError)
  })

  it('크기가 정수가 아님', async () => {
    const { checker } = intake()
    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'audio',
        mimeType: 'audio/m4a',
        byteSize: 1.5,
      }),
    ).rejects.toBeInstanceOf(IngestError)
  })

  it('mime_type 이 빈 문자열', async () => {
    const { checker } = intake()
    await expect(
      checker.acceptEvidence('CASE01', {
        kind: 'text',
        mimeType: '   ',
        byteSize: 10,
      }),
    ).rejects.toBeInstanceOf(IngestError)
  })

  it('mime_type 목록으로는 막지 않는다', async () => {
    // 같은 녹음을 기기마다 다른 이름으로 보냅니다. 목록으로 막으면
    // 정상 파일이 거부되는데, 그게 상한을 넘기는 것보다 나쁩니다
    const { checker } = intake()

    for (const mimeType of ['audio/m4a', 'audio/x-m4a', 'audio/mp4']) {
      await expect(
        checker.acceptEvidence('CASE01', { kind: 'audio', mimeType, byteSize: 10 }),
      ).resolves.toHaveProperty('uploadMethod', 'PUT')
    }
  })
})

describe('업로드 완료 통지', () => {
  it('처리 시작 상태를 돌려준다', async () => {
    const { checker } = intake()
    const status = await checker.completeUpload('CASE01', 'EV01')

    expect(status).toBe('processing')
  })

  it('완료 통지도 활동이므로 파기 예정일을 다시 민다', async () => {
    const { checker, purges } = intake()
    await checker.completeUpload('CASE01', 'EV01')

    expect(purges).toEqual(['2027-02-14'])
  })
})
