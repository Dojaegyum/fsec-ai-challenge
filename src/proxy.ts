/**
 * 관리자·크론 경로의 문지기 — 라우트가 돌기 전에 걸립니다.
 *
 * 정본: spec/common/08-14-api.md §5.1 · decisions/025-scheduled-jobs.md 「남은 것」
 *
 * §5.1 이 이렇게 정했습니다.
 *
 * > `/api/admin/` 아래 모든 경로에 인증을 겁니다. 인증 없이 접근하면 `401` 입니다.
 * > **미들웨어에서 경로 접두사로 일괄 처리하고, 엔드포인트마다 개별로 확인하지
 * > 않습니다** — 새 관리자 경로를 추가할 때 인증을 빠뜨리는 것을 막기 위해서입니다.
 *
 * **라우트를 만들기 전에 이 파일을 둡니다.** 나중에 붙이면 그 사이에 만든 경로가
 * 무방비로 돕니다.
 *
 * ## 이름이 `middleware.ts` 가 아닙니다
 *
 * Next 16 에서 `middleware` 규약이 **`proxy` 로 바뀌었습니다.** 함수 이름도
 * `middleware` → `proxy` 입니다 →
 * `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`.
 * 정본이 요구한 「경로 접두사로 일괄 처리」는 이름과 무관하게 그대로 성립합니다.
 *
 * **실행 환경은 Node 로 고정입니다** — `runtime` 을 지정할 수 없습니다. 그래서
 * `node:crypto` 로 서명을 확인할 수 있습니다.
 *
 * ## 여기서 상태를 들고 있지 않습니다
 *
 * Next 문서가 *"you should not attempt relying on shared modules or globals"* 라고
 * 못 박았습니다. 조립본(`getContainer`)을 부르지 않습니다 — 문지기는 **환경변수와
 * 요청 헤더만** 봅니다.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { readEnv } from '@/lib/env'
import { userMessageFor } from '@/lib/errors'
import { isAdminPath, isCronPath } from '@/lib/gated-paths'
import { hasAdminSession } from '@/lib/session-cookie'
import { telemetryHeaders } from '@/lib/telemetry'

/**
 * 이 두 갈래에만 겁니다.
 *
 * **`matcher` 는 빌드할 때 그대로 읽히는 값이어야 합니다** — 변수를 넣으면
 * 조용히 무시되고 문지기가 아무 데도 안 걸립니다. 그래서 값을 여기 직접 적고,
 * [gated-paths.ts](./lib/gated-paths.ts) 의 것과 **같은지를 시험이 봅니다.**
 * 둘이 어긋나면 그 틈으로 인증 없이 들어옵니다.
 */
export const config = {
  matcher: ['/api/admin/:path*', '/api/cron/:path*'],
}

/**
 * 401 하나.
 *
 * **계측 헤더 넷을 여기서도 답니다** → §1.1 *"모든 응답에 붙습니다"*.
 * 문지기가 낸 응답만 헤더가 없으면 그 규약에 구멍이 생깁니다.
 *
 * **왜 막혔는지 자세히 말하지 않습니다.** 아이디가 틀렸는지 쿠키가 지났는지
 * 크론 비밀값이 없는 서버인지를 구분해 주면 그게 곧 힌트입니다.
 *
 * **문구를 여기 박지 않고 `userMessageFor` 를 지납니다** → [errors.ts](./lib/errors.ts).
 * 요청 껍데기가 내는 401 과 같은 자리에서 문구를 얻어야, 나중에 정본의 코드 표에
 * `UNAUTHORIZED` 행이 생겼을 때 두 곳이 서로 다른 문장을 말하지 않습니다.
 *
 * **`audit_id` 가 없습니다. 그게 정본입니다** → 08-16-errors.md §3 (2026-08-21 확정).
 *
 * *"모든 에러 응답에 `audit_id` 가 붙습니다"*(§5)의 **예외**입니다 — 인증 없는
 * 요청이 감사 표에 줄을 쓰게 하면 그 자체가 밖에서 잠글 수 없는 쓰기 통로가
 * 됩니다. 실패한 관리자 접근은 **서버 로그에만** 남습니다.
 */
function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: { code: 'UNAUTHORIZED', message: userMessageFor('UNAUTHORIZED') } },
    { status: 401, headers: telemetryHeaders({}) },
  )
}

/**
 * 크론 호출인가.
 *
 * 검증 방식은 ADR-025 「남은 것」이 *"시크릿 검증 방식 미정"* 으로 둔 자리입니다.
 *
 * 지금은 `Authorization: Bearer <CRON_SECRET>` 하나만 받습니다. ADR-025 가 실행
 * 트리거로 **Vercel Cron** 을 골랐고 그것이 이 헤더로 부르기 때문입니다.
 * **다른 방식을 함께 열어 두지 않았습니다** — 받는 문이 여럿이면 그중 하나만
 * 약해도 전체가 약해집니다.
 *
 * **`CRON_SECRET` 이 비어 있으면 무조건 막습니다.** 비교할 것이 없을 때 통과시키면
 * 설정을 빠뜨린 서버의 파기·발송 경로를 밖에서 부를 수 있습니다.
 */
function isCronCall(request: NextRequest, secret: string | undefined): boolean {
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header) return false

  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false

  // 길이가 다르면 그 자체로 다릅니다. 같은 길이일 때만 전부 비교합니다
  if (token.length !== secret.length) return false

  let diff = 0
  for (let i = 0; i < token.length; i += 1) {
    diff |= token.charCodeAt(i) ^ secret.charCodeAt(i)
  }
  return diff === 0
}

export function proxy(request: NextRequest): NextResponse {
  const path = request.nextUrl.pathname

  // 지키는 갈래가 아니면 손대지 않습니다
  if (!isAdminPath(path) && !isCronPath(path)) return NextResponse.next()

  try {
    const env = readEnv()

    if (isAdminPath(path)) {
      // 관리자 계정이 설정 안 된 서버는 관리자 경로가 **닫혀 있어야** 맞습니다.
      // hasAdminSession 이 환경변수가 없으면 거짓을 돌려줍니다
      return hasAdminSession(request, env, Date.now())
        ? NextResponse.next()
        : unauthorized()
    }

    return isCronCall(request, env.values.CRON_SECRET)
      ? NextResponse.next()
      : unauthorized()
  } catch {
    // **어떤 예외든 닫는 쪽으로 떨어집니다.** 여기서 예외가 밖으로 나가면
    // 프레임워크가 500 을 내는데, 그 응답에는 계측 헤더도 에러 봉투도 없어
    // §1.1·§1.4 를 한꺼번에 어깁니다. 그리고 401 과 500 이 갈리는 것 자체가
    // 「무엇을 맞췄는지」를 알려주는 힌트가 됩니다
    return unauthorized()
  }
}
