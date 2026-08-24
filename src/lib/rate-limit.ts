/**
 * 속도 제한 — 정본 §1.3 의 일곱 줄을 코드로.
 *
 * 정본: spec/common/08-14-api.md §1.3 · spec/backend/08-16-errors.md §3.1
 *
 * **보호가 목적이지 절약이 목적이 아닙니다.** 정본이 *"제한이 정상 사용을 막으면
 * 안 됩니다"* 라고 못 박았습니다 — 이 서비스의 사용자는 피해 직후라 급합니다.
 * 아래 값은 전부 사람이 손으로 낼 수 있는 속도보다 훨씬 위입니다.
 *
 * ## 세는 단위가 왜 사건인가
 *
 * 사용자 계정 체계가 없어(§5) 사람을 셀 방법이 없고, 사건은 진입 시점에 하나씩
 * 생기므로 이게 가장 가까운 단위입니다. **사건 생성만 IP 로 셉니다** — 사건이
 * 아직 없는 시점이라 다른 기준이 없습니다.
 *
 * ## 세는 곳 — 공유 저장소가 있으면 거기, 없으면 메모리
 *
 * 정본 §1.3 이 그렇게 정했습니다(2026-08-21). 공유 저장소가 있으면 거기서 세고,
 * 없으면 프로세스 메모리에 셉니다 — 지금은 메모리뿐입니다.
 *
 * **「부르면 터지는 대역」으로 두지 않습니다.** 다른 미설정 자원과 다릅니다
 * → [not-configured.ts](./not-configured.ts). 속도 제한은 **모든 요청이 지나는
 * 길목**이라, 터지게 두면 사건 생성도 조회도 전부 500 이 됩니다.
 * 「제한이 정상 사용을 막으면 안 된다」의 가장 심한 형태입니다.
 *
 * 그 대신 **어느 쪽으로 세고 있는지를 숨기지 않습니다** — `storeKind` 가
 * `'memory'` 로 드러나고 설정 현황에 한 줄로 나옵니다
 * → [config-report.ts](./config-report.ts).
 *
 * | | 프로세스 메모리 | 공유 저장소 |
 * | --- | --- | --- |
 * | 인스턴스 하나 | 정확 | 정확 |
 * | 인스턴스 N개 | **실효 상한이 N배** | 정확 |
 * | 인스턴스 재시작 | 카운터가 0으로 | 유지 |
 *
 * 공유 저장소를 붙일 때 [`RateCounterStore`](#RateCounterStore) 하나만 갈아 끼웁니다.
 * 규칙(무엇을 얼마나)은 이 파일에 그대로 남습니다.
 *
 * ⬜ **공유 구현이 아직 없습니다.** 셀 곳을 안 정했습니다 —
 * `docs/plans/08-20-api-routes.md` 「속도 제한 카운터 위치」. 계약은 여기 있고 구현만 없습니다.
 *
 * ⚠️ **볼트를 따라가지 마세요.** 볼트는 같은 Postgres 로 갔지만(ADR-049) 성격이 다릅니다 —
 * 매핑은 사건당 몇 줄이고 파기일까지 남지만, 카운터는 **초당 여러 번 갱신되고 창이 지나면
 * 버려집니다.** 관계형 DB 에 두면 모든 요청이 쓰기를 한 번씩 더 합니다.
 *
 * 그리고 **인스턴스가 여럿이면 지금은 실효 상한이 그만큼 늘어납니다.** 메모리라
 * 프로세스마다 따로 셉니다.
 */

import 'server-only'

import type { ServerClock } from './clock'
import { RateLimitedError } from './errors'

/** 무엇을 기준으로 세는가 */
export type RateScope = 'case' | 'session' | 'ip'

/** 정본 §1.3 표의 일곱 줄 중 **창(window)으로 세는 다섯** */
export type RateBucket = 'chat' | 'slot' | 'vault' | 'caseCreate' | 'read' | 'notFound'

