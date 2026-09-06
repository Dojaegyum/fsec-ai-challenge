/**
 * 선별기를 실제 풀·실제 모델로 걸어 본다 — `kb-selector` 의 탐침.
 *
 *     npm run probe:select                                    # 준비된 발화 넷을 차례로
 *     npm run probe:select -- --say "은행에 전화했는데 안 받아요"
 *     npm run probe:select -- --say "카드로 보냈으면 뭐가 달라요?" --prev "검찰 사칭에 300만원을 보내셨군요."
 *     npm run probe:select -- --say "은행에 전화했는데 안 받아요" --org kb-bank --channel CH-bank
 *     npm run probe:select -- --dry                           # 모델 없이 풀 크기와 묶음 수만
 *
 * 근거: ADR-089 「정하지 않은 것」 — 선별 모델의 최종 이름은 배선 뒤 재서 정합니다.
 *
 * 필요한 것: `src/.env.local` 의 `DATABASE_URL` · `KB_VERSION`, 그리고 모델을 부르려면
 * `LLM_SELECT_MODEL` (+ `XAI_API_KEY` 또는 `LLM_API_KEY`). 발화는 **토큰화된 글**로 적으세요 —
 * 이 탐침은 `pii-tokenizer` 를 거치지 않고 모델로 바로 갑니다.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { asSelectorSource } from '@/lib/adapters'
import { createContainer } from '@/lib/container'
import { readEnv } from '@/lib/env'
import { buildPorts } from '@/lib/wire'

import type { HistoryLine } from '@/modules/kb-selector'

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

/** 갈래마다 하나씩 — 절차 승격 · 연락처 · 조문 · 잡담 */
const SAMPLES: readonly { readonly say: string; readonly prev?: string }[] = [
  { say: '카드로 보냈으면 뭐가 달라요?', prev: '검찰을 사칭한 전화에 300만원을 보내셨군요. 다음은 지급정지 요청입니다.' },
  { say: '은행에 전화했는데 계속 안 받아요', prev: '다음은 KB국민은행에 지급정지를 요청하는 것입니다.' },
  { say: '법에 진짜 그렇게 적혀 있어요? 몇 조예요?', prev: '전화로 신청했으면 3영업일 안에 서류를 내야 합니다.' },
  { say: '감사합니다' },
]

const GROUP_CHARS = 6_000

const KIND: Record<'kb' | 'org' | 'law', string> = { kb: '절차', org: '연락처', law: '조문' }

async function main(): Promise<void> {
  loadEnvLocal()
  const env = readEnv()
  const container = createContainer(env, buildPorts(env))
  const pool = container.ports.selectorPool
  if (!pool) throw new Error('DATABASE_URL 이 없습니다 — src/.env.local')
  const kbVersion = env.values.KB_VERSION
  if (!kbVersion) throw new Error('KB_VERSION 이 없습니다 — src/.env.local')

  const today = new Date().toISOString().slice(0, 10)
  const loadedAt = Date.now()
  // 풀 크기는 한 번 읽어 보여 준다 — 실제 선별은 아래 source 가 턴마다 다시 읽는다(챗과 같음)
  const snapshot = await pool.load({ kbVersion, asOf: today })
  const counts = { kb: 0, org: 0, law: 0 }
  let chars = 0
  for (const one of snapshot.candidates) {
    counts[one.kind] += 1
    chars += `[000] 절차 · ${one.tag}: ${one.preview}`.length
  }
  console.info(
    `풀 ${snapshot.candidates.length}개 (절차 ${counts.kb} · 연락처 ${counts.org} · 조문 ${counts.law}) · ` +
      `${chars.toLocaleString()}자 → 1단계 묶음 약 ${Math.max(1, Math.ceil(chars / GROUP_CHARS))}개 · ` +
      `읽는 데 ${Date.now() - loadedAt}ms · 릴리스 ${kbVersion}`,
  )

  if (process.argv.includes('--dry')) return

  const selector = container.kbSelector
  if (!selector) {
    console.info('LLM_SELECT_MODEL 이 비어 있어 모델을 부르지 않습니다. 부르려면 src/.env.local 에 채우세요.')
    return
  }

  // 실제 챗과 같은 길 — 풀 읽기 · 사건 표시 · 선별 · 본문 옮기기 (src/lib/adapters.ts)
  const source = asSelectorSource(selector, pool)
  const orgId = arg('org') || null
  const channelId = arg('channel') || null
  const say = arg('say')
  const turns = say ? [{ say, prev: arg('prev') ?? undefined }] : SAMPLES
  for (const turn of turns) {
    const history: HistoryLine[] = [
      ...(turn.prev ? [{ speaker: 'assistant' as const, text: turn.prev }] : []),
      { speaker: 'user', text: turn.say },
    ]
    const result = await source.select({
      history,
      kbVersion,
      asOf: today,
      exclude: new Set(),
      orgId,
      channelId,
    })
    const tokens = result.stats.calls.reduce(
      (sum, one) => sum + (one.tokenIn ?? 0) + (one.tokenOut ?? 0),
      0,
    )
    console.info('')
    console.info(`사용자: ${turn.say}${orgId ? `  (사건 기관 ${orgId})` : ''}`)
    console.info(
      `  고름 ${result.entries.length}개 · 묶음 ${result.stats.groups} · 라운드 ${result.stats.rounds} · ` +
        `${result.stats.ms}ms · 호출 ${result.stats.calls.length}회 · 토큰 ${tokens.toLocaleString()}` +
        (result.stats.skipped ? ` · 건너뜀: ${result.stats.skipped}` : ''),
    )
    for (const one of result.entries) console.info(`    - ${KIND[one.kind]} · ${one.label}`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
