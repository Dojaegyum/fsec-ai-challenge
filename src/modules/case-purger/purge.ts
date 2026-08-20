/**
 * 파기 — 세 층을 순서대로 지우고, 매 층마다 확인한다.
 *
 * 정본: spec/backend/08-16-data-model.md §14
 *
 * ```
 * 1. 볼트 항목 삭제        (만료로 이미 없을 수 있음)
 * 2. 객체 저장소 파일 삭제
 * 3. 관계형 DB 사건 행 삭제 (외래키 연쇄)
 * 4. audit_log 에 case.purged 기록  ← 감사 로그는 남긴다
 * ```
 *
 * **순서가 중요합니다.** 관계형 DB 가 마지막인 것은 그 행이 「무엇을 지워야 하는가」의
 * 유일한 단서이기 때문입니다. 먼저 지우고 뒤에서 실패하면 **어디에 뭐가 남았는지
 * 알 방법이 없습니다.** 남겨 두면 다음 회차가 같은 사건을 다시 집습니다.
 */

import type {
  AuditSink,
  CasePurge,
  CasePurger,
  CaseStore,
  Clock,
  Layer,
  ObjectStore,
  PurgeRun,
  PurgeTarget,
  VaultStore,
} from './types'

/**
 * 한 번에 처리할 사건 수.
 *
 * ⬜ 서버리스는 실행 시간 상한이 있어 **배치를 쪼개는 설계가 필요할 수 있습니다**
 * → ADR-025 「잃는 것」. 상한을 확인하기 전까지 보수적인 값을 둡니다.
 */
const DEFAULT_LIMIT = 100

export function createCasePurger(deps: {
  cases: CaseStore
  objects: ObjectStore
  vault: VaultStore
  audit: AuditSink
  clock: Clock
}): CasePurger {
  const { cases, objects, vault, audit, clock } = deps

  return {
    async run(options): Promise<PurgeRun> {
      const limit = options?.limit ?? DEFAULT_LIMIT
      const due = await cases.findDue(clock.today(), limit)

      const purged: string[] = []
      const failed: CasePurge[] = []

      for (const target of due) {
        // 하나가 실패해도 나머지를 계속합니다. 하나 때문에 전부 밀리면
        // 파기가 무한정 늦어집니다
        const result = await purgeOne({ cases, objects, vault, audit }, target)
        if (result.purged) {
          purged.push(result.caseId)
        } else {
          failed.push(result)
        }
      }

      return { scanned: due.length, purged, failed }
    },
  }
}

/**
 * 사건 하나를 지운다.
 *
 * **층마다 지우고 바로 확인합니다.** 확인이 안 되면 **다음 층으로 넘어가지 않습니다** —
 * 앞 층이 남은 채 뒤를 지우면, 관계형 DB 행이 사라져 남은 것을 가리킬 단서가 없어집니다.
 */
async function purgeOne(
  deps: {
    cases: CaseStore
    objects: ObjectStore
    vault: VaultStore
    audit: AuditSink
  },
  target: PurgeTarget,
): Promise<CasePurge> {
  const { cases, objects, vault, audit } = deps
  const { caseId } = target

  const steps: { layer: Layer; run: () => Promise<void>; remains: () => Promise<boolean> }[] = [
    // 1. 볼트. 만료로 이미 없을 수 있고, 없는 것은 실패가 아닙니다
    { layer: 'vault', run: () => vault.delete(caseId), remains: () => vault.remains(caseId) },
    // 2. 객체 저장소. 네이티브 만료가 없어 반드시 확인해야 합니다
    { layer: 'objects', run: () => objects.deleteAll(caseId), remains: () => objects.remains(caseId) },
    // 3. 관계형 DB. 마지막입니다 — 남은 것을 가리킬 단서라서입니다
    { layer: 'database', run: () => cases.delete(caseId), remains: () => cases.remains(caseId) },
  ]

  for (const step of steps) {
    try {
      await step.run()
    } catch (error) {
      return stopped(caseId, step.layer, steps, String(error))
    }

    let left: boolean
    try {
      left = await step.remains()
    } catch (error) {
      // 확인 자체가 안 되면 지워졌다고 볼 수 없습니다
      return stopped(caseId, step.layer, steps, `확인 실패: ${String(error)}`)
    }

    if (left) {
      return stopped(caseId, step.layer, steps, `${step.layer} 가 지워지지 않았습니다`)
    }
  }

  // 4. 여기까지 와야 파기입니다. 감사 로그는 사건이 사라져도 남습니다
  await audit.record({
    eventType: 'case.purged',
    caseId,
    detail: { purge_after: target.purgeAfter },
  })

  return { caseId, purged: true, remaining: [] }
}

/**
 * 멈춘 지점부터 뒤를 전부 「남았다」로 봅니다.
 *
 * **지우지 않은 것을 지웠다고 하지 않습니다.** 다음 층은 손도 안 댔으므로
 * 확실히 남아 있습니다.
 */
function stopped(
  caseId: string,
  at: Layer,
  steps: readonly { layer: Layer }[],
  error: string,
): CasePurge {
  const from = steps.findIndex((step) => step.layer === at)
  return {
    caseId,
    purged: false,
    remaining: steps.slice(from).map((step) => step.layer),
    error,
  }
}
