/** 매뉴얼 렌즈 — §7.3. `KB_VERSION` 의 항목 전부와 닿은 미검수 변경 */
import { readEntries } from '@/flows/kb-review'
import { handleRoute } from '@/lib/request'

export async function GET(request: Request) {
  return handleRoute(request, async (ctx) => ({ body: await readEntries(ctx.container) }))
}
