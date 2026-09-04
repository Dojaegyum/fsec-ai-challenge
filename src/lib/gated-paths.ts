/**
 * 문지기가 지키는 경로가 어디까지인가 — **한 곳에서만 정합니다.**
 *
 * 정본: spec/common/08-14-api.md §5.1 · decisions/025-scheduled-jobs.md 「남은 것」
 *
 * ## 왜 따로 있나 — 같은 판단이 세 곳에서 필요합니다
 *
 * | 어디 | 무엇으로 |
 * | --- | --- |
 * | `proxy.ts` 의 `config.matcher` | Next 가 읽는 경로 패턴 |
 * | `proxy.ts` 의 문지기 본문 | 들어온 경로가 그 갈래인가 |
 * | `lib/request.ts` 의 두 번째 관문 | 같은 판단 |
 *
 * 셋이 조금이라도 어긋나면 **그 틈으로 인증 없이 들어옵니다.** 실제로 그랬습니다 —
 * 아래 참고.
 *
 * ## 뒤 슬래시 한 칸이 냈던 구멍
 *
 * 처음에는 `pathname.startsWith('/api/admin/')` 로만 봤습니다. 그런데 Next 의
 * 경로 패턴 `/api/admin/:path*` 는 **뒤 슬래시가 없는 `/api/admin` 도 덮습니다.**
 * Next 자신의 파서로 뽑아 확인했습니다.
 *
 * ```
 * /api/admin/:path*  →  ^\/api\/admin(?:\/(...))?[\/#\?]?$
 *     /api/admin        맞음      ← startsWith('/api/admin/') 는 여기서 거짓
 *     /api/admin/       맞음      ← Next 가 308 로 위 경로에 넘깁니다
 *     /api/admin/cases  맞음
 * ```
 *
 * 그래서 누군가 `app/api/admin/route.ts` 를 만들면 **그 한 경로만 인증 없이
 * 열립니다.** 정본 §5.1 이 접두사 일괄 처리를 고른 이유가
 * *"새 관리자 경로를 추가할 때 인증을 빠뜨리는 것을 막기 위해서"* 인데,
 * 하필 그 방식이 못 덮는 칸이 남아 있었습니다. 실제 서버(`next dev`)에서
 * `GET /api/admin` 이 200 으로 통과하는 것을 확인했습니다.
 *
 * **여기 있는 함수 하나만 쓰면 세 곳이 같은 집합을 가리킵니다.**
 *
 * ## 상태를 들고 있지 않습니다
 *
 * `proxy.ts` 가 이것을 import 합니다. Next 문서가
 * *"you should not attempt relying on shared modules or globals"* 라고 경고하는데,
 * **이 파일에는 상태도 부작용도 없습니다** — 문자열 둘과 순수 함수 하나뿐입니다.
 */

import 'server-only'

/**
 * 관리자 조회 → 08-14-api.md §5.1 — **화면은 만들지 않기로 했습니다**(ADR-068).
 * 이 갈래는 그래도 남깁니다: 누군가 `app/api/admin/route.ts` 를 만들어도 인증 없이 열리지 않게.
 */
export const ADMIN_BASE = '/api/admin'

/** 주기 실행 → ADR-025. 외부에서 호출되면 안 됩니다 */
export const CRON_BASE = '/api/cron'

/**
 * Next 의 `config.matcher` 에 그대로 들어가는 값.
 *
 * **빌드할 때 읽히는 상수여야 합니다** — 변수를 넣으면 조용히 무시되고
 * 문지기가 아무 데도 안 걸립니다. 그래서 `proxy.ts` 가 이것을 그대로 적고,
 * 시험이 두 값이 같은지 봅니다.
 */
export const GATED_MATCHERS = [
  '/api/admin/:path*',
  '/api/cron/:path*',
] as const

/**
 * 이 경로가 그 갈래 아래인가.
 *
 * **경계를 세그먼트로 봅니다.** `/api/adminx` 는 아닙니다 — 접두사만 보면
 * 상관없는 경로까지 막아 버립니다.
 */
export function isUnder(base: string, pathname: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/** 관리자 경로인가 */
export function isAdminPath(pathname: string): boolean {
  return isUnder(ADMIN_BASE, pathname)
}

/** 크론 경로인가 */
export function isCronPath(pathname: string): boolean {
  return isUnder(CRON_BASE, pathname)
}
