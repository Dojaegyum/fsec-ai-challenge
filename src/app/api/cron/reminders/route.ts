/**
 * `GET /api/cron/reminders` — 기한 알림 발송 한 바퀴.
 *
 * 정본: spec/common/08-14-api.md §6 · spec/backend/08-16-data-model.md §8.4
 * 근거: ADR-025(Vercel Cron 이 앱의 라우트를 깨운다) · ADR-021(이메일은 선택)
 *
 * ## 여기는 트리거일 뿐입니다
 *
 * 「보낼지 말지」는 전부 `reminder-sender` 가 판단합니다 — 이메일이 있는가,
 * 기한이 확정인가, 이미 보낸 건 아닌가. 이 파일은 그 모듈을 깨우고 요약을
 * 돌려줄 뿐, 판단을 한 줄도 더하지 않습니다(ADR-028 「라우트는 얇게」).
 *
 * ## 인증은 두 겹입니다
 *
 * 문지기(`proxy.ts`)가 `Authorization: Bearer <CRON_SECRET>` 를 먼저 보고,
 * 요청 껍데기(`lib/request.ts`)가 **같은 함수**(`lib/cron-call.ts`)로 한 번 더
 * 봅니다. Vercel 은 `CRON_SECRET` 환경변수가 있으면 크론 호출에 이 헤더를
 * 실어 보냅니다 — 비어 있는 서버는 전부 401 이고, 그게 맞습니다(§6.1).
 *
 * ## 발송 수단이 없어도 돕니다
 *
 * `Mailer` 가 미설정이면(§1.2 `MAILER_API_KEY` — ⬜ 발송 수단 미정 → ADR-021)
 * 보낼 사건이 `failed` 로 남습니다. 정직한 결과입니다 — `no_email`·`nothing_due`
 * 집계는 발송 수단 없이도 맞고, 미발송 사실이 숫자로 드러납니다.
 *
 * ⬜ TODO(근거 필요): Vercel Cron 의 플랜별 실행 빈도·타임아웃 상한 → ADR-025
 * 「남은 것」. 확인 전에는 「하루 1회로 충분하다」를 전제로 쓰지 마세요 —
 * 주기는 `vercel.json` 의 `crons` 가 정합니다(지금 UTC 00:00 = KST 09:00).
 */

import { handleRoute } from '@/lib/request'

import type { SkipReason } from '@/modules/reminder-sender'

export async function GET(request: Request) {
  return handleRoute(
    request,
    async (ctx) => {
      const run = await ctx.container.reminderSender.run()

      // 실패는 서버 로그에만 원인을 남깁니다 — 응답은 실행 기록에 남는 자리라
      // 건수만 싣습니다(§6.2). 발송 오류 문구에는 수신 주소가 섞일 수 있습니다
      for (const one of run.failed) {
        console.error(`[cron/reminders] 발송 실패 case=${one.caseId}: ${one.error}`)
      }

      const skipped: Record<SkipReason, number> = {
        no_email: 0,
        not_confirmed: 0,
        already_sent: 0,
        nothing_due: 0,
      }
      for (const one of run.skipped) skipped[one.reason] += 1

      // ⚠️ **이메일 주소·사건 식별자를 싣지 않습니다** → §6.2.
      // `run.sent` 안에는 수신 주소가 들어 있습니다 — 그대로 내보내면 안 됩니다
      return {
        body: { sent: run.sent.length, skipped, failed: run.failed.length },
      }
    },
    // 크론은 비밀값이 관문입니다 — 세션도 IP 도 셀 단위가 아닙니다.
    // 관리자 경로에 제한을 안 거는 것과 같은 이유입니다(§1.3)
    { rate: 'none' },
  )
}
