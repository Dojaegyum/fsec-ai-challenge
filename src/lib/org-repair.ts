/**
 * 전사문에서 기관 이름을 찾아 표준 표기로 고친다 → ADR-056.
 *
 * 정본: decisions/056-transcript-org-normalization.md ·
 *       spec/backend/08-16-data-model.md §11.4.4 ①
 * 근거: docs/research/15-STT-GPU-실측.md §6 §8 (누출 0) ·
 *       docs/research/17-기관명-사전-실측.md (사전은 듣는다)
 *
 * ## 왜 밖으로 보내도 되나
 *
 * **이 자리는 토큰화 뒤입니다.** 모델이 보는 것은 `[계좌-1]` 이고 기관명은 평문
 * 그대로입니다 — 기관명은 [토큰화 제외 목록](../../spec/common/08-14-pii-boundary.md)
 * 이라 애초에 가리면 안 되는 값입니다. [불변 규칙 2](../../CLAUDE.md)가 막는 것은
 * **원문** 개인정보이고, [ADR-043](../../decisions/043-gpu-hosting.md)이
 * *"토큰화를 마친 뒤의 호출은 이 제약을 받지 않습니다"* 로 이미 갈라 놨습니다.
 *
 * ## 모델은 정하지 않습니다
 *
 * 낸 이름을 **사전으로 다시 대조**하고 사전에서 확정된 것만 씁니다.
 * [ADR-041](../../decisions/041-pii-confirm-with-user.md)이 「프롬프트로 부탁하면
 * 안 지켜진다」를 실측으로 확인했으므로, **모델 출력을 코드가 검증하는 구조**여야
 * 합니다 — [ADR-011](../../decisions/011-pii-boundary-hardening.md)의
 * 「허용 목록을 탐지 결과보다 우선」과 같은 모양입니다.
 *
 * §11.4.4 ① 이 금지한 **유사도 검색은 여기서도 안 씁니다.** 문맥은 모델이 보고,
 * 확정은 `matchOrg` 의 정확 일치가 합니다.
 */

import { matchOrg, type OrgCandidate } from './org-match'

/**
 * 모델에게 주는 지시문.
 *
 * ⚠️ **인젝션 격리 문구를 뺐습니다** — [불변 규칙 4](../../CLAUDE.md)와 대조할 때
 * 빠뜨린 것으로 읽히지 않게 여기 적어 둡니다. 출력이 고정된 JSON 한 덩어리라
 * 자유 문장을 생성할 자리가 없고, 이름만 찾는 작업이라 지시를 따를 여지가
 * 좁다는 판단입니다. **챗처럼 사용자에게 나가는 글을 만드는 자리가 아닙니다.**
 * 이 전제가 깨지면(출력에 자유 문장이 생기면) 격리 문구를 다시 넣어야 합니다.
 */
export const ORG_REPAIR_PROMPT = `# 1. 목적

당신은 통화 전사문에서 금융기관 이름을 찾아 표준 표기로 고치는 도구다.
전사가 잘못 들은 표기를 되돌리는 것이 전부다.


# 2. 기본 규칙

JSON 하나만 출력한다. JSON 밖에 다른 문장을 쓰지 마라.
설명하지 마라. 찾은 것이 없으면 빈 목록을 낸다.
절차나 대응 방법을 말하지 마라.


# 3. 표기 규약

## <transcript>

전사된 대화 내역이다. 여기서 기관 이름을 찾는다.

## 개인정보 토큰

[계좌-1] · [이름-1] 처럼 대괄호로 감싼 것은 개인정보가 치환된 자리다.
건드리지 마라. 원래 값을 추측하지 마라. 기관 이름으로 세지 마라.


# 4. 무엇을 찾나

## 찾는 것

돈이 지나간 곳의 이름이다.
은행, 인터넷은행, 증권사, 간편송금, 가상자산거래소, 카드사, 통신사, 상품권 발행사.

## 찾지 않는 것

- 사칭 기관. 검찰청·경찰서·금융감독원·국세청
- 사람 이름. 직함이 붙어도 마찬가지다
- 금액과 일시
- 대괄호로 감싼 것

「서울중앙지검 수사관이라면서 전화가 왔다」의 서울중앙지검은 찾지 않는다.
「국민은행에서 이체했다」의 국민은행은 찾는다.


# 5. 어떻게 고치나

## 고쳐 적는 것

전사가 잘못 들은 표기를 정식 이름으로 되돌린다.

- "시나는행" 은 "신한은행" 이다
- "포스" 는 "토스" 다
- "NET2 자진권" 은 "NH투자증권" 이다
- "테이빵크" 는 "케이뱅크" 다

## 모를 때

비운다. 억지로 고르지 마라.
후보가 여럿이면 여럿 다 적는다. 하나로 고르는 것은 당신이 아니다.


# 6. [출력 형식] 작성 규칙

## heard

전사문에 있는 글자를 그대로 옮긴다. 고쳐 적지 마라.

## candidates

정식 이름을 확실한 순서로 적는다.
하나만 확실하면 한 개, 여럿이 걸리면 여럿 다, 모르겠으면 빈 배열이다.
없는 이름을 만들지 마라.`

