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
 *
 * ## 모델을 부르는 일은 응답 뒤로 보냅니다 → ADR-086
 *
 * 이 요청 하나가 2026-09-06 배포본에서 **56~69초** 걸렸습니다. 줄마다 이름 탐지에
 * 더해 기관명 보정과 슬롯 추출(둘 다 모델 호출)이 같은 요청 안에서 돌았기
 * 때문입니다. `after()` 로 응답 뒤에 돌리고, 그 결과는 다음 번들 조회에서 보입니다.
 */

import { after } from 'next/server'

import { collectReading, startReading } from '@/flows/read-evidence'
import { CaseNotFoundError } from '@/lib/http'
import { caseIdOf, handleRoute, ulidParamOf } from '@/lib/request'

/**
 * `pending` 이 이만큼 지나도록 안 바뀌면 **완료 통지가 누락된 것**으로 봅니다.
 *
 * 정상 흐름은 올리고 몇 초 안에 `…/complete` 로 `processing` 이 되는데, 그 통지가
 * 화면 이동·네트워크로 빠지면 자료가 `pending` 에 영영 남습니다(2026-09-06 배포본
 * 점검에서 시연 자료 한 건이 그랬습니다). 아래에서 그때 완료 처리를 다시 태워
 * 판독을 깨웁니다. 값이 넉넉한 이유는 큰 파일 업로드가 진행 중인 정상 `pending` 을
 * 성급히 실패로 만들지 않기 위해서입니다 — 우리 자료는 몇 초면 올라갑니다.
 */
const STALE_PENDING_MS = 90_000

/**
 * 이 경로는 **전사 결과를 받아 토큰화하는 자리**라 다른 조회보다 오래 걸립니다
 * → ADR-086. 상한을 넘기면 이 응답에만 실리는 대응표를 통째로 잃습니다(ADR-062).
 */
export const maxDuration = 120

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

    // 아직 안 올라온 것은 읽을 것이 없습니다 — 물어보면 그대로 답합니다.
    if (found.ingestStatus === 'pending') {
      const ageMs = Date.now() - Date.parse(found.createdAt)

      // **오래 멈춘 `pending` 은 완료 통지가 누락된 것**이라 판독을 다시 깨웁니다.
      // `completeUpload`(→ `markUploaded`)는 `pending` 일 때만 옮기고, `startReading`
      // 은 전사기 잠금으로 두 번 돌지 않아(→ complete 라우트 주석) **다시 불러도
      // 안전**합니다. 파일이 저장소에 없으면 판독이 `failed` 로 떨어져 「대기 중」
      // 무한 루프를 벗어납니다(불변 규칙 5 — 막지 않고 갈림길로).
      if (Number.isFinite(ageMs) && ageMs > STALE_PENDING_MS) {
        const status = await container.caseIntake.completeUpload(caseId, evidenceId)
        await startReading(
          {
            caseId,
            evidenceId,
            objectKey: found.objectKey,
            kind: found.kind,
            mimeType: found.mimeType,
          },
          container,
        )
        return {
          body: {
            evidence_id: evidenceId,
            ingest_status: status,
            poll_after_ms: 1500,
          },
        }
      }

      return {
        body: {
          evidence_id: evidenceId,
          ingest_status: 'pending',
          poll_after_ms: 1500,
        },
      }
    }

    // 이미 저장돼 있으면 그것을 씁니다 — 다시 토큰화하면 번호가 달라져
    // 브라우저가 들고 있는 매핑과 어긋납니다
    const state = await collectReading(
      {
        caseId,
        evidenceId,
        kind: found.kind,
        // 글로 올린 자료는 **서버가 직접 읽습니다** — 전사기가 할 일이 없어
        // 그 몫이 흐름에 있습니다 (`flows/read-evidence.ts` 의 `readWritten`)
        objectKey: found.objectKey,
        // 팟이 결과를 버린 뒤 다시 맡길 때 씁니다 (`collectReading` 의 `missing`)
        mimeType: found.mimeType,
        stored: found.transcriptMasked,
      },
      container,
      // **기관명 보정과 슬롯 추출을 응답 뒤로 보냅니다** → ADR-086.
      // 여기가 `after` 를 아는 유일한 자리이고, 흐름은 「미룰 자리」만 압니다 —
      // 그래야 흐름 시험이 Next 런타임 없이 돕니다
      { defer: (work) => after(work) },
    )

    if (state.status === 'running') {
      return {
        body: {
          evidence_id: evidenceId,
          ingest_status: 'processing',
          progress: {
            phase: state.phase,
            percent: state.percent,
            // **서버에 닿지 못해 다시 맡기는 중** → ADR-091 §2. 없으면 칸을 아예 안 냅니다 — 옛 화면과 호환
            ...(state.retrying ? { retrying: true } : {}),
          },
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
        // **토큰화가 이 요청에서 막 일어났을 때만** 원문 포함 대응표를 건넵니다.
        // 다음 폴링부터는 저장된 것을 읽어 이 칸이 없습니다 — 서버는 원문을
        // 보관하지 않습니다(스키마 「원문 금지」· ADR-009). 받는 쪽(브라우저)이
        // 즉시 자기 열쇠로 잠가 볼트에 넣습니다 → ADR-062
        ...(state.freshMappings && state.freshMappings.length > 0
          ? {
              pii_mappings: state.freshMappings.map((one) => ({
                token: one.token,
                kind: one.kind,
                seq: one.seq,
                original: one.original ?? '',
              })),
            }
          : {}),
        // 기계가 못 읽은 것 — 화면이 「직접 확인해 주세요」로 씁니다
        shortfalls: state.shortfalls,
      },
    }
  })
}
