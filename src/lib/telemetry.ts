/**
 * 계측 헤더를 모으고 찍는 자리.
 *
 * 정본: spec/common/08-14-api.md §1.1 · spec/common/08-14-pii-boundary.md
 *
 * §1.1 은 **「모든 응답에 붙습니다」** 입니다. 개인정보 보호가 작동한다는 것을
 * 응답 자체가 증명해야 하기 때문입니다 — *"작동할 뿐 아니라 보여야 합니다"*.
 *
 * **그래서 조건부로 붙이지 않습니다.** 값이 있을 때만 헤더를 다는 방식은
 * 「없음」과 「안 달았음」을 구분할 수 없게 만들고, 그 순간 §1.1 이 뒤집힙니다.
 * 네 헤더는 **언제나 넷 다** 나가고, 담을 것이 없으면 **없다는 뜻의 값**이 나갑니다.
 *
 * ## 담을 것이 없을 때 무엇을 찍나
 *
 * | 헤더 | 없을 때 | 뜻 |
 * | --- | --- | --- |
 * | `X-Pii-Token-Count` | `none` | 토큰화한 유형이 하나도 없습니다 |
 * | `X-Pii-Egress-Residual` | `0` | 나간 것이 없으면 나간 것 중 남은 것도 0 건입니다 |
 * | `X-Kb-Version` | `none` | 이 응답이 인용한 KB 항목이 없습니다 |
 * | `X-Audit-Id` | `none` | 이 요청에 남은 감사 기록이 없습니다 |
 *
 * **「없음」은 `none` 입니다** → 08-14-api.md §1.1 (2026-08-21 확정).
 * 빈 문자열을 쓸 수 없다는 것이 실측으로 확인됐습니다 — 아래.
 *
 * ### 빈 문자열을 쓰지 않는 이유 — 전송 중에 사라집니다
 *
 * 처음에는 빈 문자열로 두었습니다. 값을 지어내지 않는 쪽이 정직하다고 봤기
 * 때문입니다. **그런데 문지기(`proxy.ts`)가 낸 응답에서는 그 헤더가 아예
 * 사라집니다.**
 *
 * ```js
 * // node_modules/next/dist/server/lib/router-utils/resolve-routes.js
 * if (value) {                    // ← 빈 문자열은 falsy 라 통째로 버려집니다
 *   resHeaders[key] = value
 * }
 * ```
 *
 * 라우트가 낸 응답은 이 자리를 안 지나서 빈 값이 그대로 나갑니다. 그래서
 * **같은 규약이 경로에 따라 다르게 지켜지는** 상태였습니다 — `next dev` 와
 * `next start` 양쪽에서 재현했습니다. §1.1 이 *"모든 응답에 붙습니다"* 인데
 * 문지기가 낸 401 에서만 셋이 빠졌습니다.
 *
 * **빈 값이 아니면 어떤 경로에서도 안 사라집니다.** 지어낸 낱말 하나를 쓰는 것과
 * 정본의 한 문장을 못 지키는 것 중에 앞을 골랐습니다.
 *
 * `none` 이 값과 헷갈릴 일은 없습니다 — KB 버전은 `2026.08.1` 꼴이고 감사
 * 식별자는 26자 ULID 라 어느 쪽도 `none` 이 될 수 없습니다.
 *
 * **건수만 담습니다. 값을 담지 않습니다.**
 */

import 'server-only'

/** 한 응답에 실리는 계측값 → §1.1 */
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

/**
 * 담을 것이 없을 때의 표기.
 *
 * **빈 문자열을 쓰면 문지기가 낸 응답에서 헤더가 통째로 사라집니다** — 위 참고.
 */
export const TELEMETRY_NONE = 'none'

/** 네 이름. 시험이 「넷 다 붙었는가」를 이 목록으로 봅니다 */
export const TELEMETRY_HEADER_NAMES = [
  'X-Pii-Token-Count',
  'X-Pii-Egress-Residual',
  'X-Kb-Version',
  'X-Audit-Id',
] as const

