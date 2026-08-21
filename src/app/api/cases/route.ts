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
 * ## 지금 부르면 멈춥니다
 *
 * ⬜ DB 드라이버가 아직 없어(`package.json` 에 하나도 없습니다) 사건을 저장할
 * 자리가 안 붙어 있습니다. 부르면 **무엇이 왜 없는지 말하며** 멈춥니다
 * → [not-configured.ts](@/lib/not-configured).
 *
 * ## ⬜ 사건은 저장됐는데 플랜이 실패하면 — 정본에 없습니다
 *
 * `caseIntake.open()` 이 돌아온 시점에 **사건 행은 이미 커밋돼 있습니다.**
 * 그 뒤 플랜 만들기가 실패하면(KB 조회 실패·릴리스 미결·저장 실패) 에러 응답이
 * 나가는데, **에러 봉투에는 `case_id` 를 담을 칸이 없습니다**
 * → 08-16-errors.md §3. 사용자는 방금 만들어진 자기 사건으로 돌아갈 수 없습니다.
 *
 * 지금은 저장소가 하나도 안 붙어 있어 `open()` 자체가 먼저 멈추므로 이 일이
 * 일어나지 않습니다. **DB 만 붙고 KB 릴리스가 아직 미결인 다음 단계에서**
 * 드러납니다 — 진입할 때마다 빈 사건이 하나씩 쌓이고, 사건 생성 상한(IP당
 * 시간당 20건)까지 소진됩니다.
 *
 * **되돌리는 코드를 지어내지 않았습니다.** 정본이 부분 실패를 정하지 않았고,
 * `CaseStore` 에 사건을 지우는 자리도 없습니다. 만들 수 있는 답이 셋인데
 * (① 순서를 바꿔 플랜을 먼저 만든다 ② 실패하면 사건을 지운다 ③ 플랜 없이 201 을
 * 내고 화면이 다시 부른다) 셋 다 사용자에게 하는 약속이 달라 사람이 정해야 합니다.
 */

import { toApiPlan } from '@/flows/api-plan'
import { regeneratePlan } from '@/flows/regenerate-plan'
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

      const opened = await container.caseIntake.open({ track })

      // 09-data-model.md §10.2 — 사건이 열렸다는 사실만. 값은 안 담습니다
      const record = await container.auditLogger.record({
        eventType: 'case.opened',
        actorType: 'user',
        caseId: opened.caseId,
        detail: { track },
      })
      ctx.telemetry.useAuditId(record.auditId)

      // 슬롯이 하나도 없어도 T0 가 붙습니다 → 08-14-slot-tiering.md
      const plan = await regeneratePlan(opened.caseId, {
        container,
        store: container.ports.casePlan,
        kbVersion: container.ports.kbVersion,
      })
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
