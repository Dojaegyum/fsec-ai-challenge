/**
 * 사건 생성과 파일 접수.
 *
 * 정본: spec/common/08-14-api.md §3.1 §3.2 · spec/backend/08-16-data-model.md §2 §3
 *
 * **이 모듈은 파일 안을 들여다보지 않습니다.** 종류와 크기만 보고 자리를 냅니다 —
 * 전사는 `transcriber`, 토큰화는 `pii-tokenizer` 의 일이고, 그 경계를 여기서
 * 흐리면 개인정보가 아직 안 걸러진 텍스트가 이 모듈을 통해 돌아다니게 됩니다.
 */

import { IngestError, RateLimitedError } from '@/lib/errors'

import type {
  CaseIntake,
  CaseStore,
  Clock,
  DateShifter,
  EvidenceKind,
  EvidenceRequest,
  IdSource,
  IngestStatus,
  IntakeLimits,
  OpenedCase,
  Track,
  UploadSlot,
  UploadSlotSource,
} from './types'

/** 09-data-model.md §2 */
const TRACKS: readonly Track[] = ['victim', 'frozen_account']

/** 09-data-model.md §3 */
const KINDS: readonly EvidenceKind[] = ['audio', 'image', 'text']

/**
 * 08-14-api.md §1.3 의 사건당 상한.
 *
 * **녹음 여러 개 + 캡처 수십 장을 상정한 값입니다.** 정상 사용을 막지 않습니다.
 */
export const DEFAULT_LIMITS: IntakeLimits = {
  maxFiles: 30,
  maxTotalBytes: 300 * 1024 * 1024,
}

/**
 * 보관 기간. ADR-016 이 **마지막 활동일부터 180일**로 정했습니다.
 *
 * 생성일 기준이 아닌 이유는, 공고 후에 피해를 알고 들어온 피해자가 진입 시점에
 * 이미 두 달이 지나 있어 며칠 만에 만료되기 때문입니다.
 */
export const DEFAULT_PURGE_DAYS = 180

export function createCaseIntake(deps: {
  ids: IdSource
  clock: Clock
  dates: DateShifter
  store: CaseStore
  uploads: UploadSlotSource
  limits?: IntakeLimits
  purgeDays?: number
}): CaseIntake {
  const { ids, clock, dates, store, uploads } = deps
  const limits = deps.limits ?? DEFAULT_LIMITS
  const purgeDays = deps.purgeDays ?? DEFAULT_PURGE_DAYS

  return {
    async open(input): Promise<OpenedCase> {
      if (!TRACKS.includes(input.track)) {
        throw new IngestError(`track 값이 목록 밖입니다: ${input.track}`, {
          track: input.track,
        })
      }

      const opened: OpenedCase = {
        caseId: ids.next(),
        track: input.track,
        // 09-data-model.md §2 의 기본값. 사건은 접수 상태로 시작합니다
        status: 'intake',
        openedAt: clock.now(),
        purgeAfter: dates.addDays(clock.today(), purgeDays),
      }

      await store.createCase(opened)
      return opened
    },

    async acceptEvidence(caseId, req): Promise<UploadSlot> {
      assertRequest(req)

      const totals = await store.evidenceTotals(caseId)

      // 08-14-api.md §1.3 — 넘으면 429 입니다.
      // 사건별 누적이라 게이트웨이가 알 수 없어 여기서 셉니다
      if (totals.count + 1 > limits.maxFiles) {
        throw new RateLimitedError(
          `사건당 파일 수 상한을 넘었습니다: ${limits.maxFiles}개`,
          { caseId, limit: limits.maxFiles, current: totals.count },
        )
      }

      if (totals.bytes + req.byteSize > limits.maxTotalBytes) {
        throw new RateLimitedError(
          `사건당 용량 상한을 넘었습니다: ${limits.maxTotalBytes}바이트`,
          {
            caseId,
            limit: limits.maxTotalBytes,
            current: totals.bytes,
            requested: req.byteSize,
          },
        )
      }

      const evidenceId = ids.next()
      const slot = await uploads.issue({
        caseId,
        evidenceId,
        mimeType: req.mimeType,
        byteSize: req.byteSize,
      })

      await store.addEvidence({
        evidenceId,
        caseId,
        kind: req.kind,
        objectKey: slot.objectKey,
        mimeType: req.mimeType,
        byteSize: req.byteSize,
        // 아직 올라오지 않았습니다. 통지를 받아야 processing 이 됩니다
        ingestStatus: 'pending',
      })

      // 파일을 받은 것도 활동입니다. 파기 예정일을 다시 밉니다
      await store.touchPurgeAfter(caseId, dates.addDays(clock.today(), purgeDays))

      return {
        evidenceId,
        uploadUrl: slot.url,
        uploadMethod: 'PUT',
        expiresAt: slot.expiresAt,
      }
    },

    async completeUpload(caseId, evidenceId): Promise<IngestStatus> {
      const status = await store.markUploaded(caseId, evidenceId)
      await store.touchPurgeAfter(caseId, dates.addDays(clock.today(), purgeDays))
      return status
    },
  }
}

/**
 * 종류와 크기만 봅니다. **내용은 보지 않습니다.**
 *
 * MIME 값을 목록으로 굳히지 않는 이유는 기기마다 같은 녹음을 다른 이름으로
 * 보내기 때문입니다(`audio/m4a` · `audio/x-m4a` · `audio/mp4`). 목록으로 막으면
 * 정상 파일이 거부되는데, 그게 상한을 넘기는 것보다 나쁩니다 — 실제 판독은
 * `transcriber` 가 파일을 열어 보고 판단합니다.
 */
function assertRequest(req: EvidenceRequest): void {
  if (!KINDS.includes(req.kind)) {
    throw new IngestError(`kind 값이 목록 밖입니다: ${req.kind}`, {
      kind: req.kind,
    })
  }

  if (!Number.isInteger(req.byteSize) || req.byteSize <= 0) {
    throw new IngestError(`byte_size 가 올바르지 않습니다: ${req.byteSize}`, {
      byteSize: req.byteSize,
    })
  }

  if (!req.mimeType.trim()) {
    throw new IngestError('mime_type 이 비어 있습니다', {})
  }
}
