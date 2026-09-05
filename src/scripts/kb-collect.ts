/**
 * 법령 수집을 지금 한 번 돌린다 — 크론이 하는 것과 같은 일을 손으로.
 *
 *     npm run kb:collect
 *
 * 정본: spec/backend/08-16-data-model.md §12 · ADR-072. 매뉴얼에는 쓰지 않습니다 —
 * 원문을 보존하고 바뀐 것을 검수 큐(`source_change`)에 `pending` 으로 쌓습니다.
 * 그 뒤는 `npm run kb:review`.
 *
 * `.env.local` 을 아주 얇게 읽습니다 — 스크립트 하나 때문에 로더를 들이지 않습니다(`load-kb.ts` 와 같음).
 * `server-only` 표식 때문에 `npm run` 으로만 부르세요(`--conditions=react-server`).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { buildPorts } from '@/lib/wire'

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

async function main(): Promise<void> {
  loadEnvLocal()
  const env = readEnv()
  const container = createContainer(env, buildPorts(env))

  console.log('법령 수집을 시작합니다 — 소스마다 원문을 받아 조문 단위로 견줍니다\n')
  const run = await container.kbCollector.collect()

  for (const one of run.results) {
    const mark = one.error ? '✗' : '✓'
    console.log(
      `${mark} ${one.sourceKeyPrefix}  새 원문 ${one.added} · 같음 ${one.unchanged}` +
        (one.error ? `  — 오류 ${one.error}` : ''),
    )
  }
  if (run.stale.length > 0) {
    console.log(`\n⚠️ 오래 성공하지 못한 소스: ${run.stale.join(', ')}`)
  }
  const added = run.results.reduce((sum, one) => sum + one.added, 0)
  console.log(
    added > 0
      ? `\n검수 큐에 ${added}건이 쌓였습니다 → npm run kb:review`
      : '\n바뀐 것이 없습니다.',
  )
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  },
)
