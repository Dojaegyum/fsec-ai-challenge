/**
 * 서버 혼자 하는 다시 맡기기 → ADR-091 §5.
 *
 * 재시도의 주인은 브라우저 셸입니다(ADR-078) — 결과를 받아 토큰화하는 단계는 대응표를 받을
 * 브라우저가 있어야 합니다(ADR-062). **팟에 다시 맡기는 단계만은 원문을 다루지 않으므로**
 * 서버 혼자 할 수 있습니다. 감시자(ADR-092)가 팟을 되살린 직후 한 번 부릅니다 — 사용자가 창을
 * 닫아 둔 자료도 팟에서 미리 처리돼 있다가, 돌아왔을 때 첫 폴링에서 결과가 뜹니다.
 *
 * **여기서 토큰화하지 않습니다.** `collect` 가 `done` 을 줘도 저장하지 않고 둡니다.
 *
 * ## 검토 1회차 — 한 건도, 시간도, 20건 전부를 못 훑을 수 있습니다
 *
 * 라우트의 상한은 60초(`route.ts` 의 `maxDuration`)인데, 팟이 죽어 있으면 `collect` 의 타임아웃과
 * `startReading` 의 맡기기 타임아웃이 건마다 붙어 한 건에 십수 초가 듭니다. 20건을 그대로 훑으면
 * Vercel 이 함수를 죽여 **건수 응답 자체를 못 받습니다** — 아래 두 가드가 그걸 막습니다.
 *
 * 1. **시간 예산** — `RESUBMIT_BUDGET_MS` 를 넘기면 남은 건은 손대지 않고 `skipped` 로 셉니다.
 * 2. **연속 닿지 못함 중단** — `RESUBMIT_UNREACHABLE_STOP` 번 연달아 다시 맡기기도 닿지 못하면,
 *    팟이 그새 살아났을 리 없다고 보고 나머지를 `skipped` 로 남깁니다. 다음 호출(감시자가 다시
 *    부르거나 사람이 다시 부름)이 처음부터 다시 봅니다.
 *
 * 그리고 **묻기의 최종적 거절(4xx)** 은 그 건만 `failed` 로 세고 다음 건으로 넘어갑니다. 여기서
 * 통째로 던지면(옛 동작) 그 건이 다음 호출에서도 `ORDER BY created_at ASC` 때문에 매번 맨 앞에
 * 걸려, 한 건이 나머지 열아홉 건을 영원히 막습니다. `evidenceWrite.fail` 은 적지 않습니다 —
 * 묻기가 거절됐다는 것이 파일이 나쁘다는 증거는 아니고, 그 판정은 여전히 브라우저의 폴링이
 * `collectReading` 안에서 내립니다.
 */

import 'server-only'

import type { Container } from '@/lib/container'
import { IngestError } from '@/lib/errors'

import { startReading } from './read-evidence'

/** 사건 화면을 닫고 이틀 넘게 안 돌아온 자료는 셸의 폴링에 맡깁니다 */
export const RESUBMIT_WITHIN_MS = 48 * 60 * 60 * 1000
/** 팟이 막 돌아온 순간 수십 건이 몰리지 않게 */
export const RESUBMIT_LIMIT = 20
/**
 * 이 호출이 쓸 수 있는 시간 — 라우트 상한(60초)보다 짧게 잡습니다. 남는 15초는 목록 조회와
 * 마지막 건 처리, 응답 직렬화의 몫입니다
 */
export const RESUBMIT_BUDGET_MS = 45_000
/**
 * 다시 맡기기가 이만큼 연달아 닿지 못하면 멈춥니다. 팟이 이 사이에 살아날 수도 있지만,
 * 그러면 다음 호출(감시자 · 사람)이 곧 다시 훑습니다 — 계속 두드려 예산만 태울 이유가 없습니다
 */
export const RESUBMIT_UNREACHABLE_STOP = 2

