/**
 * 환경변수를 한 번만 읽어 놓는 자리.
 *
 * 정본: spec/common/08-14-api.md §1.2 · ARCHITECTURE.md §7
 *
 * **읽는 시점에 던지지 않습니다.** 라우트 모듈 최상단에서 던지면 `next build` 가
 * 통째로 깨지고, 어느 변수가 문제인지도 안 보입니다. 무엇이 비었는지는 **목록으로**
 * 들고 있다가, 그 값을 실제로 쓰는 포트를 부를 때 그 자리에서 드러냅니다
 * → [not-configured.ts](./not-configured.ts).
 */

import 'server-only'

/** 값을 읽는 이름들. 정본의 표를 그대로 옮긴 것입니다 */
export const ENV_KEYS = [
  'DATABASE_URL',
  'DIRECT_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BLOB_TOKEN',
  'XAI_API_KEY',
  // 언어모델을 갈아끼우는 셋 → llm.ts. 셋 다 없어도 기본(xAI)으로 섭니다
  'LLM_BASE_URL',
  'LLM_MODEL',
  'LLM_API_KEY',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
  'CRON_SECRET',
  'CASE_PURGE_DAYS',
  'KB_FETCH_CRON',
  'TRANSCRIBER_URL',
  'TRANSCRIBER_TOKEN',
  // 2차 개인정보 탐지(NER) → ner.ts · ARCHITECTURE §10. **비면 1차 정규식만 돕니다**
  // ⚠️ 이 주소가 어디를 가리키느냐가 곧 경계입니다 → ARCHITECTURE §6 · ADR-043
  'NER_URL',
  /** 2차 탐지 상한(ms). 비면 12초 — **CPU 서버에서는 모자랍니다** → `container.ts` */
  'NER_TIMEOUT_MS',
  'NER_TOKEN',
  'NER_MODEL',
  // 지금 쓰는 KB 릴리스 → ADR-045. 비면 안내를 만들지 않습니다
  'KB_VERSION',
] as const

export type EnvKey = (typeof ENV_KEYS)[number]

export interface Env {
  readonly values: Readonly<Partial<Record<EnvKey, string>>>
  /** 비어 있는 이름들. 조립 자리가 무엇을 못 붙이는지 판단하는 데 씁니다 */
  readonly missing: readonly EnvKey[]
  /** 사건 보관 기간. 기본 180 → ADR-016 */
  readonly casePurgeDays: number
}

/** 빈 문자열은 없는 것으로 봅니다 — `KEY=` 만 적어 둔 줄이 흔합니다 */
function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** 읽을 대상. `process.env` 를 그대로 받되 시험에서는 사전 하나를 넘깁니다 */
export type EnvSource = Readonly<Record<string, string | undefined>>

export function readEnv(source: EnvSource = process.env): Env {
  const values: Partial<Record<EnvKey, string>> = {}
  const missing: EnvKey[] = []

  for (const key of ENV_KEYS) {
    const raw = source[key]
    if (present(raw)) values[key] = raw.trim()
    else missing.push(key)
  }

  const days = Number(values.CASE_PURGE_DAYS)

  return {
    values,
    missing,
    // 숫자가 아니면 기본값으로 떨어집니다. 0 이나 음수를 그대로 쓰면
    // 사건이 만들자마자 파기 대상이 됩니다
    casePurgeDays: Number.isFinite(days) && days > 0 ? days : 180,
  }
}

/** 이 이름들이 전부 채워져 있는가 */
export function has(env: Env, ...keys: readonly EnvKey[]): boolean {
  return keys.every((key) => !env.missing.includes(key))
}

/** 이 이름들 중 비어 있는 것 */
export function missingOf(env: Env, ...keys: readonly EnvKey[]): readonly EnvKey[] {
  return keys.filter((key) => env.missing.includes(key))
}
