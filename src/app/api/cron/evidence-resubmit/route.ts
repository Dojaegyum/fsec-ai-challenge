/**
 * `POST /api/cron/evidence-resubmit` — 팟이 모르는 처리중 자료를 같은 번호로 다시 맡긴다.
 * 정본: spec/common/08-14-api.md §6.6 · ADR-091 §5
 * 근거: ADR-078(재시도의 주인은 셸 — 다시 맡기기만 서버 혼자) · ADR-092(감시자가 팟을 되살린 직후 부른다)
 *
 * ## 크론이 아닌데 왜 `/api/cron/` 아래인가
 *
 * 기계가 비밀값으로 부르는 주소이고, 문지기(`proxy.ts`)와 껍데기(`lib/request.ts`)가
 * `/api/cron/` 아래를 `Authorization: Bearer <CRON_SECRET>` 로 이미 지킵니다(§6.1). 새 문을 열면
 * 받는 문이 둘이 되고, 그중 하나만 약해도 전체가 약해집니다.
 *
 * ## 여기는 트리거일 뿐입니다
 *
 * 무엇을 다시 맡기고 무엇을 두는지는 `flows/resubmit-evidence.ts` 가 압니다. **토큰화는 하지
 * 않습니다** — 대응표를 받을 브라우저가 없습니다(ADR-062).
 *
 * ## 실패해도 200 입니다 — 건수뿐
 *
 * 닿지 못한 자료는 `unreachable` 로 세고 다음 호출이 다시 집습니다. 60초 상한(아래 `maxDuration`)
 * 안에 20건을 다 못 볼 수 있어, 시간 예산이나 연속 닿지 못함 때문에 손대지 못한 채 남은 건은
 * `skipped` 로 셉니다(ADR-091 §5 · 검토 1회차) — 함수가 죽어 건수 응답 자체를 잃는 것보다
 * 낫습니다. 사건·증거 식별자는 싣지 않습니다 — 크론 응답은 실행 기록에 남는 자리입니다
 * (§6.2 와 같은 규칙).
 */

import { resubmitEvidence } from '@/flows/resubmit-evidence'
import { handleRoute } from '@/lib/request'

export const maxDuration = 60

export async function POST(request: Request) {
  return handleRoute(
    request,
    async (ctx) => ({ body: await resubmitEvidence(ctx.container) }),
    // 기계가 비밀값으로 부르는 자리라 창으로 세지 않습니다 — 관문은 CRON_SECRET 입니다
    { rate: 'none' },
  )
}
