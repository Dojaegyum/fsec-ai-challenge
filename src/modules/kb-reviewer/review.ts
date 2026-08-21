/**
 * 검수 큐를 다루는 자리.
 *
 * 계약: spec/backend/08-16-data-model.md §12.2 ·
 *       spec/backend/08-14-kb-operations.md 원칙 4 · rfc/002-kb-authoring.md
 *
 * ## 이 모듈은 매뉴얼에 쓰지 않습니다
 *
 * 승인은 「사람이 봤고 반영해도 된다」는 표시일 뿐입니다. 실제 반영은 사람이
 * `src/kb/*.json` 을 고치는 것이고, 버전은 적재기가 찍습니다 → RFC-002.
 *
 * **승인이 곧 반영이 되면** 무엇이 어떻게 바뀌었는지가 어디에도 안 남고,
 * 「사람 검수 생략 불가」가 승인 버튼 한 번으로 축소됩니다.
 *
 * ## 미룬 것만 되돌아옵니다
 *
 * `deferred` 는 **「아직 판단하지 않았다」**입니다 → ADR-039. 시행일이 안 정해진
 * 발표처럼 지금은 판단할 수 없는 것에 씁니다.
 *
 * 승인·거절은 잠그고 이것만 다시 받습니다. 전부 잠그면 미룬 것이 거절과
 * 구분되지 않는 종결 상태가 되고, **시행일을 기다리던 개정이 어느 경로로도
 * 승인 기록을 못 받습니다.**
 *
 * ⬜ **앞 판단은 아직 안 남습니다.** `source_change` 의 검수 칸이 한 벌뿐이라
 * 새 판단이 덮습니다. 이력을 어디에 쌓을지는 검수 화면 계약과 함께 정합니다
 * → ADR-039 「남은 것」.
 *
 * ## 확신도가 낮다고 버리지 않습니다
 *
 * 정본이 못 박았습니다 — *"확신도가 낮은 판정을 자동으로 버리지 않습니다."*
 * 낮은 확신도는 **덜 중요하다는 뜻이 아니라 기계가 판단을 못 했다는 뜻**이고,
 * 그럴수록 사람이 봐야 합니다.
 *
 * 그래서 이 모듈은 확신도로 거르지 않고, **묶음의 확신도를 함께 내놓기만** 합니다.
 * 화면이 그 값으로 순서를 정하든 표시를 하든 그건 부르는 쪽의 일입니다.
 */

import { KbError } from '@/lib/errors'

import type {
  ChangeGroup,
  ChangeStore,
  Clock,
  KbReviewer,
  ReviewDecision,
  ReviewStatus,
  SourceChange,
} from './types'

/**
 * 같은 제도 변경을 묶는다.
 *
 * 금융위는 게시판을 넷 운영해서 **같은 발표가 여러 게시판에 함께 올라옵니다.**
 * 본문이 달라 해시로는 안 걸리고, 그대로 두면 사람이 같은 것을 네 번 봅니다.
 *
 * **묶는 키가 없는 것은 각자 한 묶음입니다.** 억지로 합치면 서로 다른 제도
 * 변경이 한 줄로 보여 하나를 승인하면서 다른 하나까지 승인하게 됩니다.
 */
function group(changes: readonly SourceChange[]): ChangeGroup[] {
  const byKey = new Map<string, SourceChange[]>()
  const alone: SourceChange[] = []

  for (const one of changes) {
    if (!one.dedupeKey) {
      alone.push(one)
      continue
    }
    const bucket = byKey.get(one.dedupeKey)
    if (bucket) bucket.push(one)
    else byKey.set(one.dedupeKey, [one])
  }

  const made: ChangeGroup[] = []

  for (const [dedupeKey, bucket] of byKey) {
    made.push(summarize(dedupeKey, bucket))
  }
  for (const one of alone) {
    made.push(summarize(null, [one]))
  }

  // 먼저 감지된 것이 앞입니다. 확신도로 줄 세우지 않습니다 —
  // 그러면 낮은 것이 아래로 밀려 안 보게 됩니다
  //
  // **localeCompare 를 쓰지 않습니다.** 로캘 대조 규칙이라 `.`(밀리초)와
  // `+`(오프셋)의 가중치가 달라, 밀리초가 있는 값과 없는 값이 섞이면 더 이른
  // 시각이 뒤로 갑니다. `detected_at` 은 TIMESTAMPTZ(3) 이고 Postgres 는
  // 밀리초가 0이면 소수부를 생략하므로 한 조회에 두 모양이 섞입니다
  return made.sort((a, b) => {
    const left = Date.parse(oldestAt(a))
    const right = Date.parse(oldestAt(b))
    return left - right
  })
}

