/**
 * 국가법령정보센터 Open API 에서 법령 하나를 **조문 단위**로 가져온다 — `kb-collector` 의 수집원.
 *
 * 정본: spec/backend/08-16-data-model.md §12.1 (「법령은 조문 단위로 저장합니다」 · `source_key` = 법령ID:조문번호:조문가지번호)
 * 근거: ADR-012 · ADR-072
 *
 * ## 무엇을 부르나
 *
 *     GET https://www.law.go.kr/DRF/lawService.do?OC={사용자ID}&target=law&ID={법령ID}&type=JSON
 *
 * `OC` 는 법제처가 승인한 사용자 ID 입니다(`LAW_API_OC`). 없거나 승인되지 않으면 API 가 JSON 이 아니라
 * 안내 HTML 을 주는데, 그것을 조문으로 저장하면 검수 큐가 쓰레기로 찹니다 — **JSON 이 아니면 던집니다.**
 * 던지면 `kb-collector` 가 그 소스의 `last_error` 에 남기고 다음 소스로 갑니다. 앱은 영향이 없습니다.
 *
 * ## 조문 단위로 가르는 이유
 *
 * 법령 전체를 한 행에 넣으면 「시행령이 바뀌었다」까지만 알고, 조문 단위면 「제10조가 바뀌었다」를
 * 압니다. `kb_entry.legal_basis` 가 조문을 가리키므로 영향받는 항목을 바로 고를 수 있습니다(§12.1).
 *
 * 원문은 **그대로** 둡니다 — 요약하거나 다듬지 않습니다. 근거이기 때문입니다.
 */

import 'server-only'

import type { FetchedItem, SourceFetcher } from '@/modules/kb-collector'

const ENDPOINT = 'https://www.law.go.kr/DRF/lawService.do'
const LAW_PREFIX = /^law:(\d+)$/

/** 항·호·목의 중첩 — 본문 키와 자식 키가 한 쌍씩입니다 */
const LEVELS: readonly { readonly text: string; readonly children: string }[] = [
  { text: '조문내용', children: '항' },
  { text: '항내용', children: '호' },
  { text: '호내용', children: '목' },
  { text: '목내용', children: '' },
]

function asList(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((one) => one && typeof one === 'object')
  if (value && typeof value === 'object') return [value as Record<string, unknown>]
  return []
}

/** 조문 하나의 글 — 조문 → 항 → 호 → 목 순서로 펼칩니다 */
function flatten(node: Record<string, unknown>, depth: number, out: string[]): void {
  const level = LEVELS[depth]
  if (!level) return
  const text = node[level.text]
  if (typeof text === 'string' && text.trim()) out.push(text.trim())
  if (!level.children) return
  for (const child of asList(node[level.children])) flatten(child, depth + 1, out)
}

/**
 * 법령 본문 JSON → 조문마다 하나씩. **순수 함수**라 시험이 API 없이 돕니다.
 *
 * `조문여부 === '조문'` 인 것만 씁니다 — 장·절 제목 같은 것은 조문이 아닙니다.
 */
export function splitLaw(lawId: string, body: unknown): readonly FetchedItem[] {
  const law = (body as { 법령?: unknown } | null)?.법령 as Record<string, unknown> | undefined
  if (!law || typeof law !== 'object') {
    throw new Error('법령 본문이 아닙니다 — OC 가 승인된 사용자 ID 인지 확인하세요')
  }
  const info = (law.기본정보 ?? {}) as Record<string, unknown>
  const units = asList((law.조문 as Record<string, unknown> | undefined)?.조문단위)

  const out: FetchedItem[] = []
  for (const unit of units) {
    if (unit.조문여부 !== '조문') continue
    const no = String(unit.조문번호 ?? '').trim()
    if (!no) continue
    const branch = String(unit.조문가지번호 ?? '').trim()
    const lines: string[] = []
    flatten(unit, 0, lines)
    const content = lines.join('\n')
    if (!content) continue
    out.push({
      sourceKey: `law:${lawId}:${no}${branch ? `:${branch}` : ''}`,
      content,
      meta: {
        법령ID: lawId,
        법령명: info.법령명_한글 ?? null,
        조문제목: unit.조문제목 ?? null,
        조문시행일자: unit.조문시행일자 ?? null,
        시행일자: info.시행일자 ?? null,
        공포일자: info.공포일자 ?? null,
        공포번호: info.공포번호 ?? null,
        제개정구분: info.제개정구분 ?? null,
      },
    })
  }
  return out
}

export function createLawFetcher(deps: {
  /** `LAW_API_OC`. 없으면 `law:` 소스마다 「없다」로 던집니다 — 조용히 빈 결과를 내지 않습니다 */
  readonly oc: string | null
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}): SourceFetcher {
  const { oc, fetchImpl = fetch, timeoutMs = 20_000 } = deps

  return {
    async fetch(input) {
      // 법령 API 는 한 번에 전체를 줍니다 — 「다음 쪽」이 없습니다
      if (input.page > 1) return []
      const matched = LAW_PREFIX.exec(input.sourceKeyPrefix)
      if (!matched || input.watchMethod !== 'api') {
        throw new Error(`이 수집원은 law:{법령ID} · api 만 압니다 — ${input.sourceKeyPrefix}`)
      }
      if (!oc) throw new Error('LAW_API_OC 가 없습니다 — 국가법령정보 Open API 사용자 ID')

      const lawId = matched[1]!
      const url = `${ENDPOINT}?OC=${encodeURIComponent(oc)}&target=law&ID=${lawId}&type=JSON`
      const res = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`법령 API HTTP ${res.status}`)
      const text = await res.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('법령 API 가 JSON 을 주지 않았습니다 — OC 승인 여부를 확인하세요')
      }
      return splitLaw(lawId, parsed)
    },
  }
}
