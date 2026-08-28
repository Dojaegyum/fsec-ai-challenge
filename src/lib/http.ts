/**
 * 예외를 HTTP 응답으로 옮기는 자리 — 라우트가 공유합니다.
 *
 * 정본: spec/backend/08-16-errors.md §3 §3.1 · spec/common/08-14-api.md §1.1 §1.4
 *
 * **라우트마다 이 변환을 다시 쓰지 않습니다.** 한 곳에서만 하면 `detail` 이 응답에
 * 새는 실수가 한 자리에서 막힙니다 — 08-16-errors.md 가 *"`detail` 은 감사 로그에만
 * 들어갑니다"* 라고 정했습니다.
 */

import 'server-only'

import { AppError, EgressBlockedError, userMessageFor } from './errors'
import { telemetryHeaders, type Telemetry } from './telemetry'

/**
 * 계측 헤더의 정의와 표기는 [telemetry.ts](./telemetry.ts) 로 옮겼습니다.
 *
 * **한 곳에서만 찍습니다.** 08-14-api.md §1.1 이 *"모든 응답에 붙습니다"* 인데,
 * 붙이는 자리가 둘이면 한쪽만 고쳐져 조건부로 되돌아갑니다.
 */
export type { Telemetry } from './telemetry'

/**
 * **중간 경로에 사건이 남지 않게 합니다.**
 *
 * ⬜ **캐시 규정이 정본에 없습니다** — 08-14-api.md 에도 08-16-errors.md 에도
 * 한 줄이 없어, 아래 근거로 `no-store` 를 골랐습니다.
 *
 * 이 API 의 응답은 전부 **링크만 알면 열리는 사건 데이터**입니다
 * (ADR-021 「토큰이 곧 인증」 · ADR-039). 쿠키도 `Authorization` 도 없으므로
 * **중간 캐시가 「누구의 것인지」를 가릴 근거를 아무것도 안 갖습니다.** 값을
 * 안 적으면 Next 가 라우트 응답에 `public` 이 붙은 `Cache-Control` 을 실어
 * 내보내는데(2026-08-27 배포 서버에서 확인), 그러면 사건 본문이 우리가 통제하지
 * 못하는 자리에 남습니다 — **파기(180일)가 우리 저장소에서만 일어납니다.**
 *
 * `private` 이 아니라 `no-store` 인 이유는 브라우저 디스크 캐시까지 막기
 * 위해서입니다. 이 서비스의 사용자는 **자기 기기를 남과 나눠 쓸 수 있고**,
 * 그 화면에는 피해 금액과 기관명이 있습니다.
 *
 * **성공과 실패 양쪽에 붙입니다.** 오류 본문에도 `audit_id` 가 실립니다(§5).
 */
const NO_STORE = 'no-store'

/** 계측 넷(§1.1) + 캐시 한 줄. **모든 응답이 이 자리를 지납니다** */
function baseHeaders(telemetry: Telemetry): Record<string, string> {
  return { ...telemetryHeaders(telemetry), 'Cache-Control': NO_STORE }
}

/** 성공 응답 하나 */
export function ok(
  body: unknown,
  init: { status?: number; telemetry?: Telemetry } = {},
): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: baseHeaders(init.telemetry ?? {}),
  })
}

/**
 * `Retry-After` 를 붙일 상태 코드 → 08-16-errors.md §3.1.
 *
 * **503 에만 고정값을 붙입니다.** 서버가 이미 최대 3초까지 기다려본 뒤 나가는
 * 응답이라 그보다 넉넉히 둡니다.
 *
 * **429 는 계산된 값**이라 남은 창 시간을 부른 쪽이 넣습니다.
 * **502·4xx 에는 안 붙입니다** — 기다린다고 달라지지 않는데 재시도 버튼을 띄우면
 * 사용자가 자기 잘못이라고 생각합니다.
 */
const RETRY_AFTER_503_SECONDS = 10

/**
 * 예외를 응답으로 옮긴다.
 *
 * **`detail` 을 응답에 넣지 않습니다.** 감사 로그에만 들어갑니다 → §3.
 * 그 안에는 사건 식별자·건수처럼 사용자에게 보일 이유가 없는 것이 들어갑니다.
 *
 * **우리 예외가 아니면 `INTERNAL` 로 덮습니다.** 라이브러리 예외 메시지에 접속
 * 문자열이나 내부 경로가 섞여 나가는 것을 막습니다.
 */
