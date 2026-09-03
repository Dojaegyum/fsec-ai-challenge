/**
 * `contact_ref` 를 실제 번호로 바꾸는 규칙 — **KB 는 가리키기만 합니다.**
 *
 * 정본: spec/backend/08-16-data-model.md §11.1 · §11.4.1 · §11.4.3 · §11.4.4 ·
 *       spec/common/08-14-api.md §3.6 (`body.contact` · `channels[].submit`)
 * 근거: ADR-024(단계의 action 과 url) · ADR-042(내는 길은 배열)
 *
 * ## 왜 본문에 번호를 안 쓰나
 *
 * **번호가 바뀌면 절차 항목까지 새 버전을 내야 합니다.** 절차는 그대로인데
 * 번호만 바뀌는 경우가 대부분이고, 같은 유형 절차를 열아홉 은행이 공유합니다.
 *
 * ## 못 풀어도 절차는 나갑니다 → §11.4.3
 *
 * 기관을 특정 못 했거나 번호가 아직 확인 안 됐으면 `null` 입니다.
 * **연락처는 절차의 부속이지 절차 자체가 아닙니다.** 여기서 던지면
 * 번호 하나 때문에 안내 전체가 멈춥니다.
 */

/** `org.contact.report_tel` 처럼 `org.contact.` 로 시작하는 것만 풉니다 */
const PREFIX = 'org.contact.'

/**
 * 가리키는 값 하나를 푼다. 못 풀면 `null`.
 *
 * **문자열만 돌려줍니다.** `submit` 은 배열이라 여기서 안 풉니다 — 그것은
 * 아래 `submitPathsOf` 가 §3.6 `channels[].submit` 으로 통째로 옮기고, 기재
 * 안내 화면이 순서대로 그립니다(ADR-042). 이 자리는 §3.6 의 `body.contact`
 * 한 칸을 채우는 것입니다.
 */
export function resolveContact(
  ref: unknown,
  contact: Readonly<Record<string, unknown>> | null,
): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(PREFIX)) return null
  if (!contact) return null

  const key = ref.slice(PREFIX.length)
  const value = contact[key]
  // **확인 못 한 칸은 아예 없습니다** → §11.1 ①. 없는 것을 빈 문자열로
  // 만들면 화면이 「번호가 있다」로 읽고 빈 칸을 그립니다
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * 단계 본문의 `steps[]` 각 줄에 푼 값을 얹는다.
 *
 * **원본을 안 고칩니다** — 새 객체를 만듭니다. `body` 는 KB 의 사본이고,
 * 그것을 제자리에서 고치면 무엇이 KB 이고 무엇이 서버가 얹은 것인지
 * 구분이 사라집니다.
 *
 * ⬜ **계약의 `body` 는 평탄한데 우리 KB 는 `steps[]` 배열입니다** → §3.6.
 * 계약은 단계 하나에 `action`·`contact` 가 하나씩 붙는 모양이고, KB 는 한
 * 단계가 여러 행동을 담습니다(전화하고 → 받아적고). **어느 쪽이 정본인지
 * 사람이 정해야 합니다** — 지금은 KB 모양을 그대로 두고 각 행동에 `contact`
 * 를 답니다. 화면이 두 모양을 다 읽을 수 있어야 이 결정이 미뤄집니다.
 */
export function withContacts(
  body: Readonly<Record<string, unknown>>,
  contact: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> {
  const steps = body.steps
  if (!Array.isArray(steps)) return { ...body }

  return {
    ...body,
    steps: steps.map((one) => {
      const step = (one ?? {}) as Record<string, unknown>
      const value = resolveContact(step.contact_ref, contact)
      // 가리키지 않는 줄에는 칸을 안 답니다 — 「받아적기」에 번호가 붙어
      // 있으면 화면이 열 패널을 잘못 고릅니다
      return step.contact_ref === null || step.contact_ref === undefined
        ? { ...step }
        : { ...step, contact: value }
    }),
  }
}

/**
 * 신청서를 내는 길 하나 → §11.1 ④ · ADR-042.
 *
 * 계약 §3.6 `channels[].submit[]` 이 **이 모양 그대로**입니다. 화면의
 * `SubmitPath`(`app/c/[token]/doc.tsx`)와도 같습니다 — 세 곳이 한 모양이라야
 * KB 가 한 줄을 더했을 때 코드를 안 고칩니다.
 */
export interface SubmitPath {
  /** `"branch"` 또는 `"app"` 둘뿐 — 화면이 아이콘·문구를 이걸로 고릅니다 */
  readonly how: 'branch' | 'app'
  /** 사용자에게 보이는 한 줄. 기관이 쓰는 말 그대로 */
  readonly text: string
  /** 그 경로로 가는 공식 주소. 없으면 링크 없이 글자만 */
  readonly url?: string
}

const SUBMIT_HOW: ReadonlySet<string> = new Set(['branch', 'app'])

/**
 * `org.contact.submit` 을 계약의 배열로 옮긴다 → §3.6 `channels[].submit`.
 *
 * **순서를 그대로 둡니다. 정렬·가공하지 않습니다** — 배열 순서가 곧 권장
 * 순서이고 그것은 KB 소관입니다(ADR-042 ②). 「앱이 먼저」를 여기 박으면
 * KB·NH 사용자가 앱을 뒤지다 3영업일을 씁니다.
 *
 * **기관이 없거나 확인된 길이 없으면 빈 배열입니다** — `null` 이 아닙니다.
 * 화면은 빈 배열이면 제출처 카드를 아예 안 그립니다(ADR-042 ③ · §11.1 ①).
 * 「모른다」와 「없다」를 여기서 뭉개지 않습니다.
 *
 * 모양이 안 맞는 줄은 버립니다. **정책이 아니라 타입을 좁히는 것입니다** —
 * 적재(`planOrgLoad`)가 이미 그 모양을 거부하므로 실제로는 그대로 복사입니다.
 */
export function submitPathsOf(
  contact: Readonly<Record<string, unknown>> | null,
): readonly SubmitPath[] {
  const raw = contact?.submit
  if (!Array.isArray(raw)) return []

  const out: SubmitPath[] = []
  for (const one of raw) {
    if (typeof one !== 'object' || one === null) continue
    const { how, text, url } = one as Record<string, unknown>
    if (typeof how !== 'string' || !SUBMIT_HOW.has(how)) continue
    if (typeof text !== 'string' || text.trim().length === 0) continue
    out.push({
      how: how as SubmitPath['how'],
      text,
      // 없으면 칸을 아예 안 둡니다 — `url: undefined` 가 JSON 으로 나가면
      // 사라지긴 하지만, 시험이 `toEqual` 로 볼 때 모양이 달라집니다
      ...(typeof url === 'string' && url.length > 0 ? { url } : {}),
    })
  }
  return out
}

/**
 * `org.contact.caution` — 그 기관에서 헷갈리기 쉬운 것 → §11.1.
 *
 * 국민은행 앱의 「사고신고」는 보안매체 분실 신고이지 피해구제 신청이 아닙니다.
 * 제출처 카드 밑에 이 한 줄이 없으면 사용자가 앱에서 엉뚱한 것을 누릅니다.
 * **없으면 `null`** — 확인 못 한 칸은 아예 없습니다(§11.1 ①).
 */
export function cautionOf(contact: Readonly<Record<string, unknown>> | null): string | null {
  const value = contact?.caution
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
