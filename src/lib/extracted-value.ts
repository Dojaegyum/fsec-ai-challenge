/**
 * 증거에서 뽑힌 값을 슬롯에 넣을 모양으로 다듬는다 — **못 다듬으면 `null`** 입니다.
 *
 * 정본: spec/backend/08-14-slot-tiering.md 「증거에서 자동 추출」 · spec/backend/08-16-data-model.md §5.1
 * 근거: ADR-069 (증거에서 뽑은 값은 한 번의 탭으로 확인한다)
 *
 * ## 여기에도 시계가 없습니다
 *
 * `slot-extractor` 는 값을 다듬지 않습니다 — *"「어제」를 날짜로 바꾸거나 「삼백만원」을
 * 숫자로 바꾸지 않습니다. 이 모듈에는 시계가 없고, 날짜를 세는 것은 `date-checker`
 * 하나입니다"*. 여기도 같습니다. **절대 표기만** 받습니다 — `2026.09.01 14:22:41` 은
 * 받고 「어제 오후」는 `null` 입니다. 셈이 필요한 표현을 여기서 풀면 시계가 둘이 됩니다
 * (CLAUDE.md 불변 규칙 7).
 *
 * `null` 은 실패가 아닙니다. 그 슬롯은 비어 있는 채로 남고 슬롯 체커가 그 문항을
 * 그대로 묻습니다 — *"자동 추출 실패는 정상 경로입니다"* (08-14-slot-tiering.md).
 *
 * ## 값의 모양은 문진 답과 같아야 합니다
 *
 * 같은 슬롯을 사람이 답하면 `amount` 는 숫자만(원 단위), `occurred_at` 은 날짜 입력이
 * 주는 `YYYY-MM-DD` 입니다(`chat-handler/stream.tsx`). 여기서 낸 값도 그 모양이어야
 * 기한 계산(`flows/compute-deadlines.ts` 의 `dayOf`)과 서류 기재 안내가 같은 코드로 읽습니다.
 */

/**
 * 금액 → 원 단위 정수 문자열.
 *
 *     32,000,000원   → 32000000
 *     3,200만원      → 32000000
 *     1.5억          → 150000000
 *     삼천이백만 원   → null   (한글 숫자는 셈이 필요합니다 — 사람에게 묻습니다)
 *     300만원쯤      → null   (「쯤」은 값이 아닙니다)
 */
export function normalizeAmount(raw: string): string | null {
  const m = /^\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(억|만)?\s*원?\s*$/.exec(raw)
  if (!m) return null
  const whole = m[1]!.replace(/,/g, '')
  const fraction = m[2] ?? ''
  const unit = m[3] === '억' ? 100_000_000 : m[3] === '만' ? 10_000 : 1
  // 소수는 단위가 있을 때만 뜻이 있습니다 — 「1.5억」. 원 단위 소수는 값이 아닙니다
  if (fraction && unit === 1) return null
  const value = Math.round(Number(`${whole}.${fraction || '0'}`) * unit)
  if (!Number.isFinite(value) || value <= 0 || value >= 1e13) return null
  return String(value)
}

/**
 * 시각 → `YYYY-MM-DD` 또는 `YYYY-MM-DDTHH:MM:SS+09:00`.
 *
 *     2026.09.01 14:22:41   → 2026-09-01T14:22:41+09:00
 *     2026.09.01 14:22.41   → 2026-09-01T14:22:41+09:00   (OCR 이 콜론을 점으로 읽는 일이 실제로 있었습니다 — 09-04 배포본)
 *     2026-09-01            → 2026-09-01
 *     2026년 9월 1일 14:22   → 2026-09-01T14:22:00+09:00
 *     9월 1일               → null   (해가 없으면 셈이 필요합니다)
 *     어제 오후             → null
 *
 * 시간대는 한국(+09:00)으로 못박습니다 — 이체 내역·문자 화면의 시각은 그 기기의 시각이고,
 * 이 서비스는 국내 사건만 다룹니다. `dayOf` 가 `Asia/Seoul` 로 하루를 뽑습니다.
 */
