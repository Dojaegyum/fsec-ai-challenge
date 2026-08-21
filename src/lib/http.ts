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

/** 성공 응답 하나 */
export function ok(
  body: unknown,
  init: { status?: number; telemetry?: Telemetry } = {},
): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: telemetryHeaders(init.telemetry ?? {}),
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

  const headers: Record<string, string> = {
    ...telemetryHeaders({
      ...init.telemetry,
      auditId,
      // 송출을 막은 응답은 잔여가 **0 이 아닙니다** → 아래
      piiEgressResidual: init.telemetry?.piiEgressResidual ?? residualOf(app),
    }),
  }

  if (status === 429) {
    // 남은 창 시간을 그대로 넣습니다 → 08-14-api.md §1.3.
    // 던진 쪽(rate-limit.ts)이 `detail` 에 실어 보내므로 그것도 봅니다 —
    // 라우트가 예외를 풀어 보고 다시 넣지 않아도 헤더가 빠지지 않게
    const seconds = init.retryAfterSeconds ?? retryAfterFromDetail(app)
    // ⬜ **창이 없는 429 에 무엇을 넣을지는 정본에 없습니다.**
    // §3.1 은 429 의 값을 「남은 창 시간을 그대로」로만 정했는데, 증거 업로드
    // 상한(사건당 30개·300MB)은 창이 아니라 사건이 사는 동안의 누적이라
    // **남은 창이라는 개념 자체가 없습니다** — 기다려도 풀리지 않습니다.
    // 아무 숫자나 넣으면 사용자가 그 초마다 헛되이 다시 누릅니다. 지어내지
    // 않고 **헤더를 빼는 쪽**을 골랐습니다. §3.1 이 429 에 붙이라고 한 것과
    // 어긋나므로 사람에게 물어야 하는 자리입니다
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
 * ⬜ **정본의 코드 표에 `BAD_REQUEST` 가 없습니다** → 08-16-errors.md §3.
 * 표는 도메인 실패만 담고 있어 「본문이 JSON 이 아니다」 같은 것을 넣을 자리가
 * 없습니다. 사용자 문구는 `INTERNAL` 과 같은 것으로 떨어지므로 당장 새는 것은
 * 없지만, **표에 한 줄이 필요한 자리입니다.**
 */
export class BadRequestError extends AppError {
  readonly code: string = 'BAD_REQUEST'
  readonly httpStatus: number = 400
}

/**
 * 인증 없이 관리자·크론 경로에 왔다 → 08-14-api.md §5.1.
 *
 * *"`/api/admin/` 아래 모든 경로에 인증을 겁니다. 인증 없이 접근하면 `401` 입니다."*
 *
 * ⬜ **정본의 코드 표에 401 이 없습니다** → 08-16-errors.md §3. `BAD_REQUEST` 와
 * 같은 자리입니다 — 표는 도메인 실패만 담고 있어 「인증이 없다」를 넣을 칸이
 * 없습니다. 사용자 문구는 `INTERNAL` 것으로 떨어집니다.
 *
 * **왜 그래도 괜찮은가:** 이 경로의 상대는 피해자가 아니라 운영자입니다. 문구가
 * 「처리 중 문제가 발생했습니다」로 나가도 피해자를 혼란시키지 않습니다.
 * **그리고 무엇이 틀렸는지 자세히 알려주지 않는 편이 낫습니다** — 아이디가 틀렸는지
 * 쿠키가 지났는지를 구분해 주면 그게 곧 힌트입니다.
 */
export class UnauthorizedError extends AppError {
  readonly code: string = 'UNAUTHORIZED'
  readonly httpStatus: number = 401
}
