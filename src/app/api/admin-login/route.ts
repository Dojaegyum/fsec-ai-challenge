/**
 * 관리자 로그인 — API §7.1 · ADR-087.
 *
 * **문지기 밖입니다.** `/api/admin/` 접두사에 안 걸리는 이름을 일부러 골랐습니다 — 문지기 목록에
 * 예외를 뚫으면 다음 예외가 쉬워집니다. 대신 상한(`adminLogin` · IP 기준)이 걸립니다.
 *
 * 틀렸는지 비었는지 말하지 않습니다 — 문지기의 401 과 같은 문구입니다.
 */
import { verifyPassword } from '@/lib/admin-password'
import { serverClock } from '@/lib/clock'
import { BadRequestError, UnauthorizedError } from '@/lib/http'
import { handleRoute } from '@/lib/request'
import { adminSessionSetCookie, issueAdminSession } from '@/lib/session-cookie'

export async function POST(request: Request) {
  return handleRoute(
    request,
    async (ctx) => {
      const body = (await ctx.request.json().catch(() => null)) as { password?: unknown } | null
      if (!body || typeof body.password !== 'string') {
        throw new BadRequestError('비밀번호가 없습니다', { param: 'password' })
      }
      const stored = ctx.container.env.values.ADMIN_PASSWORD_HASH
      // 해시가 없는 서버는 닫혀 있습니다 — verifyPassword 가 빈 값에 false 를 냅니다
      if (!verifyPassword(body.password, stored)) {
        throw new UnauthorizedError('관리자 인증에 실패했습니다', { gate: 'admin-login' })
      }
      const session = issueAdminSession(ctx.container.env, serverClock.nowMs())
      if (!session) throw new UnauthorizedError('관리자 인증에 실패했습니다', { gate: 'admin-login' })
      return {
        body: { ok: true },
        headers: { 'Set-Cookie': adminSessionSetCookie(session.value, session.maxAgeSeconds) },
      }
    },
    { rate: 'adminLogin' },
  )
}
