/**
 * 판독을 기다리던 부산물을 다시 판정한다 → ADR-077.
 *
 * 정본: spec/backend/08-14-completion-hook.md ② · spec/backend/08-16-data-model.md §7 ·
 *       spec/common/08-14-api.md §3.8
 * 근거: CLAUDE.md 불변 규칙 6(완료는 부산물로) · ADR-077(L2 는 판독 결과를 본다)
 *
 * ## 왜 두 자리에서 판정하나
 *
 * 파일로 낸 부산물(`receipt_doc`·`sms_capture`)은 **올린 순간 판독이 안 끝나 있습니다** —
 * 전사·OCR 은 몇 초에서 몇 분이 걸리고, 화면은 §3.3 폴링으로 그 끝을 봅니다.
 * 그래서 라우트(§3.8)는 그때 볼 수 있는 것만 보고 `reading_pending` 으로 적어 두고,
 * **읽기가 끝난 자리**(`flows/read-evidence.ts` 의 `collectReading`)가 여기를 불러
 * 미뤄 둔 판정을 마칩니다.
 *
 * 통과하면 라우트가 했을 일을 **그대로** 합니다 — 단계 완료 · 기산점 · 기한 닫기 ·
 * 플랜 재생성. 두 자리가 다르게 굴면 「올린 직후 판독이 끝나 있던 경우」와
 * 「나중에 끝난 경우」의 결과가 갈립니다.
 *
 * ## 실패해도 전사 결과를 잃지 않는다
 *
 * 부르는 쪽이 삼킵니다. 여기서 던지면 `collectReading` 의 저장(`finish`) 뒤라
 * 결과는 남지만 응답이 500 이 되고, 화면은 「다시 시도」를 띄웁니다 — 판정 하나가
 * 읽기 전체를 실패로 보이게 할 이유가 없습니다 → 불변 규칙 5.
 */

import 'server-only'

import type { Container } from '@/lib/container'

import type { EvidenceReading, StepState } from '@/modules/completion-checker'

import { anchorFromArtifact } from './anchor-from-artifact'
import { regeneratePlan } from './regenerate-plan'

/** `evidence` 표 한 줄 중 판정이 보는 것 — `EvidenceReader.read` 의 부분집합 */
export interface EvidenceRowForVerify {
  readonly kind: EvidenceReading['kind']
  readonly ingestStatus: EvidenceReading['ingestStatus']
  /** 다 읽었으면 저장된 JSON(`{ lines, tokens, shortfalls }`). 아직이면 `null` */
  readonly transcriptMasked: string | null
}

/**
 * 저장된 판독 결과를 판정이 보는 모양으로.
 *
 * `transcript_masked` 는 구조를 담은 JSON 입니다(`read-evidence.ts` 의 `finish`).
 * 줄을 이어 한 글로 만듭니다 — 접수번호 자리와 번호가 다른 줄에 있을 수 있어서
 * (OCR 이 표를 줄 단위로 냅니다) 줄 사이는 줄바꿈으로 잇습니다.
 *
 * 못 읽는 JSON 이면 **빈 글이 아니라 `null`** 입니다 — 빈 글은 「다 읽었는데 아무것도
 * 없다」(확인 못 함)이고, 못 읽은 것은 「볼 것이 없다」(미룸)라 뜻이 다릅니다.
 */
export function evidenceReadingOf(row: EvidenceRowForVerify | null): EvidenceReading | null {
  if (row === null) return null
  return { kind: row.kind, ingestStatus: row.ingestStatus, text: transcriptText(row.transcriptMasked) }
}

function transcriptText(stored: string | null): string | null {
  if (stored === null) return null
  try {
    const parsed = JSON.parse(stored) as { lines?: readonly { text?: unknown }[] }
    const lines = Array.isArray(parsed.lines) ? parsed.lines : []
    return lines
      .map((one) => (typeof one.text === 'string' ? one.text : ''))
      .filter((one) => one.length > 0)
      .join('\n')
  } catch {
    return null
  }
}

