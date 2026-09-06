/**
 * `GET /api/cron/purge` — 파기 한 바퀴 (`case.purge_after` 가 지난 사건).
 *
 * 정본: spec/backend/08-16-data-model.md §14 · spec/common/08-14-api.md §6
 * 근거: ADR-016(세 층 같은 수명) · ADR-025(Vercel Cron 이 앱의 라우트를 깨운다) ·
 *       ADR-028(라우트는 얇게)
 *
 * ## ⚠️ 이 자리가 2026-09-03 까지 없었습니다
 *
 * `case-purger` 모듈도, 컨테이너 조립도, 볼트·객체 저장소 포트도 다 서 있었는데
 * **부르는 곳이 하나도 없었습니다**(`casePurger.` 호출 0건). 게다가 관계형 DB
 * 쪽 포트(`purgeCaseStore`)가 미설정 대역이라 불렀어도 그 자리에서 터졌습니다.
 *
 * 그래서 **「마지막 활동일부터 180일 뒤에 지운다」는 약속을 코드가 한 번도 지킨
 * 적이 없습니다.** 화면과 동의 문구는 그렇게 말하고 있었습니다 → ADR-016.
 *
 * ## 여기는 트리거일 뿐입니다
 *
 * 무엇을 어떤 순서로 지우고 어떻게 확인하는지는 전부 `case-purger` 가 압니다.
 * 이 파일은 그 모듈을 깨우고 건수를 돌려줄 뿐입니다 → ADR-028.
 *
 * ## 인증은 두 겹입니다 — 알림 크론과 같습니다
 *
 * 문지기(`proxy.ts`)가 `Authorization: Bearer <CRON_SECRET>` 를 먼저 보고,
 * 요청 껍데기(`lib/request.ts`)가 같은 함수로 한 번 더 봅니다. `CRON_SECRET` 이
 * 비어 있는 서버는 **전부 401** 입니다(§6.1) — 비교할 것이 없을 때 통과시키면
 * **남의 서버의 파기를 밖에서 부를 수 있습니다.** 이 경로는 되돌릴 수 없는
 * 삭제를 하므로 그 문장이 특히 무겁습니다.
 *
 * ## 실패해도 200 입니다
 *
 * `case-purger` 는 던지지 않고 **무엇이 남았는지를 결과로** 돌려줍니다. 사건
 * 하나가 실패해도 나머지를 계속하고, 지워지지 않은 사건은 행이 남아 있으므로
 * **다음 회차가 같은 사건을 다시 집습니다.** 500 을 내면 Vercel 이 실행을
 * 실패로 표시할 뿐, 사건 하나가 밀린 것과 전부가 밀린 것을 구분하지 못합니다.
 */

import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(
    request,
    async (ctx) => {
      const run = await ctx.container.casePurger.run()

      // ⚠️ **어느 사건이 남았는지는 서버 로그에만 적습니다** → §6.2 와 같은 규칙.
      // 크론 응답은 실행 기록에 남는 자리라 사건 식별자를 싣지 않습니다.
      //
      // **로그에는 적습니다** — ADR-025 「남은 것」이 *"파기가 밀렸을 때 관측할
      // 방법이 필요합니다"* 로 남겨 둔 자리이고, 어느 층이 안 지워졌는지 모르면
      // 고칠 수가 없습니다. 사건 식별자는 개인정보가 아닙니다(무작위 26자).
      for (const one of run.failed) {
        console.error(
          `[cron/purge] 파기 실패 case=${one.caseId} 남은층=${one.remaining.join(',')} 이유=${one.error ?? '알 수 없음'}`,
        )
      }

      // **끝난 속도 제한 창도 여기서 걷어냅니다** → ADR-085. 창이 지나면 쓸모없는
      // 줄이고 아무도 안 지우면 남기만 합니다. 사건 파기와 같은 「하루 한 번」이라
      // 크론을 새로 만들지 않았습니다 — 예약 실행은 셋뿐이고 시각을 겹치지 않게
      // 벌려 두었습니다(§6.4 · ADR-025).
      //
      // **실패해도 파기 응답을 깨뜨리지 않습니다.** 배포본에 아직 마이그레이션
      // 0011 이 안 돌았으면 표가 없어 던집니다 — 그 한 줄 때문에 사건 파기가
      // 실패로 보이면 안 됩니다. 위 `run.failed` 와 같은 규칙입니다
      const rateWindows = await ctx.container.rateLimiter.purgeExpired().catch((why: unknown) => {
        console.error(
          `[cron/purge] 속도 제한 창 정리 실패 이유=${why instanceof Error ? why.message : '알 수 없음'}`,
        )
        return null
      })

      return {
        body: {
          scanned: run.scanned,
          purged: run.purged.length,
          failed: run.failed.length,
          // 몇 줄을 걷어냈나. `null` 이면 정리가 실패한 것입니다(로그에 이유가 있습니다)
          rate_windows_purged: rateWindows,
          // **어느 층이 몇 건 남았나.** 볼트만 계속 남으면 볼트 설정이 잘못된
          // 것이고, 객체 저장소만 남으면 삭제 권한 문제입니다 — 건수만으로도
          // 어디를 봐야 하는지가 갈립니다
          remaining: countLayers(run.failed),
        },
      }
    },
    // 크론은 비밀값이 관문입니다 — 세션도 IP 도 셀 단위가 아닙니다.
    // 알림 크론과 같은 이유입니다(§1.3)
    { rate: 'none' },
  )
}

/** 남은 층을 종류별로 셉니다. **사건 식별자는 안 담습니다** */
function countLayers(
  failed: readonly { readonly remaining: readonly string[] }[],
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const one of failed) {
    for (const layer of one.remaining) out[layer] = (out[layer] ?? 0) + 1
  }
  return out
}
