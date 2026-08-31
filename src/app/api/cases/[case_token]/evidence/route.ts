/**
 * `POST /api/cases/{case_token}/evidence` — 업로드 자리 발급.
 * `GET  /api/cases/{case_token}/evidence` — 이 사건에 올라온 자료 목록.
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
 *
 * ## 창으로 세지 않습니다 — `rate: 'none'`
 *
 * §1.3 의 증거 상한은 「사건당 파일 30개 · 합계 300MB」로 **누적 총량**이지
 * 창이 아닙니다. 그 숫자는 `case-intake` 가 이미 갖고 있습니다 — 두 곳에 두면
 * 한쪽만 고쳐집니다. **안 적으면 빠뜨린 것과 구분되지 않아** 밝혀 둡니다.
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

/**
 * 이 사건에 올라온 자료를 목록으로 냅니다 — §3.2 `GET`.
 *
 * ## 이 길이 없어서 올린 자료가 화면에서 사라졌습니다
 *
 * 2026-08-31 까지 자료를 읽는 길이 `GET …/evidence/{evidence_id}` 하나였습니다.
 * **그 번호를 아는 것은 방금 올린 브라우저뿐**이고, 자료 레일은 그 목록을
 * 메모리에만 들고 있었습니다. 그래서 —
 *
 * ```
 * 사건 화면에서 올림      그 순간에는 보임
 * 새로고침                사라짐
 * 시작 화면에서 올리고 들어옴   처음부터 안 보임   ← 시연 경로가 여기서 끊깁니다
 * 며칠 뒤 링크로 재접속    올린 자료가 전부 안 보임
 * ```
 *
 * 서버에는 멀쩡히 있고 전사도 되는데 **화면만 존재를 몰랐습니다.** 마지막 줄이
 * 특히 무겁습니다 — 링크 재진입이 이 서비스의 유일한 복귀 수단이고(ADR-021),
 * 몇 달짜리 사건 관리를 내걸었기 때문입니다.
 *
 * ## 전사문 본문은 안 실립니다
 *
 * `has_transcript` 로 있고 없음만 알립니다. 본문은 파일 하나를 고른 뒤
 * §3.3 이 냅니다 — 목록에 실으면 **사건의 모든 전사문이 한 응답에** 나갑니다.
 *
 * ## 파일 이름이 없는 것은 의도입니다
 *
 * `evidence` 표에 이름 칸이 없습니다. 파일 이름에도 개인정보가 들어오기
 * 때문이고(「입금내역_110-2345-678901.png」), 가리는 것은 브라우저의
 * `screenName` 입니다. 화면은 이름 대신 **종류와 올린 시각**으로 그립니다.
 */
export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    // POST 와 같은 규칙 — 조회가 신분 확인이고, 없으면 404 입니다 (ADR-039 ④)
    const caseId = await caseIdOf(route, container.caseTokens)

    const found = await container.evidence.list(caseId)

    return {
      body: {
        evidence: found.map((one) => ({
          evidence_id: one.evidenceId,
          kind: one.kind,
          mime_type: one.mimeType,
          byte_size: one.byteSize,
          ingest_status: one.ingestStatus,
          // 실패했으면 왜인지. §3.3 의 `reason` 과 같은 값입니다
          ingest_error: one.ingestError,
          created_at: one.createdAt,
          has_transcript: one.hasTranscript,
        })),
      },
    }
  })
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
  }, { rate: 'none' })
}
