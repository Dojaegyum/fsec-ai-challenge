/**
 * `contact_ref` 를 실제 번호로 바꾸는 규칙 — **KB 는 가리키기만 합니다.**
 *
 * 정본: spec/backend/08-16-data-model.md §11.1 · §11.4.1 · §11.4.3 · §11.4.4 ·
 *       spec/common/08-14-api.md §3.6 (`body.contact`)
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
 * 기재 안내 화면이 `org.contact.submit` 을 통째로 받아 순서대로 그립니다
 * (ADR-042). 이 자리는 §3.6 의 `body.contact` 한 칸을 채우는 것입니다.
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
