/**
 * 언어모델을 부르는 자리.
 *
 * 정본: spec/backend/08-17-system-prompt.md (출력 형식 · `temperature: 0`) ·
 *       spec/common/08-14-api.md §1.2 (`XAI_API_KEY`)
 * 근거: ARCHITECTURE.md §2 — **Grok (xAI)** · OpenAI 호환 · **도구 호출 안 씀** ·
 *       ADR-028(자원 접근 구현은 `src/lib/`)
 *
 * ## SDK 를 안 쓰는 이유
 *
 * 부르는 모양이 「메시지 둘 보내고 글 하나 받기」뿐입니다. 의존성을 하나 늘려
 * 얻을 것이 없고, 저장소 서명 주소도 같은 이유로 REST 를 직접 부릅니다.
 *
 * ## ⚠️ 여기 오는 글은 이미 토큰화돼 있어야 합니다
 *
 * 이 자리는 **격리 경계 바깥**입니다. 계좌번호·이름이 그대로 실린 글이 여기로
 * 오면 그대로 외부 사업자에게 나갑니다 → 04-pii-boundary.md 규칙 2.
 * 토큰화는 `pii-tokenizer` 의 몫이고, **이 파일은 그것을 검사하지 않습니다** —
 * 두 곳에서 막으면 어느 쪽이 진짜 경계인지 흐려집니다.
 */

import 'server-only'

import type { Env } from './env'

import type { LlmClient, ModelReply } from '@/modules/chat-receiver'

/**
 * 기본은 **Grok (xAI)** 입니다 → ARCHITECTURE §2 · §1.2 `XAI_API_KEY`.
 *
 * ## 갈아끼울 수 있게 둔 이유
 *
 * 부르는 모양이 **OpenAI 호환 `/chat/completions` 하나**입니다. 그래서 주소와
 * 모델 이름만 바꾸면 무료 제공자로도, 이 컴퓨터에 띄운 모델로도 갑니다 —
 * `TRANSCRIBER_URL` 을 주소 하나로 둔 것과 같은 이유입니다.
 *
 * **개발 중에 이게 필요합니다.** 유료 계정의 잔액이 떨어지면 챗 한 턴이
 * 통째로 500 이 되고, 그러면 **이 서비스의 핵심 동작을 한 번도 못 봅니다.**
 * 2026-08-25 에 실제로 그랬습니다 — `permission-denied`(403, 크레딧 없음).
 *
 * | 변수 | 없으면 |
 * | --- | --- |
 * | `LLM_BASE_URL` | `https://api.x.ai/v1` |
 * | `LLM_MODEL` | `grok-4.5` |
 * | `LLM_API_KEY` | `XAI_API_KEY` 를 씁니다 |
 *
 * ⚠️ **바꾸면 사건 내용이 그 사업자에게 갑니다.** 이 자리는 격리 경계 바깥이라
 * (아래 경고), 무엇을 끼우느냐가 **어느 회사가 토큰화된 진술을 보게 되는지**를
 * 정합니다. 제출·시연에 쓸 제공자는 사람이 정합니다 → ADR-043 과 같은 판단.
 */
const DEFAULT_BASE_URL = 'https://api.x.ai/v1'

/** ARCHITECTURE §2 · 08-17-system-prompt.md §「확인한 것」이 이 모델로 쟀습니다 */
const DEFAULT_MODEL = 'grok-4.5'

/**
 * 답이 늦어도 기다릴 수 있는 한계.
 *
 * 서버 함수 자체가 오래 못 삽니다. 여기서 안 끊으면 함수가 먼저 죽고,
 * 사용자는 「응답 없음」만 봅니다 — 무엇이 늦었는지 안 남습니다.
 *
 * **함수 상한보다 짧아야 합니다** — 라우트의 `maxDuration` 이 60초라
 * 여유 5초를 둡니다. 우리가 먼저 끊어야 「제때 답하지 않았습니다」가 남고,
 * 함수가 먼저 죽으면 아무것도 안 남습니다.
 *
 * ⚠️ 2026-08-25: 45초로는 **배포 환경에서 세 번 다 넘겼습니다.** 같은 순간
 * 같은 열쇠로 이 컴퓨터에서는 8~10초에 답했습니다 — 무료 한도 때문이 아니라
 * 실행 환경 차이로 보입니다(무료 한도의 거절은 2초 만에 오는 503 입니다).
 * 아래 `logAttempt` 가 실제로 몇 초 걸렸는지 남깁니다.
 */
const TIMEOUT_MS = 55_000

