/**
 * 검수 큐를 보고, 사람의 판단을 적는다 — `kb-reviewer` 의 명령줄 얼굴.
 *
 *     npm run kb:review                                  # pending 큐 (원문 앞부분과 함께)
 *     npm run kb:review -- --show <change_id>            # 원문 전체
 *     npm run kb:review -- --approve <change_id> --by 김태현 [--note "…"]
 *     npm run kb:review -- --reject  <change_id> --by 김태현 [--note "…"]
 *     npm run kb:review -- --defer   <change_id> --by 김태현 --note "시행일 미정"
 *     npm run kb:review -- --released <change_id> --version 2026.09.3
 *
 * 정본: spec/backend/08-16-data-model.md §12.2 · ADR-044(미룸) · RFC-002 · ADR-072.
 *
 * **승인이 곧 반영이 아닙니다.** 승인은 「사람이 봤고 반영해도 된다」는 표시이고, 반영은 사람이
 * `src/kb/*.json` 을 고쳐 `npm run kb:load` 로 릴리스하는 별도 단계입니다. 릴리스가 끝나면
 * `--released` 로 어느 버전에 실렸는지 남깁니다 — 검수의 산출물은 diff 입니다.
 *
 * 관리자 화면은 만들지 않기로 했으므로(ADR-068) 검수의 자리는 이 명령입니다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createContainer } from '@/lib/container'
import { createSql } from '@/lib/db'
import { createSnapshotReader } from '@/lib/db-kb-collect'
import { readEnv } from '@/lib/env'
import { buildPorts } from '@/lib/wire'

import type { ReviewStatus } from '@/modules/kb-reviewer'

const ENV_LOCAL = fileURLToPath(new URL('../.env.local', import.meta.url))

function loadEnvLocal(): void {
  if (!existsSync(ENV_LOCAL)) return
  for (const line of readFileSync(ENV_LOCAL, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (!m) continue
    const key = m[1]!
    if (process.env[key] === undefined) process.env[key] = m[2]!.replace(/^["']|["']$/g, '')
  }
}

function arg(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`)
  if (at < 0) return null
  const value = process.argv[at + 1]
  return value && !value.startsWith('--') ? value : ''
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function preview(text: string, lines = 4): string {
  const rows = text.split('\n')
  const head = rows.slice(0, lines).map((one) => `      ${one.length > 100 ? `${one.slice(0, 100)}…` : one}`)
  return head.join('\n') + (rows.length > lines ? `\n      … (${rows.length - lines}줄 더)` : '')
}

async function main(): Promise<void> {
  loadEnvLocal()
  const env = readEnv()
  const container = createContainer(env, buildPorts(env))
  const sql = createSql(env)
  if (!sql) throw new Error('DATABASE_URL 이 없습니다 — src/.env.local')
  const snapshots = createSnapshotReader(sql)
  const reviewer = container.kbReviewer

  const decision: ReviewStatus | null = has('approve')
    ? 'approved'
    : has('reject')
      ? 'rejected'
      : has('defer')
        ? 'deferred'
        : null

  if (decision) {
    const changeId = arg('approve') ?? arg('reject') ?? arg('defer') ?? ''
    const by = arg('by') ?? ''
    if (!changeId || !by) throw new Error('--approve|--reject|--defer <change_id> 와 --by <이름> 이 필요합니다')
    const note = arg('note')
    await reviewer.review({ changeId, status: decision, reviewedBy: by, ...(note ? { note } : {}) })
    console.log(`✓ ${changeId} → ${decision} (${by})`)
    return
  }

  if (has('released')) {
    const changeId = arg('released') ?? ''
    const version = arg('version') ?? ''
    if (!changeId || !version) throw new Error('--released <change_id> --version <KB 버전> 이 필요합니다')
    await reviewer.markReleased(changeId, version)
    console.log(`✓ ${changeId} → ${version} 에 실림`)
    return
  }

  if (has('show')) {
    const changeId = arg('show') ?? ''
    const found = (await reviewer.queue()).flatMap((group) => group.changes).find((one) => one.changeId === changeId)
    if (!found) throw new Error('pending 큐에 그 change_id 가 없습니다')
    const [after] = await snapshots.byIds([found.snapshotAfter])
    console.log(`${found.sourceKey}  (${found.detectedAt})\n`)
    console.log(after?.content ?? '(원문 없음)')
    return
  }

  const groups = await reviewer.queue()
  const changes = groups.flatMap((group) => group.changes)
  if (changes.length === 0) {
    console.log('검수 대기가 비어 있습니다.')
    return
  }
  const views = new Map(
    (await snapshots.byIds(changes.map((one) => one.snapshotAfter))).map((one) => [one.snapshotId, one]),
  )
  console.log(`검수 대기 ${changes.length}건 — 승인해도 매뉴얼에 자동 반영되지 않습니다(RFC-002)\n`)
  for (const one of changes) {
    const view = views.get(one.snapshotAfter)
    const meta = (view?.meta ?? {}) as Record<string, unknown>
    const first = one.snapshotBefore === null ? '최초 수집' : '변경'
    const label = [meta.법령명, meta.조문제목].filter(Boolean).join(' · ')
    console.log(`${one.changeId}  ${one.sourceKey}  [${first}]  ${label}`)
    console.log(`      시행 ${String(meta.시행일자 ?? '?')} · 공포번호 ${String(meta.공포번호 ?? '?')} · 감지 ${one.detectedAt}`)
    if (view) console.log(preview(view.content))
    console.log()
  }
  console.log('판단: npm run kb:review -- --approve|--reject|--defer <change_id> --by <이름> [--note "…"]')
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
