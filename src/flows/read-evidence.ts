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

import { allowedTermsFor } from '@/lib/allowed-terms'
import type { Container } from '@/lib/container'
import {
  ORG_REPAIR_PROMPT,
  buildOrgRepairInput,
  parseOrgRepair,
  verifyOrgRepair,
} from '@/lib/org-repair'

import { normalizeExtracted } from '@/lib/extracted-value'

import type { EvidenceKind, IngestStatus } from '@/modules/case-intake'
import { CONFIRMABLE_KEYS } from '@/modules/slot-checker'
import { createSlotExtractor } from '@/modules/slot-extractor'
import { readIssuedLedger } from '@/modules/pii-tokenizer'
import type { TokenMapping } from '@/modules/pii-tokenizer'
import type { CollectResult, IngestPhase, Line, Shortfall } from '@/modules/transcriber'

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
  // 글로 올라온 것은 **맡길 것이** 없습니다 — 이미 글이라 엔진이 할 일이
  // 없습니다. 다만 **아무도 안 읽는다는 뜻은 아닙니다** — 본문을 가져와
  // 토큰화하는 것은 `collectReading` 이 합니다 (아래 `readWritten`)
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
      /**
       * **이번 요청에서 막 만든** 대응표 — 원문이 들어 있습니다.
       *
       * 토큰화는 브라우저의 폴링 요청 안에서 딱 한 번 일어나고, 이 값은
       * **그 응답에만** 실립니다. 저장을 거치지 않으므로(스키마의 「원문 금지」
       * 그대로) 다음 폴링부터는 없습니다 — 브라우저가 받은 즉시 자기 열쇠로
       * 잠가 볼트에 넣는 것이 짝의 유일한 생존 경로입니다 (ADR-062).
       *
       * 장부에서 이어받은 이름표는 여기 없습니다 — 그 원문은 서버가 모릅니다.
       */
      readonly freshMappings?: readonly TokenMapping[]
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
    /**
     * 저장소의 파일 자리. **글(`kind: 'text'`)에만 씁니다** — 녹음·사진은
     * 주소만 추론 서비스에 건네고 바이트가 우리 함수를 통과하지 않습니다.
     */
    readonly objectKey: string
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

  // **글은 우리가 읽습니다.** 전사기는 옮길 것이 없어 `not_applicable` 로
  // 돌려주고(`transcribe.ts` 의 `nothingToRead`), 그 주석이 *"부르는 쪽이
  // 토큰화만 거쳐 그대로 저장하면 됩니다"* 로 몫을 여기에 넘겼습니다 —
  // 그 몫을 2026-09-03 까지 아무도 안 해서 **올린 대화 전체가 사라졌습니다**
  const progress =
    input.kind === 'text'
      ? await readWritten(input.objectKey, container)
      : await container.transcriber.collect({
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
  // **토큰화 제외 목록** → 04-pii-boundary.md. 없으면 NER 이 기관명을 사람
  // 이름으로 집어 `[이름-1]` 로 가리고, 경유 서비스를 특정할 수 없어
  // **에러 없이 슈퍼셋 플랜이 나갑니다.** 여기가 그 목록을 넘기는 자리입니다
  const allowed = await allowedTermsFor({
    channels: container.channelWrite,
    kbVersion: container.ports.kbVersion,
  })

  // **이 사건에서 이미 쓰인 이름표를 이어받습니다** → 04-pii-boundary.md
  // 「번호의 단위」. 안 이어받으면 증거마다 번호가 1부터 다시 시작해,
  // 챗에서 본인 계좌에 붙은 `[계좌-1]` 자리에 **사기범 계좌가 들어옵니다** —
  // 자료함이 전사문을 복원할 때 B 자리에 A 가 그려집니다.
  //
  // 볼트만 보지 않고 전사문도 함께 긁습니다: 서버가 붙인 이름표는 짝을 봉할
  // 키가 서버에 없어 **볼트에 안 올라가므로**, 볼트만 보면 증거 1 이 쓴 번호를
  // 증거 2 가 다시 씁니다. 그 둘이 매 턴 한 목록으로 모델에 함께 들어갑니다
  // (`flows/chat-turn.ts` 의 `caseTalk`)
  const issued = await readIssuedLedger(input.caseId, {
    vault: container.vaultWrite,
    masked: container.maskedTexts,
  })
  const masked = await maskLines(progress.result.lines, container, allowed, issued)

  const state: ReadState = {
    status: 'done',
    lines: masked.lines,
    tokens: masked.tokens,
    // **이 응답에만 실립니다** — 저장(아래 finish)에는 안 들어갑니다
    freshMappings: masked.fresh,
    shortfalls: [
      ...progress.result.shortfalls,
      // **조용히 넘어가지 않습니다.** 목록을 못 가져오면 절차는 그대로 가되
      // 기관명이 가려졌을 수 있습니다 → `Shortfall` 의 「무엇을 못 했는지는
      // 숨기지 않습니다」.
      //
      // ⬜ **여기까지는 응답이고 화면은 아직입니다.** `evidence/[id]` 응답에는
      // 실리지만 `shortfalls` 를 그리는 화면이 아직 없습니다 — 이 값만 그런 것이
      // 아니라 `no_layout`·`no_speakers` 도 마찬가지입니다. 새 자리를 만드는 것은
      // 시안 결정 대기 줄에 있어 여기서 정하지 않습니다
      ...(masked.orgGuardMissing ? ['no_org_allowlist'] : []),
    ],
  }

  // **토큰화가 끝난 뒤에 기관 이름을 고칩니다** → ADR-056.
  //
  // 이 자리인 이유는 경계 때문입니다 — 여기서부터 개인정보는 토큰이라
  // 밖으로 내보내도 [불변 규칙 2](../../CLAUDE.md)를 안 깨뜨립니다.
  // 기관명은 토큰화 제외 목록이라 평문 그대로 남아 있어 모델이 볼 수 있습니다.
  await repairOrgs(input.caseId, masked.lines, container)

  // **금액·시각·상대 계좌도 여기서 뽑습니다** → ADR-069. 같은 자리인 이유도 같습니다 —
  // 토큰화 뒤라 모델이 보는 것은 토큰뿐이고, 뽑힌 값은 `extracted` 로 두어 슬롯 체커가
  // 한 번의 탭으로 확인받습니다. 문진이 그 문항을 통째로 묻지 않게 되는 자리입니다
  await extractSlots(
    { caseId: input.caseId, evidenceId: input.evidenceId, kind: input.kind },
    masked.lines,
    container,
  )

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
export async function maskLines(
  lines: readonly Line[],
  /**
   * **컨테이너 전체를 받지 않습니다.** 쓰는 것이 토크나이저 하나뿐이고,
   * 좁혀야 시험이 이 함수를 **행동으로** 걸 수 있습니다 — 글자를 보는 시험은
   * 조건을 뒤집어 써도 통과합니다(실제로 그런 시험을 쓴 적이 있습니다).
   */
  container: Pick<Container, 'piiTokenizer'>,
  /** 토큰화하지 않을 낱말 — 기관명이 여기 들어옵니다 → `lib/allowed-terms.ts` */
  allowedTerms: readonly string[],
  /**
   * 이 사건에서 **이미 발급된 이름표**. 여기 뒤에서부터 번호가 나갑니다
   * → `pii-tokenizer/ledger.ts`.
   *
   * **원문이 없습니다** — 서버가 그 값을 모릅니다. 그래서 「같은 값 → 같은
   * 번호」는 이 줄 묶음 안에서만 서고, 장부에서 온 항목은 번호만 비켜 줍니다.
   *
   * 안 넘기면 증거마다 1번부터라 **서로 다른 증거의 `[계좌-1]` 이 다른 계좌**가
   * 됩니다 → 04-pii-boundary.md 「번호의 단위」.
   */
  issued: readonly TokenMapping[] = [],
): Promise<{
  lines: { speaker: string | null; text: string; startMs: number | null }[]
  tokens: { token: string; kind: string }[]
  /** 막 만든 대응표 — 원문 포함. 부르는 쪽이 브라우저에 건넵니다 */
  fresh: TokenMapping[]
  /**
   * **모델이 이름을 집는데 기관명을 지켜 줄 목록이 없었나.**
   * 둘이 겹칠 때만 위험합니다 → `pii-tokenizer` 의 `allowedTermsApplied`
   */
  orgGuardMissing: boolean
}> {
  const out: { speaker: string | null; text: string; startMs: number | null }[] = []
  const seen = new Map<string, string>()
  // 이번 줄 묶음에서 **막 만든** 것 — `original` 이 채워져 있습니다.
  // 장부(issued)에서 온 것은 여기 안 들어옵니다
  const fresh: TokenMapping[] = []
  let orgGuardMissing = false

  // 장부에서 이어받은 것으로 시작합니다. 줄을 돌면서 여기 쌓입니다
  let mappings: readonly TokenMapping[] = issued

  for (const line of lines) {
    const result = await container.piiTokenizer.tokenize(line.text, {
      // **NER 결과보다 우선입니다** → 04-pii-boundary.md 「토큰화 제외 목록」.
      // 이게 비면 「토스로 300만원」이 「[이름-1]로 300만원」이 됩니다
      allowedTerms,
      // **전사문입니다** → `transcript-digits.ts`. 이 표시가 없으면 구분자가
      // 깨진 계좌번호를 못 잡습니다 — 실측에서 정규식이 숫자 20건 중 6~10건만
      // 잡았습니다(docs/research/09 §5.4). 「110-234-567890」이
      // 「110에 234-56만 7,890」으로 전사되기 때문입니다
      transcript: true,
      // 앞 줄에서 만든 매핑과 **장부**를 이어 씁니다. 안 넘기면 일련번호가
      // 리셋돼 서로 다른 줄의 `[계좌-1]` 이 다른 계좌를 가리킵니다
      mappings,
    })
    mappings = result.mappings
    if (result.nerApplied && !result.allowedTermsApplied) orgGuardMissing = true
    for (const one of result.added) {
      seen.set(one.token, one.kind)
      fresh.push(one)
    }

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
    fresh,
    orgGuardMissing,
  }
}

/**
 * 글 파일에서 읽어 올 상한 — 글자 수와 줄 수.
 *
 * **자릅니다. 거절하지 않습니다.** 카카오톡 「대화 내보내기」는 몇 년치가
 * 한 파일로 나오기도 하는데, 그걸 통째로 토큰화하면 요청 하나가 함수의
 * 수명을 넘깁니다. 앞에서부터 자르는 이유는 **사건이 대개 앞에 있기**
 * 때문이 아니라 — 그건 우리가 모릅니다 — 어디를 남길지 고르는 순간
 * 그것이 판단이 되기 때문입니다. 자른 사실은 `shortfalls` 로 나갑니다.
 */
const TEXT_CHAR_LIMIT = 200_000
const TEXT_LINE_LIMIT = 3_000

/**
 * 글로 올린 자료를 읽는다 — **전사기가 아니라 이 흐름의 몫입니다.**
 *
 * ⚠️ **2026-09-03 까지 이 함수가 없었습니다.** 자료 레일이 `text/*` 를 받는데
 * (`evidence.tsx` 의 `accept`), 전사기는 글을 `not_applicable` 로 돌려주고
 * 이 흐름은 그 빈 결과를 그대로 저장했습니다. 그래서 **올린 대화 전체가
 * 조용히 사라지고 화면은 「다 읽었습니다」라고 말했습니다** — 실패했다고
 * 말하지 않으니 다시 올리지도 않는, 가장 나쁜 실패 모양입니다.
 *
 * 돌려주는 모양을 `CollectResult` 에 맞춥니다 — 부르는 쪽이 녹음·사진과
 * **같은 길**로 흘려보내야 토큰화·장부·저장이 한 벌로 남습니다.
 */
async function readWritten(
  objectKey: string,
  container: Container,
): Promise<CollectResult> {
  let body: string
  try {
    body = await container.ports.mediaReader.readText(objectKey)
  } catch {
    // **「다 됐다」로 덮지 않습니다.** 못 읽었으면 못 읽었다고 해야 사용자가
    // 다시 올릴 수 있습니다 → 08-16-errors.md §2
    return { status: 'failed', reason: 'text_read_failed' }
  }

  const clipped = body.length > TEXT_CHAR_LIMIT
  const rows = body
    .slice(0, TEXT_CHAR_LIMIT)
    .split(/\r?\n/)
    .map((one) => one.trim())
    .filter((one) => one.length > 0)

  const lines: Line[] = rows.slice(0, TEXT_LINE_LIMIT).map((text) => ({
    // **화자를 지어내지 않습니다.** 카톡 내보내기의 「[홍길동] 」 같은 머리말을
    // 잘라 화자로 세울 수도 있지만, 그 형식은 앱·버전마다 다르고 틀리면
    // **누가 계좌를 불렀는지가 뒤집힙니다** → `Line.speaker` 의 경고
    speaker: null,
    speakerConfidence: null,
    text,
    // 글에는 시각도 좌표도 없습니다
    at: null,
    pieces: [],
  }))

  const shortfalls: Shortfall[] = ['no_speakers', 'no_anchors', 'no_pieces']
  if (lines.length === 0) shortfalls.unshift('empty')
  // **잘랐으면 잘랐다고 남깁니다** — 뒷부분이 안 읽힌 것을 모르면
  // 「그 계좌가 왜 안 잡혔지」의 답을 영영 못 찾습니다
  if (clipped || rows.length > TEXT_LINE_LIMIT) shortfalls.push('truncated')

  return {
    status: 'done',
    result: { phase: null, lines, speakerCount: 0, shortfalls, dropped: 0, engine: null },
  }
}

/** `evidence.ingest_status` 로 옮긴다 → 09-data-model.md §3 */
export function statusOf(state: ReadState): IngestStatus {
  if (state.status === 'running') return 'processing'
  if (state.status === 'failed') return 'failed'
  return 'done'
}

/**
 * 전사문에서 기관 이름을 찾아 고치고, 확인 대기 상태로 남긴다 → ADR-056.
 *
 * ## 왜 확정하지 않나
 *
 * 모델이 짚고 사전이 걸러도 **마지막은 사용자가 봅니다** — `state: 'extracted'`
 * 로 두면 슬롯 체커가 그 유형의 기관 목록을 선택지로 되묻습니다
 * (`slot-checker/check.ts`). §11.4.4 ① 이 *"못 찾으면 되묻는 편이 안전합니다"*
 * 로 정한 것이고, 모델을 쓴다고 그 이유가 사라지지 않습니다.
 *
 * ## 왜 유형으로 안 좁히나
 *
 * **전사 시점에는 유형을 모릅니다** — 그것을 알아내려고 전사합니다(17 §4).
 * 그래서 전 기관을 봅니다. `matchOrg` 가 정확 일치만 보고 여럿이면 `null` 을
 * 내므로 넓게 봐도 엉뚱한 곳이 확정되지 않습니다.
 *
 * ## 실패해도 진행한다
 *
 * 모델이 안 뜨거나 형식을 못 지키면 **교정만 건너뜁니다.** 전사 결과는 그대로
 * 저장되고, 지금과 같은 상태가 될 뿐 새로 나빠지는 것이 없습니다 → 불변 규칙 5.
 */
async function repairOrgs(
  caseId: string,
  lines: readonly { readonly text: string }[],
  container: Container,
): Promise<void> {
  try {
    const texts = lines.map((one) => one.text)
    if (texts.length === 0) return

    const version = await container.ports.kbVersion.current()
    const candidates = await container.channelWrite.allCandidates(version)
    // 사전이 비면 대조할 것이 없습니다. 모델을 부를 이유도 없습니다
    if (candidates.length === 0) return

    const reply = await container.ports.llm.completeText({
      system: ORG_REPAIR_PROMPT,
      user: buildOrgRepairInput(texts),
    })

    const repaired = verifyOrgRepair(parseOrgRepair(reply.text), texts.join('\n'), candidates)
    // **하나로 확정된 것만 슬롯에 올립니다.** 여럿이 걸린 것은 값이 없는 것과
    // 같아서, 그것으로 슬롯을 채우면 되묻기가 무엇을 물을지 정하지 못합니다
    const first = repaired.find((one) => one.orgId !== null)
    if (!first) return

    const name = first.options[0]
    if (!name) return

    // ⚠️ **사용자가 확정한 답은 덮지 않습니다** (2026-09-03). 문진에서 이미
    // 「카카오뱅크」라고 답했는데(`confirmed`) 여기서 `extracted` 로 덮으면,
    // 되묻기가 다시 열려 **답한 질문을 다시 묻습니다** — `anchor-from-artifact`
    // 가 같은 자리에서 이미 쓰는 그물입니다. 자동끼리는 덮습니다 —
    // 「모른다」(`unknown`)로 표시된 것은 비어 있는 것과 같아 채웁니다
    const already = await container.slots.read(caseId)
    const held = already.find((one) => one.slotKey === 'org_name')
    if (held && held.state === 'confirmed' && held.valueMasked !== null) return

    await container.slotWrite.write({
      caseId,
      slotKey: 'org_name',
      tier: 'T2',
      valueType: 'string',
      // **확인 전입니다.** 사용자가 고르면 `confirmed` 가 됩니다
      state: 'extracted',
      valueMasked: name,
      source: 'auto',
    })
  } catch {
    // 여기서 던지면 **전사 결과를 통째로 잃습니다.** 아래 finish 가 못 돌고,
    // 다음 폴링에서 전사 서비스가 이미 작업을 버렸으면 다시 읽지도 못합니다
  }
}

/**
 * 증거에서 뽑을 수 있는 값을 뽑아 `extracted` 로 둔다 → ADR-069.
 *
 * `slot-extractor`(F-05a)는 2026-09-04 까지 어느 흐름도 부르지 않았습니다 — 모듈은 있는데
 * 배선이 없어, 이체 내역 캡처를 올려도 「얼마를 보내셨나요」를 그대로 물었습니다.
 *
 * ## 무엇을 받고 무엇을 버리나
 *
 * | | |
 * | --- | --- |
 * | 받는 이름 | `CONFIRMABLE_KEYS` 다섯 — 금액·시각·상대 계좌·사칭 기관·연락 수단 |
 * | `org_name` | 안 받습니다. `repairOrgs` 가 사전 대조로 따로 둡니다(ADR-056) — 사전 밖 이름이 들어오면 안 됩니다 |
 * | `transferred`·`channel` | 안 받습니다. T1 은 분기를 정하는 값이라 사람의 답으로만 — `channel` 은 `case_channel` 을 함께 적어야 해서 슬롯만 채우면 오히려 갈래가 빗나갑니다 |
 * | 확신도 | `CONFIDENCE_MIN` 미만은 버립니다 — 08-14-slot-tiering.md 의 「임계값 미정」을 여기서 정했습니다 |
 * | 모양 | `lib/extracted-value.ts` 가 못 다듬으면 버립니다 — 「어제」·「삼천만 원쯤」은 사람에게 묻습니다 |
 * | 이미 확정된 슬롯 | 덮지 않습니다 — `repairOrgs` 와 같은 그물. `unknown`(모름)은 채웁니다 |
 *
 * ## 실패해도 진행한다
 *
 * 모델이 안 뜨거나 헛소리를 해도 **뽑기만 건너뜁니다.** 전사 결과는 그대로 저장되고,
 * 그 슬롯은 문진이 묻습니다 — *"자동 추출 실패는 정상 경로입니다"*.
 */
const CONFIDENCE_MIN = 0.7

const KIND_LABEL: Readonly<Record<EvidenceKind, string>> = {
  audio: '통화 녹음을 글로 옮긴 것',
  image: '화면 캡처에서 읽어 낸 글자 (문자 · 이체 내역 등)',
  text: '대화 내보내기 글',
}

async function extractSlots(
  input: { readonly caseId: string; readonly evidenceId: string; readonly kind: EvidenceKind },
  lines: readonly { readonly text: string }[],
  container: Container,
): Promise<void> {
  try {
    const texts = lines.map((one) => one.text).filter((one) => one.trim().length > 0)
    if (texts.length === 0) return
    const text = texts.join('\n')

    const already = await container.slots.read(input.caseId)
    const confirmed = new Set(
      already.filter((one) => one.state === 'confirmed').map((one) => one.slotKey),
    )

    const extractor = createSlotExtractor({
      llm: { complete: (prompt) => container.ports.llm.completeText(prompt) },
    })
    const result = await extractor.extract({
      // 자료 종류를 한 줄 앞세웁니다 — 「받는 계좌」가 상대 계좌라는 것은 이체 내역 캡처일 때의 뜻입니다
      maskedText: `자료 종류: ${KIND_LABEL[input.kind]}\n${text}`,
      evidenceId: input.evidenceId,
      known: [...confirmed].filter(isConfirmable),
    })

    for (const one of result.slots) {
      if (!isConfirmable(one.slotKey)) continue
      if (one.confidence < CONFIDENCE_MIN) continue
      if (confirmed.has(one.slotKey)) continue
      const value = normalizeExtracted(one.slotKey, one.valueMasked, text)
      if (value === null) continue

      await container.slotWrite.write({
        caseId: input.caseId,
        slotKey: one.slotKey,
        tier: 'T2',
        valueType: one.valueType,
        // **확인 전입니다.** 슬롯 체커가 「이 값이 맞나요」로 되묻고, 「맞아요」면 `confirmed`
        state: 'extracted',
        valueMasked: value,
        source: 'auto',
        sourceRef: input.evidenceId,
        confidence: one.confidence,
      })
    }
  } catch {
    // 여기서 던지면 **전사 결과를 통째로 잃습니다** — `repairOrgs` 와 같은 이유로 삼킵니다
  }
}

/**
 * 되묻는 다섯 — `slot-checker` 와 `slot-extractor` 의 `SlotKey` 가 서로 다른 별칭이라
 * (체커에는 `notice_started_at` 이 더 있습니다) 둘 다에 들어가는 글자 합집합으로 좁힙니다
 */
type ConfirmableKey = 'amount' | 'occurred_at' | 'counterpart_account' | 'impersonated_org' | 'contact_method'

function isConfirmable(key: string): key is ConfirmableKey {
  return (CONFIRMABLE_KEYS as readonly string[]).includes(key)
}