export function fail(
  error: unknown,
  init: { auditId?: string; retryAfterSeconds?: number; telemetry?: Telemetry } = {},
): Response {
  const app = error instanceof AppError ? error : null
  const code = app?.code ?? 'INTERNAL'
  const status = app?.httpStatus ?? 500

  // 08-16-errors.md §5 — *"모든 에러 응답에 `audit_id` 가 붙습니다"*.
  // 부른 쪽이 따로 주지 않았으면 이 요청이 모아 둔 계측값에서 찾습니다.
  // 감사 기록이 아직 하나도 안 남은 요청이면 없는 채로 나갑니다
  const auditId = init.auditId ?? init.telemetry?.auditId

  const headers: Record<string, string> = baseHeaders({
    ...init.telemetry,
    auditId,
    // 송출을 막은 응답은 잔여가 **0 이 아닙니다** → 아래
    piiEgressResidual: init.telemetry?.piiEgressResidual ?? residualOf(app),
  })

  if (status === 429) {
    // 남은 창 시간을 그대로 넣습니다 → 08-14-api.md §1.3.
    // 던진 쪽(rate-limit.ts)이 `detail` 에 실어 보내므로 그것도 봅니다 —
    // 라우트가 예외를 풀어 보고 다시 넣지 않아도 헤더가 빠지지 않게
    const seconds = init.retryAfterSeconds ?? retryAfterFromDetail(app)
    // **창이 없는 429 에는 안 붙입니다** → 08-16-errors.md §3.1 (2026-08-21 확정).
    // 증거 업로드 상한(사건당 30개·300MB)은 창이 아니라 사건이 사는 동안의
    // 누적이라 남은 창이라는 개념 자체가 없습니다 — 기다려도 풀리지 않습니다.
    // 아무 숫자나 넣으면 사용자가 그 초마다 헛되이 다시 누릅니다
    if (seconds !== undefined) headers['Retry-After'] = String(seconds)
  } else if (status === 503) {
    headers['Retry-After'] = String(RETRY_AFTER_503_SECONDS)
  }

  return Response.json(
    {
      error: {
        code,
        // 사용자를 탓하지 않고, 할 수 있는 다음 행동을 함께 줍니다 → §3.2
        message: userMessageFor(code),
        ...(auditId ? { audit_id: auditId } : {}),
        // **`Retry-After` 를 붙였나가 곧 이 값입니다** → 08-16-errors.md §3.1.1 「값」.
        //
        // ⚠️ **예외의 `retryable` 필드를 그대로 옮기면 틀립니다.** 그 칸은
        // 「서버가 자기 안에서 다시 시도할까」(§2)이고, 여기는 「사용자가 같은
        // 요청을 다시 보내면 달라질까」입니다. 응답이 여기 왔다는 것은 서버의
        // 재시도가 **이미 끝났다**는 뜻이라, 둘이 뒤집히는 자리가 있습니다
        // (`KbCitationMissingError` 502 · `IngestError` 422).
        //
        // 헤더 유무로 브라우저가 **추론**하게 두지 않는 것이 이 칸의 뜻입니다 —
        // 나중에 둘이 갈릴 때 조용히 틀립니다
        retryable: headers['Retry-After'] !== undefined,
      },
    },
    { status, headers },
  )
}

/** 429 를 던진 쪽이 `detail` 에 남긴 남은 창 시간 */
function retryAfterFromDetail(app: AppError | null): number | undefined {
  const value = app?.detail?.retryAfterSeconds
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : undefined
}

/**
 * 송출을 막은 응답의 잔여 건수 → 08-16-errors.md §6 (1).
 *
 * 정본의 예시가 `EGRESS_BLOCKED` 422 응답에 **`X-Pii-Egress-Residual: 1`** 을
 * 못 박았고, 같은 예시의 감사 기록이 `detail.counts = {"resident_id": 1}` 입니다.
 * 던지는 자리(`chat-publisher`)도 건수를 `detail.counts` 에만 싣습니다.
 *
 * **여기서 옮기지 않으면 헤더가 거짓을 말합니다.** 잔여가 있어서 막은 응답이
 * 「잔여 0건」으로 나가는데, §1.1 이 이 헤더를 둔 이유가 *"PII 보호가 작동한다는
 * 것을 응답 자체가 증명"* 하는 것입니다.
 *
 * **유형 이름은 안 옮기고 합계만 옮깁니다** — 헤더가 건수만 담는 규칙 그대로입니다.
 */
