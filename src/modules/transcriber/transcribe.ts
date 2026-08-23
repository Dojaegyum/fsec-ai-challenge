/**
 * 전사 — 녹음을 글로 옮기고(화자 분리), 이미지에서 글자를 읽습니다(대화 구조 보존).
 *
 * 계약: spec/common/08-14-features.md `F-02` · spec/common/08-14-api.md §3.3
 *       spec/common/08-16-module-boundaries.md 서버 표
 * 근거: ADR-028(자원을 인터페이스로 받음) · ADR-038(확인 화면이 요구하는 것)
 * 실측: docs/research/09-로컬모델-PII인식-실측.md
 *
 * ## 제품을 여기서 고르지 않습니다
 *
 * `ARCHITECTURE.md` §6 이 STT·OCR 에 **「경계 이전 ⚠️」**을 달았습니다 —
 * *"외부 API 를 쓰면 원문이 나갑니다. 이 자리가 경계의 가장 약한 고리입니다."*
 *
 * **그래서 읽는 도구가 이 파일에 없습니다.** 인터페이스로 선언하고 밖에서 받습니다.
 * 우리가 돌리는 모델을 붙이든 원격 서비스를 붙이든 이 파일은 안 바뀝니다 —
 * `pii-tokenizer` 가 판별 모델을 같은 방식으로 다룬 것과 같습니다.
 *
 * ## 덜 읽힌 것은 정상 경로입니다
 *
 * 한 줄도 못 읽어도, 화자를 못 갈라도, 신뢰도를 못 받아도 **던지지 않습니다.**
 * CLAUDE.md 불변 규칙 5 가 *"「모름」은 실패가 아니다"* 로 정했고,
 * 08-16-errors.md §2 가 전사를 *"배경 작업이라 여유가 있습니다"* 로 두었습니다.
 *
 * 던지는 것은 **읽는 도구가 없거나 호출 자체가 실패했을 때**뿐입니다.
 *
 * ## 값을 다듬지 않습니다
 *
 * 「삼백만원」을 「3000000」으로, 「어제」를 날짜로 바꾸지 않습니다.
 *
 * 실측 보고서가 전사에서 숫자가 한글로 남는 것을 확인했고(§5.1) 그것을 고칠 여지가
 * 있다고 적었지만, **전사문 자체를 고치면 세 가지가 깨집니다** — 사용자가 확인 화면에서
 * 볼 원본이 사라지고(ADR-038), 근거로 인용할 대목이 어긋나며(`F-04`),
 * **받은 자료가 우리가 고쳐 쓴 것이 됩니다**(불변 규칙 4). 정규화가 필요하면
 * 전사문 옆에 따로 붙여야 하고, 그건 이 모듈의 일이 아닙니다.
 */

import { AppError, IngestError } from '@/lib/errors'

import type {
  At,
  CollectResult,
  EngineLine,
  EngineOutput,
  EnginePiece,
  EngineProgress,
  IngestPhase,
  LayoutRule,
  Line,
  Piece,
  Shortfall,
  StartResult,
  TranscribeInput,
  TranscribeResult,
  Transcriber,
  TranscriberDeps,
  TranscriptionJob,
} from './types'

/**
 * 말풍선 좌·우를 가르는 기본값.
 *
 * ⬜ **근거가 아니라 출발점입니다.** 정본에 임계값이 없어 보수적으로 잡았습니다 —
 * 줄이 적거나 좌우가 안 벌어지면 **가르지 않습니다.** 틀린 화자를 붙이는 것이
 * 화자를 안 붙이는 것보다 나쁩니다.
 */
export const DEFAULT_LAYOUT: LayoutRule = {
  minLines: 4,
  minGapRatio: 0.15,
}

/** 화자 이름표. `A`·`B`… → 08-14-api.md §3.3 의 예시가 쓰는 모양 */
function speakerLabel(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `S${index + 1}`
}

