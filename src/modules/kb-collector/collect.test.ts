/**
 * 수집기 시험.
 *
 * 검증 대상: spec/backend/08-16-data-model.md §12.1 §12.3 §12.5 ·
 *            spec/backend/08-14-kb-operations.md 원칙 4 · ADR-012
 *
 * **여기서 못 박는 것 다섯:**
 * 1. 매뉴얼에 직접 쓰지 않는다 — 검수 큐로만 간다
 * 2. 변경 감지에 비교 로직이 없다 — 저장 성공이 곧 변경이다
 * 3. 게시판은 겹칠 때까지 읽는다 (고정 쪽수가 아니다)
 * 4. 한 소스가 실패해도 나머지를 계속한다
 * 5. 조용히 멈춘 수집기를 알린다
 */

import { describe, expect, it, vi } from 'vitest'

import { createKbCollector } from './collect'
import type {
  Clock,
  FetchedItem,
  Hasher,
  RegistryStore,
  Snapshot,
  SnapshotStore,
  SourceFetcher,
  WatchedSource,
} from './types'

const NOW = '2026-08-21T09:00:00.000+09:00'

const clock: Clock = { now: () => NOW, today: () => '2026-08-21' }
const ids = (() => {
  let n = 0
  return { next: () => `01J8SNAP${String((n += 1)).padStart(17, '0')}` }
})()
/** 내용이 같으면 같은 값. 실제 SHA-256 은 밖에서 옵니다 */
const hasher: Hasher = { hash: (text) => `h:${text}` }

function source(over: Partial<WatchedSource> = {}): WatchedSource {
  return {
    sourceKeyPrefix: 'law.go.kr/DRF',
    sourceType: 'law',
    watchMethod: 'api',
    intervalDays: 1,
    lastSuccessAt: NOW,
    lastSeenDate: null,
    lastError: null,
    ...over,
  }
}

/**
 * 실제 `source_snapshot` 의 제약을 흉내내는 보관소.
 *
 * **둘 다 겁니다** → §12.1. `uk_source_hash (source_key, content_hash)` 만 흉내내면
 * `snapshot_id` 를 상수로 박는 회귀를 못 잡습니다 — 진짜 Postgres 는 PK 에서 터집니다.
 *
 * 스냅샷과 검수 큐 행을 **함께** 씁니다. 실제 저장소도 한 트랜잭션이어야 합니다.
 */
function snapshotStoreOf(opts: { failChange?: () => boolean } = {}) {
  const hashes = new Set<string>()
  const ids = new Set<string>()
  const kept: Snapshot[] = []
  const recorded: { sourceKey: string; snapshotAfter: string; detectedAt: string }[] = []

  const store: SnapshotStore = {
    async append({ snapshot, change }) {
      const key = `${snapshot.sourceKey}|${snapshot.contentHash}`
      if (hashes.has(key)) return false
      if (ids.has(snapshot.snapshotId)) {
        // PRIMARY KEY (snapshot_id) → §12.1
        throw new Error('duplicate key value violates unique constraint "source_snapshot_pkey"')
      }
      // 검수 큐 등록이 실패하면 스냅샷도 안 남습니다 — 한 트랜잭션이기 때문입니다
      if (opts.failChange?.()) throw new Error('source_change 쓰기 실패')

      hashes.add(key)
      ids.add(snapshot.snapshotId)
      kept.push(snapshot)
      recorded.push({
        sourceKey: snapshot.sourceKey,
        snapshotAfter: snapshot.snapshotId,
        detectedAt: change.detectedAt,
      })
      return true
    },
  }
  return { store, kept, recorded }
}

function registryOf(sources: readonly WatchedSource[], opts: { fail?: boolean } = {}) {
  const patches: Record<string, unknown>[] = []
  const registry: RegistryStore = {
    async list() {
      return sources
    },
    async update(sourceKeyPrefix, patch) {
      if (opts.fail) throw new Error('registry 쓰기 실패')
      patches.push({ sourceKeyPrefix, ...patch })
    },
  }
  return { registry, patches }
}

