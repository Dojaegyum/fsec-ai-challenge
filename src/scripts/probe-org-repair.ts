/**
 * 전사문 기관명 교정(ADR-056)이 **실제로 도는지** 재 본다 — 실측 전사문으로.
 *
 *   npx tsx scripts/probe-org-repair.ts
 *   npx tsx scripts/probe-org-repair.ts --model gemini-3.6-flash --limit 5
 *
 * ## 왜 필요한가
 *
 * `flows/read-evidence.ts` 의 `repairOrgs` 는 **실패해도 던지지 않습니다** —
 * 던지면 전사 결과를 통째로 잃기 때문입니다(옳은 설계입니다). 그런데 그래서
 * **모델이 형식을 못 지키면 영영 조용히 안 됩니다.** 아무도 못 알아챕니다.
 *
 * 챗에서 실제로 그랬습니다 — `gemini-2.5-flash` 가 200 을 내면서 인용을 틀리게
 * 냈고, 걸어 보기 전까지 몰랐습니다(`.env.local` 실측 표).
 *
 * ## 무엇을 쓰나 — 지어낸 문장이 아닙니다
 *
 * [15-STT-GPU-실측](../../docs/research/15-STT-GPU-실측.md)이 **기관 손상 19%**
 * 를 잰 그 전사문입니다. 「케이뱅크」가 「캐이뱅크」로 들린 자리들이라
 * **교정이 실제로 필요한 입력**입니다.
 *
 *     assets/datasets/08-25-stt-gpu/results-gpu.json   전사 결과 (large-v3)
 *     assets/datasets/08-21-local-llm-pii/eval-set.json 정답 (keep 의 기관)
 *
 * ## 무엇을 보나
 *
 *   ① 형식      `parseOrgRepair` 가 읽히는가
 *   ② 안 지어냄  `heard` 가 전사문에 실제로 있는가 (verifyOrgRepair ①)
 *   ③ 회수      잃은 기관을 되찾는가
 *   ④ 오탐      **없는 기관을 만들어내지 않는가** — 이게 제일 비쌉니다
 *
 * **④ 가 ③ 보다 중요합니다.** 기관을 잘못 넣으면 [9유형 분기](../../spec/backend/08-14-channel-matrix.md)가
 * 틀어져 **엉뚱한 매뉴얼이 에러 없이 나갑니다** → 17 §2.
 *
 * ## 처음 잰 값 (2026-08-27 · `gemini-3.6-flash` · 사전 51곳)
 *
 *     회수 8/9   오탐 0   사전에 없음 1
 *
 * **사전만으로는 영영 못 잡을 것들이 돌아왔습니다** — 편집거리로 닿지 않습니다.
 *
 *     K뱅크          -> 케이뱅크
 *     미래의세증권    -> 미래에셋증권
 *     에너지투자증권  -> NH투자증권
 *     포스           -> 토스
 *     단할           -> 다날
 *     컬처랜드        -> 컬쳐랜드
 *     네이버 페이포인트 -> 네이버페이
 *
 * 못 잡은 하나(신세계상품권)는 **모델 탓이 아닙니다** — 「신세계 상품권」으로
 * 정확히 들었는데 `org.json` 에 신세계가 없습니다(상품권사는 컬쳐랜드·해피머니 둘).
 *
 * ⚠️ **오탐 세는 법을 조심하세요.** 처음에 「잃은 것」만 정답으로 잡아 「오탐 2」가
 * 나왔는데 둘(업비트·페이코) 다 **그 글에 실제로 있던 기관**이었습니다. 안 잃은
 * 기관을 함께 찾아내는 것은 맞는 동작입니다 — **그 글의 기관 전체**로 재야 합니다.
 */

import { readFileSync } from 'node:fs'

import { buildOrgRepairInput, parseOrgRepair, verifyOrgRepair, ORG_REPAIR_PROMPT } from '@/lib/org-repair'
import type { OrgCandidate } from '@/lib/org-match'

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1]! : fallback
}

/** `.env.local` 을 직접 읽습니다 — tsx 스크립트에는 Next 의 적재가 안 붙습니다 */
function loadEnv(): void {
  let text: string
  try {
    text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  } catch {
    return
  }
  for (const line of text.split('\n')) {
    const at = line.indexOf('=')
    if (at < 0 || line.trimStart().startsWith('#')) continue
    const key = line.slice(0, at).trim()
    if (!key || process.env[key]) continue
    process.env[key] = line.slice(at + 1).trim()
  }
}
loadEnv()

const BASE = arg('base', process.env.LLM_BASE_URL ?? '')
const MODEL = arg('model', process.env.LLM_MODEL?.split(',')[0] ?? '')
const KEY = process.env.LLM_API_KEY ?? process.env.XAI_API_KEY ?? ''
const LIMIT = Number(arg('limit', '8'))

const ROOT = new URL('../../', import.meta.url)
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'))

/** `org.json` 을 `matchOrg` 가 보는 모양으로 */
function candidates(): OrgCandidate[] {
  const file = read('src/kb/org.json') as { orgs: { org_id: string; name: string; aliases?: string[] }[] }
  return file.orgs.map((one) => ({ orgId: one.org_id, name: one.name, aliases: one.aliases ?? [] }))
}

