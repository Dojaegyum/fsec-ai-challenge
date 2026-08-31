/**
 * `POST /api/cases/{case_token}/vault` — 복원 매핑 맡기기.
 *
 * 정본: spec/common/08-14-api.md §3.11
 * 근거: ADR-009(매핑은 암호문으로 서버 볼트에) · ADR-027(키는 브라우저에만) ·
 *       ADR-049(볼트를 같은 Postgres 의 `case_vault` 스키마에)
 *
 * ## 서버는 이것을 열 수 없습니다
 *
 * `ciphertext` 는 브라우저가 `key-handler` 로 봉한 **AES-GCM** 결과이고,
 * 복호화 키는 IndexedDB 에 `extractable: false` 로만 있습니다. 이 라우트가
 * 하는 일은 **받아서 보관하는 것**뿐입니다 — 열어 보는 코드를 여기 넣지 마세요.
 *
 * ## 이것이 없으면 서류가 통째로 빈칸입니다
 *
 * `[계좌-1]` 이 영영 `[계좌-1]` 이 됩니다. 그래서 **매핑을 먼저 올리고 값을
 * 나중에 씁니다** — 순서가 계약입니다(§3.11). 거꾸로 하면 **아무도 못 푸는
 * 토큰**이 사건에 남고, 사용자는 그게 왜 빈칸인지 알 방법이 없습니다.
 *
 * ## `token` 은 평문입니다
 *
 * `[계좌-1]` 자체는 개인정보가 아니고, 덮어쓰기의 조회 키로 써야 합니다.
 */

import { BadRequestError, readJsonObject } from '@/lib/http'
import { caseIdOf, handleRoute } from '@/lib/request'
import { readIssuedLedger } from '@/modules/pii-tokenizer'

interface VaultBody {
  readonly entries?: unknown
}

interface Entry {
  readonly token: string
  readonly ciphertext: string
}

/**
 * **모양은 `key-handler` 의 `VaultEntry` 그대로입니다** — 브라우저가 `sealAll()` 로
 * 만든 것을 그대로 받습니다. 서버가 다시 정의하지 않습니다 (§3.11).
 */
function readEntries(body: VaultBody): Entry[] {
  if (!Array.isArray(body.entries) || body.entries.length === 0) {
    throw new BadRequestError('entries 가 없습니다', { param: 'entries' })
  }

  return body.entries.map((one, i) => {
    const row = one as Partial<Entry>
    if (typeof row.token !== 'string' || row.token.length === 0) {
      throw new BadRequestError('token 이 없습니다', { param: `entries[${i}].token` })
    }
    if (typeof row.ciphertext !== 'string' || row.ciphertext.length === 0) {
      throw new BadRequestError('ciphertext 가 없습니다', {
        param: `entries[${i}].ciphertext`,
      })
    }
    return { token: row.token, ciphertext: row.ciphertext }
  })
}

/**
 * 맡긴 것을 되받습니다 — §3.11 `GET` · ADR-050.
 *
 * **이 자리가 없으면 본인이 다시 들어와도 `[계좌-1]` 을 못 풉니다.** 매핑은 그
 * 세션의 메모리에만 있고, 키는 IndexedDB 에 남아 있는데 열 암호문을 가져올
 * 방법이 없었습니다 — 서류 기재 안내가 통째로 빈칸이 됩니다.
 *
 * **암호문 그대로 나갑니다.** 여는 것은 브라우저의 `key-handler` 이고,
 * 키가 없는 기기(가족이 링크를 받아 연 경우)에서는 **안 풀리는 것이 맞습니다.**
 *
 * ## `issued` — 서버가 붙인 이름표까지 함께 냅니다
 *
 * 볼트에는 **브라우저가 맡긴 것만** 있습니다. 서버 2차(NER)와 전사가 붙인
 * `[계좌-1]`·`[이름-1]` 은 봉할 키가 서버에 없어 여기 못 들어옵니다 — 그래서
 * `entries` 만 보면 브라우저가 **서버가 이미 쓴 번호를 모른 채** 다음 값을 가립니다.
 *
 * 실제로 이렇게 무너졌습니다 (2026-08-31 확인) —
 *
 * ```
 * /start 에서 사건 만들고 곧바로 녹음 업로드
 *   → 서버가 전사하며 사기범 계좌에 [계좌-1]      (볼트는 아직 빔)
 * 나중에 챗에 본인 계좌 입력
 *   → 브라우저가 빈 볼트를 보고 [계좌-1] 을 다시 발급
 * 자료함에서 전사문 열기
 *   → 사기범 계좌 자리에 본인 계좌번호가 그려짐
 * ```
 *
 * ⚠️ **이름표만 나갑니다 — 값은 없습니다.** `[계좌-1]` 자체는 개인정보가
 * 아니고(위 「`token` 은 평문입니다」), 서버는 그 값을 애초에 모릅니다.
 * **여기에 원문이나 복호화 키를 실을 수 있는 자리를 만들지 마세요** (불변 규칙 3).
 */
export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    const [entries, ledger] = await Promise.all([
      container.vaultWrite.list(caseId),
      readIssuedLedger(caseId, {
        vault: container.vaultWrite,
        masked: container.maskedTexts,
      }),
    ])

    return { body: { entries, issued: ledger.map((one) => one.token) } }
  })
}

export async function POST(
  request: Request,
  route: { params: Promise<{ case_token: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)

    // 값을 쓰기 직전마다 도니 슬롯과 같은 급입니다 → §1.3
    await ctx.limit('vault', caseId)

    const entries = readEntries(await readJsonObject<VaultBody>(request))
    const stored = await container.vaultWrite.put(caseId, entries)

    return { body: { stored } }
  })
}
