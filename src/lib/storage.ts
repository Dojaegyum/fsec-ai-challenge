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

import type { UploadSlotSource } from '@/modules/case-intake'
import type { ObjectStore } from '@/modules/case-purger'
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
 * 업로드 주소가 살아 있는 시간.
 *
 * 계약 §3.2 의 예시가 5분입니다(`expires_at`). 읽기(15분)보다 짧게 두는 이유는,
 * 이 주소를 가진 쪽은 **그 경로에 파일을 쓸 수 있기** 때문입니다.
 */
const UPLOAD_EXPIRES_SECONDS = 5 * 60

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

    /**
     * 글 파일의 본문을 그대로 가져옵니다 — `kind: 'text'` 만 이 길로 옵니다.
     *
     * 위에서 낸 임시 주소를 서버가 자기 손으로 한 번 받습니다. **녹음·사진은
     * 이 길로 오지 않습니다** — 그쪽은 주소만 추론 서비스에 건네고 바이트는
     * 우리 함수를 통과하지 않습니다(§3.2).
     */
    async readText(objectKey: string): Promise<string> {
      const url = await this.readUrl(objectKey)

      let res: Response
      try {
        res = await fetch(url, { cache: 'no-store' })
      } catch {
        // ⚠️ **주소를 메시지에 담지 않습니다** — 서명이 붙어 있고 이 값은
        // 감사 기록으로 갑니다
        throw new Error('저장소에서 파일을 받지 못했습니다')
      }

      if (!res.ok) throw new Error(`저장소가 파일을 안 냈습니다 (${res.status})`)

      // **자르는 것은 부르는 쪽이 합니다** — 여기서 자르면 얼마나 잘렸는지를
      // 밖에서 알 길이 없습니다
      return await res.text()
    },
  }
}

/**
 * 업로드 자리를 낸다 → `case-intake` 의 `UploadSlotSource` · 계약 §3.2.
 *
 * **파일이 우리 함수를 통과하지 않습니다.** 녹음이 수십 MB 라 서버 함수의
 * 본문 한계에 걸리기 때문입니다 — 브라우저가 저장소로 직행합니다.
 *
 * 돌려주는 주소는 **한 번 쓰고 마는 것**입니다. 저장소가 경로와 토큰을 묶어
 * 발급하므로, 이 주소로는 그 경로에만 올릴 수 있습니다.
 */
export function createUploadSlotSource(env: Env): UploadSlotSource | null {
  const base = env.values.SUPABASE_URL
  const key = env.values.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  const root = base.replace(/\/$/, '')

  return {
    async issue(req): Promise<{ objectKey: string; url: string; expiresAt: string }> {
      // 사건별로 접어 둡니다 — 파기할 때 앞자리로 한꺼번에 지웁니다
      const objectKey = `${req.caseId}/${req.evidenceId}`
      const path = objectKey.split('/').map(encodeURIComponent).join('/')

      let res: Response
      try {
        res = await fetch(
          `${root}/storage/v1/object/upload/sign/${EVIDENCE_BUCKET}/${path}`,
          {
            method: 'POST',
            headers: {
              authorization: `Bearer ${key}`,
              apikey: key,
              'content-type': 'application/json',
            },
            body: JSON.stringify({ expiresIn: UPLOAD_EXPIRES_SECONDS }),
            cache: 'no-store',
          },
        )
      } catch {
        // ⚠️ **접속 정보를 메시지에 담지 않습니다** — 이 값은 감사 기록으로 갑니다
        throw new Error('저장소에 닿지 못했습니다')
      }

      if (!res.ok) throw new Error(`저장소가 업로드 자리를 안 냈습니다 (${res.status})`)

      const body: unknown = await res.json().catch(() => null)
      const signed = (body as { url?: unknown } | null)?.url
      if (typeof signed !== 'string' || signed.length === 0) {
        throw new Error('저장소가 업로드 자리를 안 냈습니다')
      }

      return {
        objectKey,
        url: signed.startsWith('http') ? signed : `${root}/storage/v1${signed}`,
        expiresAt: new Date(Date.now() + UPLOAD_EXPIRES_SECONDS * 1000).toISOString(),
      }
    },
  }
}

/**
 * 사건이 올린 파일을 통째로 지운다 → `case-purger` 의 `ObjectStore`.
 *
 * **지운 뒤 남았는지 되묻습니다.** 파기는 「지웠다」가 아니라 「없다」로
 * 판정해야 합니다 — 삭제 요청이 200 을 내고도 남는 경우가 있습니다.
 */
export function createObjectStore(env: Env): ObjectStore | null {
  const base = env.values.SUPABASE_URL
  const key = env.values.SUPABASE_SERVICE_ROLE_KEY
  if (!base || !key) return null
  const root = base.replace(/\/$/, '')

  const headers = {
    authorization: `Bearer ${key}`,
    apikey: key,
    'content-type': 'application/json',
  }

  async function listOf(caseId: string): Promise<string[]> {
    const res = await fetch(`${root}/storage/v1/object/list/${EVIDENCE_BUCKET}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prefix: `${caseId}/`, limit: 1000 }),
      cache: 'no-store',
    })
    if (!res.ok) throw new Error(`저장소 목록을 못 읽었습니다 (${res.status})`)
    const body: unknown = await res.json().catch(() => null)
    if (!Array.isArray(body)) return []
    return body
      .map((one) => (one as { name?: unknown }).name)
      .filter((one): one is string => typeof one === 'string')
      .map((name) => `${caseId}/${name}`)
  }

  return {
    async deleteAll(caseId: string): Promise<void> {
      const names = await listOf(caseId)
      // 한 건도 없으면 부르지 않습니다 — 빈 목록으로 부르면 저장소가 400 을 냅니다
      if (names.length === 0) return

      const res = await fetch(`${root}/storage/v1/object/${EVIDENCE_BUCKET}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ prefixes: names }),
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`파일을 못 지웠습니다 (${res.status})`)
    },

    async remains(caseId: string): Promise<boolean> {
      return (await listOf(caseId)).length > 0
    },
  }
}
