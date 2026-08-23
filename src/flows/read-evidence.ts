/**
 * 올라온 증거 하나를 읽어 진행 상태로 답하는 흐름.
 *
 * 정본: spec/common/08-14-api.md §3.2 3단계 · §3.3 ·
 *       spec/common/08-14-pii-boundary.md 규칙 2
 * 근거: ADR-028(자원은 밖에서) · ADR-038(확인 화면은 낱말 단위 신뢰도로)
 *
 * ## 왜 흐름이 따로 있나
 *
 * 라우트 하나가 모듈 셋을 순서대로 부르고 그 사이에 **경계가 하나 있습니다**.
 * 라우트에 두면 그 순서가 라우트마다 복제되고, 복제된 것 중 하나가 토큰화를
 * 빠뜨리면 원문이 그대로 나갑니다.
 *
 * ## ⚠️ 이 파일이 경계를 지납니다
 *
 * 전사 결과는 **원문**입니다 — 계좌번호와 이름이 그대로 있습니다. 그것을
 * 저장하거나 응답에 실으려면 **반드시 먼저 토큰으로 바꿔야** 합니다
 * → 04-pii-boundary.md 규칙 2·3.
 *
 * 아래 `collect` 는 원문을 받은 뒤 **토큰화를 거치지 않고는 아무것도
 * 돌려주지 않습니다.** 토큰화가 실패하면 그대로 던집니다 — 통과시키는
 * 경로를 만들지 않는 것이 `pii-tokenizer` 의 존재 이유입니다.
 */

import 'server-only'

import type { Container } from '@/lib/container'

import type { EvidenceKind, IngestStatus } from '@/modules/case-intake'
import type { IngestPhase, Line } from '@/modules/transcriber'

/** 화면이 다음에 언제 물을지 → §3.3 `poll_after_ms` */
const POLL_AFTER_MS = 1500

/**
 * 읽기를 맡긴다 → §3.2 3단계.
 *
 * **작업 번호로 증거 번호를 그대로 씁니다.** 그러면 「어느 작업이었나」를
 * 적어 둘 칸이 없어도 나중에 다시 물어볼 수 있습니다 — 스키마에 그 칸이
 * 없기도 하고, 있어도 서비스가 다시 뜨면 가리키는 곳이 사라집니다.
 * 번호를 유도할 수 있으면 그냥 다시 맡기면 됩니다.
 */
export async function startReading(
  input: {
    readonly evidenceId: string
    readonly objectKey: string
    readonly kind: EvidenceKind
    readonly mimeType: string
  },
  container: Container,
): Promise<void> {
  // 글로 올라온 것은 읽을 것이 없습니다 — 이미 글입니다
  if (input.kind === 'text') return

  await container.transcriber.start({
    media: { objectKey: input.objectKey, kind: input.kind, mimeType: input.mimeType },
    jobId: input.evidenceId,
  })
}

/** §3.3 이 돌려주는 것 */
export type ReadState =
  | {
      readonly status: 'running'
      readonly phase: IngestPhase
      readonly percent: number
      readonly pollAfterMs: number
    }
  | {
      readonly status: 'done'
      /** **토큰화된 상태입니다.** 원문이 아닙니다 → 규칙 2 */
      readonly lines: readonly { speaker: string | null; text: string; startMs: number | null }[]
      /** 어떤 토큰이 있는지만. **원문을 담지 않습니다** → §3.3 */
      readonly tokens: readonly { token: string; kind: string }[]
      /** 기계가 못 읽은 것 — 화면이 「이건 직접 확인해 주세요」로 씁니다 */
      readonly shortfalls: readonly string[]
    }
  | { readonly status: 'failed'; readonly reason: string }

/**
 * 진행 상태를 묻는다 → §3.3.
 *
 * **끝났으면 토큰화까지 해서 돌려줍니다.** 이 함수가 원문을 밖으로 내보내는
 * 유일한 길목이고, 그래서 여기서 막습니다.
 */
