/**
 * `POST /api/cases/{case_token}/steps/{step_id}/artifacts` — 단계의 부산물.
 *
 * 정본: spec/common/08-14-api.md §3.8 · spec/backend/08-14-completion-hook.md
 * 근거: CLAUDE.md 불변 규칙 6(완료는 사용자의 체크가 아니라 부산물로 판정) ·
 *       ADR-040(쓰기도 경계를 지난다)
 *
 * ## 검증 실패는 오류가 아닙니다
 *
 * L1 을 통과하지 못해도 **200 입니다.** 접수번호 형식이 안 맞는 것은
 * 시스템 오류가 아니라 사용자에게 알려 줄 사실이고, 그때 **다른 길(L2·L3)을
 * 함께 냅니다** — 막히면 사용자가 사건을 포기합니다.
 *
 * ❌ **접수번호 형식의 정본은 없습니다**(U-18) — 그리고 기다리지 않기로 했습니다
 * → ADR-057. `receipt_no` 는 이제 **모양만 봅니다**: 구분자를 뗀 영숫자 6자 이상에
 * 숫자가 하나라도 있으면 통과하고, `verify_detail.reason` 에 `format_unchecked`
 * 가 남습니다. **아무 글자나 통과시키지는 않습니다** — 「ㅇㅇ」·「9」는 걸립니다.
 *
 * ## 창으로 세지 않습니다 — `rate: 'none'`
 *
 * §1.3 표에 이 자리가 없습니다. 사람이 접수번호를 받아 적어 넣는 자리라 연타가
 * 안 나옵니다. **안 적으면 빠뜨린 것과 구분되지 않아** 밝혀 둡니다.
 */

import { BadRequestError, readJsonObject } from '@/lib/http'
import { caseIdOf, handleRoute, ulidParamOf } from '@/lib/request'
import { newUlid } from '@/lib/ids'

import { anchorFromArtifact } from '@/flows/anchor-from-artifact'
import { regeneratePlan } from '@/flows/regenerate-plan'

import type { ArtifactSubmission } from '@/modules/completion-checker'

interface ArtifactBody {
  readonly kind?: unknown
  readonly value?: unknown
  readonly evidence_id?: unknown
  readonly self_reported?: unknown
}

/** §3.8 이 정한 셋 */
function readSubmission(body: ArtifactBody): ArtifactSubmission {
  const kind = body.kind

  if (kind === 'receipt_no') {
    if (typeof body.value !== 'string' || body.value.trim().length === 0) {
      throw new BadRequestError('value 가 없습니다', { param: 'value' })
    }
    return { kind: 'receipt_no', value: body.value }
  }

  if (kind === 'sms_capture' || kind === 'receipt_doc') {
    if (typeof body.evidence_id !== 'string') {
      throw new BadRequestError('evidence_id 가 없습니다', { param: 'evidence_id' })
    }
    return { kind, evidenceId: body.evidence_id }
  }

  if (kind === 'other') {
    if (body.self_reported !== true) {
      throw new BadRequestError('self_reported 가 true 여야 합니다', {
        param: 'self_reported',
      })
    }
    return { kind: 'other', selfReported: true }
  }

  // ⚠️ **받은 값을 detail 에 넣지 않습니다** — 감사 기록으로 갑니다
  throw new BadRequestError('kind 값이 목록 밖입니다', {
    param: 'kind',
    allowed: ['receipt_no', 'sms_capture', 'receipt_doc', 'other'],
  })
}

