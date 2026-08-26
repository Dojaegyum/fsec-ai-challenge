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
  // **토큰화 제외 목록** → 04-pii-boundary.md. 없으면 NER 이 기관명을 사람
  // 이름으로 집어 `[이름-1]` 로 가리고, 경유 서비스를 특정할 수 없어
  // **에러 없이 슈퍼셋 플랜이 나갑니다.** 여기가 그 목록을 넘기는 자리입니다
  const allowed = await allowedTermsFor({
    channels: container.channelWrite,
    kbVersion: container.ports.kbVersion,
  })
  const masked = await maskLines(progress.result.lines, container, allowed)

  const state: ReadState = {
    status: 'done',
    lines: masked.lines,
    tokens: masked.tokens,
    shortfalls: [
      ...progress.result.shortfalls,
      // **조용히 넘어가지 않습니다.** 목록을 못 가져오면 절차는 그대로 가되
      // 기관명이 가려졌을 수 있고, 그건 화면이 「직접 확인해 주세요」로 쓸
      // 종류의 사실입니다 → `Shortfall` 의 「무엇을 못 했는지는 숨기지 않습니다」
      ...(masked.orgGuardMissing ? ['no_org_allowlist'] : []),
    ],
  }

  // **토큰화가 끝난 뒤에 기관 이름을 고칩니다** → ADR-056.
  //
  // 이 자리인 이유는 경계 때문입니다 — 여기서부터 개인정보는 토큰이라
  // 밖으로 내보내도 [불변 규칙 2](../../CLAUDE.md)를 안 깨뜨립니다.
  // 기관명은 토큰화 제외 목록이라 평문 그대로 남아 있어 모델이 볼 수 있습니다.
  await repairOrgs(input.caseId, masked.lines, container)

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
  /** 토큰화하지 않을 낱말 — 기관명이 여기 들어옵니다 → `lib/allowed-terms.ts` */
  allowedTerms: readonly string[],
): Promise<{
  lines: { speaker: string | null; text: string; startMs: number | null }[]
  tokens: { token: string; kind: string }[]
  /**
   * **모델이 이름을 집는데 기관명을 지켜 줄 목록이 없었나.**
   * 둘이 겹칠 때만 위험합니다 → `pii-tokenizer` 의 `allowedTermsApplied`
   */
  orgGuardMissing: boolean
}> {
  const out: { speaker: string | null; text: string; startMs: number | null }[] = []
  const seen = new Map<string, string>()
  let orgGuardMissing = false

  let mappings: readonly { token: string; kind: string; value: string }[] = []

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
      // 앞 줄에서 만든 매핑을 이어 씁니다. 안 넘기면 일련번호가 리셋돼
      // 서로 다른 줄의 `[계좌-1]` 이 다른 계좌를 가리킵니다
      mappings: mappings as never,
    })
    mappings = result.mappings as never
    if (result.nerApplied && !result.allowedTermsApplied) orgGuardMissing = true
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
    orgGuardMissing,
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
