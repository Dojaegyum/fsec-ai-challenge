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

import { AppError, userMessageFor } from './errors'

/**
 * 계측 헤더 → 08-14-api.md §1.1.
 *
 * **모든 응답에 붙습니다.** 개인정보 보호가 작동한다는 것을 응답 자체가 증명합니다
 * → 04-pii-boundary.md *"작동할 뿐 아니라 보여야 합니다"*.
 *
 * **건수만 담습니다. 값을 담지 않습니다.**
 */
export interface Telemetry {
  /** 유형별 토큰화 건수. `{ account: 1, name: 2 }` → `account=1;name=2` */
  readonly piiTokenCounts?: Readonly<Record<string, number>>
  /** 송출 직전 잔여 건수. 정상은 `0` */
  readonly piiEgressResidual?: number
  /** 이 응답이 인용한 KB 버전 */
  readonly kbVersion?: string
  /** 감사 로그 식별자 */
  readonly auditId?: string
}

/** `{ account: 1, name: 2 }` → `account=1;name=2`. 비면 `0` 이 아니라 빈 문자열입니다 */
function formatCounts(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .map(([kind, n]) => `${kind}=${n}`)
    .join(';')
}

function telemetryHeaders(telemetry: Telemetry): Record<string, string> {
  const headers: Record<string, string> = {}

  if (telemetry.piiTokenCounts) {
    headers['X-Pii-Token-Count'] = formatCounts(telemetry.piiTokenCounts)
  }
  if (telemetry.piiEgressResidual !== undefined) {
    headers['X-Pii-Egress-Residual'] = String(telemetry.piiEgressResidual)
  }
  if (telemetry.kbVersion) headers['X-Kb-Version'] = telemetry.kbVersion
  if (telemetry.auditId) headers['X-Audit-Id'] = telemetry.auditId

  return headers
}

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

  const headers: Record<string, string> = {
    ...telemetryHeaders({ ...init.telemetry, auditId: init.auditId }),
  }

  if (status === 429 && init.retryAfterSeconds !== undefined) {
    // 남은 창 시간을 그대로 넣습니다 → 08-14-api.md §1.3
    headers['Retry-After'] = String(init.retryAfterSeconds)
  } else if (status === 503) {
    headers['Retry-After'] = String(RETRY_AFTER_503_SECONDS)
  }

  return Response.json(
    {
      error: {
        code,
        // 사용자를 탓하지 않고, 할 수 있는 다음 행동을 함께 줍니다 → §3.2
        message: userMessageFor(code),
        ...(init.auditId ? { audit_id: init.auditId } : {}),
      },
    },
    { status, headers },
  )
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
