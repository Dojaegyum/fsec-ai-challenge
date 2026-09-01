/**
 * 크론 호출인가 — **판단은 이 함수 하나뿐입니다.**
 *
 * 정본: spec/common/08-14-api.md §6.1 · decisions/025-scheduled-jobs.md
 *
 * [gated-paths.ts](./gated-paths.ts)와 같은 이유로 따로 있습니다 — 문지기
 * (`proxy.ts`)와 요청 껍데기(`request.ts`)의 두 번째 관문이 **같은 판단**을
 * 써야 합니다. 둘이 조금이라도 어긋나면 그 틈으로 인증 없이 들어옵니다.
 * 원래 `proxy.ts` 안에 있어 껍데기가 못 썼습니다(2026-09-01 옮김).
 *
 * 검증 방식은 ADR-025 「남은 것」이 *"시크릿 검증 방식 미정"* 으로 둔 자리였고,
 * 지금은 `Authorization: Bearer <CRON_SECRET>` 하나만 받습니다. ADR-025 가 실행
 * 트리거로 **Vercel Cron** 을 골랐고 그것이 이 헤더로 부르기 때문입니다.
 * **다른 방식을 함께 열어 두지 않았습니다** — 받는 문이 여럿이면 그중 하나만
 * 약해도 전체가 약해집니다.
 */

import 'server-only'

/** 헤더만 읽습니다 — `NextRequest` 든 `Request` 든 같은 모양입니다 */
interface HasHeaders {
  readonly headers: { get(name: string): string | null }
}

/**
 * **`CRON_SECRET` 이 비어 있으면 무조건 막습니다.** 비교할 것이 없을 때
 * 통과시키면 설정을 빠뜨린 서버의 파기·발송 경로를 밖에서 부를 수 있습니다.
 */
export function isCronCall(request: HasHeaders, secret: string | undefined): boolean {
  if (!secret) return false

  const header = request.headers.get('authorization')
  if (!header) return false

  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) return false

  // 길이가 다르면 그 자체로 다릅니다. 같은 길이일 때만 전부 비교합니다
  if (token.length !== secret.length) return false

  let diff = 0
  for (let i = 0; i < token.length; i += 1) {
    diff |= token.charCodeAt(i) ^ secret.charCodeAt(i)
  }
  return diff === 0
}