export async function POST(
  request: Request,
  route: { params: Promise<{ case_token: string; step_id: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)
    const stepId = await ulidParamOf(route, 'step_id')

    const submission = readSubmission(await readJsonObject<ArtifactBody>(ctx.request))
    const verdict = container.completionChecker.verify({ submission })

    // ── 경계 ─────────────────────────────────────────────────────────
    // 접수번호에 개인정보가 섞여 들어올 수 있습니다 → ADR-040.
    // 파일로 올린 것은 값이 없습니다 — 그쪽은 이미 전사 경로가 다뤘습니다
    const raw = submission.kind === 'receipt_no' ? submission.value : null
    const valueMasked =
      raw === null ? null : (await container.piiTokenizer.tokenize(raw)).masked

    const artifactId = newUlid()
    await container.artifacts.write({
      artifactId,
      caseId,
      planStepId: stepId,
      kind: submission.kind,
      valueMasked,
      objectKey: null,
      verifyLevel: verdict.verifyLevel,
      verifyResult: verdict.verifyResult,
      verifyDetail: verdict.verifyDetail ? { ...verdict.verifyDetail } : null,
    })

    // 단계가 이 사건 것이 아니면 안 옮겨집니다 — 남의 단계를 완료 처리할 수 없습니다
    await container.artifacts.markStep(caseId, stepId, verdict.stepState)

    // ── 증거 연쇄 → 05-completion-hook.md ① ───────────────────────────
    //
    // **부산물이 다음 단계의 입력입니다.** KB 가 `after` 로 「저 단계가
    // 끝나야 이 단계가 열린다」를 적어 두는데, 그 판정을 하는 것이 플랜
    // 생성기입니다 — 다시 만들지 않으면 방금 열린 단계가 안 나타납니다.
    //
    // 2026-08-25 실측: 지급정지를 `done_verified` 로 만들어도 피해구제
    // 신청 단계가 플랜에 안 붙었습니다. **그 뒤에 붙는 3영업일 기한도
    // 따라서 영영 안 생깁니다** — 이 서비스가 막으려는 바로 그 실패입니다.
    //
    // 기한도 여기서 함께 다시 계산됩니다(`regeneratePlan` 안).
    const stored = await container.ports.casePlan.readSteps(caseId)
    const before = new Set(stored.map((one) => one.stepKey))

    // ── 기산점 → 08-14-completion-hook.md ① ──────────────────────────
    //
    // **부산물이 기한의 기산점을 남깁니다.** 이 줄이 없어서 `GET …/deadlines`
    // 가 모든 경로에서 빈 배열이었습니다 — KB 가 기산점으로 쓰는 슬롯 둘을
    // 아무도 안 채우고 있었습니다 (2026-08-27 걸어서 확인).
    //
    // `regeneratePlan` **앞**입니다. 기한 계산이 그 안에서 돌기 때문에,
    // 뒤에 두면 기한이 한 번 늦게 섭니다.
    if (verdict.stepState === 'done_verified') {
      const stepKey = stored.find((one) => one.planStepId === stepId)?.stepKey
      if (stepKey) {
        await anchorFromArtifact({ caseId, stepKey, container }).catch(() => null)
      }
    }

    const unlocked =
      // **완료로 판정됐을 때만 돕니다.** L3 자기신고(`unconfirmed`)는 「했다」의
      // 근거가 아니라, 그것으로 다음 단계를 열면 증거 연쇄가 무너집니다
      verdict.stepState === 'done_verified'
        ? (await regeneratePlan(caseId, {
            container,
            store: container.ports.casePlan,
            kbVersion: container.ports.kbVersion,
          }).catch(() => null))
        : null

    const unlockedSteps = (unlocked?.steps ?? [])
      .filter((one) => !before.has(one.stepKey))
      .map((one) => ({
        step_id: one.planStepId,
        title: one.title,
        // **왜 열렸는지**를 말합니다 — 증거 연쇄를 사용자가 이해하게 만드는 것이
        // 이 칸의 목적입니다 (§3.8). 근거는 KB 가 적어 둔 요약입니다
        reason: typeof one.body.summary === 'string' ? one.body.summary : one.title,
      }))

    return {
      body: {
        artifact_id: artifactId,
        verify_level: verdict.verifyLevel,
        verify_result: verdict.verifyResult,
        step_state: verdict.stepState,
        ...(verdict.verifyDetail ? { verify_detail: verdict.verifyDetail } : {}),
        // **막히지 않게 다음 길을 함께 냅니다** → 08-14-completion-hook.md
        ...(verdict.nextOptions ? { next_options: verdict.nextOptions } : {}),
        // **증거 연쇄를 보여줍니다** → §3.8. 부산물이 다음 단계의 입력이
        // 되는 구조를 사용자가 이해하게 만드는 칸입니다
        unlocked_steps: unlockedSteps,
      },
    }
  }, { rate: 'none' })
}
