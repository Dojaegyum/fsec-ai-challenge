/**
 * 기한 응답에 붙는 셈 — `days_left` 와 `elapsed`.
 *
 * 정본: spec/common/08-14-api.md §3.7 · spec/common/08-16-deadline-rules.md
 * 근거: CLAUDE.md 불변 규칙 7 「기한 계산에 언어모델을 쓰지 않는다」
 *
 * ## 왜 서버가 세나
 *
 * 화면이 `due_at` 에서 직접 세면 **사용자 기기의 날짜가 틀릴 때 기한을 놓칩니다.**
 * 기준 시계는 서버 하나입니다 → 기한 규칙 「클라이언트 시계를 신뢰하지 않습니다」.
 * §S-07 도 「화면은 날짜를 세지 않습니다」로 같은 말을 합니다.
 *
 * ## 규칙으로 셉니다 — 모델에 안 맡깁니다
 *
 * 불변 규칙 7 은 **날짜를 세는 것**을 금지한 게 아니라 **모델에 맡기는 것**을
 * 금지합니다. 여기 있는 것이 그 「코드의 규칙」입니다.
 *
 * ⚠️ **여기서 법정 기한을 계산하지 않습니다.** 3영업일·14일을 세는 것은
 * `date-checker` 이고, 그 결과가 `deadline` 표에 적힙니다. 이 파일은 **적힌
 * 날짜와 오늘 사이**만 봅니다.
 */

import 'server-only'

import { seoulDay } from './clock'

const DAY_MS = 86_400_000

/** `YYYY-MM-DD` 를 날 번호로. 시간대가 없는 값이라 UTC 로 읽어야 안 흔들립니다 */
function dayNumber(ymd: string): number | null {
  const at = Date.parse(`${ymd}T00:00:00Z`)
  return Number.isNaN(at) ? null : at / DAY_MS
}

/**
 * 며칠 남았나 — **달력 일수**입니다 (영업일이 아닙니다).
 *
 * | | |
 * | --- | --- |
 * | 오늘이 마감일 | `0` |
 * | 이미 지남 | **`null`** — 부르는 쪽이 칸을 뺍니다 |
 * | 음수 | **안 냅니다** |
 *
 * 지난 기한은 `status: "missed"` 하나로 말합니다 (§3.7 확정). 「D+3」 같은 표시는
 * 시안에 없어서, 음수를 보내면 화면이 그릴 곳이 없습니다.
 */
export function daysLeft(dueAtIso: string, today: string): number | null {
  const due = new Date(dueAtIso)
  if (Number.isNaN(due.getTime())) return null

  const dueDay = dayNumber(seoulDay(due))
  const todayDay = dayNumber(today)
  if (dueDay === null || todayDay === null) return null

  const left = dueDay - todayDay
  return left < 0 ? null : left
}

/**
 * 시작~만료 사이에서 지금이 어디인가 — `0`~`1`.
 *
 * **공고 대기 카드의 마커 자리입니다** (§S-07 · ADR-048). 이게 없으면 카드가
 * 「언제 끝나는지」만 말하고, 몇 달짜리 기다림에서 **지금이 어디쯤인지**를
 * 사용자가 알 방법이 없습니다.
 *
 * 못 재면 `null` — 시작이 없거나 끝이 시작보다 앞이면 그렇습니다.
 */
export function elapsedRatio(
  startsAtIso: string,
  dueAtIso: string,
  nowMs: number,
): number | null {
  const from = new Date(startsAtIso).getTime()
  const to = new Date(dueAtIso).getTime()
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return null

  const ratio = (nowMs - from) / (to - from)
  // 시작 전이면 0, 지났으면 1 — 마커가 카드 밖으로 나가지 않게 가둡니다
  const held = Math.min(1, Math.max(0, ratio))
  return Math.round(held * 100) / 100
}
