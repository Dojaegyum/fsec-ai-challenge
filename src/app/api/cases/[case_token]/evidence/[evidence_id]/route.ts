/**
 * `GET /api/cases/{case_token}/evidence/{evidence_id}` — 전사·판독 진행 상태.
 *
 * 정본: spec/common/08-14-api.md §3.3
 * 근거: ADR-028 · ADR-039(주소는 링크 토큰) · 04-pii-boundary.md 규칙 2
 *
 * ## 왜 폴링인가
 *
 * 서버 함수는 몇 분을 못 삽니다. 전사는 몇 분이 걸립니다. 그래서 **맡기고
 * 나중에 물어보는 모양**이고, 계약이 이미 그렇게 적혀 있습니다 —
 * 응답에 `poll_after_ms` 가 붙는 이유입니다.
 *
 * ## ⚠️ 내려가는 글은 토큰화된 것입니다
 *
 * *"`transcript` 는 토큰화된 상태로 내려갑니다"*(§3.3). 원문 복원은
 * **브라우저가 자기 매핑으로** 합니다 — 서버에는 복호화 키가 없습니다
 * → 04-pii-boundary.md 규칙 3.
 */

import { collectReading } from '@/flows/read-evidence'
import { CaseNotFoundError } from '@/lib/http'
import { caseIdOf, handleRoute, ulidParamOf } from '@/lib/request'

export async function GET(
  request: Request,
  route: { params: Promise<{ case_token: string; evidence_id: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    // 조회가 신분 확인입니다 → ADR-039. 없으면 404 이고 그 404 는 IP 로 셉니다
    const caseId = await caseIdOf(route, container.caseTokens)
    const evidenceId = await ulidParamOf(route, 'evidence_id')

    // **사건과 함께 찾습니다.** 증거 번호만으로 찾으면 남의 사건 증거를
    // 자기 주소로 열 수 있습니다 — 증거 번호는 비밀이 아닙니다
    const found = await container.evidence.read(caseId, evidenceId)
    if (!found) throw new CaseNotFoundError('그 증거를 찾지 못했습니다')

    // 아직 안 올라온 것은 읽을 것이 없습니다 — 물어보면 그대로 답합니다
    if (found.ingestStatus === 'pending') {
      return {
        body: {
          evidence_id: evidenceId,
          ingest_status: 'pending',
          poll_after_ms: 1500,
        },
      }
    }

    const state = await collectReading({ evidenceId, kind: found.kind }, container)

    if (state.status === 'running') {
      return {
        body: {
          evidence_id: evidenceId,
          ingest_status: 'processing',
          progress: { phase: state.phase, percent: state.percent },
          // 이게 없으면 화면이 언제 다시 물을지 모릅니다 → §3.3
          poll_after_ms: state.pollAfterMs,
        },
      }
    }

    if (state.status === 'failed') {
      // **200 입니다.** 못 읽은 것은 정상 상태이고, 500 을 내면 화면이
      // 「다시 시도」를 띄웁니다 → 불변 규칙 5 · 08-16-errors.md §2
      return {
        body: {
          evidence_id: evidenceId,
          ingest_status: 'failed',
          reason: state.reason,
        },
      }
    }

    return {
      body: {
        evidence_id: evidenceId,
        ingest_status: 'done',
        // 토큰화된 상태입니다. 브라우저가 자기 매핑으로 복원합니다
        transcript: state.lines.map((one) => ({
          speaker: one.speaker,
          text: one.text,
          start_ms: one.startMs,
        })),
        // 어떤 토큰이 있는지만. **원문을 담지 않습니다**
        pii_tokens: state.tokens.map((one) => ({ token: one.token, kind: one.kind })),
        // 기계가 못 읽은 것 — 화면이 「직접 확인해 주세요」로 씁니다
        shortfalls: state.shortfalls,
      },
    }
  })
}
