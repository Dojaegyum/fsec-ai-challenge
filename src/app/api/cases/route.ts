/**
 * `POST /api/cases` — 사건 생성.
 *
 * 정본: spec/common/08-14-api.md §3.1 · §1.3
 * 근거: ADR-028 「라우트는 얇게, 모듈이 두껍게」
 *
 * **이 파일이 하는 일은 셋뿐입니다** — 본문을 읽고, 판단은 모듈에 넘기고,
 * 계약의 표기로 옮깁니다. 도메인 판단은 한 줄도 없습니다.
 *
 * ## 사건을 만드는 즉시 T0 가 붙습니다
 *
 * 슬롯이 하나도 없어도 그렇습니다 → 08-14-slot-tiering.md *"진입 자체로 충분"*.
 * 그래서 응답 안에 플랜이 함께 나갑니다 — 화면이 한 번 더 묻지 않고 곧장
 * 공통 안전 절차를 띄울 수 있어야 하기 때문입니다.
 *
 * ## 사건과 플랜은 함께 저장됩니다
 *
 * 사건을 먼저 저장하면 플랜이 실패했을 때 **되돌아갈 수 없는 빈 사건**이 남습니다 —
 * 에러 봉투에 `case_id` 를 담을 칸이 없기 때문입니다(08-16-errors.md §3).
 * 둘 다 만들어진 뒤 한 번에 저장합니다 → ADR-041.
 *
 * ## 지금 부르면 멈춥니다
 *
 * ⬜ DB 드라이버가 아직 없어(`package.json` 에 하나도 없습니다) 사건을 저장할
 * 자리가 안 붙어 있습니다. 부르면 **무엇이 왜 없는지 말하며** 멈춥니다
 * → [not-configured.ts](@/lib/not-configured).
 */

import { toApiPlan } from '@/flows/api-plan'
import { openCaseWithPlan } from '@/flows/regenerate-plan'
import { BadRequestError, readJsonObject } from '@/lib/http'
import { handleRoute } from '@/lib/request'

import type { Track } from '@/modules/case-intake'

/** 09-data-model.md §2. 통장묶기는 절차가 완전히 다릅니다 */
const TRACKS: readonly Track[] = ['victim', 'frozen_account']

interface OpenCaseBody {
  readonly track?: unknown
}

/**
 * 갈래를 여기서 봅니다.
 *
 * `case-intake` 도 같은 검사를 하지만 거기서는 `IngestError`(422 · *"파일을 읽지
 * 못했습니다"*)가 나갑니다. 파일 얘기가 아닌데 파일 문구가 나가면 사용자가
 * 무엇을 고쳐야 할지 알 수 없습니다.
 *
 * **요청의 모양을 보는 것은 라우트의 일입니다** → ARCHITECTURE.md
 * *"`route.ts` 가 맡는 것은 요청 파싱·인증"*.
 */
function readTrack(body: OpenCaseBody): Track {
  if (typeof body.track !== 'string' || !TRACKS.includes(body.track as Track)) {
    // detail 에 받은 값을 넣지 않습니다 — 감사 로그로 흘러가는 자리입니다
    throw new BadRequestError('track 값이 목록 밖입니다', {
      param: 'track',
      allowed: [...TRACKS],
    })
  }
  return body.track as Track
}

export async function POST(request: Request) {
  return handleRoute(
    request,
    async (ctx) => {
      const track = readTrack(await readJsonObject<OpenCaseBody>(ctx.request))
      const { container } = ctx

      // 사건과 T0 공통 안전 절차를 함께 만들고 한 번에 저장합니다 → ADR-041.
      // 슬롯이 하나도 없어도 절차가 붙습니다 → 08-14-slot-tiering.md
      const { opened, plan } = await openCaseWithPlan(
        { track },
        {
          container,
          store: container.ports.casePlan,
          kbVersion: container.ports.kbVersion,
        },
      )

      ctx.telemetry.useAuditId(plan.auditId)
      ctx.telemetry.useKbVersion(plan.kbVersion)

      return {
        status: 201,
        body: {
          case_id: opened.caseId,
          track: opened.track,
          status: opened.status,
          opened_at: opened.openedAt,
          plan: toApiPlan(plan),
        },
      }
    },
    // IP당 시간당 20건 → §1.3. 사건이 아직 없는 시점이라 다른 기준이 없습니다
    { rate: 'caseCreate' },
  )
}
