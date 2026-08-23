/**
 * `POST /api/cases/{case_token}/evidence` — 업로드 자리 발급.
 *
 * 정본: spec/common/08-14-api.md §3.2 · §1.3
 * 근거: ADR-028 「라우트는 얇게, 모듈이 두껍게」 · ADR-039(주소는 링크 토큰)
 *
 * ## 파일이 이 함수를 통과하지 않습니다
 *
 * 서버 함수는 요청 본문 크기와 실행 시간에 한계가 있는데 녹음이 수십 MB 입니다.
 * 그래서 **주소만 내주고 브라우저가 저장소로 직행합니다** — 우리가 하는 일은
 * 「어디에 올려라」를 말해 주는 것뿐입니다 → `lib/storage.ts`.
 *
 * ## 폴더 이름이 `[case_token]` 인 이유
 *
 * 주소에 오는 것은 링크 토큰이고 내부 식별자가 아닙니다 → ADR-039.
 * 둘은 규격이 같아(26자 Crockford Base32) **형식으로 못 가르므로**, 어느
 * 사건인지는 저장소 조회로 답합니다 → `caseIdOf`.
 */

import { BadRequestError, readJsonObject } from '@/lib/http'
import { caseIdOf, handleRoute } from '@/lib/request'

import type { EvidenceKind } from '@/modules/case-intake'

/** 09-data-model.md §3 의 `evidence.kind` */
const KINDS: readonly EvidenceKind[] = ['audio', 'image', 'text']

interface EvidenceBody {
  readonly kind?: unknown
  readonly mime_type?: unknown
  readonly byte_size?: unknown
}

/**
 * 요청의 **모양**을 본다.
 *
 * 상한(파일 30개 · 합계 300MB)은 여기서 안 봅니다 — 그건 사건이 지금까지
 * 무엇을 받았는지 알아야 하는 판단이라 `case-intake` 의 몫입니다.
 * **여기서는 「이 요청이 말이 되나」까지입니다** → ARCHITECTURE.md.
 */
function readEvidence(body: EvidenceBody): {
  kind: EvidenceKind
  mimeType: string
  byteSize: number
} {
  if (typeof body.kind !== 'string' || !KINDS.includes(body.kind as EvidenceKind)) {
    // ⚠️ **detail 에 받은 값을 넣지 않습니다** — 감사 기록으로 가는 자리입니다
    throw new BadRequestError('kind 값이 목록 밖입니다', {
      param: 'kind',
      allowed: [...KINDS],
    })
  }

  if (typeof body.mime_type !== 'string' || body.mime_type.length === 0) {
    throw new BadRequestError('mime_type 이 없습니다', { param: 'mime_type' })
  }

  // 정수여야 합니다. 실수나 음수가 오면 상한 계산이 무너집니다 —
  // 음수를 더하면 합계가 줄어 상한을 영영 안 넘습니다
  if (
    typeof body.byte_size !== 'number' ||
    !Number.isSafeInteger(body.byte_size) ||
    body.byte_size <= 0
  ) {
    throw new BadRequestError('byte_size 가 양의 정수가 아닙니다', { param: 'byte_size' })
  }

  return {
    kind: body.kind as EvidenceKind,
    mimeType: body.mime_type,
    byteSize: body.byte_size,
  }
}

export async function POST(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    // **조회가 신분 확인입니다.** 없으면 404 이고, 그 404 는 IP 로 세어
    // 열거를 막습니다 → ADR-039 ④ · `handleRoute`
    const caseId = await caseIdOf(route, container.caseTokens)

    const body = readEvidence(await readJsonObject<EvidenceBody>(ctx.request))
    const slot = await container.caseIntake.acceptEvidence(caseId, body)

    return {
      status: 201,
      body: {
        evidence_id: slot.evidenceId,
        upload_url: slot.uploadUrl,
        upload_method: slot.uploadMethod,
        expires_at: slot.expiresAt,
      },
    }
  })
}
