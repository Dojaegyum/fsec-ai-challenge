/**
 * KB 적재기 — `src/kb/*.json` 을 읽어 `kb_entry` 에 넣습니다.
 *
 * 규약: rfc/002-kb-authoring.md 「원본은 파일이고, DB는 사본입니다」
 * 정본: spec/backend/08-16-data-model.md §11.1 (칼럼) · §11.4.5 (적재 시 검증)
 * 근거: ADR-012 · ADR-045(버전을 못 박아 읽는다)
 *
 * ```
 * cd src
 * npm run kb:load -- --version 2026.08.1 --dry-run   # 무엇이 실릴지만
 * npm run kb:load -- --version 2026.08.1             # 실제로 적재
 * ```
 *
 * **버전은 여기서 찍습니다.** 파일에는 없습니다 — 항목을 고칠 때마다 버전
 * 문자열까지 손대야 하고, 빠뜨리면 릴리스가 조용히 어긋납니다 (RFC-002).
 *
 * ## 판정은 `lib/kb-load.ts` 가 합니다
 *
 * 이 파일은 **파일을 읽고 DB 에 넣는 것만** 합니다. 검증을 여기 두면 시험을
 * 못 붙입니다 — 스크립트는 `npm test` 가 안 봅니다.
 *
 * ## 이미 있는 버전은 덮지 않습니다
 *
 * 릴리스된 버전이 조용히 바뀌면 **「그때 무엇을 안내했나」가 사라집니다.**
 * 되짚어야 할 때 되짚을 수 없게 됩니다 → ADR-045. 정말 덮어야 하면 `--overwrite`.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import postgres from 'postgres'

import {
  planLoad,
  planOrgLoad,
  type KbFile,
  type KbRow,
  type OrgFile,
  type OrgRow,
} from '@/lib/kb-load'

const KB_DIR = fileURLToPath(new URL('../kb/', import.meta.url))
const ENV_LOCAL = fileURLToPath(new URL('../.env.local', import.meta.url))

interface Args {
  readonly version: string | null
  readonly dryRun: boolean
  readonly overwrite: boolean
}

function readArgs(argv: readonly string[]): Args {
  let version: string | null = process.env.KB_VERSION ?? null
  let dryRun = false
  let overwrite = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--version') {
      version = argv[i + 1] ?? null
      i += 1
    } else if (arg === '--dry-run') dryRun = true
    else if (arg === '--overwrite') overwrite = true
  }
  return { version, dryRun, overwrite }
}

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

/**
 * 파일을 둘로 가른다 — **절차(`entries`)와 기관(`orgs`)은 다른 표로 갑니다.**
 *
 * 한 폴더에 두는 이유는 **같은 릴리스로 묶이기 때문**입니다. 번호가 바뀌었는데
 * 절차만 새 버전을 내면, 그 릴리스를 인용한 안내가 옛 번호를 답니다.
 */
function readFiles(): { kb: readonly KbFile[]; orgs: readonly OrgFile[] } {
  const names = readdirSync(KB_DIR).filter((name) => name.endsWith('.json')).sort()
  const kb: KbFile[] = []
  const orgs: OrgFile[] = []

  for (const name of names) {
    const raw = JSON.parse(readFileSync(KB_DIR + name, 'utf8')) as Record<string, unknown>
    if (Array.isArray(raw.orgs)) orgs.push({ name, ...raw } as OrgFile)
    else kb.push({ name, ...raw } as KbFile)
  }
  return { kb, orgs }
}

