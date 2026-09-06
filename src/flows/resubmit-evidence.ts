/**
 * 서버 혼자 하는 다시 맡기기 → ADR-091 §5.
 *
 * 재시도의 주인은 브라우저 셸입니다(ADR-078) — 결과를 받아 토큰화하는 단계는 대응표를 받을
 * 브라우저가 있어야 합니다(ADR-062). **팟에 다시 맡기는 단계만은 원문을 다루지 않으므로**
 * 서버 혼자 할 수 있습니다. 감시자(ADR-092)가 팟을 되살린 직후 한 번 부릅니다 — 사용자가 창을
 * 닫아 둔 자료도 팟에서 미리 처리돼 있다가, 돌아왔을 때 첫 폴링에서 결과가 뜹니다.
 *
 * **여기서 토큰화하지 않습니다.** `collect` 가 `done` 을 줘도 저장하지 않고 둡니다.
 */

import 'server-only'

import type { Container } from '@/lib/container'
import { IngestError } from '@/lib/errors'

import { startReading } from './read-evidence'

/** 사건 화면을 닫고 이틀 넘게 안 돌아온 자료는 셸의 폴링에 맡깁니다 */
export const RESUBMIT_WITHIN_MS = 48 * 60 * 60 * 1000
/** 팟이 막 돌아온 순간 수십 건이 몰리지 않게 */
export const RESUBMIT_LIMIT = 20

export interface ResubmitReport {
  readonly scanned: number
  /** 팟이 몰라서(404 · 닿지 못함) 같은 번호로 다시 맡긴 것 */
  readonly resubmitted: number
  /** 팟이 알고 있어서(도는 중 · 끝남 · 팟이 실패라 함) 둔 것 — 브라우저 몫 */
  readonly running: number
  /** 다시 맡기는 것도 닿지 못한 것 — 다음 호출이 다시 집습니다 */
  readonly unreachable: number
  /** 다시 맡기기가 최종적으로 거절된 것 — `startReading` 이 `failed` 로 적었습니다 */
  readonly failed: number
}

export async function resubmitEvidence(container: Container): Promise<ResubmitReport> {
  const rows = await container.evidence.listRetryCandidates({
    withinMs: RESUBMIT_WITHIN_MS,
    limit: RESUBMIT_LIMIT,
  })
  const report = { scanned: rows.length, resubmitted: 0, running: 0, unreachable: 0, failed: 0 }

  for (const row of rows) {
    let known = false
    try {
      const progress = await container.transcriber.collect({
        jobId: row.evidenceId,
        phase: row.kind === 'audio' ? 'stt' : 'ocr',
        kind: row.kind,
      })
      known = progress.status !== 'missing'
    } catch (error) {
      // 닿지 못한 것만 「모른다」로 봅니다. 미설정(AppError)·최종적 실패는 그대로 올립니다
      if (!(error instanceof IngestError) || error.detail.transient !== true) throw error
    }
    if (known) {
      report.running += 1
      continue
    }

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
    if (started.ok) report.resubmitted += 1
    else if (started.transient) report.unreachable += 1
    else report.failed += 1
  }

  return report
}