/** 유한한 수인가. `NaN`·`Infinity`·문자열은 아닙니다 */
function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 빈 문자열은 글자가 아닙니다 */
function textOf(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * 0~1 인가. **범위 밖은 버립니다.**
 *
 * 1.5 를 그대로 두면 「신뢰도 낮은 것」을 고르는 비교가 조용히 틀립니다.
 */
function confidenceOf(value: unknown): number | null {
  const n = numberOf(value)
  if (n === null) return null
  return n >= 0 && n <= 1 ? n : null
}

/**
 * 음성에서 읽은 자리.
 *
 * **끝이 없으면 시작과 같게 둡니다.** 08-14-api.md §3.3 이 필수로 둔 것은 `start_ms`
 * 하나라, 끝을 못 받았다고 줄을 버리면 계약이 요구하는 값까지 함께 사라집니다.
 */
function audioAt(line: EngineLine | EnginePiece): At | null {
  const startMs = numberOf(line.startMs)
  if (startMs === null || startMs < 0) return null
  const endMs = numberOf(line.endMs)
  return {
    kind: 'audio',
    startMs,
    endMs: endMs !== null && endMs >= startMs ? endMs : startMs,
  }
}

/**
 * 이미지에서 읽은 자리. `[x, y, width, height]` — 좌상단 기준 픽셀.
 *
 * 넓이나 높이가 0 이하면 자리가 아닙니다 — 그 상자로는 아무것도 못 보여 줍니다.
 */
function imageAt(line: EngineLine | EnginePiece): At | null {
  const box = line.box
  if (!Array.isArray(box) || box.length < 4) return null
  const [x, y, width, height] = box.map((one: unknown) => numberOf(one))
  if (x === null || y === null || width === null || height === null) return null
  if (width <= 0 || height <= 0) return null
  return { kind: 'image', x, y, width, height }
}

function atOf(line: EngineLine | EnginePiece, phase: IngestPhase): At | null {
  return phase === 'stt' ? audioAt(line) : imageAt(line)
}

/** 엔진이 낸 것에서 배열을 꺼낸다. 배열이 아니면 빈 것으로 봅니다 */
function arrayOf(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function readPieces(value: unknown, phase: IngestPhase): readonly Piece[] {
  const out: Piece[] = []
  for (const raw of arrayOf(value)) {
    if (raw === null || typeof raw !== 'object') continue
    const piece = raw as EnginePiece
    const text = textOf(piece.text)
    if (text === null) continue
    out.push({ text, at: atOf(piece, phase), confidence: confidenceOf(piece.confidence) })
  }
  return out
}

/**
 * 엔진이 낸 줄들을 이 모듈의 어휘로 옮긴다.
 *
 * **글자가 없는 줄만 버립니다.** 자리가 없어도, 신뢰도가 없어도, 화자가 없어도
 * 글자는 남깁니다 — 글자가 이 모듈의 산출물이고 나머지는 그것을 확인시키는 것입니다.
 */
function normalize(
  output: EngineOutput,
  phase: IngestPhase,
): { lines: Line[]; dropped: number } {
  const lines: Line[] = []
  let dropped = 0

  for (const raw of arrayOf(output.lines)) {
    if (raw === null || typeof raw !== 'object') {
      dropped += 1
      continue
    }
    const line = raw as EngineLine
    const text = textOf(line.text)
    if (text === null) {
      dropped += 1
      continue
    }
    lines.push({
      // 엔진이 매긴 구분값은 여기서 안 씁니다 — 아래 relabel 이 A·B 로 다시 붙입니다
      speaker: null,
      speakerConfidence: confidenceOf(line.speakerConfidence),
      text,
      at: atOf(line, phase),
      pieces: readPieces(line.pieces, phase),
    })
  }

  return { lines, dropped }
}

/**
 * 엔진이 매긴 화자 구분값을 `A`·`B`… 로 다시 붙인다. **먼저 말한 쪽이 `A`** 입니다.
 *
 * ⚠️ **누가 사기범인지는 정하지 않습니다.** 수신 통화면 사기범이 먼저 말하고
 * 발신 통화면 피해자가 먼저 말하는데, **녹음 파일 안에 어느 쪽인지가 없습니다.**
 * 여기서 정하면 근거 없는 판정이 되고, 그 값이 `case-reader` 의 수법 판별까지
 * 흘러갑니다.
 *
 * 엔진 구분값을 그대로 쓰지 않는 이유는 제품마다 모양이 다르기 때문입니다 —
 * 숫자·`SPEAKER_00`·화자 이름이 섞이면 화면과 프롬프트가 제품에 묶입니다.
 */
function relabelSpeakers(
  engineLines: readonly unknown[],
  lines: readonly Line[],
): { lines: Line[]; count: number } {
  // 버려진 줄이 있으면 자리가 어긋나므로, 살아남은 줄만 순서대로 짝지읍니다
  const raws = engineLines.filter(
    (raw): raw is EngineLine =>
      raw !== null && typeof raw === 'object' && textOf((raw as EngineLine).text) !== null,
  )

  const order = new Map<string, string>()
  const out = lines.map((line, index) => {
    const marker = raws[index]?.speaker
    if (marker === null || marker === undefined) return line
    const key = String(marker)
    let label = order.get(key)
    if (label === undefined) {
      label = speakerLabel(order.size)
      order.set(key, label)
    }
    return { ...line, speaker: label }
  })

  return { lines: out, count: order.size }
}

/**
 * 이미지의 말풍선 좌·우로 화자를 가른다.
 *
 * `F-02` 가 OCR 에 **「대화 구조 보존」**을 요구하는데, 어떤 판독기도 「왼쪽 말풍선이
 * 상대」라는 것을 모릅니다. 좌표에서 우리가 세워야 하는 규칙입니다.
 *
 * **모델이 아니라 규칙입니다.** 그리고 **애매하면 안 가릅니다** — 두 무리가 충분히
 * 벌어져 있을 때만 붙이고, 아니면 `no_layout` 을 실어 보냅니다. 사기범이 한 말이
 * 피해자가 한 말로 기록되면 판정이 통째로 뒤집힙니다.
 *
 * ⚠️ **카카오톡은 배경색이 좌·우보다 강한 신호입니다.** 다만 이 모듈에는 픽셀이 없고
 * 읽어낸 글자와 좌표뿐이라 색을 볼 수 없습니다. 색까지 보려면 판독기 쪽이 그 값을
 * 함께 내야 합니다 — ⬜ 미결입니다.
 */
function applyLayout(
  lines: readonly Line[],
  rule: LayoutRule,
): { lines: Line[]; count: number; laidOut: boolean } {
  const boxed = lines.filter(
    (line): line is Line & { at: Extract<At, { kind: 'image' }> } =>
      line.at !== null && line.at.kind === 'image',
  )
  if (boxed.length < rule.minLines) return { lines: [...lines], count: 0, laidOut: false }

  const centers = boxed.map((line) => line.at.x + line.at.width / 2)
  const left = Math.min(...boxed.map((line) => line.at.x))
  const right = Math.max(...boxed.map((line) => line.at.x + line.at.width))
  const span = right - left
  if (span <= 0) return { lines: [...lines], count: 0, laidOut: false }

  const mid = (Math.min(...centers) + Math.max(...centers)) / 2
  const nearSide = centers.filter((one) => one <= mid)
  const farSide = centers.filter((one) => one > mid)
  if (nearSide.length === 0 || farSide.length === 0) {
    return { lines: [...lines], count: 0, laidOut: false }
  }

  const mean = (values: number[]): number =>
    values.reduce((sum, one) => sum + one, 0) / values.length
  const gap = mean(farSide) - mean(nearSide)
  if (gap / span < rule.minGapRatio) return { lines: [...lines], count: 0, laidOut: false }

  const out = lines.map((line) => {
    if (line.at === null || line.at.kind !== 'image') return line
    const center = line.at.x + line.at.width / 2
    return { ...line, speaker: center <= mid ? 'A' : 'B' }
  })

  return { lines: out, count: 2, laidOut: true }
}

/** 무엇을 못 했나. **비어 있으면 다 됐다는 뜻입니다** */
function shortfallsOf(lines: readonly Line[], speakerCount: number): Shortfall[] {
  if (lines.length === 0) return ['empty']

  const out: Shortfall[] = []
  if (speakerCount === 0) out.push('no_speakers')

  const pieces = lines.flatMap((line) => line.pieces)
  if (pieces.length === 0) out.push('no_pieces')

  // 조각이 있으면 조각의 신뢰도를, 없으면 줄에 아무 신뢰도도 없다는 뜻입니다.
  // ADR-038 이 고칠 수 있는 것을 명사·숫자로 한정했으므로 조각 쪽이 기준입니다
  const hasConfidence = pieces.some((one) => one.confidence !== null)
  if (!hasConfidence) out.push('no_confidence')

  const hasAnchor =
    lines.some((line) => line.at !== null) || pieces.some((one) => one.at !== null)
  if (!hasAnchor) out.push('no_anchors')

  return out
}

/**
 * 읽는 도구가 실패했다.
 *
 * **원인 문자열을 담지 않습니다.** 판독기가 돌려준 오류 본문에 파일 내용이 섞여 있을
 * 수 있고, 이 값은 감사 로그로 갑니다 → 08-16-errors.md §3 · 04-pii-boundary.md.
 * 담는 것은 **어디서·무엇이** 뿐입니다.
 */
function ingestFailed(
  message: string,
  detail: {
    /** 맡길 때는 저장소 경로가, 물어볼 때는 작업 번호가 있습니다 */
    readonly objectKey?: string
    readonly jobId?: string
    readonly kind: string
    readonly phase: IngestPhase | null
    /** 어디서 틀어졌나. **짧은 표시값만** — 예외 문구를 그대로 담지 않습니다 */
    readonly reason: string
  },
): IngestError {
  return new IngestError(message, { ...detail })
}

export function createTranscriber(deps: TranscriberDeps): Transcriber {
  const layout: LayoutRule = { ...DEFAULT_LAYOUT, ...deps.layout }

  /** 옮길 것이 없는 것은 실패가 아닙니다 */
  const nothingToRead = (): TranscribeResult => ({
    phase: null,
    lines: [],
    speakerCount: 0,
    shortfalls: ['not_applicable'],
    dropped: 0,
    engine: null,
  })

  /** 읽은 것을 이 모듈의 어휘로 옮긴다. **판단은 전부 여기서** 합니다 */
  const shape = (output: EngineOutput, phase: IngestPhase): TranscribeResult => {
    const { lines: normalized, dropped } = normalize(output, phase)
    const labelled = relabelSpeakers(arrayOf(output.lines), normalized)

    let lines = labelled.lines
    let speakerCount = labelled.count

    // 판독기는 화자를 모릅니다. 좌표로 세워 봅니다 — 애매하면 안 세웁니다
    if (phase === 'ocr' && speakerCount === 0) {
      const arranged = applyLayout(lines, layout)
      if (arranged.laidOut) {
        lines = arranged.lines
        speakerCount = arranged.count
      }
    }

    const shortfalls = shortfallsOf(lines, speakerCount)
    if (phase === 'ocr' && speakerCount === 0 && lines.length > 0) {
      shortfalls.push('no_layout')
    }

    return {
      phase,
      lines,
      speakerCount,
      shortfalls,
      dropped,
      engine: textOf(output.engine),
    }
  }

  return {
    async start(input: TranscribeInput): Promise<StartResult> {
      // 밖에서 정한 번호. 아래 `jobId` 는 실제로 열린 번호라 이름을 가릅니다
      const { media, vocabulary, jobId: wanted } = input

      // 글로 올라온 것은 옮길 것이 없습니다. **에러가 아닙니다** —
      // 부르는 쪽이 토큰화만 거쳐 그대로 저장하면 됩니다
      if (media.kind === 'text') {
        return { started: false, result: nothingToRead() }
      }

      const phase: IngestPhase = media.kind === 'audio' ? 'stt' : 'ocr'

      let url: string
      try {
        url = await deps.media.readUrl(media.objectKey)
      } catch (error) {
        // 이미 이 계층의 예외면 그대로 올립니다. 미설정(500 · 재시도 없음)을
        // 전사 실패(422 · 재시도 있음)로 덮으면, **고칠 수 없는 상태를 두고
        // 사용자가 계속 다시 누르게** 됩니다 → 08-16-errors.md §2 · lib/not-configured.ts
        if (error instanceof AppError) throw error
        throw ingestFailed('파일을 읽을 자리를 얻지 못했습니다', {
          objectKey: media.objectKey,
          kind: media.kind,
          phase,
          reason: 'read_url_failed',
        })
      }

      try {
        const jobId =
          media.kind === 'audio'
            ? await deps.stt.submit({
                url,
                mimeType: media.mimeType,
                vocabulary,
                jobId: wanted,
              })
            : await deps.ocr.submit({ url, mimeType: media.mimeType, jobId: wanted })
        return { started: true, job: { jobId, phase, kind: media.kind } }
      } catch (error) {
        if (error instanceof AppError) throw error
        throw ingestFailed('읽어 달라고 맡기지 못했습니다', {
          objectKey: media.objectKey,
          kind: media.kind,
          phase,
          reason: 'submit_failed',
        })
      }
    },

    async collect(job: TranscriptionJob): Promise<CollectResult> {
      if (job.kind === 'text') {
        return { status: 'done', result: nothingToRead() }
      }

      const tool = job.kind === 'audio' ? deps.stt : deps.ocr

      let progress: EngineProgress
      try {
        progress = await tool.poll(job.jobId)
      } catch (error) {
        if (error instanceof AppError) throw error
        throw ingestFailed('맡긴 일을 물어보지 못했습니다', {
          jobId: job.jobId,
          kind: job.kind,
          phase: job.phase,
          reason: 'poll_failed',
        })
      }

      if (progress.status === 'running') {
        // 100 을 넘거나 뒤로 가지 않게 합니다 — 화면의 진행률이 줄어들면 고장으로 보입니다
        const percent = numberOf(progress.percent) ?? 0
        return {
          status: 'running',
          phase: job.phase,
          percent: Math.max(0, Math.min(99, Math.trunc(percent))),
        }
      }

      if (progress.status === 'failed') {
        // **던지지 않습니다.** 부르는 쪽이 `ingest_status` 를 `failed` 로 적으면 되고,
        // 사건 진행은 막지 않습니다 → CLAUDE.md 불변 규칙 5
        return { status: 'failed', reason: textOf(progress.reason) ?? 'unknown' }
      }

      return { status: 'done', result: shape(progress.output, job.phase) }
    },
  }
}
