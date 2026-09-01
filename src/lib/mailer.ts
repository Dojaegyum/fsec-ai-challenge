/**
 * 메일을 실제로 부치는 자리 — Brevo (transactional).
 *
 * 정본: spec/common/08-14-api.md §1.2 (`MAILER_API_KEY` · `MAILER_FROM` · `APP_ORIGIN`)
 * 근거: ADR-021(이메일은 선택 · 재진입 축) · ADR-028(자원 접근은 `src/lib/`)
 *
 * ## 왜 Brevo 인가 — 2026-09-01 결정
 *
 * 무료 300통/일이고, **도메인 없이** 발신자 이메일 인증만으로 발송됩니다.
 * 우리 주소가 `*.vercel.app` 라 DNS 를 못 만져서 도메인 인증이 필수인 곳
 * (Resend)은 못 쓰고, SendGrid 는 무료 구간이 없어졌습니다.
 * 부르는 모양이 REST 하나라 SDK 없이 갑니다 — `llm.ts` 와 같은 이유입니다.
 *
 * ## 이 메일에 실리는 것 — 그리고 안 실리는 것
 *
 * 실립니다: 기한 날짜(규칙이 센 값 그대로 — 불변 규칙 7) · 단계 제목(KB 제목) ·
 * 사건 링크(`APP_ORIGIN` + `link_token`).
 * 안 실립니다: 이름·계좌 등 PII(볼트 밖으로 안 나옵니다) · 환급 기대치(불변
 * 규칙 8) · 여기서 지어낸 절차(불변 규칙 1 — 문장은 안내가 아니라 「돌아오세요」입니다).
 *
 * ⬜ **문구는 임시입니다** — 주기·문구의 정본이 아직 없습니다(층 4 TODO).
 * 정본이 서면 여기 문장만 갈아끼웁니다. 그래서 문구를 한 곳에 모아 뒀습니다.
 */

import 'server-only'

import type { Env } from './env'
import type { Mailer, Reminder } from '@/modules/reminder-sender'

const ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

/** 무료 구간에서도 넉넉한 한계 — 발송은 크론이라 사용자를 기다리게 하지 않습니다 */
const TIMEOUT_MS = 15_000

/**
 * 이유별 제목. **한 곳에 모아 둔 것**이 요점입니다 — 문구 정본이 서면 여기만 바꿉니다.
 */
const SUBJECT: Record<Reminder['reason'], string> = {
  deadline_near: '[FinAlly] 기한이 다가옵니다 — 사건을 이어서 진행하세요',
  deadline_passed: '[FinAlly] 지나간 기한이 있습니다 — 아직 할 수 있는 일이 있는지 확인하세요',
  step_unconfirmed: '[FinAlly] 완료 확인이 안 된 단계가 있습니다',
}

/**
 * 본문을 짓는다 — **재진입 안내이지 절차 안내가 아닙니다.**
 *
 * 절차·날짜 해석은 화면(사건 링크 너머)이 합니다. 메일이 절차를 말하기 시작하면
 * 그 문장에도 근거·시행일이 붙어야 하는데(불변 규칙 1) 메일은 그걸 못 합니다.
 */
function bodyOf(reminder: Reminder, caseUrl: string): string {
  const lines: string[] = []

  if (reminder.deadlines.length > 0) {
    lines.push('다가온 기한:')
    for (const one of reminder.deadlines) {
      // 서버 규칙이 센 날짜 그대로입니다. 여기서 다시 세지 않습니다
      lines.push(`  · ${one.dueDate} 까지`)
    }
    lines.push('')
  }

  if (reminder.steps.length > 0) {
    lines.push('완료 확인이 안 된 단계:')
    for (const one of reminder.steps) {
      lines.push(`  · ${one.title}`)
    }
    lines.push('')
  }

  lines.push('사건 화면에서 이어서 진행하실 수 있습니다:')
  lines.push(caseUrl)
  lines.push('')
  lines.push('이 링크는 본인만 쓰세요. 링크가 곧 사건 열쇠입니다.')
  lines.push('')
  lines.push('— FinAlly · 이 메일은 알림을 신청하신 사건에 대해서만 발송됩니다')

  return lines.join('\n')
}

/**
 * Brevo 메일러를 만든다. **셋 중 하나라도 비면 `null`** — 조립하는 쪽이
 * not-configured 로 채워, 크론은 돌되 발송이 `failed` 로 남습니다.
 */
export function createMailer(env: Env): Mailer | null {
  // `LLM_API_KEY ?? XAI_API_KEY` 와 같은 무늬 — 일반 이름이 비면 제공자 이름
  const key = env.values.MAILER_API_KEY ?? env.values.BREVO_API_KEY
  const from = env.values.MAILER_FROM
  const origin = env.values.APP_ORIGIN?.replace(/\/+$/, '')

  // 링크 없는 알림은 재진입이 아닙니다 — 밑동이 없으면 안 섭니다 (머리말)
  if (!key || !from || !origin) return null

  return {
    async send(reminder: Reminder): Promise<void> {
      const caseUrl = `${origin}/c/${reminder.linkToken}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

      let res: Response
      try {
        res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'api-key': key,
            'content-type': 'application/json',
            accept: 'application/json',
          },
          body: JSON.stringify({
            sender: { email: from, name: 'FinAlly' },
            to: [{ email: reminder.email }],
            subject: SUBJECT[reminder.reason],
            textContent: bodyOf(reminder, caseUrl),
          }),
          signal: controller.signal,
          cache: 'no-store',
        })
      } catch (error) {
        // ⚠️ **열쇠도 수신자 주소도 메시지에 담지 않습니다** — 이 메시지는
        // `ReminderRun.failed` 로 가고, 그건 로그와 크론 응답에 남습니다
        const timedOut = error instanceof Error && error.name === 'AbortError'
        // 맨 Error 로 충분합니다 — 크론(reminder-sender)이 잡아 `failed` 에 담고,
        // HTTP 로 나가는 값이 아닙니다. 다음 회차가 다시 집습니다
        throw new Error(timedOut ? '메일 서비스가 제때 답하지 않았습니다' : '메일 서비스에 닿지 못했습니다')
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        // 응답 본문에 수신자 주소가 실려 올 수 있어 그대로 옮기지 않습니다
        throw new Error(`메일 서비스가 거절했습니다 (${res.status})`)
      }
    },
  }
}