export async function collectReading(
  input: {
    readonly caseId: string
    readonly evidenceId: string
    readonly kind: EvidenceKind
    /** 이미 저장된 결과. 있으면 다시 읽지 않습니다 */
    readonly stored: string | null
  },
  container: Container,
): Promise<ReadState> {
  // **이미 다 읽은 것은 저장된 것을 돌려줍니다.**
  //
  // 매번 다시 토큰화하면 같은 계좌번호에 **번호가 매번 달리 붙습니다** —
  // 브라우저가 들고 있는 매핑과 어긋나 복원이 깨집니다. 게다가 전사 서비스는
  // 30분 뒤 작업을 버리므로, 그 뒤에는 아예 못 읽습니다
  if (input.stored !== null) return fromStored(input.stored)

  const progress = await container.transcriber.collect({
    jobId: input.evidenceId,
    // 아래 둘은 `collect` 가 결과를 어느 갈래로 읽을지 정할 때만 씁니다
    phase: input.kind === 'audio' ? 'stt' : 'ocr',
    kind: input.kind,
  })

  if (progress.status === 'running') {
    return {
      status: 'running',
      phase: progress.phase,
      percent: progress.percent,
      pollAfterMs: POLL_AFTER_MS,
    }
  }

  if (progress.status === 'failed') {
    // **에러로 올리지 않습니다** → 불변 규칙 5. 못 읽은 것은 정상 상태입니다
    await container.evidenceWrite.fail({
      caseId: input.caseId,
      evidenceId: input.evidenceId,
      reason: progress.reason,
    })
    return { status: 'failed', reason: progress.reason }
  }

  // ── 여기부터 원문입니다 ────────────────────────────────────────────
  const masked = await maskLines(progress.result.lines, container)

  const state: ReadState = {
    status: 'done',
    lines: masked.lines,
    tokens: masked.tokens,
    shortfalls: [...progress.result.shortfalls],
  }

  // **한 번만 토큰화합니다.** 저장해 두면 다음 폴링은 위에서 바로 돌아갑니다.
  // 챗도 이 값을 맥락으로 씁니다 → `flows/chat-turn.ts`
  await container.evidenceWrite.finish({
    caseId: input.caseId,
    evidenceId: input.evidenceId,
    transcriptMasked: JSON.stringify({
      lines: state.lines,
      tokens: state.tokens,
      shortfalls: state.shortfalls,
    }),
  })

  return state
}

/**
 * 저장해 둔 것을 되돌린다.
 *
 * 칸이 `TEXT` 하나라 구조를 담아 넣습니다 — 화자와 시각을 버리면 확인
 * 화면이 「어느 대목인지」를 못 보여줍니다 → ADR-038.
 *
 * **못 읽으면 「다 됐지만 내용이 없다」로 답합니다.** 여기서 던지면 이미
 * 끝난 증거가 오류로 보이고, 사용자가 다시 올리게 됩니다.
 */
function fromStored(text: string): ReadState {
  try {
    const parsed = JSON.parse(text) as {
      lines?: ReadState extends { lines: infer L } ? L : never
      tokens?: readonly { token: string; kind: string }[]
      shortfalls?: readonly string[]
    }
    return {
      status: 'done',
      lines: parsed.lines ?? [],
      tokens: parsed.tokens ?? [],
      shortfalls: parsed.shortfalls ?? [],
    }
  } catch {
    return { status: 'done', lines: [], tokens: [], shortfalls: ['no_layout'] }
  }
}

/**
 * 줄마다 토큰으로 바꾼다.
 *
 * **줄을 하나씩 부르되 매핑을 이어 넘깁니다.** 같은 계좌번호가 여러 줄에
 * 나오면 같은 토큰이 붙어야 합니다 — 안 이으면 일련번호가 매번 1로 리셋돼
 * 서로 다른 줄의 `[계좌-1]` 이 다른 계좌를 가리키고, **복원이 엉뚱한 값을
 * 되살립니다** → 04-pii-boundary.md.
 */
async function maskLines(
  lines: readonly Line[],
  container: Container,
): Promise<{
  lines: { speaker: string | null; text: string; startMs: number | null }[]
  tokens: { token: string; kind: string }[]
}> {
  const out: { speaker: string | null; text: string; startMs: number | null }[] = []
  const seen = new Map<string, string>()

  let mappings: readonly { token: string; kind: string; value: string }[] = []

  for (const line of lines) {
    const result = await container.piiTokenizer.tokenize(line.text, {
      // **전사문입니다** → `transcript-digits.ts`. 이 표시가 없으면 구분자가
      // 깨진 계좌번호를 못 잡습니다 — 실측에서 정규식이 숫자 20건 중 6~10건만
      // 잡았습니다(docs/research/09 §5.4). 「110-234-567890」이
      // 「110에 234-56만 7,890」으로 전사되기 때문입니다
      transcript: true,
      // 앞 줄에서 만든 매핑을 이어 씁니다. 안 넘기면 일련번호가 리셋돼
      // 서로 다른 줄의 `[계좌-1]` 이 다른 계좌를 가리킵니다
      mappings: mappings as never,
    })
    mappings = result.mappings as never
    for (const one of result.added) seen.set(one.token, one.kind)

    out.push({
      speaker: line.speaker,
      text: result.masked,
      // 이미지에는 시각이 없습니다 → `At` 이 두 갈래입니다
      startMs: line.at && 'startMs' in line.at ? line.at.startMs : null,
    })
  }

  return {
    lines: out,
    tokens: [...seen].map(([token, kind]) => ({ token, kind })),
  }
}

/** `evidence.ingest_status` 로 옮긴다 → 09-data-model.md §3 */
export function statusOf(state: ReadState): IngestStatus {
  if (state.status === 'running') return 'processing'
  if (state.status === 'failed') return 'failed'
  return 'done'
}
