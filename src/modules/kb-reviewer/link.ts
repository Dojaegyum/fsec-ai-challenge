/**
 * 조문 ↔ 매뉴얼 — API §7.4 · ADR-081 ④.
 *
 * `source_key`(`law:011359:3` = 법 제3조)의 법령 번호와 조를 `kb_entry.legal_basis` 글에서 뽑은
 * 「법 제N조」「시행령 제N조」와 대조합니다. **모델을 쓰지 않습니다** — 규칙이라 시험이 되고,
 * 틀리면 사람이 봅니다. 화면은 「(추정)」을 붙입니다. 항·호는 버립니다 — 스냅샷의 단위가 조입니다(ADR-012).
 * 읽을 때 계산하고 `source_change.impact` 에 쓰지 않습니다 — 저장하면 규칙이 바뀔 때 옛 값이 남습니다.
 */

export const LAWS: Readonly<Record<string, { readonly word: '법' | '시행령'; readonly name: string }>> = {
  '011359': { word: '법', name: '통신사기피해환급법' },
  '011448': { word: '시행령', name: '통신사기피해환급법 시행령' },
}

/**
 * `law:<법령ID>:<조문번호>[:<가지번호>]` — 데이터 모델 §12.1 · law-fetcher.ts. `law:011359:3` 이 제3조,
 * `law:011359:2:2` 가 제2조의2 입니다. 화면에 보이는 「제N조」는 여기서 만듭니다
 */
const SOURCE_KEY = /^law:(\d+):(\d+)(?::(\d+))?$/
/**
 * 「법 제3조」「시행령 제7조」「전기통신사업법 제32조의6」「「전자금융거래법」 제2조」.
 * 앞말은 한글로 이어진 「…법」 전체거나 「시행령」 — 다른 법의 조를 우리 법의 조로 세지 않으려는 것입니다.
 * 닫는 괄호(」·)) 하나는 앞말과 조 사이에 올 수 있습니다
 */
const ARTICLE = /(?:([가-힣]*법|시행령)[」)]?\s*)?(제\d+조(?:의\d+)?)/g
const NAMED_LAW = /통신사기피해환급법(?!\s*시행령)/g
const NAMED_DECREE = /통신사기피해환급법\s*시행령/g

type Word = '법' | '시행령'

export function parseSourceKey(sourceKey: string): { lawId: string; article: string } | null {
  const m = SOURCE_KEY.exec(sourceKey)
  if (!m) return null
  return { lawId: m[1]!, article: `제${m[2]}조${m[3] ? `의${m[3]}` : ''}` }
}

export function sourceLabelOf(sourceKey: string): string {
  const parsed = parseSourceKey(sourceKey)
  const law = parsed ? LAWS[parsed.lawId] : undefined
  if (!parsed || !law) return sourceKey
  return `${law.word} ${parsed.lawId} · ${law.name}`
}

/**
 * 「법 제3조」「시행령 제11조의3」 꼴의 키 집합.
 *
 * 법령 이름이 앞에 붙은 자리(「통신사기피해환급법 제3조」)는 이름을 「법」/「시행령」으로 바꿔 읽고,
 * 「제N조」만 이어지면 **바로 앞에서 마지막으로 나온 법령**을 따릅니다. 아무 법령도 안 나왔으면 「법」입니다.
 * **다른 법**(「전기통신사업법 제32조의6」)이 나오면 그 조는 세지 않고, 우리 법이 다시 나올 때까지
 * 이어지는 「제N조」도 세지 않습니다 — 다른 법의 조를 우리 조문에 잇는 것이 가장 나쁜 오답입니다.
 */
export function articleRefsOf(legalBasis: string): ReadonlySet<string> {
  const text = legalBasis.replace(NAMED_DECREE, '시행령').replace(NAMED_LAW, '법')
  const refs = new Set<string>()
  let current: Word | null = '법'
  for (const m of text.matchAll(ARTICLE)) {
    const word = m[1]
    if (word === '법' || word === '시행령') current = word
    else if (word !== undefined) current = null
    if (current) refs.add(`${current} ${m[2]}`)
  }
  return refs
}

export function linkEntries(
  sourceKey: string,
  entries: readonly { readonly kbEntryId: string; readonly legalBasis: string }[],
): readonly string[] {
  const parsed = parseSourceKey(sourceKey)
  const law = parsed ? LAWS[parsed.lawId] : undefined
  if (!parsed || !law) return []
  const wanted = `${law.word} ${parsed.article}`
  return entries.filter((one) => articleRefsOf(one.legalBasis).has(wanted)).map((one) => one.kbEntryId)
}
