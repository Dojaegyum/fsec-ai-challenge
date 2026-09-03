/**
 * audit-logger — 모든 LLM 호출을 토큰화 텍스트 기준으로 기록하고, 해시 사슬로 잇는다.
 *
 * 정본: spec/backend/08-16-data-model.md §10 · §10.1 · §10.2
 * 근거: ADR-028
 *
 * **서버 전용입니다** — node:crypto 를 씁니다. 브라우저에서 import 하면 번들이 깨집니다.
 *
 * 감사 로그는 **고치지도 지우지도 않습니다.** 사건이 파기돼도 남습니다 —
 * 개인정보가 없으므로 남길 수 있습니다.
 */

import { createHash } from 'node:crypto'

import { PiiBoundaryError } from '@/lib/errors'

import type {
  AuditEvent,
  AuditLogger,
  AuditRecord,
  AuditStore,
  ChainVerdict,
} from './types'

/**
 * `[계좌-1]` 꼴 개인정보 토큰. **detail 에 들어오면 거부합니다.**
 *
 * 정본이 "토큰이라도 넣지 않는다"고 못 박은 이유는, 볼트가 살아 있는 동안
 * 토큰으로 원문을 얻을 수 있기 때문입니다 → §10.1.
 *
 * 원문 개인정보까지 잡지는 못합니다 — 그건 detail 을 만드는 쪽의 몫입니다.
 * **여기서 막는 것은 형태가 뚜렷해 기계로 잡을 수 있는 토큰뿐입니다.**
 */
const PII_TOKEN = /\[[^[\]\n]+-\d+\]/

export function createAuditLogger(deps: {
  store: AuditStore
  /** ISO 8601 문자열. 시간대를 포함합니다 */
  now: () => string
  /** ULID 발급 */
  newId: () => string
}): AuditLogger {
  const { store, now, newId } = deps

  return {
    async record(event: AuditEvent): Promise<AuditRecord> {
      assertNoToken(event.detail)

      // **앞줄을 보고 잇는 것까지 저장소가 한 덩어리로 합니다.** 여기서
      // `lastHash()` 를 따로 부르면 요청이 겹칠 때 사슬이 갈라지고,
      // `verifyChain` 이 그것을 「위조됨」으로 읽습니다 → `AuditStore` 의 경고
      return await store.appendChained((prevHash) => {
        const auditId = newId()
        const createdAt = now()

        return {
          auditId,
          caseId: event.caseId ?? null,
          eventType: event.eventType,
          actorType: event.actorType,
          detail: event.detail,
          prevHash,
          hash: hashOf({
            prevHash,
            auditId,
            eventType: event.eventType,
            detail: event.detail,
            createdAt,
          }),
          createdAt,
        }
      })
    },
  }
}

/**
 * 한 줄의 hash 를 계산한다.
 *
 * 정본이 정한 재료는 다섯입니다 — prev_hash, audit_id, event_type, detail, created_at.
 * 그 다섯을 이어 붙여 SHA-256 을 냅니다 → §10.1.
 *
 * **detail 을 키 정렬해 직렬화합니다.** 저장소가 JSONB 라 읽어올 때 키 순서가
 * 달라질 수 있는데, 순서가 달라지면 같은 내용인데도 해시가 어긋나 사슬이 깨진 것처럼
 * 보입니다. 정렬해 두면 어느 쪽에서 계산해도 같은 값이 나옵니다.
 */
export function hashOf(parts: {
  prevHash: string | null
  auditId: string
  eventType: string
  detail: Readonly<Record<string, unknown>>
  createdAt: string
}): string {
  const joined = [
    parts.prevHash ?? '',
    parts.auditId,
    parts.eventType,
    stableStringify(parts.detail),
    parts.createdAt,
  ].join('\u0000')

  return createHash('sha256').update(joined, 'utf8').digest('hex')
}

/**
 * 사슬이 끊기지 않았는지 확인한다.
 *
 * 시간순으로 넘긴 기록의 hash 를 다시 계산해 대조하고, 앞줄의 hash 가 뒷줄의
 * prevHash 와 이어지는지도 봅니다. **중간을 지우거나 고치면 여기서 드러납니다.**
 */
export function verifyChain(records: readonly AuditRecord[]): ChainVerdict {
  let expectedPrev: string | null = null

  for (const [index, record] of records.entries()) {
    const recomputed = hashOf({
      prevHash: record.prevHash,
      auditId: record.auditId,
      eventType: record.eventType,
      detail: record.detail,
      createdAt: record.createdAt,
    })

    const broken = recomputed !== record.hash || record.prevHash !== expectedPrev

    if (broken) {
      return { intact: false, brokenAt: { index, auditId: record.auditId } }
    }

    expectedPrev = record.hash
  }

  return { intact: true }
}

/** 어디에 중첩돼 있든 토큰을 찾는다 */
function assertNoToken(detail: Readonly<Record<string, unknown>>): void {
  if (!PII_TOKEN.test(JSON.stringify(detail) ?? '')) return

  // 무엇이 들어왔는지 값으로 알려주지 않는다 → 08-16-errors.md 원칙 2
  throw new PiiBoundaryError('감사 로그에 개인정보 토큰을 담을 수 없습니다')
}

/** 키를 정렬해 직렬화한다. 중첩된 객체도 같은 규칙으로 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, one]) => one !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, one]) => `${JSON.stringify(key)}:${stableStringify(one)}`)

  return `{${entries.join(',')}}`
}
