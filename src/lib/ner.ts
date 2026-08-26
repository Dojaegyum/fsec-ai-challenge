/**
 * 2차 개인정보 탐지 모델을 부르는 자리 — **앱은 그것이 무엇인지 모릅니다.**
 *
 * 근거: ADR-028(자원 접근 구현은 `src/lib/`) · [ADR-043](../../decisions/043-gpu-hosting.md)(GPU 배치)
 * 실측: [research/09](../../docs/research/09-로컬모델-PII인식-실측.md) R-1 —
 *       gemma3:4b + 정규식 + 허용목록이 **깨끗한 텍스트에서 누출 0% · 과차단 0%**
 *
 * ## 이 파일이 하는 일은 번역뿐입니다
 *
 * `pii-tokenizer` 가 요구하는 모양(`NerModel`)을 HTTP 로 옮깁니다.
 * **판단은 한 줄도 없습니다** — 무엇을 가릴지, 허용 목록을 어떻게 적용할지는
 * 전부 모듈이 정합니다([09 R-2](../../docs/research/09-로컬모델-PII인식-실측.md):
 * *「허용 목록을 프롬프트로 부탁하면 안 지켜집니다. 코드로 걸어야 합니다」*).
 *
 * ## ⚠️ 이 주소가 곧 경계입니다
 *
 * 이 자리는 **토큰화 이전**이라 넘기는 글에 원문이 그대로 있습니다 → ARCHITECTURE §6.
 * 우리가 돌리는 모델이면 원문이 조직 밖으로 안 나가고, 원격 API 를 끼우면 나갑니다.
 * `NER_URL` 을 무엇으로 두느냐가 **설정이 아니라 정책**입니다.
 *
 * ## 왜 기다리나 — STT 와 다릅니다
 *
 * 전사는 몇 분이 걸려 맡기고 나중에 물어보지만([inference.ts](./inference.ts)),
 * 발화 한 토막의 NER 은 GPU 에서 1초 안팎입니다. 그래서 **그냥 기다립니다.**
 * 대신 예산을 짧게 잡습니다 — 서버리스 함수 안에서 끝나야 합니다.
 */

import 'server-only'

import type { NerModel, NerSpan } from '@/modules/pii-tokenizer'

export interface NerConfig {
  /** 서비스 주소. 예: `https://xxxx-8000.proxy.runpod.net` */
  readonly baseUrl: string
  /**
   * 공유 비밀값. 서비스가 이 값을 요구하면 맞춰 보냅니다.
   *
   * ⚠️ **밖에 열린 서비스에는 반드시 있어야 합니다** — 이 자리로 원문이 지나갑니다.
   */
  readonly token?: string
  /** 어느 모델을 쓰라고 말할지. 서비스가 여럿을 들고 있을 때만 씁니다 */
  readonly model?: string
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 12_000

/**
 * ⚠️ **응답 본문을 담지 않습니다.** 서비스가 뱉은 말에 원문이 섞여 올 수 있고,
 * 이 메시지는 감사 기록으로 갑니다 → 08-14-pii-boundary.md.
 */
function failed(what: string, status?: number): Error {
  return new Error(status === undefined ? what : `${what} (${status})`)
}

/**
 * 응답을 모듈의 어휘로 옮긴다.
 *
 * **모양이 안 맞는 조각은 버립니다 — 던지지 않습니다.** 한 조각이 이상하다고
 * 통째로 실패하면, 1차 정규식이 잡아 둔 것까지 못 쓰게 됩니다. 다만
 * **응답 전체가 배열이 아니면** 그건 서비스가 고장 난 것이라 던집니다.
 */
function spansOf(body: unknown): readonly NerSpan[] {
  const raw = (body as { spans?: unknown } | null)?.spans
  if (!Array.isArray(raw)) throw failed('탐지 서비스가 목록을 안 줬습니다')

  const out: NerSpan[] = []
  for (const one of raw) {
    const span = (one ?? {}) as Record<string, unknown>
    if (
      typeof span.label === 'string' &&
      typeof span.value === 'string' &&
      typeof span.start === 'number' &&
      typeof span.end === 'number' &&
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      span.start >= 0 &&
      span.end > span.start
    ) {
      out.push({ label: span.label, start: span.start, end: span.end, value: span.value })
    }
  }
  return out
}

/**
 * 모델을 부르는 도구를 만든다.
 *
 * **못 부르면 던집니다** — `pii-tokenizer` 가 `PiiTokenizerUnavailableError` 로
 * 바꿉니다. 조용히 빈 목록을 내면 **토큰화 없이 LLM 을 부르는 우회 경로**가
 * 생깁니다(불변 규칙 2).
 */
export function createNerModel(cfg: NerConfig): NerModel {
  return {
    async find(text: string): Promise<readonly NerSpan[]> {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': 'application/json',
      }
      if (cfg.token) headers['x-finally-token'] = cfg.token

      let res: Response
      try {
        res = await fetch(`${cfg.baseUrl}/ner`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ text, ...(cfg.model ? { model: cfg.model } : {}) }),
          signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
          cache: 'no-store',
        })
      } catch {
        throw failed('탐지 서비스에 닿지 못했습니다')
      }

      if (!res.ok) throw failed('탐지 서비스가 거절했습니다', res.status)

      try {
        return spansOf(await res.json())
      } catch (error) {
        // spansOf 가 던진 것은 그대로 올립니다 — 「목록을 안 줬다」와
        // 「JSON 이 아니다」는 다른 고장입니다
        if (error instanceof Error && error.message.includes('목록')) throw error
        throw failed('탐지 서비스의 응답을 읽지 못했습니다')
      }
    },
  }
}
