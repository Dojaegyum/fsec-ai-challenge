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
 */
const TIMEOUT_MS = 45_000

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
  const model = env.values.LLM_MODEL ?? DEFAULT_MODEL

  return {
    async complete(prompt: { system: string; user: string }): Promise<ModelReply> {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

      let res: Response
      try {
        res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${key}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model,
            // **0 입니다.** 절차 안내는 같은 물음에 같은 답이 나와야 하고,
            // 정본이 이 값으로 재서 확인했습니다 → 08-17-system-prompt.md
            temperature: 0,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user },
            ],
          }),
          signal: controller.signal,
          cache: 'no-store',
        })
      } catch (error) {
        // ⚠️ **열쇠도 프롬프트도 메시지에 담지 않습니다.** 프롬프트에는 사건
        // 내용이 들어 있고, 이 메시지는 로그와 감사 기록으로 갑니다
        const timedOut = error instanceof Error && error.name === 'AbortError'
        throw new Error(timedOut ? '모델이 제때 답하지 않았습니다' : '모델에 닿지 못했습니다')
      } finally {
        clearTimeout(timer)
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
