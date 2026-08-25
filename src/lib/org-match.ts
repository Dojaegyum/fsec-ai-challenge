/**
 * 사용자가 말한 기관 표기를 `org_id` 로 정규화한다 → §11.4.4 ① · §4.1.
 *
 * 정본: spec/backend/08-16-data-model.md §4.1(표기가 흔들린다) · §11.4.4 ①
 * 근거: CLAUDE.md 「모르는 절차·수치를 지어내지 마세요」
 *
 * ## ⛔ 유사도 검색을 쓰지 않습니다
 *
 * §11.4.4 ① 이 못 박은 것입니다 — *"오타를 잡으려다 **틀린 기관을 고를 수 있고,
 * 엉뚱한 은행에 전화하면 골든타임을 통째로 잃습니다.** 못 찾으면 되묻는 편이
 * 안전합니다."*
 *
 * 그래서 두 단계만 봅니다.
 *
 * ```
 * 1  aliases 정확 일치        "국민은행" → kb-bank
 * 2  정규화 후 재시도          "KB 국민은행" → 공백·대소문자·(주) 제거 → "kb국민은행"
 * 3  실패                     org_id 를 null 로 두고 유형 기본 절차로
 * ```
 *
 * **못 찾는 것이 실패가 아닙니다.** `channel_id` 만으로 유형 기본이 나갑니다.
 */

/** 정규화 대상 한 곳 */
export interface OrgCandidate {
  readonly orgId: string
  readonly name: string
  readonly aliases: readonly string[]
}

/**
 * 표기를 견줄 수 있는 모양으로.
 *
 * 공백·대소문자·법인 표기를 지웁니다. **글자를 바꾸지는 않습니다** —
 * 오타 교정은 여기서 하지 않습니다.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(주\)|주식회사|㈜/g, '')
    .replace(/\s+/g, '')
    .trim()
}

/**
 * 표기 하나로 기관을 찾는다. **못 찾으면 `null`.**
 *
 * 이름과 별칭을 함께 봅니다 — 사용자는 정식 표기도 별칭도 씁니다.
 */
export function matchOrg(
  raw: string,
  candidates: readonly OrgCandidate[],
): string | null {
  const said = raw.trim()
  if (said.length === 0) return null

  // **여럿이 걸리면 못 고릅니다.** 하나를 임의로 고르면 엉뚱한 기관이 나가고,
  // 그것이 유사도 검색을 안 쓰는 이유와 같습니다. **두 단계에 똑같이 걸립니다** —
  // 정확 일치에서 먼저 걸린 것을 집으면 목록 순서가 답을 정하게 됩니다
  const only = (hits: readonly OrgCandidate[]): string | null =>
    hits.length === 1 ? hits[0]!.orgId : null

  // 1. 정확 일치
  const exact = candidates.filter(
    (one) => one.name === said || one.aliases.includes(said),
  )
  if (exact.length > 0) return only(exact)

  // 2. 정규화 후 재시도
  const key = normalize(said)
  if (key.length === 0) return null

  return only(
    candidates.filter(
      (one) =>
        normalize(one.name) === key || one.aliases.some((alias) => normalize(alias) === key),
    ),
  )
}