/**
 * **다시 보내면 될 수도 있는 것들.**
 *
 * 전부 「이 요청이 처리되지 않았다」는 뜻이라 같은 것을 또 보내도 두 번
 * 실행될 수 없습니다 — `lib/db.ts` 의 `NEVER_SENT` 와 같은 논리입니다.
 * 400·401·403·404 는 다시 보내도 같은 답이 오므로 여기 넣지 않습니다.
 *
 * ⚠️ **무료 한도에서는 503 이 상시로 옵니다.** 2026-08-25 실측: 같은
 * 프롬프트를 다섯 모델에 보냈더니 둘이 `503 UNAVAILABLE`(과부하)이었고,
 * 잠시 뒤에는 다른 둘이 그랬습니다. 재시도가 없으면 그때마다 사용자는
 * 500 을 받고 **대화가 그 자리에서 끊깁니다.**
 */
const AGAIN_LATER: ReadonlySet<number> = new Set([429, 500, 502, 503, 504])

/**
 * 후보를 몇 바퀴 돌지.
 *
 * 한 바퀴는 `LLM_MODEL` 에 적힌 모델을 차례로 한 번씩 시도하는 것입니다.
 * 한 번 왕복이 10~30초라 예산(45초) 안에서 실제로 도는 것은 두세 번입니다.
 */
const MAX_ROUNDS = 2

/** 한 바퀴를 다 돌고 다시 시작하기 전에 쉬는 시간. 과부하는 대개 짧게 지나갑니다 */
const ROUND_BACKOFF_MS = 1_000

/**
 * 남은 예산이 이보다 적으면 더 시도하지 않습니다.
 *
 * 5초는 **가장 빨랐던 응답(5초)** 에서 온 값입니다. 이보다 적게 남았는데
 * 또 보내면 거의 확실히 중간에 잘리고, 그때 사용자는 「제때 답하지
 * 않았습니다」 대신 애매한 실패를 봅니다.
 */
const MIN_ATTEMPT_MS = 5_000

/**
 * 한 번의 시도가 어떻게 끝났는지 남긴다.
 *
 * ⚠️ **열쇠도 프롬프트도 안 담습니다.** 프롬프트에는 사건 내용이 들어 있고
 * 이 줄은 로그로 갑니다 → 04-pii-boundary.md 규칙 2. 모델 이름과 상태와
 * 걸린 시간만 남깁니다 — 셋 다 개인정보가 아닙니다.
 *
 * **이게 없으면 「늦었다」와 「거절당했다」를 구분할 수 없습니다.** 앞엣것은
 * 예산·환경 문제이고 뒤엣것은 한도·잔액 문제라, 고치는 자리가 다릅니다.
 */
function logAttempt(model: string, outcome: string, ms: number): void {
  console.info(`[llm] ${model} · ${outcome} · ${Math.round(ms)}ms`)
}

/**
 * 모델이 돌려준 글에서 JSON 을 꺼낸다.
 *
 * 지시문이 *"JSON 하나만 출력한다"* 로 못 박았지만(§55-57), 모델이 앞뒤에
 * ```json 울타리를 두르는 일이 있습니다. **그것 때문에 답을 통째로 버리지
 * 않습니다** — 울타리를 벗기는 것은 뜻을 바꾸지 않습니다.
 */
function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  const body = fenced ? fenced[1] : trimmed
  return JSON.parse(body)
}

/**
 * 모델이 돌려준 것을 우리 모양으로 좁힌다.
 *
 * **모르는 칸은 버립니다.** 모델이 지어낸 칸을 그대로 흘리면 아래 단계가
 * 근거 없는 값을 근거처럼 다루게 됩니다.
 *
 * `insufficient` 를 **기본 참으로 두는 것**이 중요합니다. 값이 빠졌을 때
 * 「근거가 충분하다」로 읽으면, 모델이 형식을 어긴 순간 근거 없는 안내가
 * 나갑니다 → 불변 규칙 1.
 */
function toReply(raw: unknown): ModelReply {
  const one = (raw ?? {}) as Record<string, unknown>

  const citations = Array.isArray(one.citations)
    ? one.citations
        .map((item) => {
          const c = (item ?? {}) as Record<string, unknown>
          return { ref: String(c.ref ?? ''), why: String(c.why ?? '') }
        })
        // ref 가 없는 인용은 인용이 아닙니다
        .filter((c) => c.ref.length > 0)
    : []

  return {
    ...(typeof one.reasoning === 'string' ? { reasoning: one.reasoning } : {}),
    insufficient: one.insufficient !== false,
    citations,
    ...(typeof one.reply === 'string' ? { reply: one.reply } : {}),
  }
}

/**
 * 부를 것을 만든다. **열쇠가 없으면 `null`** — 조립이 성공해야 합니다.
 */
