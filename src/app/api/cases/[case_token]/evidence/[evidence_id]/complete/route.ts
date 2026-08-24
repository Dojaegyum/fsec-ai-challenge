/**
 * `POST /api/cases/{case_token}/evidence/{evidence_id}/complete` — 업로드 완료 통지.
 *
 * 정본: spec/common/08-14-api.md §3.2 3단계
 * 근거: ADR-028 · ADR-039(주소는 링크 토큰)
 *
 * ## 왜 브라우저가 따로 알려 줘야 하나
 *
 * 파일이 우리를 통과하지 않으므로(§3.2) **올라간 것을 우리가 알 방법이 없습니다.**
 * 저장소가 알려 주는 길을 붙이면 그쪽 설정에 매이고, 폴링하면 서버 함수가
 * 그 시간만큼 살아 있어야 합니다.
 *
 * ## 두 번 와도 됩니다
 *
 * 네트워크가 흔들리면 브라우저가 다시 보냅니다. `markUploaded` 가
 * `pending` 일 때만 옮기므로 **이미 처리 중인 것을 되돌리지 않습니다**
 * → `lib/db.ts`.
 *
 * **읽기도 마찬가지여야 합니다** → ADR-051. 사건 행만 멱등이고 아래 `startReading` 은
 * 부를 때마다 도는 상태였습니다 — 같은 파일을 다시 내려받아 모델을 다시
 * 돌렸습니다. 접수 쪽에서 막습니다 → `services/transcriber/jobs.py` 의
 * `create` 가 「이번에 열렸는가」를 잠금 안에서 답하고, 안 열렸으면 돌리지
 * 않습니다. **상한으로는 못 막는 자리입니다** — 분당 10회를 걸어도 10번 돕니다.
 *
 * ## 창으로 세지 않습니다 — `rate: 'none'` (ADR-051)
 *
 * §1.3 표에 이 자리가 없습니다. **안 적으면 빠뜨린 것과 구분되지 않아** 밝혀 둡니다.
 */

import { startReading } from '@/flows/read-evidence'
import { caseIdOf, handleRoute, ulidParamOf } from '@/lib/request'

export async function POST(
  request: Request,
  route: { params: Promise<{ case_token: string; evidence_id: string }> },
) {
  return handleRoute(request, async (ctx) => {
    const { container } = ctx
    const caseId = await caseIdOf(route, container.caseTokens)
    const evidenceId = await ulidParamOf(route, 'evidence_id')

    const status = await container.caseIntake.completeUpload(caseId, evidenceId)

    // **여기서 읽기를 맡깁니다.** 결과를 기다리지 않습니다 — 서버 함수가
    // 몇 분을 못 살고, 화면은 §3.3 으로 물어봅니다.
    // 작업 번호로 증거 번호를 그대로 쓰므로 어디에도 적어 둘 필요가 없습니다
    const found = await container.evidence.read(caseId, evidenceId)
    if (found) {
      await startReading(
        {
          evidenceId,
          objectKey: found.objectKey,
          kind: found.kind,
          mimeType: found.mimeType,
        },
        container,
      )
    }

    return {
      // 202 — 접수했고 아직 안 끝났습니다. 진행 상태는 §3.3 으로 묻습니다
      status: 202,
      body: { evidence_id: evidenceId, ingest_status: status },
    }
  }, { rate: 'none' })
}
