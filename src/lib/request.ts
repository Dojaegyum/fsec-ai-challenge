/**
 * 요청 하나를 여는 자리 — 문맥을 만들고, 제한을 걸고, 예외를 응답으로 넘깁니다.
 *
 * 정본: spec/common/08-14-api.md §1 §1.1 §1.3 · spec/backend/08-16-errors.md §3
 * 근거: ADR-028 「라우트는 얇게, 모듈이 두껍게」
 *
 * **라우트마다 같은 껍데기를 다시 쓰지 않습니다.** 한 라우트에서 계측 헤더를
 * 빠뜨리거나 속도 제한을 안 걸면 그 자리만 조용히 규약 밖으로 나가는데,
 * 그건 코드를 읽어서는 안 보입니다. 껍데기가 하나면 빠뜨릴 자리도 하나입니다.
 *
 * ## 라우트가 쓰는 모양
 *
 * ```ts
 * export async function POST(request: Request) {
 *   return handleRoute(request, async (ctx) => {
 *     const body = await readJson<{ track: string }>(ctx.request)
 *     const opened = await ctx.container.caseIntake.open(...)
 *     return { body: opened, status: 201 }
 *   }, { rate: 'caseCreate' })
 * }
 * ```
 *
 * **핸들러는 `Response` 를 만들지 않고 본문만 돌려줍니다.** 응답을 만드는 자리가
 * 하나여야 계측 헤더 넷이 §1.1 대로 **모든 응답에** 붙습니다.
 */

import 'server-only'

import { serverClock } from './clock'
import type { Container } from './container'
import { isCronCall } from './cron-call'
import { isAdminPath, isCronPath } from './gated-paths'
import { AppError } from './errors'
import { BadRequestError, CaseNotFoundError, UnauthorizedError, fail, ok } from './http'
import { isTokenShaped, isUlid } from './ids'
import type { CaseRateBucket, UpfrontRateBucket } from './rate-limit'
import { hasAdminSession } from './session-cookie'
import { createTelemetry, type TelemetryRecorder } from './telemetry'
import { getContainer } from './wire'

/** 한 요청이 도는 동안 들고 다니는 것 */
export interface RequestContext {
  readonly request: Request
  /** 조립본. 라우트는 여기서 모듈을 꺼내 씁니다 */
  readonly container: Container
  /** 이 응답에 실릴 계측값을 모으는 자리 → §1.1 */
  readonly telemetry: TelemetryRecorder
  /** `X-Session-Id` 헤더. 없으면 `null` */
  readonly sessionId: string | null
  /** 프록시가 알려준 발신 주소. 없으면 `null` */
  readonly clientIp: string | null
  /**
   * 사건 단위 제한을 건다 — 경로 파라미터를 푼 **뒤에** 부릅니다.
   *
   * 사건 식별자가 필요한 제한(`chat`·`slot`)은 껍데기가 미리 걸 수 없습니다.
   * 그 값은 `await params` 를 해야 나오기 때문입니다.
   */
  limit(bucket: CaseRateBucket, caseId: string): Promise<void>
}

/** 핸들러가 돌려주는 것. `Response` 가 아니라 본문입니다 */
export interface RouteResult {
  readonly body: unknown
  /** 기본 200. 생성은 201, 접수는 202 → §3.1 §3.2 */
  readonly status?: number
}

export type RouteHandler = (ctx: RequestContext) => Promise<RouteResult>

export interface RouteOptions {
  /**
   * 들어오자마자 걸 제한.
   *
   * - 안 적으면 **`GET`·`HEAD` 는 `'read'`** 가 걸립니다 → §1.3 「그 외 조회」.
   *   폴링(§3.3)이 여기 포함되는데, 라우트마다 적게 두면 새 조회 경로를 만들
   *   때 빠뜨립니다.
   * - 그 외 메서드는 기본이 없습니다. 사건 단위 제한은 `ctx.limit` 로 겁니다.
   * - `'none'` 은 **일부러 안 거는 것**입니다.
   *
   * **사건 단위 갈래는 여기 못 넣습니다.** 타입이 막습니다 — 넣을 수 있게 두면
   * 사건 식별자가 없는 자리에서 사건 카운터를 세려다 실행 중에 터집니다.
   */
  readonly rate?: UpfrontRateBucket | 'none'
  /** 시험에서 조립본을 갈아 끼우는 자리. 실제 라우트는 안 씁니다 */
  readonly container?: Container
}

