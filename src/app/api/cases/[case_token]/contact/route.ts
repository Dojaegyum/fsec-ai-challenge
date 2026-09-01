/**
 * `PUT /api/cases/{case_token}/contact` — 알림용 이메일을 저장한다.
 *
 * 정본: spec/common/08-14-api.md §3.13 · spec/backend/08-16-data-model.md §2 `notify_email`
 * 근거: ADR-021(이메일은 선택·미검증 — 「남은 것」의 저장 위치 TODO 이행) ·
 *       ADR-016(활동이 있으면 파기일을 다시 민다)
 *
 * ## 검증하지 않습니다 — 형식 검사가 곧 관문입니다
 *
 * ADR-021 이 명시적으로 정했습니다: *"인증하지 않는 것이 핵심입니다. 오타가
 * 나면 알림이 안 갈 뿐이고, 그 사이에 사용자가 막히지 않습니다."*
 * 정규식·확인 메일을 여기 넣지 마세요. 보는 것은 타입과 칸의 크기(254)뿐입니다.
 *
 * ## 값은 어디에도 다시 나타나지 않습니다
 *
 * 이메일은 서버가 평문으로 갖는 유일한 연락처입니다(04-pii-boundary.md
 * 「예외 — 알림용 이메일 하나」). 응답 본문·오류 `detail`·감사 로그에 값을
 * 적지 않습니다 — 링크 토큰을 detail 에 안 담는 것과 같은 규칙입니다.
 *
 * ## 창으로 세지 않습니다 — `rate: 'none'`
 *
 * §1.3 의 일곱 줄에 이 경로가 없고, 새 숫자를 여기서 지어내지 않습니다.
 * `PUT` 이라 몇 번을 보내도 칸 하나를 갈아끼울 뿐이고, 링크 토큰 없이는
 * 닿지 못하며, 없는 사건을 찔러 보는 것은 껍데기의 열거 방어(`notFound`)가
 * 따로 셉니다(ADR-039 ④). **안 적으면 빠뜨린 것과 구분되지 않아** 밝혀 둡니다.
 */

import { BadRequestError, readJsonObject } from '@/lib/http'
import { serverClock } from '@/lib/clock'
import { caseIdOf, handleRoute } from '@/lib/request'

/** `VARCHAR(254)` — 형식이 아니라 칸의 크기입니다 → 09-data-model.md §2 */
const MAX_LENGTH = 254

interface ContactBody {
  readonly email?: unknown
}

/**
 * `string | null` 만 받습니다. 빈 문자열은 지우기(`null`)로 봅니다.
 *
 * 앞뒤 공백은 잘라 저장합니다 — 공백 하나로 발송이 조용히 실패하는 것을
 * 막는 것이지 형식 검사가 아닙니다(§3.13).
 */
function readEmail(body: ContactBody): string | null {
  const raw = body.email
  if (raw === null || raw === undefined) return null

  if (typeof raw !== 'string') {
    // ⚠️ **받은 값을 detail 에 넣지 않습니다** — 종류만 말합니다
    throw new BadRequestError('email 은 문자열이거나 null 이어야 합니다', {
      param: 'email',
      got: typeof raw,
    })
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  if (trimmed.length > MAX_LENGTH) {
    // ⚠️ **값을 안 담습니다.** 길이만 — 이메일은 그 자체가 개인정보입니다
    throw new BadRequestError('email 이 너무 깁니다', {
      param: 'email',
      length: trimmed.length,
      max: MAX_LENGTH,
    })
  }

  return trimmed
}

export async function PUT(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const email = readEmail(await readJsonObject<ContactBody>(ctx.request))
    await container.contactWrite.saveNotifyEmail(caseId, email)

    // 이메일 제공도 활동입니다 — 파기일을 다시 밉니다(ADR-016 · §2 `purge_after`).
    // GREATEST 로 앞으로만 밀리므로 지우기(null)로 보내도 당겨지지 않습니다
    await container.ports.caseStore.touchPurgeAfter(
      caseId,
      container.dateChecker.addDays(serverClock.today(), container.env.casePurgeDays),
    )

    // **값을 되돌려주지 않습니다** → §3.13. 확인해 주고 싶어도 그 자리가
    // 곧 값이 응답에 실리는 자리가 됩니다
    return { body: { saved: true } }
  }, { rate: 'none' })
}
