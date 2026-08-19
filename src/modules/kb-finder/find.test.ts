/**
 * kb-finder 시험.
 *
 * 검증 대상은 spec/backend/08-16-chat-context.md §2 와
 * spec/backend/08-16-data-model.md §11.2 입니다.
 */

import { describe, expect, it } from 'vitest'

import { KbUnavailableError, StoreError } from '@/lib/errors'

import { createKbFinder } from './find'
import type { KbQuery, KbRow, KbStore } from './types'

const QUERY: KbQuery = {
  kbVersion: '2026.08.1',
  track: 'victim',
  channelId: 'CH-bank',
  orgId: 'kb-bank',
  asOf: '2026-08-20',
}

/** 최소한만 채운 한 행. 시험에서 보는 칸만 인자로 받습니다 */
function row(over: Partial<KbRow> & Pick<KbRow, 'kbEntryId' | 'stepKey'>): KbRow {
  return {
    kbVersion: '2026.08.1',
    stepSeq: 1,
    channelId: null,
    orgId: null,
    track: 'victim',
    title: '제목',
    body: {},
    legalBasis: '통신사기피해환급법 시행령 제3조',
    sourceUrl: 'https://www.law.go.kr/...',
    effectiveFrom: '2026-07-01',
    effectiveUntil: null,
    verifiedAt: '2026-08-16',
    ...over,
  }
}

function finder(store: Partial<KbStore>) {
  return createKbFinder({
    store: {
      findApplied: async () => [],
      findReference: async () => [],
      ...store,
    },
  })
}

describe('적용 묶음 — 우선순위 병합', () => {
  it('같은 단계가 겹치면 기관 전용이 유형 기본을 대신한다', async () => {
    // 09-data-model.md §11.2 의 예시 그대로
    const kb = finder({
      findApplied: async () => [
        row({ kbEntryId: 'kb-bank-freeze-request', stepKey: 'bank-freeze-request',
              orgId: 'kb-bank', channelId: 'CH-bank' }),
        row({ kbEntryId: 'generic-bank-freeze', stepKey: 'bank-freeze-request',
              channelId: 'CH-bank' }),
      ],
    })

    const { applied } = await kb.find(QUERY)

    expect(applied).toHaveLength(1)
    expect(applied[0].kbEntryId).toBe('kb-bank-freeze-request')
  })

  it('유형 기본이 전 유형 공통을 대신한다', async () => {
    const kb = finder({
      findApplied: async () => [
        row({ kbEntryId: 'common-freeze', stepKey: 'freeze' }),
        row({ kbEntryId: 'bank-freeze', stepKey: 'freeze', channelId: 'CH-bank' }),
      ],
    })

    const { applied } = await kb.find(QUERY)

    expect(applied.map((one) => one.kbEntryId)).toEqual(['bank-freeze'])
  })

  it('저장소가 순서를 거꾸로 줘도 결과가 같다', async () => {
    // 쿼리의 ORDER BY 가 바뀌어도 병합 규칙이 조용히 깨지면 안 됩니다
    const rows = [
      row({ kbEntryId: 'generic', stepKey: 'freeze', channelId: 'CH-bank' }),
      row({ kbEntryId: 'org', stepKey: 'freeze', orgId: 'kb-bank', channelId: 'CH-bank' }),
    ]

    const forward = finder({ findApplied: async () => rows })
    const backward = finder({ findApplied: async () => [...rows].reverse() })

    expect((await forward.find(QUERY)).applied[0].kbEntryId).toBe('org')
    expect((await backward.find(QUERY)).applied[0].kbEntryId).toBe('org')
  })

  it('겹치지 않는 단계는 전부 남는다', async () => {
    // 기관 전용에 없는 단계는 유형 기본이, 유형에도 없으면 공통이 남습니다
    const kb = finder({
      findApplied: async () => [
        row({ kbEntryId: 'org-1', stepKey: 'freeze', stepSeq: 2,
              orgId: 'kb-bank', channelId: 'CH-bank' }),
        row({ kbEntryId: 'ch-1', stepKey: 'relief-apply', stepSeq: 3, channelId: 'CH-bank' }),
        row({ kbEntryId: 'common-1', stepKey: 'report-112', stepSeq: 1 }),
      ],
    })

    const { applied } = await kb.find(QUERY)

    expect(applied).toHaveLength(3)
  })

  it('표시 순서대로 정렬한다', async () => {
    // CH-facetoface 는 여기서 순서가 역전됩니다 — 112 신고가 먼저입니다
    const kb = finder({
      findApplied: async () => [
        row({ kbEntryId: 'c', stepKey: 'c', stepSeq: 30 }),
        row({ kbEntryId: 'a', stepKey: 'a', stepSeq: 10 }),
        row({ kbEntryId: 'b', stepKey: 'b', stepSeq: 20 }),
      ],
    })

    const { applied } = await kb.find(QUERY)

    expect(applied.map((one) => one.kbEntryId)).toEqual(['a', 'b', 'c'])
  })
})

