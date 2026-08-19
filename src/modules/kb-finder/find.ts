/**
 * KB 조회 — 두 묶음, 우선순위 병합.
 *
 * 정본: spec/backend/08-16-chat-context.md §2 · spec/backend/08-16-data-model.md §11.2
 *
 * **이 모듈의 알맹이는 병합입니다.** 조회는 밖(`KbStore`)이 하고, 여기서는
 * 「같은 단계가 여러 순위에 있을 때 무엇을 남기나」를 정합니다. 이걸 안 하면
 * 화면에 지급정지 안내가 두 번 뜹니다 → 09-data-model.md §11.2.
 */

import { AppError, KbUnavailableError } from '@/lib/errors'

import type { KbFinder, KbGroups, KbQuery, KbRow, KbStore } from './types'

/**
 * 조회 우선순위 → 09-data-model.md §11.2.
 *
 * ```
 * 1순위  org_id 일치        국민은행 전용 절차·연락처
 * 2순위  channel_id 일치     CH-bank 유형 기본
 * 3순위  둘 다 없음          전 유형 공통 (112 신고 등)
 * ```
 *
 * **저장소가 정렬해 주더라도 여기서 다시 셉니다.** 쿼리가 바뀌어도 병합 규칙이
 * 조용히 깨지지 않게 하려는 것입니다.
 */
function rankOf(row: KbRow): number {
  if (row.orgId !== null) return 1
  if (row.channelId !== null) return 2
  return 3
}

export function createKbFinder(deps: { store: KbStore }): KbFinder {
  const { store } = deps

  return {
    async find(query: KbQuery): Promise<KbGroups> {
      const [applied, reference] = await Promise.all([
        call(() => store.findApplied(query), 'applied', query),
        call(() => store.findReference(query), 'reference', query),
      ])

      return {
        applied: mergeByPriority(applied),
        // 참고 묶음은 병합하지 않습니다 — 아래 설명
        reference: sortReference(reference),
      }
    },
  }
}

/**
 * 같은 `step_key` 가 여러 순위에 있으면 **높은 순위만 남깁니다.**
 *
 * 기관 전용 항목이 있으면 유형 기본을 대신합니다. 기관 전용에 없는 단계는
 * 유형 기본이 그대로 남고, 유형에도 없으면 공통이 남습니다 — 그래서
 * **기관을 몰라도 유형 기본으로, 유형도 모르면 공통으로** 안내가 나갑니다.
 */
function mergeByPriority(rows: readonly KbRow[]): readonly KbRow[] {
  const best = new Map<string, KbRow>()

  for (const row of rows) {
    const found = best.get(row.stepKey)
    if (!found || rankOf(row) < rankOf(found)) {
      best.set(row.stepKey, row)
    }
  }

  // stepSeq 가 곧 표시 순서입니다. CH-facetoface 는 여기서 순서가 역전됩니다
  return [...best.values()].sort((a, b) => a.stepSeq - b.stepSeq)
}

/**
 * 참고 묶음은 **`step_key` 로 병합하지 않습니다.**
 *
 * 여기 담긴 것은 서로 **다른 유형**의 절차라, 같은 `step_key` 여도 내용이
 * 다릅니다. 간편송금의 지급정지와 시중은행의 지급정지는 요청처가 다릅니다 —
 * 하나로 합치면 다른 하나를 잃습니다.
 */
function sortReference(rows: readonly KbRow[]): readonly KbRow[] {
  return [...rows].sort(
    (a, b) =>
      (a.channelId ?? '').localeCompare(b.channelId ?? '') ||
      a.stepSeq - b.stepSeq,
  )
}

/**
 * 조회 실패를 `KbUnavailableError` 로 올립니다.
 *
 * **빈 결과로 삼키지 않습니다.** 0건과 「조회를 못 했다」는 다른 사건인데,
 * 여기서 뭉개면 KB 가 죽은 것을 근거 없음으로 오인해 1332 안내가 나갑니다 —
 * 사용자는 절차가 없는 줄 압니다 → 10-errors.md.
 *
 * **이미 우리 예외면 그대로 올립니다.** 감싸면 `code` 가 바뀌어 사용자에게
 * 보일 문구와 재시도 판정이 달라집니다 → 10-errors.md §3.
 */
async function call(
  run: () => Promise<readonly KbRow[]>,
  group: string,
  query: KbQuery,
): Promise<readonly KbRow[]> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new KbUnavailableError('KB 조회에 실패했습니다', {
      group,
      kbVersion: query.kbVersion,
      cause: String(error),
    })
  }
}