export function normalizeDateTime(raw: string): string | null {
  const m =
    /^\s*(\d{4})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?(?:[\sT]+(\d{1,2})\s*[:.시]\s*(\d{1,2})\s*분?(?:\s*[:.]\s*(\d{1,2})\s*초?)?)?\s*\.?\s*$/.exec(
      raw,
    )
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null
  // 2월 30일 같은 날을 걸러냅니다 — UTC 로 만들어 되읽으면 달이 넘어갑니다
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null

  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${year}-${pad(month)}-${pad(day)}`
  if (m[4] === undefined) return date

  const hour = Number(m[4])
  const minute = Number(m[5])
  const second = m[6] === undefined ? 0 : Number(m[6])
  if (hour > 23 || minute > 59 || second > 59) return null
  return `${date}T${pad(hour)}:${pad(minute)}:${pad(second)}+09:00`
}

/**
 * 상대 계좌 → 이 사건의 계좌 토큰 그대로(`[계좌-1]`).
 *
 * 전사문은 이미 토큰화된 뒤라 계좌번호는 토큰으로만 있습니다. 모델이 낸 것이
 * 토큰 모양이고 **그 토큰이 실제로 전사문에 있을 때만** 받습니다 — 지어낸 번호가
 * 슬롯에 들어가면 서류에 남의 계좌가 적힙니다.
 */
export function normalizeAccountToken(raw: string, text: string): string | null {
  // 모델이 「국민은행 [계좌-1]」처럼 앞뒤 말을 붙여 내는 일이 실제로 있었습니다(09-04 배포본).
  // 토큰이 **하나**면 그것을 값으로 받고, 둘 이상이면 어느 쪽인지 모르는 것이라 버립니다
  const tokens = raw.match(/\[계좌-\d+\]/g) ?? []
  if (tokens.length !== 1) return null
  const token = tokens[0]!
  return text.includes(token) ? token : null
}

/**
 * 사칭 기관·연락 수단 같은 글 값 → 전사문에 **그대로 있는** 짧은 글만.
 *
 * 모델이 요약하거나 바꿔 쓴 표현은 받지 않습니다. 「서울중앙지방검찰청 첨단범죄수사부」에서
 * 「서울중앙지방검찰청」을 집는 것은 되고(부분 문자열), 「검찰」로 바꿔 쓰면 안 됩니다 —
 * 그건 전사문에 없는 말입니다. 대괄호 토큰은 값이 아닙니다.
 */
export function normalizeMention(raw: string, text: string): string | null {
  const value = raw.trim()
  if (value.length === 0 || value.length > 40) return null
  if (/[[\]]/.test(value)) return null
  return text.includes(value) ? value : null
}

/**
 * 본인 이름 → 이 사건의 이름 토큰 그대로(`[이름-1]`).
 *
 * 이름 토큰은 2차 탐지(NER)가 켜졌을 때만 생깁니다. 꺼져 있으면 전사문에 이름이 **원문**으로
 * 남아 있고, 모델은 「김민수」라고 낼 것입니다 — **그것은 받지 않습니다.** 원문 이름이 슬롯에
 * 들어가면 서버에 개인정보가 남습니다(불변 규칙 2·3). 토큰 하나가 전사문에 있을 때만 받습니다 → ADR-070.
 */
export function normalizeNameToken(raw: string, text: string): string | null {
  const tokens = raw.match(/\[이름-\d+\]/g) ?? []
  if (tokens.length !== 1) return null
  const token = tokens[0]!
  return text.includes(token) ? token : null
}

/** 슬롯 이름에 맞는 다듬기 하나를 고른다. 표 밖 이름은 `null` — 슬롯에 안 들어갑니다 */
export function normalizeExtracted(slotKey: string, raw: string, text: string): string | null {
  switch (slotKey) {
    case 'amount':
      return normalizeAmount(raw)
    case 'occurred_at':
    case 'notice_started_at':
      return normalizeDateTime(raw)
    case 'counterpart_account':
    case 'victim_account':
      return normalizeAccountToken(raw, text)
    case 'victim_name':
      return normalizeNameToken(raw, text)
    case 'impersonated_org':
    case 'contact_method':
      return normalizeMention(raw, text)
    default:
      return null
  }
}
