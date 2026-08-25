/**
 * 경유 서비스 목록을 화면이 읽을 모양으로 접는다 → 계약 §3.6 `channels[]`.
 *
 * ## 왜 접어야 하나
 *
 * `case_channel` 은 **같은 사건에 여러 줄이 쌓이는 표**입니다 (09-data-model.md §4) —
 * 여러 번 특정을 시도할 수 있고, 나중 시도가 앞선 것을 지우지 않습니다.
 * 그래서 문진을 순서대로 답하기만 해도 줄이 둘 생깁니다:
 *
 *   1. 「시중은행 계좌이체」 → `CH-bank` · `org_id: null`
 *   2. 「국민은행이요」     → `CH-bank` · `org_id: kb-bank`
 *
 * 표를 그대로 내보내면 화면에 **같은 건이 두 줄로 뜹니다** — 「시중은행(미특정)」과
 * 「시중은행 국민은행」. 사용자는 자기가 두 군데로 보냈다고 읽습니다.
 *
 * ## 무엇을 한 건으로 보나
 *
 * **유형이 같고 기관도 같으면 한 건입니다.** 유형만 같고 기관이 다르면 두 건입니다 —
 * 국민은행과 신한은행에 각각 보낸 사건이 실제로 있고, 그건 절차도 두 번입니다.
 *
 * **기관이 안 붙은 줄은 그 유형에 기관이 붙은 줄이 하나라도 있으면 버립니다.**
 * 위 예의 1번이 그것이고, 2번의 앞선 모습이지 별개의 송금이 아닙니다.
 * 반대로 기관이 끝내 안 붙었으면 그 줄이 남습니다 — **기관을 모르는 것은
 * 정상이고**(§4.1 *"못 찾아도 진행합니다"*), 그때도 유형 절차는 나갑니다.
 */

/** `case_channel` 한 줄 — 읽은 그대로 */
export interface ChannelRow {
  readonly channelId: string
  /** 서버가 해석한 기관. `null` 이면 미특정 → §4.1 */
  readonly orgId: string | null
  /** 사용자·증거에 나온 표기 그대로(가린 값). **토큰화 대상이 아닙니다** → ADR-011 */
  readonly orgNameRaw: string | null
  /** 원 단위. 모르면 `null` */
  readonly amount: number | null
  /** 판별 확신도 0.00~1.00. 없으면 `null` */
  readonly confidence: number | null
}

/**
 * 확신 높은 순으로 접는다.
 *
 * ⚠️ **입력은 이미 정렬돼 있어야 합니다** — 확신도 내림차순, 같으면 최신 순
 * (`ORDER BY confidence DESC NULLS LAST, created_at DESC`). 이 함수는 순서를
 * 다시 매기지 않고 **앞에 온 줄을 더 확실한 것으로 믿습니다.**
 *
 * 접을 때 **빈 칸만 뒤엣것으로 채웁니다.** 확신 높은 줄이 금액을 모른다고 해서
 * 앞서 적힌 금액까지 지우면, 사용자가 이미 답한 값이 화면에서 사라집니다.
 */
export function foldChannels(rows: readonly ChannelRow[]): readonly ChannelRow[] {
  const named = new Set(
    rows.filter((one) => one.orgId !== null).map((one) => one.channelId),
  )

  const folded = new Map<string, ChannelRow>()
  for (const row of rows) {
    // 기관이 끝내 안 붙은 유형만 미특정으로 남습니다
    if (row.orgId === null && named.has(row.channelId)) continue

    // 사이를 빈칸으로 벌립니다. `CH-bank`·`kb-bank` 같은 식별자에는 빈칸이
    // 없어 경계가 안 섞입니다 — 그냥 이어 붙이면 `CH-a` + `b` 와
    // `CH-` + `ab` 가 같은 열쇠가 됩니다
    const key = `${row.channelId} ${row.orgId ?? ''}`
    const prior = folded.get(key)
    if (!prior) {
      folded.set(key, row)
      continue
    }

    folded.set(key, {
      ...prior,
      orgNameRaw: prior.orgNameRaw ?? row.orgNameRaw,
      amount: prior.amount ?? row.amount,
      confidence: prior.confidence ?? row.confidence,
    })
  }

  return [...folded.values()]
}