describe('참고 묶음', () => {
  it('같은 단계 이름이어도 유형이 다르면 둘 다 남긴다', async () => {
    // 간편송금의 지급정지와 시중은행의 지급정지는 요청처가 다릅니다.
    // 하나로 합치면 다른 하나를 잃습니다
    const kb = finder({
      findReference: async () => [
        row({ kbEntryId: 'easypay-freeze', stepKey: 'freeze', channelId: 'CH-easypay' }),
        row({ kbEntryId: 'crypto-freeze', stepKey: 'freeze', channelId: 'CH-crypto' }),
      ],
    })

    const { reference } = await kb.find(QUERY)

    expect(reference).toHaveLength(2)
  })

  it('유형별로 묶어 정렬한다 — 조건 라벨을 붙일 수 있게', async () => {
    const kb = finder({
      findReference: async () => [
        row({ kbEntryId: 'crypto-2', stepKey: 'b', stepSeq: 20, channelId: 'CH-crypto' }),
        row({ kbEntryId: 'easypay-1', stepKey: 'a', stepSeq: 10, channelId: 'CH-easypay' }),
        row({ kbEntryId: 'crypto-1', stepKey: 'a', stepSeq: 10, channelId: 'CH-crypto' }),
      ],
    })

    const { reference } = await kb.find(QUERY)

    expect(reference.map((one) => one.kbEntryId)).toEqual([
      'crypto-1',
      'crypto-2',
      'easypay-1',
    ])
  })

  it('적용 묶음과 섞지 않는다', async () => {
    // 섞으면 은행 이체 사건에서 가상자산 거래소 절차를 그냥 안내합니다
    const kb = finder({
      findApplied: async () => [row({ kbEntryId: 'bank', stepKey: 'freeze', channelId: 'CH-bank' })],
      findReference: async () => [row({ kbEntryId: 'crypto', stepKey: 'freeze', channelId: 'CH-crypto' })],
    })

    const { applied, reference } = await kb.find(QUERY)

    expect(applied.map((one) => one.kbEntryId)).toEqual(['bank'])
    expect(reference.map((one) => one.kbEntryId)).toEqual(['crypto'])
  })
})

describe('0건은 실패가 아니다', () => {
  it('둘 다 비어도 정상으로 돌려준다', async () => {
    // 절차를 말하지 않고 1332 를 안내할지는 부른 쪽이 정합니다
    const kb = finder({})

    await expect(kb.find(QUERY)).resolves.toEqual({ applied: [], reference: [] })
  })

  it('유형을 몰라도 조회한다 — 공통만 나온다', async () => {
    // 슬롯 T1 미충족. 여기서 막으면 「멈추지 않는다」 원칙이 깨집니다
    const kb = finder({
      findApplied: async () => [row({ kbEntryId: 'report-112', stepKey: 'report-112' })],
    })

    const { applied } = await kb.find({ ...QUERY, channelId: null, orgId: null })

    expect(applied.map((one) => one.kbEntryId)).toEqual(['report-112'])
  })
})

describe('조회 실패는 빈 결과로 삼키지 않는다', () => {
  it('저장소가 던지면 KB_UNAVAILABLE 로 올린다', async () => {
    // 0건과 「조회를 못 했다」를 뭉개면, KB 가 죽은 것을 근거 없음으로 오인해
    // 사용자는 절차가 없는 줄 압니다
    const kb = finder({
      findApplied: async () => {
        throw new Error('connection refused')
      },
    })

    await expect(kb.find(QUERY)).rejects.toBeInstanceOf(KbUnavailableError)
  })

  it('참고 묶음 조회가 실패해도 올린다', async () => {
    const kb = finder({
      findReference: async () => {
        throw new Error('timeout')
      },
    })

    await expect(kb.find(QUERY)).rejects.toBeInstanceOf(KbUnavailableError)
  })

  it('이미 우리 예외면 그대로 올린다', async () => {
    // 감싸면 code 가 바뀌어 사용자 문구와 재시도 판정이 달라집니다
    const kb = finder({
      findApplied: async () => {
        throw new StoreError('볼트 접속 실패')
      },
    })

    await expect(kb.find(QUERY)).rejects.toBeInstanceOf(StoreError)
  })
})

describe('이 모듈이 하지 않는 것', () => {
  it('참조 번호를 붙이지 않는다', async () => {
    // kb-1, kb-2 는 prompt-builder 가 붙입니다 → 11-chat-context.md §3.4
    const kb = finder({
      findApplied: async () => [row({ kbEntryId: 'a', stepKey: 'a' })],
    })

    const { applied } = await kb.find(QUERY)

    expect(applied[0]).not.toHaveProperty('ref')
  })

  it('낡은 항목을 걸러내지 않는다', async () => {
    // 재검증은 KB 운영 파이프라인의 일입니다. 낡았다고 빼면
    // 사용자에게 아무것도 못 내놓습니다
    const kb = finder({
      findApplied: async () => [
        row({ kbEntryId: 'old', stepKey: 'a', verifiedAt: '2020-01-01' }),
      ],
    })

    const { applied } = await kb.find(QUERY)

    expect(applied).toHaveLength(1)
  })
})
