/**
 * 관리자 세션 쿠키 — 만들고, 읽고, 맞는지 확인하는 자리.
 *
 * 정본: spec/common/08-14-api.md §5.1 — **2026-09-04 폐기(ADR-068).** 화면·로그인은 만들지 않고,
 * 이 파일은 문지기(`proxy.ts`·`request.ts`)가 `/api/admin/*` 을 401 로 막을 때 부를 뿐인 **잠든 코드**입니다.
 *
 * 정본이 정한 것은 넷입니다.
 *
 * | | |
 * | --- | --- |
 * | 계정 | **하나.** 아이디·비밀번호를 환경변수로 받음 |
 * | 환경변수 | `ADMIN_USERNAME` · `ADMIN_PASSWORD_HASH` |
 * | 인증 방식 | 로그인 후 **세션 쿠키** |
 * | 헤더 | `X-Session-Id`(사용자용)와 **별개** |
 *
 * ## 정본이 안 정한 것 — 여기서 고른 것과 그 이유
 *
 * **쿠키 이름·수명·서명 방식이 정본에 있습니다** → 08-14-api.md §5.1 (2026-08-21 확정).
 *
 * | 무엇 | 값 | 왜 |
 * | --- | --- | --- |
 * | 서명 키 | `ADMIN_PASSWORD_HASH` 에서 파생 | **새 환경변수를 만들지 않으려는 것**입니다. 정본의 표에 없는 이름을 하나 더 늘리면 배포마다 빠뜨릴 자리가 생깁니다. 덤으로 **비밀번호를 바꾸면 기존 세션이 전부 끊깁니다** — 그게 맞는 동작입니다 |
 * | 파생 방식 | 고정 라벨로 한 번 더 HMAC | 저장된 해시를 **그대로** 서명 키로 쓰지 않습니다. 용도가 다른 두 곳이 같은 값을 쓰면 한쪽이 새면 다른 쪽도 같이 무너집니다 |
 * | 담는 내용 | 만료 시각 하나 | 계정이 하나뿐이라 누구인지 담을 것이 없습니다. **개인정보도 아이디도 넣지 않습니다** |
 * | 수명 | 8시간 | 조사하는 사람이 하루 안에 끝내는 것을 상정한 값입니다. 근거는 없습니다 |
 *
 * ## 안 만든 것 — 로그인 경로
 *
 * **비밀번호를 확인하는 코드를 여기 두지 않았습니다.** `ADMIN_PASSWORD_HASH` 가
 * 어떤 해시인지(알고리즘·솔트·표기)가 정본에 없어, 확인하는 코드를 쓰려면 형식을
 * 지어내야 합니다. 그건 나중에 실제 값과 안 맞으면 **관리자가 영영 못 들어오는**
 * 자리입니다.
 *
 * 그래서 이 파일은 **세션이 우리 것인지 확인하는 것**과 **세션을 발급하는 것**까지만
 * 합니다. 로그인 경로는 해시 형식이 정해진 뒤에 붙입니다.
 */

import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

import { has, type Env } from './env'

/**
 * `X-Session-Id` 와 이름이 겹치지 않게 둡니다 — 정본이 「별개」라고 못 박았습니다.
 *
 * **`__Host-` 접두사는 브라우저가 강제하는 규칙입니다.** 이 접두사가 붙은 쿠키는
 * `Secure` 이고 `Path=/` 이고 `Domain` 이 없을 때만 저장되며, **다른 서브도메인이
 * 같은 이름으로 덮어쓸 수 없습니다.**
 *
 * 이게 없으면 이웃 서브도메인 하나가 `fin_ally_admin` 을 심어 진짜 세션을 밀어낼
 * 수 있습니다. 권한이 올라가지는 않지만(서명을 못 만듭니다) **관리자가 로그인해도
 * 계속 401 을 받아 조사 자체가 막힙니다.**
 */
export const ADMIN_SESSION_COOKIE = '__Host-fin_ally_admin'

/** 표기가 바뀌면 이 값을 올립니다. 옛 쿠키는 그때 자동으로 안 맞게 됩니다 */
const VERSION = 'v1'

/** 서명 키를 다른 용도와 갈라 두는 라벨 */
const KEY_LABEL = 'fin-ally/admin-session/v1'

/** 08-14-api.md §5.1 — 8시간 */
export const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60

/**
 * 서명 키. **환경변수가 없으면 `null`** 이고, 그러면 아래 둘 다 실패합니다.
 *
 * **열리는 쪽으로 실패하지 않습니다.** 관리자 계정이 설정 안 된 서버는
 * 관리자 경로가 **닫혀 있어야** 맞습니다.
 */
function signingKey(env: Env): Buffer | null {
  if (!has(env, 'ADMIN_PASSWORD_HASH')) return null
  return createHmac('sha256', env.values.ADMIN_PASSWORD_HASH as string)
    .update(KEY_LABEL)
    .digest()
}

function sign(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('hex')
}

/**
 * 두 서명이 같은가 — **어떤 입력에도 던지지 않고, 길이도 흘리지 않습니다.**
 *
 * `timingSafeEqual` 은 두 버퍼의 **바이트** 길이가 다르면 예외를 던집니다.
 * 글자 수로 길이를 먼저 재는 것으로는 못 막습니다 — `é` 한 글자가 2바이트라
 * 「글자 수는 같은데 바이트 수는 다른」 값을 쿠키로 보내면 그대로 터집니다.
 * 실제로 그랬습니다: 문지기가 401 대신 500 을 냈고, 그 응답에는 계측 헤더도
 * 에러 봉투도 없었습니다.
 *
 * **양쪽을 한 번 더 해시해 32바이트로 맞춘 뒤 비교합니다.** 입력이 무엇이든
 * 길이가 같아지므로 던질 일이 없고, 길이 차이로 새어 나가는 것도 없습니다.
 */