/**
 * 사용자 메시지 맨 끝에 붙는 출력 형식.
 *
 * **맨 끝에 다시 놓는 이유**는 모델이 바로 앞에서 본 것을 가장 잘 지키기
 * 때문입니다 — `prompt-builder` 가 같은 이유로 같게 합니다.
 */
export const ORG_REPAIR_OUTPUT_FORMAT = `[출력 형식]

{"orgs":[{"heard":"들린 그대로","candidates":["정식 이름"]}]}`

/** 모델이 낸 것 하나 — **검증 전입니다** */
export interface OrgMention {
  /** 전사문에 있던 글자 그대로 */
  readonly heard: string
  /** 모델이 고른 정식 이름들. 모르면 빈 배열 */
  readonly candidates: readonly string[]
}

/** 검증을 통과한 것 하나 */
export interface RepairedOrg {
  readonly heard: string
  /**
   * 사전에서 확정된 `org_id`. **하나로 못 좁혔으면 `null`** 이고,
   * 그때는 `options` 로 되묻습니다
   */
  readonly orgId: string | null
  /** 되묻기 선택지 — 사전에 있는 이름만 남습니다 */
  readonly options: readonly string[]
}

/**
 * 전사문 줄들을 모델에 넣을 모양으로 조립한다.
 *
 * **줄 태그로 감쌉니다** — 줄 경계가 사라지면 모델이 두 줄에 걸친 글자를
 * 한 이름으로 붙일 수 있습니다.
 */
export function buildOrgRepairInput(lines: readonly string[]): string {
  const body = lines.map((one) => `<line>${one}</line>`).join('\n')
  return `<transcript>\n${body}\n</transcript>\n\n${ORG_REPAIR_OUTPUT_FORMAT}`
}

/**
 * 모델이 낸 글에서 목록을 꺼낸다. **못 읽으면 빈 배열입니다.**
 *
 * 지시문이 *"JSON 하나만 출력한다"* 로 못 박았지만 모델이 앞뒤에 \`\`\`json
 * 울타리를 두르는 일이 있습니다. **그것 때문에 답을 통째로 버리지 않습니다** —
 * `lib/llm.ts` 가 같은 이유로 같게 합니다.
 */
export function parseOrgRepair(raw: string): readonly OrgMention[] {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  const text = fenced?.[1] ?? trimmed

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // 형식을 못 지킨 답은 **교정을 건너뛸 뿐** 전사 결과를 버리지 않습니다
    return []
  }

  if (typeof parsed !== 'object' || parsed === null) return []
  const orgs = (parsed as { orgs?: unknown }).orgs
  if (!Array.isArray(orgs)) return []

  const out: OrgMention[] = []
  for (const one of orgs) {
    if (typeof one !== 'object' || one === null) continue
    const { heard, candidates } = one as { heard?: unknown; candidates?: unknown }
    if (typeof heard !== 'string' || heard.trim().length === 0) continue

    out.push({
      heard: heard.trim(),
      candidates: Array.isArray(candidates)
        ? candidates.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
        : [],
    })
  }
  return out
}

/**
 * 모델이 낸 것을 사전으로 검증한다 — **여기가 확정의 자리입니다.**
 *
 * 넷을 봅니다.
 *
 * 1. `heard` 가 전사문에 실제로 있나 — **없으면 모델이 지어낸 것**입니다
 * 2. `candidate` 가 사전에 있나 — `matchOrg` 의 정확 일치. 없으면 버립니다
 * 3. 그 유형의 후보인가 — `candidates` 가 이미 채널로 좁혀져 옵니다
 * 4. 남은 것이 하나인가 — 하나면 확정, 여럿이면 되묻기 선택지
 *
 * @param transcript 줄들을 이어붙인 원문. `heard` 대조에 씁니다
 * @param candidates 그 사건 유형의 기관들 → `ChannelWriter.candidates`
 */
export function verifyOrgRepair(
  mentions: readonly OrgMention[],
  transcript: string,
  candidates: readonly OrgCandidate[],
): readonly RepairedOrg[] {
  if (candidates.length === 0) return []

  const out: RepairedOrg[] = []
  const seen = new Set<string>()

  for (const one of mentions) {
    // ① 지어낸 자리를 버립니다
    if (!transcript.includes(one.heard)) continue
    // 같은 표기를 여러 번 내도 한 번만 봅니다
    if (seen.has(one.heard)) continue
    seen.add(one.heard)

    // ②③ 사전에 있는 것만 남깁니다. **정확 일치입니다** — 유사도를 안 씁니다
    const hits: { orgId: string; name: string }[] = []
    for (const candidate of one.candidates) {
      const orgId = matchOrg(candidate, candidates)
      if (orgId === null) continue
      if (hits.some((hit) => hit.orgId === orgId)) continue
      const found = candidates.find((c) => c.orgId === orgId)
      if (found) hits.push({ orgId, name: found.name })
    }

    if (hits.length === 0) continue

    // ④ 하나면 확정, 여럿이면 되묻기
    out.push({
      heard: one.heard,
      orgId: hits.length === 1 ? hits[0]!.orgId : null,
      options: hits.map((hit) => hit.name),
    })
  }

  return out
}