/** 쪽마다 정해 둔 것을 돌려주는 소스 */
function fetcherOf(pages: readonly (readonly FetchedItem[])[]): SourceFetcher {
  return {
    async fetch({ page }) {
      return pages[page - 1] ?? []
    },
  }
}

function item(sourceKey: string, content: string, postedDate?: string): FetchedItem {
  return { sourceKey, content, ...(postedDate ? { postedDate } : {}) }
}

function build(over: {
  fetcher?: SourceFetcher
  sources?: readonly WatchedSource[]
  snapshots?: SnapshotStore
  registry?: RegistryStore
  failChange?: () => boolean
  registryFails?: boolean
}) {
  const snaps = snapshotStoreOf({ failChange: over.failChange })
  const reg = registryOf(over.sources ?? [source()], { fail: over.registryFails })

  return {
    snaps,
    reg,
    collector: createKbCollector({
      fetcher: over.fetcher ?? fetcherOf([[item('law:011359:3', '제3조 본문')]]),
      snapshots: over.snapshots ?? snaps.store,
      registry: over.registry ?? reg.registry,
      ids,
      clock,
      hasher,
    }),
  }
}

describe('매뉴얼에 직접 쓰지 않는다 — 원칙 4', () => {
  it('새 원문은 검수 큐로 간다', async () => {
    // 수집기가 kb_entry 를 직접 쓰면 「사람 검수는 생략 불가」가 무너집니다
    const { collector, snaps } = build({})

    await collector.collect()

    expect(snaps.recorded).toHaveLength(1)
    expect(snaps.recorded[0].sourceKey).toBe('law:011359:3')
  })

  it('검수 큐 행이 방금 저장한 스냅샷을 가리킨다', async () => {
    // 엉뚱한 스냅샷을 가리키면 검수자가 다른 조문을 보고 판단합니다
    const { collector, snaps } = build({
      fetcher: fetcherOf([[item('law:1:1', 'a'), item('law:1:2', 'b')]]),
    })

    await collector.collect()

    expect(snaps.recorded.map((r) => r.snapshotAfter)).toEqual(
      snaps.kept.map((k) => k.snapshotId),
    )
    expect(new Set(snaps.kept.map((k) => k.snapshotId)).size).toBe(2)
    expect(snaps.recorded[0].detectedAt).toBe(NOW)
  })

  it('밖에 내놓는 것은 collect 하나뿐이다', () => {
    // kb_entry 를 건드리는 자리를 새로 붙이면 여기서 걸립니다.
    // (포트 목록 자체는 런타임에 안 보이므로 타입이 지킵니다 — createKbCollector 인자)
    const { collector } = build({})

    expect(Object.keys(collector)).toEqual(['collect'])
  })
})