function sameSignature(key: Buffer, a: string, b: string): boolean {
  const left = createHmac('sha256', key).update(a).digest()
  const right = createHmac('sha256', key).update(b).digest()
  return timingSafeEqual(left, right)
}

/**
 * 세션 하나를 만든다.
 *
 * 로그인 경로가 **비밀번호를 확인한 뒤에** 부릅니다. 이 함수는 비밀번호를 보지
 * 않습니다 — 확인은 부르는 쪽의 일입니다.
 *
 * @returns 설정이 안 됐으면 `null`
 */
export function issueAdminSession(
  env: Env,
  nowMs: number,
  maxAgeSeconds: number = ADMIN_SESSION_MAX_AGE_SECONDS,
): { readonly value: string; readonly maxAgeSeconds: number } | null {
  const key = signingKey(env)
  if (!key) return null

  const expiresAtMs = nowMs + maxAgeSeconds * 1000
  const payload = `${VERSION}.${expiresAtMs}`

  return { value: `${payload}.${sign(key, payload)}`, maxAgeSeconds }
}

/**
 * 이 쿠키가 우리가 발급한 것이고 아직 안 지났는가.
 *
 * **여기서 던지지 않습니다.** 참·거짓만 돌려줍니다 — 어디가 틀렸는지 알려주면
 * 그게 곧 공격자에게 주는 힌트입니다.
 */
export function verifyAdminSession(
  cookieValue: string | null | undefined,
  env: Env,
  nowMs: number,
): boolean {
  if (!cookieValue) return false

  const key = signingKey(env)
  if (!key) return false

  const parts = cookieValue.split('.')
  if (parts.length !== 3) return false

  const [version, expiresRaw, signature] = parts
  if (version !== VERSION) return false

  const expiresAtMs = Number(expiresRaw)
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= nowMs) return false

  return sameSignature(key, signature, sign(key, `${version}.${expiresRaw}`))
}

/**
 * `Set-Cookie` 한 줄.
 *
 * - `HttpOnly` — 스크립트가 못 읽습니다
 * - `Secure` — 평문 연결로는 안 나갑니다. 브라우저가 `localhost` 는 예외로 봅니다
 * - `SameSite=Strict` — 다른 사이트에서 온 요청에 실리지 않습니다. 관리자 경로는
 *   외부에서 걸어 들어올 일이 없습니다
 *
 * ⬜ `Path` 를 `/` 로 둡니다. 관리자 화면의 주소가 아직 안 정해져서 좁힐 근거가
 * 없습니다. 정해지면 그 아래로 좁힙니다.
 */
export function adminSessionSetCookie(
  value: string,
  maxAgeSeconds: number,
): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ')
}

/** 로그아웃 — 같은 이름을 빈 값에 수명 0으로 덮습니다 */
export function adminSessionClearCookie(): string {
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

/**
 * `Cookie` 헤더에서 이 이름의 값을 **전부** 꺼낸다.
 *
 * 프레임워크의 쿠키 객체를 안 쓰는 이유는, 이 판단이 요청 껍데기와 `proxy.ts`
 * **두 곳**에서 필요한데 그 둘이 서로 다른 요청 타입을 받기 때문입니다.
 * 표준 `Cookie` 헤더 하나만 보면 양쪽에서 같은 코드가 돕니다.
 *
 * ## 왜 하나가 아니라 전부인가
 *
 * 같은 이름의 쿠키가 여러 개 실려 올 수 있습니다. 앞의 것 하나만 보면
 * **가짜를 앞에 하나 끼워 넣어 진짜를 밀어낼 수 있습니다** — 서명은 못 만드니
 * 들어오지는 못하지만, 진짜 관리자가 계속 401 을 받아 조사가 막힙니다.
 * 전부 검사하면 그 밀어내기가 안 통합니다.
 *
 * ## 깨진 인코딩에 던지지 않습니다
 *
 * `decodeURIComponent('%')` 는 예외를 던집니다. 문지기가 이걸 그대로 맞으면
 * 인증 없는 요청 한 줄이 401 대신 500 이 됩니다 — 정본 §5.1(401)·§1.1(계측 헤더)·
 * §1.4(에러 봉투)를 한꺼번에 어깁니다. 못 푸는 값은 **원문 그대로** 넘깁니다.
 * 어차피 서명이 안 맞아 떨어집니다.
 */
export function readCookies(cookieHeader: string | null, name: string): string[] {
  if (!cookieHeader) return []

  const found: string[] = []
  for (const piece of cookieHeader.split(';')) {
    const at = piece.indexOf('=')
    if (at < 0) continue
    if (piece.slice(0, at).trim() !== name) continue

    const raw = piece.slice(at + 1).trim()
    try {
      found.push(decodeURIComponent(raw))
    } catch {
      found.push(raw)
    }
  }
  return found
}

/** 앞의 하나. 값이 하나뿐인 자리에서 씁니다 */
export function readCookie(cookieHeader: string | null, name: string): string | null {
  return readCookies(cookieHeader, name)[0] ?? null
}

/**
 * 이 요청이 관리자 세션을 들고 있는가.
 *
 * **실려 온 것 중 하나라도 맞으면 통과입니다** — 위 「밀어내기」 참고.
 */
export function hasAdminSession(request: Request, env: Env, nowMs: number): boolean {
  const values = readCookies(request.headers.get('cookie'), ADMIN_SESSION_COOKIE)
  return values.some((value) => verifyAdminSession(value, env, nowMs))
}
