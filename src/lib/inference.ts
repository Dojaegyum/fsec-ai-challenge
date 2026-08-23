/**
 * 전사·판독 서비스를 부르는 자리 — **앱은 그것이 무엇인지 모릅니다.**
 *
 * 근거: ADR-028(자원 접근 구현은 `src/lib/`) · RFC-001 `services/`
 * 상대: `services/transcriber/` (같은 저장소, 따로 뜹니다)
 *
 * ## 이 파일이 하는 일은 번역뿐입니다
 *
 * `transcriber` 모듈이 요구하는 모양(`SttEngine`·`OcrEngine`)을 HTTP 로 옮깁니다.
 * **판단은 한 줄도 없습니다** — 화자를 붙이는 것도, 못 한 것을 밝히는 것도
 * 모듈이 합니다. 그래서 서비스를 갈아끼워도 모듈은 안 바뀝니다.
 *
 * ## 왜 기다리지 않나
 *
 * 전사는 몇 분 걸리고 Vercel 함수는 그렇게 오래 못 삽니다.
 * 그래서 **맡기고(`submit`) 나중에 물어봅니다(`poll`)** — 계약이 이미 그 모양입니다
 * (업로드 완료에 `202 처리 중`, 화면이 폴링) → 08-14-api.md §3.2 §3.3.
 *
 * ## 어디를 부르는지는 설정이 정합니다
 *
 * 이 컴퓨터에서 띄운 것이든, 국내 GPU 서버든, 나중에 다른 제품이든
 * **주소만 바뀝니다.** 개발과 운영의 배치는 따로 정해져 있습니다(GPU 배치 결정).
 */

import 'server-only'

import type {
  EngineProgress,
  OcrEngine,
  OcrRequest,
  SttEngine,
  SttRequest,
} from '@/modules/transcriber'

export interface InferenceConfig {
  /** 서비스 주소. 예: `http://127.0.0.1:8917` */
  readonly baseUrl: string
  /**
   * 공유 비밀값. 서비스가 이 값을 요구하면 맞춰 보냅니다.
   *
   * ⚠️ **밖에 열린 서비스에는 반드시 있어야 합니다.** 그 서비스는 넘겨받은 주소를
   * 내려받으므로, 비워 두면 남의 심부름을 하게 됩니다.
   */
  readonly token?: string
  /**
   * 한 번의 HTTP 호출을 얼마나 기다리나.
   *
   * **전사가 끝나기를 기다리는 시간이 아닙니다** — 맡기고 물어보는 각각의 왕복입니다.
   * 짧게 잡는 이유는 서버리스 함수의 예산 안에서 끝나야 하기 때문입니다.
   */
  readonly timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * 서비스가 실패했다.
 *
 * **일부러 이 계층의 예외로 만들지 않습니다.** 그냥 `Error` 로 던지면
 * `transcriber` 모듈이 `IngestError`(422 · 재시도 1회)로 감쌉니다 —
 * 08-16-errors.md §2 가 STT·OCR 실패에 정해 둔 코드입니다.
 * 여기서 다른 코드를 지어내면 재시도 규칙이 두 곳에서 갈립니다.
 */
function failed(what: string, status?: number): Error {
  // ⚠️ **응답 본문을 담지 않습니다.** 서비스가 뱉은 말에 파일 내용이 섞여 올 수 있고,
  // 이 메시지는 감사 기록으로 갑니다 → 04-pii-boundary.md
  return new Error(status === undefined ? what : `${what} (${status})`)
}

async function call(
  cfg: InferenceConfig,
  path: string,
  init: RequestInit = {},
): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (cfg.token) headers['x-finally-token'] = cfg.token
  if (init.body) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}${path}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      // 이 응답은 절대 캐시되면 안 됩니다 — 진행률이 굳어 버립니다
      cache: 'no-store',
    })
  } catch {
    throw failed('전사 서비스에 닿지 못했습니다')
  }

  if (!res.ok) throw failed('전사 서비스가 거절했습니다', res.status)

  try {
    return await res.json()
  } catch {
    throw failed('전사 서비스의 응답을 읽지 못했습니다')
  }
}

/** 맡긴 뒤 돌려받는 번호. **없으면 실패입니다** — 물어볼 대상이 없습니다 */
function jobIdOf(body: unknown): string {
  const id = (body as { job_id?: unknown } | null)?.job_id
  if (typeof id !== 'string' || id.length === 0) {
    throw failed('전사 서비스가 작업 번호를 안 줬습니다')
  }
  return id
}

/**
 * 물어본 결과를 모듈의 어휘로 옮긴다.
 *
 * **모르는 상태는 실패로 봅니다.** 서비스가 새 상태를 추가했는데 우리가 모르면
 * 「아직 도는 중」으로 두는 것보다 실패로 떨어뜨리는 편이 안전합니다 —
 * 영원히 폴링하는 화면이 되지 않습니다.
 */
function progressOf(body: unknown): EngineProgress {
  const b = (body ?? {}) as {
    status?: unknown
    percent?: unknown
    engine?: unknown
    lines?: unknown
    reason?: unknown
  }

  if (b.status === 'running') {
    const percent = typeof b.percent === 'number' && Number.isFinite(b.percent)
      ? b.percent
      : 0
    return { status: 'running', percent }
  }

  if (b.status === 'done') {
    // **여기서 줄을 검사하지 않습니다.** 모듈이 `unknown` 으로 받아 스스로 거릅니다 —
    // 두 곳에서 거르면 어느 쪽이 버렸는지 알 수 없어집니다
    return { status: 'done', output: { engine: b.engine, lines: b.lines } }
  }

  if (b.status === 'failed') {
    const reason = typeof b.reason === 'string' && b.reason.length > 0
      ? b.reason
      : 'unknown'
    return { status: 'failed', reason }
  }

  return { status: 'failed', reason: 'unknown_status' }
}

/**
 * 서비스를 부르는 두 도구를 만든다.
 *
 * **둘이 같은 서비스를 부릅니다.** 그래도 자리를 둘로 둔 이유는 설정 현황에서
 * 「음성은 되는데 이미지는 안 된다」를 따로 말할 수 있어야 하기 때문입니다.
 */
export function createInferenceEngines(cfg: InferenceConfig): {
  stt: SttEngine
  ocr: OcrEngine
} {
  const submit = async (kind: 'audio' | 'image', req: SttRequest | OcrRequest) => {
    const body: Record<string, unknown> = {
      kind,
      url: req.url,
      mime_type: req.mimeType,
    }
    const vocabulary = (req as SttRequest).vocabulary
    if (vocabulary && vocabulary.length > 0) body.vocabulary = [...vocabulary]
    // 부르는 쪽이 번호를 정했으면 그대로 넘깁니다. 같은 번호로 다시 오면
    // 서비스가 앞의 작업을 돌려주므로, 재시도가 전사를 다시 안 돌립니다
    if (req.jobId) body.job_id = req.jobId

    return jobIdOf(
      await call(cfg, '/jobs', { method: 'POST', body: JSON.stringify(body) }),
    )
  }

  const poll = async (jobId: string): Promise<EngineProgress> =>
    progressOf(await call(cfg, `/jobs/${encodeURIComponent(jobId)}`))

  return {
    stt: {
      submit: (request) => submit('audio', request),
      poll,
    },
    ocr: {
      submit: (request) => submit('image', request),
      poll,
    },
  }
}