function residualOf(app: AppError | null): number | undefined {
  if (!(app instanceof EgressBlockedError)) return undefined

  const counts = app.detail?.counts
  if (counts === null || typeof counts !== 'object') return undefined

  let total = 0
  for (const value of Object.values(counts as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      total += value
    }
  }
  return total > 0 ? total : undefined
}

/**
 * 요청 본문을 JSON 으로 읽는다.
 *
 * **본문이 깨져 있으면 500 이 아니라 400 입니다.** 라이브러리 예외를 그대로
 * 올리면 `INTERNAL` 로 떨어져 사용자에게 「처리 중 문제가 발생했습니다」가 나가는데,
 * 실제로는 요청이 잘못된 것입니다.
 */
export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T
  } catch {
    throw new BadRequestError('요청 본문을 읽지 못했습니다')
  }
}

/**
 * 요청 본문을 **객체로** 읽는다.
 *
 * `readJson` 은 `as T` 로 타입을 덮어씌울 뿐이라, JSON 으로 유효한
 * `null`·`7`·`"victim"`·`[]` 이 그대로 통과합니다. 그걸 객체로 알고 칸을 읽으면
 * **`null` 에서 터집니다** — 잘못된 요청인데 500 이 나가고, 사용자에게는
 * 「처리 중 문제가 발생했습니다」가 나가 서버 잘못으로 보입니다.
 *
 * 더 나쁜 것은 그 500 이 서버 로그에 쌓인다는 점입니다. 5xx 만 남기기로 한
 * 이유가 *"밖에서 일부러 틀린 요청을 반복해 로그를 채울 수 있습니다"* 인데,
 * 본문 한 글자로 그 방어가 뚫립니다 → [request.ts](./request.ts).
 *
 * **본문이 객체인 라우트는 이것을 씁니다.** 라우트마다 따로 막으면 열두 곳 중
 * 한 곳을 빠뜨립니다.
 */
export async function readJsonObject<T extends object>(request: Request): Promise<T> {
  const body = await readJson<unknown>(request)

  // 배열도 막습니다 — 칸을 읽으면 undefined 가 나와 조용히 다른 실패가 됩니다
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestError('요청 본문이 객체가 아닙니다', {
      // 받은 값을 넣지 않습니다. 무엇이 왔는지는 종류만
      got: body === null ? 'null' : Array.isArray(body) ? 'array' : typeof body,
    })
  }

  return body as T
}

/**
 * 요청 자체가 잘못됐다.
 *
 * 08-16-errors.md §3 — 400. *"요청 형식이 올바르지 않습니다."*
 */
export class BadRequestError extends AppError {
  readonly code: string = 'BAD_REQUEST'
  readonly httpStatus: number = 400
}

/**
 * 그 주소로 열리는 사건이 없다.
 *
 * 08-16-errors.md §3 — 404.
 *
 * **모양이 틀린 것(400)과 다릅니다.** 이쪽은 「26자 규격은 맞는데 그런 사건이
 * 없다」이고, 저쪽은 「26자가 아니거나 허용 문자가 아니다」입니다.
 *
 * ⚠️ **왜 「없다」와 「남의 것이다」를 구분하지 않나** — 링크 토큰이 사실상
 * 비밀번호라(ADR-021 · ADR-039), 둘을 구분해 답하면 **존재 여부가 새어
 * 나갑니다.** 찍어 보는 쪽에 「이 주소는 실재한다」를 알려 주는 셈입니다.
 *
 * ⚠️ **detail 에 토큰을 담지 않습니다.** 이 오류는 감사 기록으로 갑니다.
 */
export class CaseNotFoundError extends AppError {
  readonly code: string = 'CASE_NOT_FOUND'
  readonly httpStatus: number = 404
}

/**
 * 인증 없이 관리자·크론 경로에 왔다 → 08-14-api.md §5.1.
 *
 * *"`/api/admin/` 아래 모든 경로에 인증을 겁니다. 인증 없이 접근하면 `401` 입니다."*
 *
 * 08-16-errors.md §3 — 401.
 *
 * **문구가 일부러 아무것도 알려주지 않습니다.** 아이디가 틀렸는지 쿠키가 지났는지를
 * 구분해 주면 그게 곧 힌트가 됩니다. 이 경로의 상대는 피해자가 아니라 운영자라
 * 뭉뚱그린 문구가 피해자를 혼란시키지 않습니다.
 */
export class UnauthorizedError extends AppError {
  readonly code: string = 'UNAUTHORIZED'
  readonly httpStatus: number = 401
}