function oldestAt(one: ChangeGroup): string {
  return one.changes.reduce(
    (oldest, change) => (change.detectedAt < oldest ? change.detectedAt : oldest),
    one.changes[0].detectedAt,
  )
}

function summarize(
  dedupeKey: string | null,
  changes: readonly SourceChange[],
): ChangeGroup {
  const entries = new Set<string>()
  let confidence: number | null = null

  for (const one of changes) {
    for (const entry of one.impact?.affectedEntries ?? []) entries.add(entry)

    const value = one.impact?.confidence
    if (typeof value === 'number' && Number.isFinite(value)) {
      // 묶음 안에서 가장 높은 것을 냅니다. 낮은 쪽으로 잡으면 근거가 여럿인
      // 묶음이 오히려 덜 확실해 보입니다
      confidence = confidence === null ? value : Math.max(confidence, value)
    }
  }

  return {
    dedupeKey,
    changes,
    confidence,
    affectedEntries: [...entries],
  }
}

/**
 * 다시 판단할 수 있는 상태 → ADR-039.
 *
 * `approved`·`rejected` 는 잠깁니다. 승인 기록을 덮으면 원칙 4 를 지켰는지
 * 확인할 수 없고, 거절을 승인으로 바꾸는 문을 열게 됩니다.
 */
const REOPENABLE: ReadonlySet<ReviewStatus> = new Set(['pending', 'deferred'])

export function createKbReviewer(deps: {
  store: ChangeStore
  clock: Clock
}): KbReviewer {
  const { store, clock } = deps

  return {
    async queue(): Promise<readonly ChangeGroup[]> {
      // 확신도로 거르지 않습니다. 낮은 것이야말로 사람이 봐야 합니다
      return group(await store.listByStatus('pending'))
    },

    async review(decision: ReviewDecision): Promise<void> {
      const found = await store.findById(decision.changeId)
      if (!found) {
        throw new KbError('그 변경을 찾지 못했습니다', {
          changeId: decision.changeId,
        })
      }

      // **승인·거절은 덮어쓰지 않습니다.** 검수 이력이 사라지면 「사람 검수
      // 생략 불가」를 지켰는지 확인할 방법이 없어집니다.
      //
      // **`deferred` 만 예외입니다** → ADR-039. 「미룬다」가 곧 「나중에 다시
      // 본다」이고, 잠그면 미룬 것이 거절과 구분되지 않는 종결 상태가 됩니다 —
      // 시행일을 기다리던 개정이 어느 경로로도 승인 기록을 못 받습니다
      if (!REOPENABLE.has(found.reviewStatus)) {
        throw new KbError('이미 판단이 끝난 변경입니다', {
          changeId: decision.changeId,
          status: found.reviewStatus,
        })
      }

      if (!decision.reviewedBy || decision.reviewedBy.trim().length === 0) {
        // 누가 봤는지가 안 남으면 「사람이 봤다」를 증명할 수 없습니다
        throw new KbError('검수자가 비었습니다', { changeId: decision.changeId })
      }

      await store.applyDecision({
        changeId: decision.changeId,
        status: decision.status,
        reviewedBy: decision.reviewedBy,
        reviewedAt: clock.now(),
        note: decision.note ?? null,
      })
    },

    async markReleased(changeId: string, kbVersion: string): Promise<void> {
      const found = await store.findById(changeId)
      if (!found) {
        throw new KbError('그 변경을 찾지 못했습니다', { changeId })
      }

      // **승인 없이 매뉴얼에 들어가는 경로를 만들지 않습니다** → 원칙 4.
      // 이 검사가 없으면 거절된 변경도 반영된 것으로 표시할 수 있습니다
      if (found.reviewStatus !== 'approved') {
        throw new KbError('승인되지 않은 변경입니다', {
          changeId,
          status: found.reviewStatus,
        })
      }

      if (!kbVersion || kbVersion.trim().length === 0) {
        // 어느 버전에 들어갔는지가 안 남으면 나중에 되짚을 수 없습니다
        throw new KbError('반영된 KB 버전이 비었습니다', { changeId })
      }

      await store.markReleased(changeId, kbVersion)
    },
  }
}
