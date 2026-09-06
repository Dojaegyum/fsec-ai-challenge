/** 관리자 로그아웃 — §7.1. 문지기 안이라 세션이 있어야 부를 수 있습니다 — 그대로 맞습니다 */
import { handleRoute } from '@/lib/request'
import { adminSessionClearCookie } from '@/lib/session-cookie'

export async function POST(request: Request) {
  return handleRoute(
    request,
    async () => ({ body: { ok: true }, headers: { 'Set-Cookie': adminSessionClearCookie() } }),
    // 관리자 경로는 제한하지 않습니다(§1.3) — 껍데기가 어차피 건너뜁니다. 검사기(R3)에 밝히는 것입니다
    { rate: 'none' },
  )
}