interface Case {
  readonly id: string
  /** 전사가 실제로 낸 글 — 여기에 손상된 표기가 들어 있습니다 */
  readonly heard: string
  /** 그 글에서 **사라진** 기관 이름들 — 교정이 되찾아야 할 것 */
  readonly lost: readonly string[]
  /**
   * 그 글에 원래 있던 기관 **전부**. 잃지 않은 것도 들어 있습니다.
   *
   * ⚠️ **오탐을 `lost` 기준으로 세면 안 됩니다.** 안 잃은 기관을 모델이 같이
   * 찾아내는 것은 **맞는 동작**인데 그러면 오탐으로 잡힙니다 — 처음에 그렇게
   * 세서 「오탐 2」가 나왔고, 둘 다(업비트·페이코) **정답이었습니다.**
   */
  readonly all: readonly string[]
}

/** 손상된 것만 고릅니다 — 안 잃은 것은 교정할 일이 없습니다 */
function cases(): Case[] {
  const runs = read('assets/datasets/08-25-stt-gpu/results-gpu.json') as {
    runs: { key: string; items: { id: string; text: string }[] }[]
  }
  const spec = read('assets/datasets/08-21-local-llm-pii/eval-set.json') as {
    items: { id: string; keep: { kind: string; text: string }[] }[]
  }
  const truth = new Map(spec.items.map((one) => [one.id, one]))
  const run = runs.runs.find((one) => one.key === 'H')
  if (!run) throw new Error('results-gpu.json 에 H 실행이 없습니다')

  const out: Case[] = []
  for (const item of run.items) {
    const want = truth.get(item.id)
    if (!want) continue
    const all = want.keep
      .filter((k) => ['기관', '상품권사', '통신사'].includes(k.kind))
      .map((k) => k.text)
    const lost = all.filter((name) => !item.text.includes(name))
    if (lost.length) out.push({ id: item.id, heard: item.text, lost, all })
  }
  return out
}

async function call(system: string, user: string): Promise<string> {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${(await res.text()).slice(0, 160)}`)
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  return body.choices?.[0]?.message?.content ?? ''
}

async function main(): Promise<void> {
  if (!BASE || !MODEL || !KEY) {
    console.log('LLM_BASE_URL · LLM_MODEL · LLM_API_KEY 가 있어야 합니다 (src/.env.local)')
    process.exit(2)
  }
  const orgs = candidates()
  const all = cases()
  const pick = all.slice(0, LIMIT)
  console.log(`${MODEL}\n`)
  console.log(`사전 ${orgs.length}곳 · 기관을 잃은 전사문 ${all.length}건 중 ${pick.length}건을 겁니다\n`)

  let recovered = 0
  let wanted = 0
  let invented = 0
  let unreadable = 0
  /** 모델은 들었는데 **사전에 없어서** 못 쓴 것 — 사전을 넓히면 풀립니다 */
  let notInDict = 0

  const known = new Set(orgs.flatMap((o) => [o.name, ...o.aliases]))

  for (const one of pick) {
    wanted += one.lost.length
    let mentions
    try {
      const reply = await call(ORG_REPAIR_PROMPT, buildOrgRepairInput([one.heard]))
      mentions = parseOrgRepair(reply)
    } catch (e) {
      unreadable += 1
      console.log(`  ${one.id}  ✗ ${String(e).slice(0, 90)}`)
      continue
    }
    if (mentions.length === 0) {
      console.log(`  ${one.id}  — 아무것도 못 냈습니다 (잃은 것: ${one.lost.join(', ')})`)
      continue
    }

    const repaired = verifyOrgRepair(mentions, one.heard, orgs)
    const got = repaired.flatMap((r) => r.options)
    const hit = one.lost.filter((name) => got.includes(name))
    // **그 글의 기관 전체**를 기준으로 봅니다 — `lost` 로 재면 안 잃은 것을
    // 맞게 찾아낸 것까지 오탐이 됩니다
    const wrong = got.filter((name) => !one.all.includes(name))
    recovered += hit.length
    invented += wrong.length

    // 모델이 이름을 냈는데 사전에 그 표기가 없으면 **사전을 넓힐 자리**입니다
    const missed = one.lost.filter((name) => !got.includes(name) && !known.has(name))
    notInDict += missed.length

    const mark = hit.length === one.lost.length && wrong.length === 0 ? '✓' : wrong.length ? '⚠️' : '·'
    console.log(
      `  ${one.id}  ${mark} 잃음[${one.lost.join(', ')}]` +
        ` 회수[${hit.join(', ') || '—'}]` +
        (wrong.length ? `  ⚠️ 오탐[${wrong.join(', ')}]` : '') +
        `  (모델이 들었다는 것: ${mentions.map((m) => m.heard).join(' / ') || '—'})`,
    )
  }

  console.log(
    `\n  회수 ${recovered}/${wanted}   오탐 ${invented}` +
      `   사전에 없음 ${notInDict}   모델을 못 부름 ${unreadable}건`,
  )
  if (notInDict > 0) {
    console.log('\n  ※ 「사전에 없음」은 모델 탓이 아닙니다 — 모델은 제대로 들었는데')
    console.log('     `org.json` 에 그 기관이 없어 확정하지 못한 것입니다. 사전을 넓히면 풀립니다.')
  }
  if (invented > 0) {
    console.log('\n⚠️ **오탐이 회수보다 비쌉니다.** 기관이 틀리면 9유형 분기가 틀어져')
    console.log('   에러 없이 엉뚱한 매뉴얼이 나갑니다 → 17 §2.')
  }
  if (recovered === 0 && unreadable === 0) {
    console.log('\n⚠️ 하나도 회수하지 못했습니다 — `repairOrgs` 는 실패해도 조용하므로')
    console.log('   이 상태로 배포하면 **교정이 안 도는 것을 아무도 모릅니다.**')
  }
}

void main()