describe('저장 성공이 곧 변경이다 — §12.1', () => {
  it('같은 내용을 다시 가져오면 검수 큐에 안 넣는다', async () => {
    // 앞엣것과 견주는 코드를 따로 만들지 않습니다.
    // 두 곳에 두면 어긋나고, 어긋난 쪽이 조용히 놓치는 쪽이 됩니다
    const snaps = snapshotStoreOf()
    const reg = registryOf([source()])
    const make = () =>
      createKbCollector({
        fetcher: fetcherOf([[item('law:011359:3', '제3조 본문')]]),
        snapshots: snaps.store,
        registry: reg.registry,
        ids,
        clock,
        hasher,
      })

    await make().collect()
    await make().collect()

    expect(snaps.kept).toHaveLength(1)
    expect(snaps.recorded).toHaveLength(1)
  })

  it('내용이 바뀌면 새로 쌓인다', async () => {
    const snaps = snapshotStoreOf()
    const reg = registryOf([source()])
    const make = (content: string) =>
      createKbCollector({
        fetcher: fetcherOf([[item('law:011359:3', content)]]),
        snapshots: snaps.store,
        registry: reg.registry,
        ids,
        clock,
        hasher,
      })

    await make('제3조 본문').collect()
    await make('제3조 본문 — 개정').collect()

    expect(snaps.kept).toHaveLength(2)
    expect(snaps.recorded.map((r) => r.snapshotAfter)).toEqual(
      snaps.kept.map((k) => k.snapshotId),
    )
  })

  it('안 바뀐 것도 세어서 알린다', async () => {
    const { collector } = build({
      fetcher: fetcherOf([[item('a', 'x'), item('a', 'x'), item('b', 'y')]]),
    })

    const { results } = await collector.collect()

    expect(results[0].added).toBe(2)
    expect(results[0].unchanged).toBe(1)
  })

  it('원문을 그대로 담는다', async () => {
    // 요약하거나 다듬지 않습니다 — 근거이기 때문입니다
    const { collector, snaps } = build({
      fetcher: fetcherOf([[item('law:1:1', '  제3조   원문 그대로  ')]]),
    })

    await collector.collect()

    expect(snaps.kept[0].content).toBe('  제3조   원문 그대로  ')
  })

  it('해시를 저장한 원문 바로 그 문자열에서 뽑는다', async () => {
    // 다듬은 문자열에서 뽑으면 공백만 다른 재공포가 같은 것으로 묶입니다.
    // 저장된 것과 해시의 재료가 어긋나면 §12.1 의 감지 장치가 어긋납니다
    const { collector, snaps } = build({
      fetcher: fetcherOf([[item('law:1:1', ' 제3조 ')]]),
    })

    await collector.collect()

    expect(snaps.kept[0].contentHash).toBe(hasher.hash(snaps.kept[0].content))
  })

  it('출처 종류와 메타를 그대로 담는다', async () => {
    // 시행일이 메타에 있습니다 — 버리면 「언제부터 적용되나」를 잃습니다
    // → 07-kb-operations.md 원칙 1
    const { collector, snaps } = build({
      fetcher: {
        async fetch() {
          return [
            {
              sourceKey: 'fsc:press:1',
              content: '보도자료 본문',
              meta: { effectiveFrom: '2026-10-01', 부처: '금융위원회' },
            },
          ]
        },
      },
      sources: [source({ sourceType: 'press', watchMethod: 'board' })],
    })

    await collector.collect()

    expect(snaps.kept[0].sourceType).toBe('press')
    expect(snaps.kept[0].meta).toEqual({ effectiveFrom: '2026-10-01', 부처: '금융위원회' })
    expect(snaps.kept[0].fetchedAt).toBe(NOW)
  })
})

describe('저장과 검수 큐 등록은 함께 일어난다 — §12.1', () => {
  it('검수 큐 등록이 실패하면 스냅샷도 안 남는다', async () => {
    // **해시만 남으면 그 개정은 영영 다시 감지되지 않습니다.**
    // 다음 바퀴부터 append 가 거짓을 돌려주고 검수 큐에는 끝내 안 나타납니다
    const { collector, snaps } = build({ failChange: () => true })

    const { results } = await collector.collect()

    expect(snaps.kept).toHaveLength(0)
    expect(snaps.recorded).toHaveLength(0)
    expect(results[0].error).toBe('Error')
  })

  it('한 번 실패해도 다음 바퀴에 다시 감지된다', async () => {
    let fail = true
    const snaps = snapshotStoreOf({ failChange: () => fail })
    const reg = registryOf([source()])
    const make = () =>
      createKbCollector({
        fetcher: fetcherOf([[item('law:011359:3', '제3조 개정')]]),
        snapshots: snaps.store,
        registry: reg.registry,
        ids,
        clock,
        hasher,
      })

    await make().collect()
    fail = false
    const { results } = await make().collect()

    expect(results[0].added).toBe(1)
    expect(snaps.recorded).toHaveLength(1)
  })
})

