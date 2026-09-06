/** 검수 큐 — API §7.2 · §7.3. 문지기 뒤(§5.1) — 인증은 껍데기가 봅니다 */
import { readQueue } from '@/flows/kb-review'
import { BadRequestError } from '@/lib/http'
import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(request, async (ctx) => {
    const status = new URL(ctx.request.url).searchParams.get('status') ?? 'pending'
    if (status !== 'pending' && status !== 'deferred') {
      throw new BadRequestError('status 는 pending 또는 deferred 입니다', { param: 'status' })
    }
    return { body: await readQueue(ctx.container, status) }
  })
}