/** `{ account: 1, name: 2 }` → `account=1;name=2` */
function formatCounts(counts: Readonly<Record<string, number>>): string {
  return Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => `${kind}=${n}`)
    .join(';')
}

/**
 * 계측값을 헤더 네 줄로.
 *
 * **넷을 언제나 함께 냅니다.** 하나라도 조건부로 두면 §1.1 이 깨집니다.
 */
export function telemetryHeaders(telemetry: Telemetry): Record<string, string> {
  const counts = telemetry.piiTokenCounts
    ? formatCounts(telemetry.piiTokenCounts)
    : ''

  return {
    'X-Pii-Token-Count': counts || TELEMETRY_NONE,
    'X-Pii-Egress-Residual': String(telemetry.piiEgressResidual ?? 0),
    'X-Kb-Version': telemetry.kbVersion || TELEMETRY_NONE,
    'X-Audit-Id': telemetry.auditId || TELEMETRY_NONE,
  }
}

/**
 * 한 요청이 도는 동안 계측값을 모으는 자리.
 *
 * 흐름 여러 곳이 조금씩 채웁니다 — 토큰화가 건수를, 송출 검사가 잔여를,
 * KB 조회가 버전을, 감사 기록이 식별자를. **모아 두었다가 응답 한 번에 찍습니다.**
 */
export interface TelemetryRecorder {
  /**
   * 토큰화 건수를 **더합니다**. 한 요청에서 두 번 토큰화하면 합쳐져야 합니다
   * (예: 챗 발화 + 슬롯 값).
   */
  addTokenCounts(counts: Readonly<Record<string, number>> | undefined): void
  /**
   * 송출 직전 잔여 건수를 적습니다.
   *
   * **실제로 송출 검사를 한 자리에서만 부릅니다.** 안 부르면 기본값 `0` 이
   * 나가는데, 그건 「나간 것이 없다」는 뜻입니다 — 검사를 빠뜨린 것과 구분되지
   * 않으므로, 외부 모델을 부르는 경로는 반드시 이것을 부릅니다.
   */
  setEgressResidual(count: number): void
  /** 인용한 KB 버전. 여러 번 오면 **처음 것을 지킵니다** — 아래 참고 */
  useKbVersion(version: string | null | undefined): void
  /** 감사 기록 식별자. 여러 번 오면 처음 것을 지킵니다 */
  useAuditId(auditId: string | null | undefined): void
  /** 지금까지 모인 것 */
  snapshot(): Telemetry
}

export function createTelemetry(initial: Telemetry = {}): TelemetryRecorder {
  const counts: Record<string, number> = { ...(initial.piiTokenCounts ?? {}) }
  let residual = initial.piiEgressResidual
  let kbVersion = initial.kbVersion
  let auditId = initial.auditId

  return {
    addTokenCounts(more) {
      if (!more) return
      for (const [kind, n] of Object.entries(more)) {
        if (!Number.isFinite(n) || n <= 0) continue
        counts[kind] = (counts[kind] ?? 0) + n
      }
    },

    setEgressResidual(count) {
      // 두 번 송출했다면 남은 것도 합쳐야 합니다. 덮어쓰면 앞의 잔여가 사라집니다
      residual = (residual ?? 0) + Math.max(0, count)
    },

    useKbVersion(version) {
      // 한 응답이 두 버전을 인용하는 것은 KB 릴리스 도중이 아니면 생기지 않습니다.
      // 생겼을 때 뒤엣것으로 덮으면 앞 절차의 근거 버전이 조용히 사라지므로,
      // **처음 것을 지키고** 나머지는 버립니다 — 헤더는 하나뿐입니다
      if (!version) return
      kbVersion ??= version
    },

    useAuditId(id) {
      if (!id) return
      auditId ??= id
    },

    snapshot() {
      return {
        piiTokenCounts: counts,
        piiEgressResidual: residual,
        kbVersion,
        auditId,
      }
    },
  }
}
