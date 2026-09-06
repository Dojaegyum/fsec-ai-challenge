/**
 * 지금 무엇이 붙어 있고 무엇이 비어 있는지 — 한 화면으로.
 *
 *     npm run config:report
 *
 * 정본은 `lib/config-report.ts` 입니다. 2026-09-06 까지 그 함수를 부르는 곳이 시험뿐이라
 * 「설정 현황」이 실제로는 아무 데도 뜨지 않았습니다. API 경로를 새로 내지 않고(계약 §2 의
 * 엔드포인트 목록에 없는 경로를 지어내지 않으려고) 명령 하나로 둡니다.
 *
 * **값은 찍지 않습니다.** 이름과 붙었는지 여부만 — 로그에 열쇠가 남지 않게.
 *
 * `.env.local` 을 아주 얇게 읽습니다(`kb-collect.ts` 와 같음). `server-only` 표식 때문에
 * `npm run` 으로만 부르세요(`--conditions=react-server`).
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { configReport, formatConfigReport } from '@/lib/config-report'
import { getContainer } from '@/lib/wire'

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

function main(): void {
  loadEnvLocal()
  // **서버가 쓰는 것과 같은 조립본을 봅니다** → wire.ts. 여기서 따로 조립하면
  // 서버에만 있는 것(속도 제한 카운터 · ADR-085)이 「없음」으로 떠서, 운영자가
  // 멀쩡한 설정을 의심합니다 — 2026-09-06 까지 실제로 그랬습니다
  const container = getContainer()
  console.log('설정 현황 — 이 프로세스가 읽은 환경변수 기준 (값은 찍지 않습니다)\n')
  console.log(formatConfigReport(configReport(container)))
}

main()
process.exit(0)