export function createLlmClient(env: Env): LlmClient | null {
  // **둘 중 하나면 섭니다.** 개발용 열쇠를 넣었는데 `XAI_API_KEY` 가 비어서
  // 안 뜨면, 무엇이 문제인지 아무 데도 안 나옵니다
  const key = env.values.LLM_API_KEY ?? env.values.XAI_API_KEY
  if (!key) return null

  // 끝의 빗금을 지웁니다 — 붙여 놓고 오는 주소가 흔하고, 그러면 `//v1` 이 됩니다
  const base = (env.values.LLM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const endpoint = `${base}/chat/completions`

  /**
   * **쉼표로 여러 개를 적을 수 있습니다** — 앞엣것이 막히면 뒤엣것으로 넘어갑니다.
   *
   * 무료 한도에서 필요합니다. 2026-08-25 실측: 같은 프롬프트를 다섯 모델에
   * 보냈더니 어느 순간엔 둘이, 잠시 뒤엔 다른 둘이 `503`(과부하)이었습니다.
   * **모델 하나만 박아 두면 그때그때 챗이 통째로 멈춥니다.**
   *
   * ⚠️ **모델이 다르면 답도 다릅니다.** 같은 물음에 다른 모델이 답하면 재현이
   * 안 됩니다 — **개발·시연용 설정입니다.** 제출본에서 무엇을 쓸지는 사람이
   * 정하고, 그때는 하나만 적습니다.
   */
  const models = (env.values.LLM_MODEL ?? DEFAULT_MODEL)
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one.length > 0)

  /** 보낼 것. **글은 그대로 두고 모델만 바뀝니다** */
  const requestBody = (model: string, prompt: { system: string; user: string }) =>
    JSON.stringify({
      model,
      // **0 입니다.** 절차 안내는 같은 물음에 같은 답이 나와야 하고,
      // 정본이 이 값으로 재서 확인했습니다 → 08-17-system-prompt.md
      temperature: 0,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user },
      ],
    })

  return {
    async complete(prompt: { system: string; user: string }): Promise<ModelReply> {
      // **예산은 통틀어 하나입니다.** 시도마다 45초씩 주면 재시도 두 번에
      // 함수 상한(60초)을 넘겨 버립니다 → 라우트의 `maxDuration`
      const deadline = Date.now() + TIMEOUT_MS
      const tries = models.length * MAX_ROUNDS

      let res: Response | null = null

      for (let attempt = 0; ; attempt += 1) {
        const left = deadline - Date.now()
        // 남은 시간이 한 번 왕복도 못 할 만큼이면 더 시도하지 않습니다
        if (left < MIN_ATTEMPT_MS) throw new Error('모델이 제때 답하지 않았습니다')

        const sent = requestBody(models[attempt % models.length]!, prompt)

        const model = models[attempt % models.length]!
        const startedAt = Date.now()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), left)

        try {
          res = await fetch(endpoint, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${key}`,
              'content-type': 'application/json',
            },
            body: sent,
            signal: controller.signal,
            cache: 'no-store',
          })
        } catch (error) {
          // ⚠️ **열쇠도 프롬프트도 메시지에 담지 않습니다.** 프롬프트에는 사건
          // 내용이 들어 있고, 이 메시지는 로그와 감사 기록으로 갑니다
          const timedOut = error instanceof Error && error.name === 'AbortError'
          logAttempt(model, timedOut ? '시간 초과' : '닿지 못함', Date.now() - startedAt)
          throw new Error(timedOut ? '모델이 제때 답하지 않았습니다' : '모델에 닿지 못했습니다')
        } finally {
          clearTimeout(timer)
        }

        logAttempt(model, `HTTP ${res.status}`, Date.now() - startedAt)
        if (res.ok) break
        // 형식·권한 문제는 다시 보내도 같습니다. 그 자리에서 멈춥니다
        if (!AGAIN_LATER.has(res.status) || attempt >= tries - 1) break

        // **다음 후보로 넘어갈 때는 안 쉽니다** — 다른 모델이라 지금 바로
        // 될 수 있습니다. 한 바퀴를 다 돌았을 때만 쉬었다 갑니다
        const roundDone = (attempt + 1) % models.length === 0
        if (roundDone) {
          await new Promise((resolve) => setTimeout(resolve, ROUND_BACKOFF_MS))
        }
      }

      if (!res.ok) throw new Error(`모델이 거절했습니다 (${res.status})`)

      const body: unknown = await res.json().catch(() => null)
      const text = (body as { choices?: { message?: { content?: unknown } }[] } | null)
        ?.choices?.[0]?.message?.content

      if (typeof text !== 'string' || text.length === 0) {
        throw new Error('모델이 빈 답을 냈습니다')
      }

      try {
        return toReply(extractJson(text))
      } catch {
        // **형식을 어긴 것은 「근거 없음」으로 다룹니다.** 던져서 500 을 내면
        // 사용자가 다시 물어볼 수 없고, 억지로 읽으면 근거 없는 안내가 나갑니다
        return { insufficient: true, citations: [] }
      }
    },
  }
}
