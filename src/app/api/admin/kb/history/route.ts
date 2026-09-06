/** 판단 이력 — §7.3. 최신순 200건 */
import { readHistory } from '@/flows/kb-review'
import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(request, async (ctx) => ({ body: await readHistory(ctx.container) }))
}
