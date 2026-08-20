/**
 * 서버 시계 하나 — `Asia/Seoul` 고정.
 *
 * 정본: spec/common/08-16-deadline-rules.md 「계산의 전제」
 *
 * **시계가 여러 개면 하루가 어긋납니다.** 특히 크론이 UTC 자정 근처에 돌 때
 * 어느 시계를 봤느냐로 날짜가 갈립니다.
 *
 * 여섯 모듈이 각자 `Clock` 포트를 선언했고 모양이 조금씩 다릅니다
 * (`now` · `today` · `todayLabel` · `nowMs`). 넷을 다 가진 객체 하나를 만들어
 * 각 자리에 그대로 넣으면 구조적으로 전부 맞습니다.
 */

import 'server-only'

const TIME_ZONE = 'Asia/Seoul'

/** `2026-08-20` — 09-data-model.md 의 DATE 칼럼과 같은 표기 */
const DATE_PARTS = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** `2026년 8월 20일` — 프롬프트에 사람이 읽는 형태로 들어갑니다 → 11-chat-context.md §3.3 */
const LABEL_PARTS = new Intl.DateTimeFormat('ko-KR', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
})

/**
 * `2026-08-20T14:30:00.000+09:00`
 *
 * **`toISOString()` 을 쓰지 않습니다.** 그건 UTC 로 찍혀 `Z` 가 붙는데,
 * 정본이 `Asia/Seoul` 표기(`+09:00`)로 정했습니다 → 08-14-api.md.
 */
function toSeoulIso(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const get = (type: string) => parts.find((one) => one.type === type)?.value ?? '00'
  const ms = String(at.getMilliseconds()).padStart(3, '0')

  // 한국은 서머타임이 없어 오프셋이 항상 +09:00 입니다
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}.${ms}+09:00`
}

/** 여섯 모듈의 `Clock` 포트를 한꺼번에 만족하는 모양 */
export interface ServerClock {
  /** ISO 8601 · `Asia/Seoul` */
  now(): string
  /** `YYYY-MM-DD` · `Asia/Seoul` */
  today(): string
  /** `2026년 8월 20일` */
  todayLabel(): string
  /** 경과 시간 재기용 */
  nowMs(): number
}

export function createServerClock(source: () => Date = () => new Date()): ServerClock {
  return {
    now: () => toSeoulIso(source()),
    today: () => DATE_PARTS.format(source()),
    todayLabel: () => LABEL_PARTS.format(source()),
    nowMs: () => source().getTime(),
  }
}

/** 앱이 쓰는 것 하나 */
export const serverClock: ServerClock = createServerClock()
