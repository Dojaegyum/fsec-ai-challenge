/**
 * 속도 제한을 **Postgres 표 하나에** 세는 구현 → [ADR-085](../../decisions/085-shared-rate-counter.md).
 *
 * 정본: spec/common/08-14-api.md §1.3 · spec/backend/08-16-data-model.md §16
 *
 * ## 왜 생겼나
 *
 * 규칙(무엇을 얼마나)은 전부 [rate-limit.ts](./rate-limit.ts) 에 있고 **여기는
 * 세는 곳만** 바꿉니다. 메모리 카운터는 프로세스마다 따로 세서, Vercel 이 요청을
 * 여러 인스턴스에 나누면 상한이 인스턴스 수만큼 늘어납니다 — 2026-09-06 QA 에서
 * 없는 링크 14건을 같은 순간 보내니 **429 가 하나도 없었습니다.**
 *
 * ## 한 문장인 것이 핵심입니다
 *
 * `INSERT … ON CONFLICT (key) DO UPDATE … RETURNING` 하나로 **증가와 조회를
 * 함께** 합니다. 읽고 나서 쓰면 동시에 들어온 요청이 같은 값을 읽어 상한을
 * 넘습니다(§1.3). 행 잠금이 upsert 안에 있어 20개가 동시에 와도 1..20 이 됩니다.
 *
 * **창이 끝났으면 1 로 시작합니다.** 창 끝(`reset_at`)은 처음 친 시각 + 창 길이라
 * 칠 때마다 뒤로 밀리지 않습니다 — 밀면 상한에 걸린 사람이 영영 못 빠져나옵니다.
 */

import 'server-only'

import type { Sql } from './db'
import type { RateCounterStore } from './rate-limit'

/** Postgres 에 세는 카운터 → ADR-085. 증가와 조회가 한 문장이라 동시 요청에도 상한이 지켜집니다 */
export function createPostgresRateCounter(sql: Sql): RateCounterStore {
  return {
    kind: 'shared',

    async hit(key, windowMs, nowMs) {
      const now = new Date(nowMs)
      const reset = new Date(nowMs + windowMs)

      const rows = await sql<{ count: number; reset_at: Date }[]>`
        INSERT INTO rate_limit_window (key, count, reset_at)
        VALUES (${key}, 1, ${reset})
        ON CONFLICT (key) DO UPDATE SET
          count    = CASE WHEN rate_limit_window.reset_at <= ${now} THEN 1 ELSE rate_limit_window.count + 1 END,
          reset_at = CASE WHEN rate_limit_window.reset_at <= ${now} THEN ${reset} ELSE rate_limit_window.reset_at END
        RETURNING count, reset_at
      `

      const one = rows[0]
      return { count: Number(one.count), resetAtMs: one.reset_at.getTime() }
    },

    async purgeExpired(nowMs) {
      // **던집니다** — 표가 없으면(마이그레이션 0011 전) 여기서 터집니다.
      // 삼키는 것은 부르는 쪽(`purge` 크론)의 몫입니다: 이 한 줄 때문에 사건
      // 파기가 실패로 보이면 안 되고, 여기서 조용히 0 을 내면 「지울 것이
      // 없었다」와 「못 지웠다」가 같은 모양이 됩니다
      const gone = await sql`
        DELETE FROM rate_limit_window WHERE reset_at < ${new Date(nowMs)}
      `
      return gone.count
    },
  }
}