export interface RateRule {
  readonly bucket: RateBucket
  readonly scope: RateScope
  /** 창 하나에 허용하는 횟수 */
  readonly limit: number
  readonly windowMs: number
  /** 사람이 읽는 이름. 감사·로그에 씁니다 */
  readonly what: string
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/**
 * 정본 §1.3 의 표. **여기 값을 코드 다른 곳에 다시 적지 않습니다.**
 *
 * 증거 업로드는 창이 아니라 누적 총량이라 아래 따로 있습니다.
 */
export const RATE_RULES = {
  // 사람이 읽고 답하는 속도의 몇 배입니다. LLM 호출이라 가장 비쌉니다
  chat: { bucket: 'chat', scope: 'case', limit: 20, windowMs: MINUTE, what: '챗' },
  // 버튼 연타를 흡수합니다
  slot: { bucket: 'slot', scope: 'case', limit: 60, windowMs: MINUTE, what: '슬롯 응답' },
  // 남용 방지. 가족이 같은 망에서 여러 건 만드는 경우까지 덮습니다
  caseCreate: {
    bucket: 'caseCreate',
    scope: 'ip',
    limit: 20,
    windowMs: HOUR,
    what: '사건 생성',
  },
  // 값을 쓰기 직전마다 도니 슬롯과 같은 급입니다
  vault: { bucket: 'vault', scope: 'case', limit: 60, windowMs: MINUTE, what: '매핑 맡기기' },
  // 폴링(§3.3)이 여기 포함됩니다
  read: { bucket: 'read', scope: 'session', limit: 300, windowMs: MINUTE, what: '그 외 조회' },
  /**
   * **열거 방어** → ADR-039 ④.
   *
   * 링크 토큰이 사실상 비밀번호라(ADR-021), 없는 사건을 계속 찔러 보는 것이
   * 유일한 공격 경로입니다. **IP 로 세는 이유**는 나머지 카운터가 전부
   * 사건당인데, 매번 다른 사건을 부르는 공격에는 그게 무의미하기 때문입니다.
   *
   * 정상 사용자는 404 를 거의 만들지 않습니다 — 자기 링크를 쓰니까요.
   */
  notFound: {
    bucket: 'notFound',
    scope: 'ip',
    limit: 10,
    windowMs: MINUTE,
    what: '사건 조회 실패',
  },
} as const satisfies Record<RateBucket, RateRule>

/**
 * 사건 식별자가 있어야 걸 수 있는 갈래.
 *
 * 경로 파라미터를 `await` 해야 나오는 값이라, 요청이 들어오자마자 거는 자리에서는
 * 걸 수 없습니다. **타입으로 갈라 둡니다** — 갈래 이름을 잘못 넘기는 실수를
 * 실행 중이 아니라 컴파일에서 잡습니다.
 */
export type CaseRateBucket = {
  [K in RateBucket]: (typeof RATE_RULES)[K]['scope'] extends 'case' ? K : never
}[RateBucket]

/** 요청이 들어오자마자 걸 수 있는 갈래 — 세는 기준이 세션이나 IP 라 헤더만으로 됩니다 */
export type UpfrontRateBucket = Exclude<RateBucket, CaseRateBucket>

/**
 * 증거 업로드 — **사건당 파일 30개 · 합계 300MB** 는 여기 없습니다.
 *
 * **창으로 세는 것이 아니라 사건이 사는 동안의 누적 총량**이라, 카운터가 아니라
 * 이미 접수된 증거 행을 세어 판단합니다. 그 판단은 이미 `case-intake` 안에
 * 있습니다 (`DEFAULT_LIMITS`) — 파일을 접수하는 자리에서 `evidenceTotals` 를
 * 보고 거절합니다.
 *
 * **값을 여기 한 벌 더 적지 않습니다.** 같은 숫자가 두 곳에 있으면 한쪽만
 * 고쳐질 때 어느 쪽이 정본인지 알 수 없게 됩니다.
 */

/** 한 창의 현재 상태 */
export interface RateWindow {
  /** 이번 것을 포함해 이 창에서 몇 번째인가 */
  readonly count: number
  /** 이 창이 끝나는 시각(ms). `Retry-After` 를 여기서 계산합니다 */
  readonly resetAtMs: number
}

/**
 * 세는 곳.
 *
 * **증가와 조회가 한 번에 일어나야 합니다.** 읽고 나서 쓰면 동시에 들어온 요청이
 * 같은 값을 읽어 상한을 넘깁니다. 공유 저장소로 바꿀 때도 이 모양을 지킵니다
 * (Redis `INCR` + `PEXPIRE` 가 그대로 맞습니다).
 */
export interface RateCounterStore {
  readonly kind: 'memory' | 'shared'
  hit(key: string, windowMs: number, nowMs: number): Promise<RateWindow>
}

/**
 * 프로세스 메모리에 세는 기본 구현.
 *
 * 창이 끝난 항목은 **다음에 그 키를 볼 때** 버립니다. 별도 청소 타이머를 두지
 * 않는 이유는 서버리스 함수가 언제 얼면(freeze) 타이머가 안 도는지 알 수 없어서입니다.
 * 대신 항목 수 상한을 두어 무한정 늘지 않게 합니다.
 *
 * ## 넘칠 때 무엇을 버리나 — **가장 먼저 끝나는 창**입니다
 *
 * 삽입 순서로 버리면 안 됩니다. `X-Session-Id` 는 클라이언트가 아무 값이나 넣을
 * 수 있어(§1 이 형식을 안 정했습니다) 매 요청 다른 값을 보내면 1분짜리 조회
 * 카운터가 상한까지 쌓입니다. 그때 **가장 오래 앉아 있던 항목**을 버리면 그건
 * 창이 가장 긴 사건 생성 카운터(1시간)입니다 — 정본 §1.3 의 「IP당 시간당 20건」이
 * 통째로 0으로 돌아갑니다.
 *
 * **가장 먼저 끝나는 창을 버리면 잃는 것이 가장 적습니다.** 어차피 곧 만료될
 * 항목이고, 오래 세야 하는 카운터가 남습니다.
 */
export function createMemoryRateCounter(maxKeys = 10_000): RateCounterStore {
  const windows = new Map<string, { count: number; resetAtMs: number }>()

  /** 이미 끝난 창을 걷어낸다 */
  const sweep = (nowMs: number) => {
    for (const [key, one] of windows) {
      if (one.resetAtMs <= nowMs) windows.delete(key)
    }
  }

  /** 살아 있는 것 중 가장 먼저 끝나는 것을 하나 버린다. 버릴 것이 없으면 거짓 */
  const evictSoonest = (): boolean => {
    let victim: string | undefined
    let soonest = Number.POSITIVE_INFINITY
    for (const [key, one] of windows) {
      if (one.resetAtMs < soonest) {
        soonest = one.resetAtMs
        victim = key
      }
    }
    if (victim === undefined) return false
    windows.delete(victim)
    return true
  }

  return {
    kind: 'memory',

    async hit(key, windowMs, nowMs) {
      const found = windows.get(key)

      if (!found || found.resetAtMs <= nowMs) {
        if (windows.size >= maxKeys) {
          sweep(nowMs)
          // 새로 넣을 자리가 날 때까지. 버릴 것이 없으면 멈춥니다 —
          // 여기서 안 멈추면 `maxKeys` 가 0 일 때 고리가 안 끝납니다
          while (windows.size >= maxKeys && evictSoonest());
        }
        const fresh = { count: 1, resetAtMs: nowMs + windowMs }
        windows.set(key, fresh)
        return { ...fresh }
      }

      found.count += 1
      return { count: found.count, resetAtMs: found.resetAtMs }
    },
  }
}

export interface RateLimiter {
  /** 지금 무엇으로 세고 있는가. 설정 현황이 이걸 봅니다 */
  readonly storeKind: RateCounterStore['kind']
  /**
   * 한 번 세고, 넘었으면 던진다.
   *
   * @param subject 세는 대상의 값 — 사건 식별자 · 세션 식별자 · IP
   * @throws RateLimitedError 상한을 넘었을 때. `detail.retryAfterSeconds` 에
   *         남은 창 시간이 들어갑니다 → 08-16-errors.md §3.1
   */
  check(bucket: RateBucket, subject: string): Promise<void>
}

export function createRateLimiter(deps: {
  counter: RateCounterStore
  clock: ServerClock
}): RateLimiter {
  const { counter, clock } = deps

  return {
    storeKind: counter.kind,

    async check(bucket, subject) {
      const rule = RATE_RULES[bucket]
      const nowMs = clock.nowMs()
      const window = await counter.hit(`${bucket}:${subject}`, rule.windowMs, nowMs)

      if (window.count <= rule.limit) return

      // 남은 창 시간. 0초를 내보내면 화면이 「지금 다시」로 읽어 곧장 다시 칩니다
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((window.resetAtMs - nowMs) / 1000),
      )

      // detail 에 **대상 값을 넣지 않습니다.** 감사 로그로 흘러가는 자리이고
      // IP 는 그 자체로 사람에 가까운 값입니다 → 09-data-model.md §10.1
      throw new RateLimitedError(`${rule.what} 상한을 넘었습니다`, {
        bucket,
        scope: rule.scope,
        limit: rule.limit,
        windowMs: rule.windowMs,
        retryAfterSeconds,
      })
    },
  }
}