async function main(): Promise<number> {
  const args = readArgs(process.argv.slice(2))

  if (!args.version) {
    console.error('버전을 정해야 합니다 — `--version 2026.08.1` 또는 `KB_VERSION`.')
    console.error('릴리스가 버전을 찍습니다 (RFC-002). 파일에는 버전이 없습니다.')
    return 1
  }

  const { kb: files, orgs: orgFiles } = readFiles()
  if (files.length === 0) {
    console.error(`KB 파일이 없습니다: ${KB_DIR}`)
    return 1
  }

  const orgPlan = planOrgLoad(orgFiles, { kbVersion: args.version })
  const { rows, problems } = planLoad(files, {
    kbVersion: args.version,
    releasedAt: new Date().toISOString(),
  })

  console.log(`파일 ${files.length}개 · 항목 ${rows.length + problems.length}개를 봤습니다.\n`)

  const allProblems = [...problems, ...orgPlan.problems]
  if (allProblems.length > 0) {
    // **하나라도 어기면 통째로 거부합니다** → §11.4.5.
    // 절반만 실으면 「어느 절차가 최신인가」가 사건마다 달라집니다
    console.error(`적재를 거부합니다 — 어긴 자리 ${allProblems.length}건.\n`)
    for (const one of allProblems) {
      console.error(`  [${one.rule}] ${one.file}${one.entry ? ` · ${one.entry}` : ''}`)
      console.error(`      ${one.message}`)
    }
    return 1
  }

  console.log(`실을 것 ${rows.length}건 — 버전 ${args.version}`)
  for (const row of rows) {
    console.log(
      `  ${row.step_seq.toString().padStart(3)} ${row.step_key.padEnd(20)} ${row.effective_from}  ${row.title}`,
    )
  }

  if (orgPlan.rows.length > 0) {
    console.log(`
기관 ${orgPlan.rows.length}곳`)
    for (const one of orgPlan.rows) {
      const tel = (one.contact.report_tel as string | undefined) ?? '(번호 미확인)'
      console.log(`  ${one.org_id.padEnd(16)} ${one.channel_id.padEnd(12)} ${tel.padEnd(14)} ${one.name}`)
    }
  }

  if (args.dryRun) {
    console.log('\n`--dry-run` 이라 여기서 멈춥니다. DB 를 건드리지 않았습니다.')
    return 0
  }

  const url = process.env.DATABASE_URL ?? fromEnvLocal('DATABASE_URL')
  if (!url) {
    console.error('\nDATABASE_URL 이 없습니다 — 환경변수나 `src/.env.local` 에 넣으세요.')
    return 1
  }

  // 마이그레이션과 같은 이유로 `max: 1` 입니다 — 트랜잭션을 씁니다
  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} })

  try {
    const already = await sql<{ count: number }[]>`
      SELECT COUNT(*)::int AS count FROM kb_entry WHERE kb_version = ${args.version}
    `
    const found = already[0]?.count ?? 0
    if (found > 0 && !args.overwrite) {
      console.error(`\n버전 ${args.version} 이 이미 ${found}건 있습니다.`)
      console.error('릴리스된 버전을 조용히 바꾸면 「그때 무엇을 안내했나」가 사라집니다.')
      console.error('정말 덮으려면 `--overwrite` 를 붙이세요.')
      return 1
    }

    // **한 덩어리로 넣습니다.** 절반만 실린 KB 는 절반이 최신이고 절반이 옛것입니다
    await sql.begin(async (tx) => {
      for (const row of rows) await insert(tx, row)
      for (const row of orgPlan.rows) await insertOrg(tx, row)
    })

    console.log(`\n적재했습니다 — 절차 ${rows.length}건 · 기관 ${orgPlan.rows.length}곳, 버전 ${args.version}.`)
    console.log(`이 버전을 쓰려면 \`KB_VERSION=${args.version}\` 을 환경에 넣으세요 (ADR-045).`)
    return 0
  } finally {
    await sql.end({ timeout: 5 })
  }
}

type Tx = postgres.TransactionSql

/**
 * 한 줄을 넣습니다. **같은 (항목, 버전)이면 갈아끼웁니다** — `--overwrite` 로
 * 들어온 경우이거나, 앞선 실행이 중간에 끊긴 경우입니다.
 */
async function insert(tx: Tx, row: KbRow): Promise<void> {
  await tx`
    INSERT INTO kb_entry
      (kb_entry_id, kb_version, step_key, step_seq, channel_id, org_id, track,
       title, body, legal_basis, source_url, effective_from, effective_until,
       verified_at, released_at)
    VALUES
      (${row.kb_entry_id}, ${row.kb_version}, ${row.step_key}, ${row.step_seq},
       ${row.channel_id}, ${row.org_id}, ${row.track}, ${row.title},
       ${tx.json(row.body as never)}, ${row.legal_basis}, ${row.source_url},
       ${row.effective_from}, ${row.effective_until}, ${row.verified_at},
       ${row.released_at})
    ON CONFLICT (kb_entry_id, kb_version) DO UPDATE SET
      step_key = EXCLUDED.step_key,
      step_seq = EXCLUDED.step_seq,
      channel_id = EXCLUDED.channel_id,
      org_id = EXCLUDED.org_id,
      track = EXCLUDED.track,
      title = EXCLUDED.title,
      body = EXCLUDED.body,
      legal_basis = EXCLUDED.legal_basis,
      source_url = EXCLUDED.source_url,
      effective_from = EXCLUDED.effective_from,
      effective_until = EXCLUDED.effective_until,
      verified_at = EXCLUDED.verified_at,
      released_at = EXCLUDED.released_at
  `
}

// **최상위 `await` 를 쓰지 않습니다** — `package.json` 에 `"type": "module"` 이
// 없어서 실행기가 CJS 로 옮기고, 그러면 최상위 await 이 못 씁니다
main().then(
  (code) => {
    process.exitCode = code
  },
  (error: unknown) => {
    console.error(error)
    process.exitCode = 1
  },
)

/**
 * 기관 한 곳을 넣는다 → §11.1.
 *
 * 열쇠가 `(org_id, kb_version)` 이라 **같은 릴리스 안에서만 덮어씁니다.**
 * 지난 릴리스의 번호는 그대로 남습니다 — 「그때 무엇을 안내했나」가 남아야 합니다.
 */
async function insertOrg(tx: Tx, row: OrgRow): Promise<void> {
  await tx`
    INSERT INTO org
      (org_id, kb_version, channel_id, name, aliases, contact, source_url, verified_at)
    VALUES
      (${row.org_id}, ${row.kb_version}, ${row.channel_id}, ${row.name},
       ${tx.json(row.aliases as never)}, ${tx.json(row.contact as never)},
       ${row.source_url}, ${row.verified_at})
    ON CONFLICT (org_id, kb_version) DO UPDATE SET
      channel_id = EXCLUDED.channel_id,
      name = EXCLUDED.name,
      aliases = EXCLUDED.aliases,
      contact = EXCLUDED.contact,
      source_url = EXCLUDED.source_url,
      verified_at = EXCLUDED.verified_at
  `
}
