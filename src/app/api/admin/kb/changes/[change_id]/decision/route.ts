/**
 * 판단 — §7.3. 승인은 「봤고 반영해도 된다」는 표시이고 매뉴얼에 자동 반영되지 않습니다(RFC-002).
 * 이미 승인·거절된 건은 409(`KB_CHANGE_DECIDED`) — 검수 이력을 덮지 않습니다(ADR-044).
 */
import { decide, type DecisionStatus } from '@/flows/kb-review'
import { BadRequestError } from '@/lib/http'
import { handleRoute, ulidParamOf } from '@/lib/request'

const STATUSES: readonly DecisionStatus[] = ['approved', 'rejected', 'deferred']

export async function POST(request: Request, route: { params: Promise<{ change_id: string }> }) {
  return handleRoute(
    request,
    async (ctx) => {
      const changeId = await ulidParamOf(route, 'change_id')
      const body = (await ctx.request.json().catch(() => null)) as
        | { status?: unknown; reviewed_by?: unknown; note?: unknown }
        | null
      const status = body?.status
      if (typeof status !== 'string' || !(STATUSES as readonly string[]).includes(status)) {
        throw new BadRequestError('status 는 approved · rejected · deferred 중 하나입니다', { param: 'status' })
      }
      const reviewedBy = typeof body?.reviewed_by === 'string' ? body.reviewed_by.trim() : ''
      if (reviewedBy.length === 0) throw new BadRequestError('reviewed_by 가 비었습니다', { param: 'reviewed_by' })
      const note = typeof body?.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null
      return { body: await decide(ctx.container, changeId, { status: status as DecisionStatus, reviewedBy, note }) }
    },
    // 관리자 경로는 제한하지 않습니다(§1.3) — 검사기(R3)에 밝히는 것입니다
    { rate: 'none' },
  )
}