/**
 * 판정이 볼 공공기관 이름 → `org_public`. **못 가져오면 빈 목록입니다** —
 * 접수번호 자리는 목록 없이도 보고, 목록은 판정의 부속이지 판정 자체가 아닙니다
 * (`lib/allowed-terms.ts` 의 같은 저울). 은행 이름은 넣지 않습니다 — 이체 캡처에도 있습니다.
 */
export async function publicOrgNamesFor(
  container: Pick<Container, 'channelWrite'> & { readonly ports: Pick<Container['ports'], 'kbVersion'> },
): Promise<readonly string[]> {
  try {
    const version = await container.ports.kbVersion.current()
    return await container.channelWrite.allPublicNames(version)
  } catch {
    return []
  }
}

export interface SettledArtifact {
  readonly artifactId: string
  readonly planStepId: string
  readonly stepState: StepState
}

/**
 * 그 자료의 판독을 기다리던 부산물을 전부 다시 판정한다.
 *
 * @returns 판정을 마친 것들. 아직 읽는 중이면 빈 배열
 */
export async function settleArtifacts(input: {
  readonly caseId: string
  readonly evidenceId: string
  readonly container: Container
}): Promise<readonly SettledArtifact[]> {
  const { caseId, evidenceId, container } = input

  const pending = await container.artifacts.pendingFor(caseId, evidenceId)
  // 기다리는 것이 없으면 자료를 읽지도 않습니다 — 대부분의 폴링이 이 길입니다
  if (pending.length === 0) return []

  const found = await container.evidence.read(caseId, evidenceId)
  const evidence = evidenceReadingOf(found)
  const orgNames = await publicOrgNamesFor(container)

  const out: SettledArtifact[] = []
  let completed = false
  // 단계 이름은 기산점 표(`anchor-from-artifact`)가 봅니다. 한 번만 읽습니다
  let steps: readonly { planStepId: string; stepKey: string }[] | null = null

  for (const one of pending) {
    if (one.kind !== 'receipt_doc' && one.kind !== 'sms_capture') continue

    const verdict = container.completionChecker.verify({
      submission: { kind: one.kind, evidenceId },
      evidence,
      orgNames,
    })
    // 아직 읽는 중이면 그대로 둡니다 — 다음 폴링이 다시 옵니다
    if (verdict.verifyDetail?.reason === 'reading_pending') continue

    await container.artifacts.settle({
      artifactId: one.artifactId,
      verifyResult: verdict.verifyResult,
      // **어느 자료였는지는 그대로 남깁니다.** 통과 이유와 함께 「무엇으로 통과했나」를
      // 나중에 셀 값입니다. 증거 번호는 개인정보가 아닙니다 (§7 · 라우트와 같은 모양)
      verifyDetail: { ...(verdict.verifyDetail ?? {}), evidence_id: evidenceId },
    })
    await container.artifacts.markStep(caseId, one.planStepId, verdict.stepState)

    if (verdict.stepState === 'done_verified') {
      steps ??= await container.ports.casePlan.readSteps(caseId)
      const stepKey = steps.find((step) => step.planStepId === one.planStepId)?.stepKey
      // ── 라우트(§3.8)와 같은 순서입니다 — 기산점 → 기한 닫기 → (아래) 플랜 재생성 ──
      if (stepKey) await anchorFromArtifact({ caseId, stepKey, container }).catch(() => null)
      await container.deadlineWrite.markMet(caseId, one.planStepId).catch(() => 0)
      completed = true
    }

    out.push({ artifactId: one.artifactId, planStepId: one.planStepId, stepState: verdict.stepState })
  }

  // **완료된 것이 있을 때만, 한 번만** 다시 만듭니다 — `after` 로 묶인 다음 단계가
  // 여기서 열리고, 기한도 이 안에서 다시 섭니다 (라우트의 같은 자리 참고)
  if (completed) {
    await regeneratePlan(caseId, {
      container,
      store: container.ports.casePlan,
      kbVersion: container.ports.kbVersion,
    }).catch(() => null)
  }

  return out
}
