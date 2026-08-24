/**
 * 손으로 기한을 심는 도구 — **개발 확인용입니다.**
 *
 * ⛔ 아직 `date-checker` 를 부르는 자리가 없어 실제 사건에는 기한이 안 생깁니다.
 * §3.7 응답(`days_left`·`starts_at`·`elapsed`·`condition`)이 실제로 나가는지
 * 눌러 보려면 줄이 있어야 해서 만든 것입니다.
 *
 * ```
 * npm run seed:deadline -- --token <링크토큰>
 * npm run seed:deadline -- --token <링크토큰> --clear
 * ```
 *
 * **제품 경로가 아닙니다.** 기한을 만드는 것은 `date-checker` 이고, 그 자리가
 * 붙으면 이 스크립트는 지웁니다.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

const ENV_LOCAL = fileURLToPath(new URL('../.env.local', import.meta.url))

function fromEnvLocal(key: string): string | undefined {
  try {
    for (const line of readFileSync(ENV_LOCAL, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at < 0 || line.trimStart().startsWith('#')) continue
      if (line.slice(0, at).trim() !== key) continue
      return line.slice(at + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 없으면 환경변수만 봅니다 */
  }
  return undefined
}

/** `lib/ids.ts` 와 같은 알파벳 — 여기서 import 하지 않는 이유는 그쪽이 `server-only` 라서입니다 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function ulid(): string {
  let out = ''
  let left = Date.now()
  for (let i = 0; i < 10; i += 1) {
    out = ALPHABET[left % 32] + out
    left = Math.floor(left / 32)
  }
  for (let i = 0; i < 16; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * 32)]
  }
  return out
}

/** 오늘로부터 며칠 뒤의 그날 끝 — `2026-08-27T23:59:59+09:00` */
function endOfDayIn(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000)
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
  return `${day}T23:59:59+09:00`
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const token = argv[argv.indexOf('--token') + 1]
  const clear = argv.includes('--clear')

  if (!token || token.startsWith('--')) {
    console.error('사건 링크 토큰이 필요합니다 — `--token <26자>`')
    return 1
  }

  const url = process.env.DATABASE_URL ?? fromEnvLocal('DATABASE_URL')
  if (!url) {
    console.error('DATABASE_URL 이 없습니다.')
    return 1
  }

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })
  try {
    const found = await sql<{ case_id: string }[]>`
      SELECT case_id FROM "case" WHERE link_token = ${token}
    `
    const caseId = found[0]?.case_id
    if (!caseId) {
      console.error('그 토큰의 사건이 없습니다.')
      return 1
    }

    if (clear) {
      await sql`DELETE FROM deadline WHERE case_id = ${caseId}`
      console.log('기한을 지웠습니다.')
      return 0
    }

    const rows = [
      {
        kind: 'primary',
        due_at: endOfDayIn(2),
        computed_from: 'relief_applied_at',
        snapshot: { on_miss: '이 날짜를 넘기면 금융회사가 14일을 추가로 통지합니다' },
      },
      {
        kind: 'grace',
        due_at: endOfDayIn(16),
        computed_from: 'relief_applied_at',
        snapshot: {
          condition: '3영업일을 넘겼을 때 주어지는 기간입니다. 이때도 안 내면 지급정지가 무효가 됩니다',
        },
      },
      {
        kind: 'info',
        due_at: endOfDayIn(60),
        computed_from: 'relief_applied_at',
        snapshot: {
          starts_at: endOfDayIn(-1).replace('T23:59:59', 'T00:00:00'),
          note: '금융감독원이 진행합니다. 사용자가 할 일은 없습니다',
        },
      },
      {
        kind: 'primary',
        due_at: endOfDayIn(-3),
        computed_from: 'relief_applied_at',
        snapshot: { on_miss: '이미 지난 기한입니다' },
      },
    ]

    for (const row of rows) {
      await sql`
        INSERT INTO deadline
          (deadline_id, case_id, plan_step_id, kind, due_at, computed_from,
           computed_at, rule_snapshot, kb_version, status)
        VALUES
          (${ulid()}, ${caseId}, NULL, ${row.kind}, ${row.due_at}, ${row.computed_from},
           now(), ${sql.json(row.snapshot as never)}, ${'2026.08.1'},
           ${row.kind === 'primary' && row.due_at < endOfDayIn(0) ? 'missed' : 'open'})
      `
    }
    console.log(`기한 ${rows.length}건을 심었습니다 — 사건 ${caseId}`)
    return 0
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)