export interface ResubmitReport {
  readonly scanned: number
  /** 팟이 몰라서(404 · 닿지 못함) 같은 번호로 다시 맡긴 것 */
  readonly resubmitted: number
  /** 팟이 알고 있어서(도는 중 · 끝남 · 팟이 실패라 함) 둔 것 — 브라우저 몫 */
  readonly running: number
  /** 다시 맡기는 것도 닿지 못한 것 — 다음 호출이 다시 집습니다 */
  readonly unreachable: number
  /** 묻기·다시 맡기기가 최종적으로 거절된 것 — 파일이 나쁘다는 판정은 아직 안 내립니다 */
  readonly failed: number
  /** 집었지만 손대지 못한 것 — 예산·연속 닿지 못함 때문에 멈춘 뒤 남은 건 → 검토 1회차 */
  readonly skipped: number
}

export interface ResubmitOptions {
  /** 시험이 예산을 짧게 잡아 보려고 갈아 끼웁니다 */
  readonly budgetMs?: number
  /** 시험이 시계를 갈아 끼웁니다 */
  readonly now?: () => number
}

export async function resubmitEvidence(
  container: Container,
  opts: ResubmitOptions = {},
): Promise<ResubmitReport> {
  const now = opts.now ?? Date.now
  const budgetMs = opts.budgetMs ?? RESUBMIT_BUDGET_MS
  const startedAt = now()

  const rows = await container.evidence.listRetryCandidates({
    withinMs: RESUBMIT_WITHIN_MS,
    limit: RESUBMIT_LIMIT,
  })
  const report = {
    scanned: rows.length,
    resubmitted: 0,
    running: 0,
    unreachable: 0,
    failed: 0,
    skipped: 0,
  }

  // 연달아 몇 건이 「닿지 못함」이었나 — 다른 결과가 나오면 0으로 되돌립니다
  let consecutiveUnreachable = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]

    let known = false
    // 묻기가 최종적으로 거절된 것(4xx) — 이 건만 실패로 세고 다음 건을 봅니다
    let rejected = false
    try {
      const progress = await container.transcriber.collect({
        jobId: row.evidenceId,
        phase: row.kind === 'audio' ? 'stt' : 'ocr',
        kind: row.kind,
      })
      known = progress.status !== 'missing'
    } catch (error) {
      // 미설정(AppError)은 그대로 올립니다 — 이 함수가 고칠 수 있는 상태가 아닙니다
      if (!(error instanceof IngestError)) throw error
      if (error.detail.transient !== true) {
        // **한 건의 거절이 나머지를 막지 않습니다** — 검토 1회차. `ORDER BY created_at ASC` 라
        // 여기서 던지면 다음 호출도 매번 이 건에서 멈춥니다. `evidenceWrite.fail` 은 적지
        // 않습니다 — 묻기 거절이 파일이 나쁘다는 증거는 아닙니다
        rejected = true
      }
      // transient 면 「모른다」로 보고 아래에서 같은 번호로 다시 맡깁니다
    }

    if (rejected) {
      report.failed += 1
      consecutiveUnreachable = 0
    } else if (known) {
      report.running += 1
      consecutiveUnreachable = 0
    } else {
      const started = await startReading(
        {
          caseId: row.caseId,
          evidenceId: row.evidenceId,
          objectKey: row.objectKey,
          kind: row.kind,
          mimeType: row.mimeType,
        },
        container,
      )
      if (started.ok) {
        report.resubmitted += 1
        consecutiveUnreachable = 0
      } else if (started.transient) {
        report.unreachable += 1
        consecutiveUnreachable += 1
      } else {
        report.failed += 1
        consecutiveUnreachable = 0
      }
    }

    const remaining = rows.length - (i + 1)
    if (remaining === 0) break

    // **연속 닿지 못함이거나 예산을 다 썼으면 나머지는 다음 호출로 미룹니다.** 여기서 멈추지
    // 않으면 20건 전부가 죽은 팟에 한 건씩 타임아웃을 물고, 함수 상한(60초)에 걸려 건수
    // 응답조차 못 받습니다
    if (consecutiveUnreachable >= RESUBMIT_UNREACHABLE_STOP || now() - startedAt >= budgetMs) {
      report.skipped += remaining
      break
    }
  }

  return report
}
