/**
 * `GET /api/cron/kb-collect` — 법령 원문을 하루 1회 가져와 바뀐 것을 검수 큐에 쌓는다.
 *
 * 계약: spec/common/08-14-api.md §6.5 · spec/backend/08-16-data-model.md §12
 * 근거: ADR-012 · ADR-025(크론) · ADR-072
 *
 * **매뉴얼(`kb_entry`)에는 쓰지 않습니다.** 원문을 보존하고 `source_change` 에 `pending` 을 쌓는
 * 것까지가 이 크론의 일입니다. 그 뒤는 사람이 `npm run kb:review` 로 봅니다(RFC-002 · 원칙 4).
 */

import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(
    request,
    async (ctx) => {
      const run = await ctx.container.kbCollector.collect()

      // 소스 하나가 실패해도 나머지는 돕니다 — 실패는 로그와 `source_registry.last_error` 에
      for (const one of run.results) {
        if (one.error) console.error(`[cron/kb-collect] ${one.sourceKeyPrefix}: ${one.error}`)
      }
      for (const prefix of run.stale) {
        console.warn(`[cron/kb-collect] 오래 성공하지 못한 소스: ${prefix}`)
      }

      return {
        body: {
          sources: run.results.map((one) => ({
            source: one.sourceKeyPrefix,
            added: one.added,
            unchanged: one.unchanged,
            pages: one.pages,
            hit_page_limit: one.hitPageLimit,
            ...(one.error ? { error: one.error } : {}),
          })),
          stale: run.stale,
        },
      }
    },
    // 크론은 비밀값이 관문입니다(§6.1) — 속도 제한의 셀 단위가 없습니다
    { rate: 'none' },
  )
}
