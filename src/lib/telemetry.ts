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
 * | 헤더 | 없을 때 | 왜 그 값이 사실인가 |
 * | --- | --- | --- |
 * | `X-Pii-Token-Count` | 빈 문자열 | 유형별 목록이 비었다는 뜻입니다. `0` 은 유형 이름이 없어 쓸 수 없습니다 |
 * | `X-Pii-Egress-Residual` | `0` | 나간 것이 없으면 나간 것 중 남은 것도 0 건입니다 |
 * | `X-Kb-Version` | 빈 문자열 | *"이 응답이 인용한 KB 버전"* 인데 인용이 없으면 버전도 없습니다 |
 * | `X-Audit-Id` | 빈 문자열 | 이 요청에 남은 감사 기록이 없다는 뜻입니다 |
 *
 * ⬜ **빈 문자열이 「없음」의 표기로 맞는지는 정본에 없습니다.** 값을 지어내는 것보다
 * 낫다고 보고 고른 것입니다 — `-` 같은 기호를 쓰면 그건 정본에 없는 약속을
 * 새로 만드는 것이 됩니다. 정해지면 이 파일만 고칩니다.
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
  return {
    'X-Pii-Token-Count': telemetry.piiTokenCounts
      ? formatCounts(telemetry.piiTokenCounts)
      : '',
    'X-Pii-Egress-Residual': String(telemetry.piiEgressResidual ?? 0),
    'X-Kb-Version': telemetry.kbVersion ?? '',
    'X-Audit-Id': telemetry.auditId ?? '',
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
