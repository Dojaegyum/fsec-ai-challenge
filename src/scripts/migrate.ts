/**
 * 마이그레이션 적용기 — `psql` 없이도 돕니다.
 *
 * 정본: spec/backend/08-16-data-model.md (스키마) · `src/migrations/README.md`
 * 근거: ADR-016(Supabase Postgres) · RFC-001 「DB 통합시험은 CI 밖」
 *
 * ```
 * cd src
 * npm run migrate -- --dry-run   # 무엇이 적용될지만
 * npm run migrate                # 실제로 적용
 * ```
 *
 * ## `apply.sh` 와 무엇이 다른가
 *
 * **하는 일은 같습니다.** 옆의 `apply.sh` 는 `psql` 을 쓰는데, **Windows 개발
 * 기기에 `psql` 이 없습니다.** 그것 하나 때문에 스키마를 못 옮기면 DB 통합
 * 시험을 못 돌리고, 그 시험이 없으면 SQL 오타가 실제 요청까지 살아 나갑니다 —
 * 2026-08-24 에 실제로 그랬습니다.
 *
 * 배포에서도 쓸 자리라 **의존성을 안 늘렸습니다** — 앱이 이미 쓰는
 * `postgres` 드라이버 하나로 돕니다.
 *
 * ## 파일을 통째로 한 번에 보냅니다
 *
 * 마이그레이션 파일이 스스로 `BEGIN`·`COMMIT` 과 `schema_migrations` 기록을
 * 담고 있습니다. **여기서 문장을 쪼개지 않습니다** — 세미콜론으로 나누면
 * 함수 본문(`$$ … $$`)이 중간에서 갈라집니다.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

const DIR = fileURLToPath(new URL('../migrations/', import.meta.url))
const ENV_LOCAL = fileURLToPath(new URL('../.env.local', import.meta.url))

/** `.env.local` 을 아주 얇게 읽습니다 — 스크립트 하나 때문에 로더를 들이지 않습니다 */
function fromEnvLocal(key: string): string | undefined {
  try {
    for (const line of readFileSync(ENV_LOCAL, 'utf8').split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at < 0 || line.trimStart().startsWith('#')) continue
      if (line.slice(0, at).trim() !== key) continue
      return line.slice(at + 1).trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // 파일이 없으면 환경변수만 봅니다
  }
  return undefined
}

/** `0001_…sql` 처럼 번호가 앞에 붙은 것만. 이름순이 곧 적용 순서입니다 */
function pending(applied: ReadonlySet<string>): readonly string[] {
  return readdirSync(DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()
    .filter((name) => !applied.has(name.replace(/\.sql$/, '')))
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes('--dry-run')
  const url = process.env.DATABASE_URL ?? fromEnvLocal('DATABASE_URL')

  if (!url) {
    console.error('DATABASE_URL 이 비어 있습니다.')
    return 1
  }

  // 앱과 같은 설정입니다 → lib/db.ts. pooler 가 준비된 구문을 지원하지 않습니다
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })

  try {
    // 첫 마이그레이션이 이 표를 만듭니다 — 아직 없으면 빈 목록으로 봅니다
    const rows = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations
    `.catch(() => [] as { version: string }[])

    const applied = new Set(rows.map((one) => one.version))
    const todo = pending(applied)

    if (todo.length === 0) {
      console.log(`적용할 것이 없습니다. (이미 ${applied.size}개)`)
      return 0
    }

    console.log(`적용 대상 ${todo.length}개:`)
    for (const name of todo) console.log(`  ${name}`)

    if (dryRun) {
      console.log('\n--dry-run 이라 아무것도 안 했습니다.')
      return 0
    }

    for (const name of todo) {
      const text = readFileSync(DIR + name, 'utf8')
      // **파일 하나가 한 덩이입니다.** 안에 BEGIN·COMMIT 이 들어 있어
      // 여기서 트랜잭션을 또 열지 않습니다
      await sql.unsafe(text)
      console.log(`  ✓ ${name}`)
    }

    console.log(`\n${todo.length}개를 적용했습니다.`)
    return 0
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// **최상위 await 을 쓰지 않습니다** — `package.json` 에 `"type": "module"` 이
// 없어 tsx 가 CommonJS 로 컴파일합니다 → load-kb.ts 의 같은 이유
main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  },
)
