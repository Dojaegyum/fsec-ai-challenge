/** 변경 하나 — §7.3. `change_id` 는 ULID 라 전용 헬퍼로만 읽습니다 */
import { readChange } from '@/flows/kb-review'
import { handleRoute, ulidParamOf } from '@/lib/request'

export async function GET(request: Request, route: { params: Promise<{ change_id: string }> }) {
  return handleRoute(request, async (ctx) => {
    const changeId = await ulidParamOf(route, 'change_id')
    return { body: await readChange(ctx.container, changeId) }
  })
}