/**
 * `X-Forwarded-For` 의 첫 칸이 원래 발신자입니다. 뒤는 거쳐온 프록시들입니다.
 *
 * **Vercel 이 이 헤더를 붙입니다.** 로컬에서 직접 부르면 아무것도 없어 `null` 이고,
 * 그때는 아래 `subjectFor` 가 모두를 한 통에 넣습니다 — 구분할 근거가 없으니까요.
 */
export function clientIpOf(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

/** 세션 식별자 → §1 */
export function sessionIdOf(request: Request): string | null {
  return request.headers.get('x-session-id')?.trim() || null
}

/**
 * 이 제한을 무엇으로 셀 것인가.
 *
 * **`X-Session-Id` 가 없으면 IP 로 셉니다** → 08-14-api.md §1.3 (2026-08-21 확정).
 *
 * 400 으로 막지 않습니다. 헤더 하나가 없다고 조회를 거절하면 §1.3 의
 * *"제한이 정상 사용을 막으면 안 됩니다"* 를 정면으로 어깁니다. IP 는 정본이
 * 사건 생성에서 이미 쓰는 기준이라 새로 지어낸 것이 아닙니다.
 *
 * ## 접두사로 이름 공간을 가릅니다
 *
 * `X-Session-Id` 는 **클라이언트가 아무 문자열이나 넣을 수 있습니다** — §1 이
 * 형식을 안 정했습니다. 세션 값과 IP 대체값이 같은 이름 공간을 쓰면, 누가
 * `X-Session-Id: ip:203.0.113.9` 를 보내 **그 주소 뒤에 있는 사람들의 통을 대신
 * 태울 수 있습니다.** 헤더를 안 보내는 클라이언트가 그 IP 로 떨어지는 순간
 * 첫 요청부터 429 를 받습니다.
 *
 * 접두사가 다르면(`s:` 와 `ip:`) 클라이언트가 무엇을 보내든 두 값이 같아질 수
 * 없습니다.
 */
function subjectFor(bucket: UpfrontRateBucket, ctx: {
  sessionId: string | null
  clientIp: string | null
}): string {
  // IP 로 세는 갈래 둘 — 사건 생성(아직 사건이 없다)과 열거 방어(매번 다른 사건이다)
  if (bucket === 'caseCreate' || bucket === 'notFound') {
    return `ip:${ctx.clientIp ?? 'unknown'}`
  }

  // 'read' — 세션당. 없으면 IP 로 떨어집니다
  return ctx.sessionId !== null
    ? `s:${ctx.sessionId}`
    : `ip:${ctx.clientIp ?? 'unknown'}`
}

/**
 * 요청 하나를 처리한다.
 *
 * **예외를 밖으로 내보내지 않습니다.** 무엇이 나오든 §3 의 에러 봉투로 바뀝니다.
 * 우리 예외가 아니면 `INTERNAL` 로 덮여 라이브러리 메시지가 새지 않습니다.
 */
export async function handleRoute(
  request: Request,
  handler: RouteHandler,
  options: RouteOptions = {},
): Promise<Response> {
  const container = options.container ?? getContainer()
  const telemetry = createTelemetry()
  const sessionId = sessionIdOf(request)
  const clientIp = clientIpOf(request)

  // 관리자 경로는 계정이 하나뿐이고 조사 중에 걸리면 곤란합니다 → §1.3.
  // 어디까지가 관리자 경로인지는 문지기와 **같은 판단**을 씁니다 →
  // [gated-paths.ts](./gated-paths.ts). 둘이 어긋나면 그 틈으로 들어옵니다
  const pathname = new URL(request.url).pathname
  const isAdmin = isAdminPath(pathname)
  const isCron = isCronPath(pathname)

  const ctx: RequestContext = {
    request,
    container,
    telemetry,
    sessionId,
    clientIp,
    limit: async (bucket, subject) => {
      if (isAdmin) return
      await container.rateLimiter.check(bucket, subject)
    },
  }

  try {
    // 문지기(`proxy.ts`)가 이미 막았어야 하는 자리입니다. **한 번 더 봅니다.**
    //
    // Next 문서가 *"Always verify authentication and authorization inside each
    // Server Function rather than relying on Proxy alone"* 라고 경고합니다 —
    // `matcher` 를 한 줄 고치거나 경로를 옮기면 문지기가 **조용히** 안 걸립니다.
    //
    // **정본 §5.1 의 「엔드포인트마다 개별로 확인하지 않습니다」를 어기지 않습니다.**
    // 그 문장이 막으려는 것은 *새 관리자 경로를 추가할 때 인증을 빠뜨리는 것*인데,
    // 이 검사는 모든 라우트가 지나는 껍데기 한 곳에 있어 빠뜨릴 자리가 없습니다
    if (isAdmin && !hasAdminSession(request, container.env, serverClock.nowMs())) {
      throw new UnauthorizedError('관리자 인증이 없습니다', { gate: 'admin' })
    }

    // 크론도 같은 이유로 한 번 더 봅니다 → §6.1. 판단은 문지기와 **같은 함수**
    // 입니다([cron-call.ts](./cron-call.ts)) — gated-paths.ts 머리주석의
    // 「세 곳이 같은 판단」 약속이 여기서 완성됩니다. `CRON_SECRET` 이 없는
    // 서버는 전부 401 — 열린 쪽으로 실패하지 않습니다
    if (isCron && !isCronCall(request, container.env.values.CRON_SECRET)) {
      throw new UnauthorizedError('크론 인증이 없습니다', { gate: 'cron' })
    }

    const upfront = options.rate ?? defaultRateFor(request.method)
    if (upfront !== 'none' && !isAdmin) {
      await container.rateLimiter.check(
        upfront,
        subjectFor(upfront, { sessionId, clientIp }),
      )
    }

    const result = await handler(ctx)
    return ok(result.body, {
      status: result.status,
      telemetry: telemetry.snapshot(),
    })
  } catch (error) {
    // **열거 방어는 여기서 겁니다** → ADR-039 ④ · §1.3.
    //
    // 앞의 속도 제한은 요청이 들어오자마자 거는 것이라 「404 를 몇 번 냈나」를
    // 셀 수 없습니다. 그 값은 처리해 봐야 나옵니다.
    //
    // **막는 것이 아니라 세는 것입니다.** 이번 404 는 그대로 나가고, 한도를
    // 넘은 **다음** 요청부터 429 가 됩니다 — 정상 사용자가 링크를 한 번
    // 잘못 눌렀을 때 곧바로 막히면 안 됩니다.
    if (!isAdmin && error instanceof CaseNotFoundError) {
      try {
        await container.rateLimiter.check(
          'notFound',
          subjectFor('notFound', { sessionId, clientIp }),
        )
      } catch (limited) {
        // 한도를 넘었으면 404 대신 429 를 냅니다. 이 지점부터는
        // **사건이 있는지 없는지도 알려주지 않습니다**
        logServerFailure(request, limited)
        return fail(limited, { telemetry: telemetry.snapshot() })
      }
    }

    logServerFailure(request, error)
    return fail(error, { telemetry: telemetry.snapshot() })
  }
}

/**
 * 서버 쪽 실패를 **운영자가 볼 수 있는 곳에** 남긴다.
 *
 * 이게 없으면 안 붙은 자원을 불러 500 이 나가도 **아무 데도 이유가 안 남습니다.**
 * `not-configured.ts` 가 「무엇이 · 어느 환경변수 때문에」를 담아 던지는데,
 * 그 말을 아무도 못 듣는 상태였습니다. `detail` 은 감사 로그로 가지만
 * 그 저장소도 아직 안 붙어 있습니다.
 *
 * ## 5xx 만 남깁니다
 *
 * 400·401·429 는 **정상적으로 오가는 요청**입니다. 그걸 남기면 로그가 그것으로
 * 덮여 진짜 문제가 묻히고, 밖에서 일부러 틀린 요청을 반복해 로그를 채울 수 있습니다.
 *
 * ## 응답과 로그는 경계가 다릅니다
 *
 * 응답에는 우리 예외가 아닌 것의 메시지를 **절대** 싣지 않습니다 — 접속 문자열이
 * 섞여 나갑니다. 로그는 운영자만 보는 자리라 원인을 그대로 남깁니다.
 * 남기지 않으면 무엇이 터졌는지 알아낼 방법이 없습니다.
 *
 * **개인정보는 어느 쪽에도 안 남습니다.** `AppError.detail` 은 계약상 값이 아니라
 * 이름과 건수만 담습니다 → 09-data-model.md §10.1.
 */
function logServerFailure(request: Request, error: unknown): void {
  const app = error instanceof AppError ? error : null
  if (app && app.httpStatus < 500) return

  const where = `${request.method} ${new URL(request.url).pathname}`

  if (app) {
    console.error(`[${where}] ${app.code}: ${app.message}`, app.detail)
    return
  }

  console.error(`[${where}] 알 수 없는 실패`, error)
}

/** 조회는 적지 않아도 걸립니다. 나머지는 라우트가 밝힙니다 */
function defaultRateFor(method: string): UpfrontRateBucket | 'none' {
  return method === 'GET' || method === 'HEAD' ? 'read' : 'none'
}

/**
 * 경로 파라미터에서 **링크 토큰**을 꺼낸다.
 *
 * **`case_id` 가 아닙니다** → ADR-039. 주소에 오는 것은 링크 토큰 하나뿐이고,
 * 내부 식별자는 URL 에 쓰지 않습니다. Next 폴더가 `[case_token]` 이므로
 * 파라미터 키도 `case_token` 입니다.
 *
 * **Next 16 은 경로 파라미터가 `Promise` 입니다.** `await` 없이 읽으면
 * `undefined` 가 나옵니다.
 *
 * ⚠️ **여기서 하는 것은 모양 검사뿐입니다.** 링크 토큰과 `case_id` 는 규격이
 * 같아서(둘 다 26자 Crockford Base32) **형식으로 신분을 확인할 수 없습니다**
 * → `lib/ids.ts` 의 `isTokenShaped`. 「어느 사건인가」는 저장소 조회로
 * 답해야 합니다 → `caseIdOf`.
 *
 * 모양이 틀린 것은 `BAD_REQUEST`(400)입니다 → 08-16-errors.md §3.
 * **`CASE_NOT_FOUND`(404)와 다릅니다** — 이쪽은 「모양이 틀렸다」이고
 * 저쪽은 「모양은 맞는데 그런 사건이 없다」입니다.
 */
export async function caseTokenOf(route: {
  params: Promise<{ case_token: string }>
}): Promise<string> {
  const { case_token: token } = await route.params
  if (typeof token !== 'string' || !isTokenShaped(token)) {
    // ⚠️ **detail 에 값을 넣지 않습니다.** 링크 토큰은 사실상 비밀번호이고
    // 이 detail 은 감사 기록으로 갑니다 → ADR-039 · 09-data-model.md §10.1
    throw new BadRequestError('사건 주소 형식이 아닙니다', {
      param: 'case_token',
      length: typeof token === 'string' ? token.length : 0,
    })
  }
  return token
}

/**
 * 링크 토큰을 내부 사건 식별자로 바꾼다.
 *
 * **이 조회가 신분 확인입니다.** 토큰을 그대로 내부 식별자로 흘리면
 * 두 가지가 깨집니다 — 속도 제한이 사건 단위가 아니라 토큰 단위가 되고
 * (같은 사건인데 다른 값이 오면 카운터가 갈립니다), 기본키 조회는 언제나
 * 빕니다. ADR-039 「검토한 대안」이 그 모양을 명시적으로 기각했습니다.
 *
 * 없으면 `CASE_NOT_FOUND`(404)입니다. **저장소 장애와 구분됩니다** —
 * 조회 자체가 실패하면 그쪽 오류가 그대로 올라옵니다.
 */
export async function caseIdOf(
  route: { params: Promise<{ case_token: string }> },
  resolver: { toCaseId(linkToken: string): Promise<string | null> },
): Promise<string> {
  const token = await caseTokenOf(route)
  const caseId = await resolver.toCaseId(token)
  if (caseId === null) {
    // ⚠️ **토큰을 메시지에도 detail 에도 담지 않습니다**
    throw new CaseNotFoundError('그 주소로 열리는 사건이 없습니다')
  }
  return caseId
}

/**
 * 그 밖의 식별자 경로 파라미터 — `evidence_id` · `step_id` · `message_id`.
 *
 * 전부 ULID 입니다 → 09-data-model.md 의 `CHAR(26)` 키.
 */
export async function ulidParamOf<K extends string>(
  route: { params: Promise<Record<K, string>> },
  key: K,
): Promise<string> {
  const params = await route.params
  const value = params[key]
  if (typeof value !== 'string' || !isUlid(value)) {
    throw new BadRequestError(`${key} 형식이 아닙니다`, {
      param: key,
      length: typeof value === 'string' ? value.length : 0,
    })
  }
  return value
}
