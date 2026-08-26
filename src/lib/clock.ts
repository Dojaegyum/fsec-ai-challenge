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

/**
 * 어느 순간의 `Asia/Seoul` 날짜 `YYYY-MM-DD`.
 *
 * **기한이 며칠 남았나를 셀 때 씁니다** → §3.7 `days_left`. `due_at` 은 시각인데
 * 세는 것은 날이라, 먼저 같은 시간대의 날짜로 내려야 합니다. UTC 로 세면
 * **한국 시각 아침 8시가 전날로** 잡혀 하루가 어긋납니다.
 */
export function seoulDay(at: Date): string {
  return DATE_PARTS.format(at)
}

/**
 * `2026-08-20T23:59:59+09:00` → `2026년 8월 20일`. **못 읽으면 `null`** 입니다.
 *
 * 프롬프트에 기한을 사람이 읽는 날짜로 넣을 때 씁니다 → 11-chat-context.md §3.3
 * *"프롬프트에 넣는 것: 기한: 2026년 8월 20일까지"*. **모델은 이 날짜를 문장에
 * 넣기만 하고 세지 않습니다** (불변 규칙 7).
 *
 * `todayLabel()` 과 같은 형식이라야 합니다 — 프롬프트에 「현재 날짜」와 기한이
 * 나란히 들어가는데 표기가 다르면 모델이 둘을 다른 종류로 읽습니다.
 */
export function seoulDayLabel(iso: string): string | null {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : LABEL_PARTS.format(at)
}

/**
 * 어느 순간을 `2026-08-20T23:59:59.000+09:00` 로.
 *
 * **저장소에서 읽은 시각을 응답에 실을 때 씁니다.** `toISOString()` 을 쓰면
 * `Z` 가 붙어 정본 표기와 어긋나고, 자정 근처 값에서 **날짜가 하루 앞으로**
 * 보입니다 — 공고 시작 `00:00+09:00` 이 전날 `15:00Z` 가 됩니다.
 */
export function seoulIso(at: Date): string {
  return toSeoulIso(at)
}