describe('게시판은 겹칠 때까지 읽는다 — §12.5', () => {
  it('겹치는 날짜를 만나면 멈춘다', async () => {
    // 고정 쪽수를 읽지 않습니다
    const fetch = vi.fn<SourceFetcher['fetch']>(async ({ page }) => {
      if (page === 1) return [item('p1', 'a', '2026-08-21')]
      if (page === 2) return [item('p2', 'b', '2026-08-10')]
      return [item('p3', 'c', '2026-08-01')]
    })
    const { collector } = build({
      fetcher: { fetch },
      sources: [
        source({
          sourceKeyPrefix: 'fsc.go.kr/no010101',
          sourceType: 'press',
          watchMethod: 'board',
          lastSeenDate: '2026-08-15',
        }),
      ],
    })

    const { results } = await collector.collect()

    // 2쪽에서 2026-08-10 이 마지막으로 본 날짜보다 오래돼 겹쳤습니다
    expect(results[0].pages).toBe(2)
    expect(results[0].hitPageLimit).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('수집이 멈췄다 재개돼도 그 구간을 복구한다', async () => {
    // 한 달 멈췄다 재개된 상황입니다
    const pages = Array.from({ length: 6 }, (_, i) => [
      item(`p${i}`, `본문 ${i}`, `2026-08-${String(20 - i * 3).padStart(2, '0')}`),
    ])
    const { collector } = build({
      fetcher: fetcherOf(pages),
      sources: [
        source({
          sourceKeyPrefix: 'fsc.go.kr/no010101',
          sourceType: 'press',
          watchMethod: 'board',
          lastSeenDate: '2026-08-05',
        }),
      ],
    })

    const { results } = await collector.collect()

    expect(results[0].pages).toBeGreaterThan(2)
    expect(results[0].added).toBeGreaterThan(2)
    expect(results[0].hitPageLimit).toBe(false)
  })

  it('처음 수집이면 줄 때까지 읽는다', async () => {
    const { collector } = build({
      fetcher: fetcherOf([
        [item('p1', 'a', '2026-08-21')],
        [item('p2', 'b', '2026-08-18')],
      ]),
      sources: [
        source({
          sourceKeyPrefix: 'fsc.go.kr/no010101',
          sourceType: 'press',
          watchMethod: 'board',
          lastSeenDate: null,
        }),
      ],
    })

    const { results } = await collector.collect()

    // 3쪽이 비어서 멈춥니다
    expect(results[0].pages).toBe(3)
    expect(results[0].added).toBe(2)
  })

  it('겹치는 지점을 못 찾으면 안전장치에 걸리고 그 사실을 밝힌다', async () => {
    // 구멍이 남았을 수 있습니다 — 조용히 넘어가면 안 됩니다
    const fetch = vi.fn<SourceFetcher['fetch']>(async ({ page }) => [
      item(`p${page}`, `본문 ${page}`, '2026-08-21'),
    ])
    const { collector } = build({
      fetcher: { fetch },
      sources: [
        source({
          sourceKeyPrefix: 'fsc.go.kr/no010101',
          sourceType: 'press',
          watchMethod: 'board',
          lastSeenDate: '2020-01-01',
        }),
      ],
    })

    const { results } = await collector.collect()

    expect(results[0].hitPageLimit).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(20)
  })

  it('게시판이 아니면 한 쪽으로 끝낸다', async () => {
    // 법령 API 는 전체 이력을 한 번에 줍니다 — 쪽 개념이 없습니다
    const fetch = vi.fn<SourceFetcher['fetch']>(async () => [item('law:1:1', 'x')])
    const { collector } = build({ fetcher: { fetch } })

    await collector.collect()

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('마지막으로 본 게시물 날짜를 갱신한다', async () => {
    const { collector, reg } = build({
      fetcher: fetcherOf([[item('p1', 'a', '2026-08-21')], []]),
      sources: [
        source({
          sourceKeyPrefix: 'fsc.go.kr/no010101',
          sourceType: 'press',
          watchMethod: 'board',
          lastSeenDate: '2026-08-15',
        }),
      ],
    })

    await collector.collect()

    expect(reg.patches[0]).toMatchObject({ lastSeenDate: '2026-08-21' })
  })
})

describe('잘렸으면 커서를 밀지 않는다 — §12.5', () => {
  const truncated = () => ({
    fetcher: {
      async fetch({ page }: { page: number }) {
        return [item(`p${page}`, `본문 ${page}`, '2026-08-21')]
      },
    },
    sources: [
      source({
        sourceKeyPrefix: 'fsc.go.kr/no010101',
        sourceType: 'press',
        watchMethod: 'board',
        lastSeenDate: '2020-01-01',
        lastError: null,
      }),
    ],
  })

  it('안전장치에 걸린 바퀴는 lastSeenDate 를 안 적는다', async () => {
    // 밀면 다음 바퀴가 1쪽에서 바로 겹쳐 멈추고, 구멍이 남았다는 사실이
    // 결과에서도 저장소에서도 사라집니다 — 경고가 딱 한 번 뜨고 끝납니다
    const { collector, reg } = build(truncated())

    const { results } = await collector.collect()

    expect(results[0].hitPageLimit).toBe(true)
    expect(reg.patches[0]).not.toHaveProperty('lastSeenDate')
  })

  it('안전장치에 걸린 바퀴는 lastError 를 지우지 않는다', async () => {
    // 「구멍이 남았을 수 있다」고 스스로 판정한 바퀴에 오류 표시를 지우면
    // 저장소만 보고는 정상 수집과 구분이 안 됩니다
    const { collector, reg } = build(truncated())

    await collector.collect()

    expect(reg.patches[0]).not.toHaveProperty('lastError')
  })

  it('다음 바퀴에도 같은 경고가 뜬다', async () => {
    // 사람이 손댈 때까지 계속 보여야 합니다
    const { collector } = build(truncated())

    const first = await collector.collect()
    const second = await collector.collect()

    expect(first.results[0].hitPageLimit).toBe(true)
    expect(second.results[0].hitPageLimit).toBe(true)
  })

  it('정상 종료한 바퀴는 커서를 밀고 오류 표시를 지운다', async () => {
    const { collector, reg } = build({
      fetcher: fetcherOf([[item('p1', 'a', '2026-08-21')], []]),
      sources: [
        source({
          sourceKeyPrefix: 'fsc.go.kr/no010101',
          sourceType: 'press',
          watchMethod: 'board',
          lastSeenDate: '2026-08-15',
        }),
      ],
    })

    await collector.collect()

    expect(reg.patches[0]).toMatchObject({
      lastSeenDate: '2026-08-21',
      lastError: null,
    })
  })
})

describe('한 소스가 실패해도 나머지를 계속한다', () => {
  it('실패를 결과에 담고 다음 소스로 간다', async () => {
    // 법령 API 가 죽었다고 게시판 수집까지 멈추면
    // 그날 나온 정책 발표를 통째로 놓칩니다
    const fetch = vi.fn<SourceFetcher['fetch']>(async ({ sourceKeyPrefix }) => {
      if (sourceKeyPrefix === 'law.go.kr/DRF') throw new TypeError('연결 실패')
      return [item('p1', 'a')]
    })
    const { collector } = build({
      fetcher: { fetch },
      sources: [
        source(),
        source({ sourceKeyPrefix: 'fsc.go.kr/no010101', sourceType: 'press' }),
      ],
    })

    const { results } = await collector.collect()

    expect(results).toHaveLength(2)
    expect(results[0].error).toBe('TypeError')
    expect(results[1].added).toBe(1)
  })

  it('던지지 않는다', async () => {
    const { collector } = build({
      fetcher: {
        async fetch() {
          throw new Error('연결 실패')
        },
      },
    })

    await expect(collector.collect()).resolves.toBeDefined()
  })

  it('감시 목록에 기록하다 실패해도 나머지를 계속한다', async () => {
    // 수집 실패의 가장 흔한 원인이 저장소·네트워크라, 실패를 기록하려는
    // 그 호출도 함께 실패합니다. 그것이 새어 나가면 뒤 소스가 통째로 안 돕니다
    const { collector } = build({
      registryFails: true,
      sources: [
        source(),
        source({ sourceKeyPrefix: 'fsc.go.kr/no010101', sourceType: 'press' }),
      ],
    })

    const { results } = await collector.collect()

    expect(results).toHaveLength(2)
    expect(results[0].error).toBe('Error')
    expect(results[1].error).toBe('Error')
  })

  it('가져오기가 실패해도 기록 실패로 던지지 않는다', async () => {
    const { collector } = build({
      registryFails: true,
      fetcher: {
        async fetch() {
          throw new TypeError('연결 실패')
        },
      },
    })

    const { results } = await collector.collect()

    expect(results[0].error).toBe('TypeError')
  })

  it('감시 목록 자체를 못 읽으면 던진다', async () => {
    // 돌 소스를 모르면 결과를 만들 수 없습니다.
    // 빈 결과를 돌려주면 「전부 정상」으로 읽혀 §12.3 이 경고한 상태가 됩니다
    const { collector } = build({
      registry: {
        async list() {
          throw new Error('registry 읽기 실패')
        },
        async update() {},
      },
    })

    await expect(collector.collect()).rejects.toThrow('registry 읽기 실패')
  })

  it('실패를 감시 목록에 남긴다', async () => {
    // 조용히 넘기면 다음 바퀴에서도 안 보입니다
    const { collector, reg } = build({
      fetcher: {
        async fetch() {
          throw new Error('연결 실패')
        },
      },
    })

    await collector.collect()

    expect(reg.patches[0]).toMatchObject({ lastError: 'Error' })
  })

  it('실패한 바퀴는 성공 시각을 찍지 않는다', async () => {
    // 실패를 성공으로 기록하면 §12.3 의 「조용히 멈춘 수집기」 감시가
    // 통째로 무력해집니다 — last_success_at 이 그 판정의 유일한 입력입니다
    const { collector, reg } = build({
      fetcher: {
        async fetch() {
          throw new Error('연결 실패')
        },
      },
    })

    await collector.collect()

    expect(reg.patches[0]).not.toHaveProperty('lastSuccessAt')
  })

  it('성공한 바퀴는 성공 시각을 이번 시각으로 갱신한다', async () => {
    // 옛 값을 그대로 두면 stale 판정이 영영 안 풀립니다.
    // 픽스처의 이전 성공 시각을 지금과 다르게 둬야 갱신 여부가 드러납니다
    const { collector, reg } = build({
      sources: [source({ lastSuccessAt: '2026-08-01T09:00:00.000+09:00' })],
    })

    await collector.collect()

    expect(reg.patches[0]).toMatchObject({ lastSuccessAt: NOW })
  })

  it('실패 사유에 원문을 담지 않는다', async () => {
    const { collector, reg } = build({
      fetcher: {
        async fetch() {
          throw new Error('연결 실패: 110-234-567890')
        },
      },
    })

    await collector.collect()

    expect(JSON.stringify(reg.patches)).not.toContain('110-234')
  })
})

describe('조용히 멈춘 수집기를 알린다 — §12.3', () => {
  /** 지금으로부터 몇 시간 전 */
  function hoursAgo(hours: number): string {
    return new Date(Date.parse(NOW) - hours * 60 * 60 * 1000).toISOString()
  }

  /**
   * 계속 실패하는 소스.
   *
   * **이번 바퀴에 성공하면 멈춘 것이 아니므로**, 임계를 보려면 성공하지 않아야
   * 합니다. 실제로도 조용히 멈춘 수집기란 「계속 실패하고 있는」 소스입니다.
   */
  function failing(over: Partial<WatchedSource>) {
    return build({
      fetcher: {
        async fetch() {
          throw new Error('연결 실패')
        },
      },
      sources: [source(over)],
    })
  }

  it('주기의 두 배를 넘기면 알린다', async () => {
    // 조용히 멈춘 수집기가 가장 위험합니다 —
    // 아무 일도 안 일어나므로 아무도 모릅니다
    const { collector } = failing({ lastSuccessAt: hoursAgo(96), intervalDays: 1 })

    const { stale } = await collector.collect()

    expect(stale).toEqual(['law.go.kr/DRF'])
  })

  it('임계 바로 아래는 안 알린다 — 하루 주기에 30시간', async () => {
    // 두 배(48시간)가 임계입니다. 1배로 줄면 매일 오탐이 뜹니다
    const { collector } = failing({ lastSuccessAt: hoursAgo(30), intervalDays: 1 })

    expect((await collector.collect()).stale).toEqual([])
  })

  it('임계 바로 위는 알린다 — 하루 주기에 54시간', async () => {
    // 3배로 늘면 6일간 멈춰도 침묵합니다
    const { collector } = failing({ lastSuccessAt: hoursAgo(54), intervalDays: 1 })

    expect((await collector.collect()).stale).toEqual(['law.go.kr/DRF'])
  })

  it('고정 시간이 아니라 주기의 배수다 — 이틀 주기에 54시간', async () => {
    // 48시간 상수로 박으면 여기서 걸립니다 (이틀 주기의 임계는 96시간)
    const { collector } = failing({ lastSuccessAt: hoursAgo(54), intervalDays: 2 })

    expect((await collector.collect()).stale).toEqual([])
  })

  it('이틀 주기도 두 배를 넘기면 알린다 — 100시간', async () => {
    const { collector } = failing({ lastSuccessAt: hoursAgo(100), intervalDays: 2 })

    expect((await collector.collect()).stale).toEqual(['law.go.kr/DRF'])
  })

  it('한 번도 성공한 적 없고 이번에도 실패하면 알린다', async () => {
    const { collector } = build({
      sources: [source({ lastSuccessAt: null })],
      fetcher: {
        async fetch() {
          throw new Error('연결 실패')
        },
      },
    })

    expect((await collector.collect()).stale).toEqual(['law.go.kr/DRF'])
  })

  it('이번 바퀴에 성공했으면 안 알린다', async () => {
    // 최초 배포 바퀴와 장애 복구 첫 바퀴에 「전부 멈춤」이 뜨면,
    // 그런 경고가 상시로 뜨는 동안 진짜 멈춘 소스가 묻힙니다
    const { collector } = build({ sources: [source({ lastSuccessAt: null })] })

    const { results, stale } = await collector.collect()

    expect(results[0].added).toBe(1)
    expect(stale).toEqual([])
  })

  it('주기 안이면 안 알린다', async () => {
    const { collector } = failing({ lastSuccessAt: hoursAgo(12), intervalDays: 1 })

    expect((await collector.collect()).stale).toEqual([])
  })

  it('사람이 보는 소스는 멈춘 것으로 세지 않는다', async () => {
    // 자동 감시가 안 되는 층입니다 — 원래 안 도는 것을 고장으로 세면 안 됩니다
    const { collector } = build({
      sources: [
        source({
          sourceKeyPrefix: 'org.contact',
          sourceType: 'manual',
          watchMethod: 'human',
          intervalDays: null,
          lastSuccessAt: null,
        }),
      ],
    })

    const { stale, results } = await collector.collect()

    expect(stale).toEqual([])
    expect(results).toHaveLength(0)
  })
})
