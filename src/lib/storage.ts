/**
 * 객체 저장소에서 **읽기용 임시 주소**를 내는 자리.
 *
 * 정본: spec/common/08-14-api.md §3.2 (업로드가 presigned 인 이유) ·
 *       spec/backend/08-16-data-model.md §3 (`evidence.object_key`)
 * 근거: ADR-016(Supabase Storage · 서울 리전) · ADR-028(자원 접근 구현은 `src/lib/`)
 *
 * ## 왜 주소만 내나 — 파일이 우리 함수를 통과하지 않습니다
 *
 * 녹음이 수십 MB 라 서버 함수의 본문 한계에 걸립니다. 업로드가 이미 그 이유로
 * 브라우저에서 저장소로 직행하고(§3.2), **읽기도 같은 이유로** 추론 서비스가
 * 저장소에서 직접 당겨옵니다. 우리는 주소만 넘깁니다
 * → `src/modules/transcriber/types.ts` 의 `MediaReader`.
 *
 * ## SDK 를 안 쓰는 이유
 *
 * `package.json` 에 Supabase 클라이언트가 없습니다. 서명 주소 하나를 받으려고
 * 의존성을 하나 늘리는 것보다 REST 를 직접 부르는 편이 가볍습니다 —
 * 언어모델 호출도 같은 이유로 SDK 없이 REST 를 씁니다(ARCHITECTURE §2).
 */

import 'server-only'

import type { Env } from './env'

import type { MediaReader } from '@/modules/transcriber'

/**
 * 업로드 원본이 들어가는 버킷. **비공개입니다.**
 *
 * ⬜ **이름이 정본에 없습니다.** `docs/plans/08-20-api-routes.md` 가
 * *"파일 보관함 · `evidence` 버킷(비공개) · 완료"* 로 적은 것을 따랐습니다.
 */
export const EVIDENCE_BUCKET = 'evidence'

/**
 * 주소가 살아 있는 시간.
 *
 * **짧게 잡습니다.** 이 주소를 가진 쪽은 인증 없이 파일을 받을 수 있어서,
 * 로그나 오류 메시지에 새면 그 시간만큼 열려 있습니다.
 *
 * ⬜ **정본에 값이 없습니다.** 업로드 쪽은 §3.2 예시가 5분인데(`expires_at`),
 * 읽기는 전사가 몇 분 걸릴 수 있어 그보다 넉넉해야 합니다. 추론 서비스가
 * 받자마자 내려받으므로 실제로 필요한 것은 처음 몇 초뿐입니다.
 */
const EXPIRES_SECONDS = 15 * 60

/**
 * 읽기용 임시 주소를 내는 것을 만든다.
 *
 * **접속 정보가 없으면 `null` 을 돌려줍니다.** 여기서 던지지 않는 이유는
 * 조립이 성공해야 하기 때문입니다 — 자원 하나 때문에 서버가 안 뜨면
 * 붙어 있는 것도 못 씁니다 → `lib/container.ts`.
 */
export function createMediaReader(env: Env): MediaReader | null {
  const base = env.values.SUPABASE_URL
  const key = env.values.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null

  return {
    async readUrl(objectKey: string): Promise<string> {
      // 경로 조각마다 인코딩합니다. 통째로 하면 `/` 가 `%2F` 가 되어 경로가 깨집니다
      const path = objectKey.split('/').map(encodeURIComponent).join('/')
      const endpoint = `${base.replace(/\/$/, '')}/storage/v1/object/sign/${EVIDENCE_BUCKET}/${path}`

      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            apikey: key,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: EXPIRES_SECONDS }),
          // 이 응답은 캐시되면 안 됩니다 — 만료된 주소를 다시 내주게 됩니다
          cache: 'no-store',
        })
      } catch {
        // ⚠️ **접속 정보를 메시지에 담지 않습니다.** 이 값은 감사 기록으로 갑니다
        throw new Error('저장소에 닿지 못했습니다')
      }

      if (!res.ok) throw new Error(`저장소가 주소를 안 냈습니다 (${res.status})`)

      const body: unknown = await res.json().catch(() => null)
      const signed = (body as { signedURL?: unknown } | null)?.signedURL
      if (typeof signed !== 'string' || signed.length === 0) {
        throw new Error('저장소가 주소를 안 냈습니다')
      }

      // 돌려주는 것은 `/object/sign/...` 로 시작하는 상대 경로입니다
      return signed.startsWith('http')
        ? signed
        : `${base.replace(/\/$/, '')}/storage/v1${signed}`
    },
  }
}
