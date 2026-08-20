/**
 * 모듈끼리 모양이 안 맞는 자리를 이어 주는 얇은 어댑터들.
 *
 * **여기 있는 것은 전부 「타입이 실제로 안 맞아서」 필요한 것입니다.**
 * 확인용 파일을 만들어 `tsc` 로 직접 확인했습니다 (2026-08-20) —
 * 무보정으로 넣으면 셋 다 컴파일이 깨집니다.
 *
 * **자동 변환을 쓰지 않습니다.** 손으로 적어야 새 필드가 저절로 새 나가지 않습니다.
 */

import 'server-only'

import { AppError } from './errors'

import type { AuditEvent, AuditLogger } from '@/modules/audit-logger'
import type { AuditSink } from '@/modules/case-purger'
import type { KbEntry, KbSource, RetryJudge } from '@/modules/chat-receiver'
import type { KbFinder, KbRow } from '@/modules/kb-finder'
import type { KbStep } from '@/modules/planner'
import type { RetryChecker } from '@/modules/retry-checker'

/**
 * 감사 기록 — 돌려주는 것이 다릅니다.
 *
 * `audit-logger` 는 남긴 기록을 돌려주고(`Promise<AuditRecord>`),
 * `case-purger` 는 아무것도 안 받습니다(`Promise<void>`).
 * TypeScript 는 `Promise<void>` 자리에 값을 돌려주는 함수를 허용하지 않습니다.
 *
 * **파기 쪽이 기록을 안 받는 것이 맞습니다** — 받아 봐야 할 일이 없고,
 * 받으면 그 값으로 뭔가 하려는 코드가 생깁니다.
 */
export function asAuditSink(logger: AuditLogger): AuditSink {
  return {
    async record(event) {
      await logger.record(event as AuditEvent)
    },
  }
}

/**
 * 재시도 판단 — 인자의 넓이가 서로 반대입니다.
 *
 * | | `retry-checker` | `chat-receiver` 가 요구 |
 * | --- | --- | --- |
 * | `error` | `AppError` (좁음) | `unknown` (넓음) |
 * | `lane` | 여러 갈래 (넓음) | `'interactive'` (좁음) |
 *
 * 양방향 모두 대입이 안 됩니다. 여기서 좁혀 넘깁니다.
 *
 * **우리 예외가 아니면 재시도하지 않습니다.** `retry-checker` 는 `retryable`
 * 하나만 보고 판단하는데, 그 값이 없는 예외는 판단할 근거가 없습니다 —
 * 「표에 없는 예외는 재시도하지 않는다」와 같은 논리입니다.
 */
export function asRetryJudge(checker: RetryChecker): RetryJudge {
  return {
    decide(input) {
      if (!(input.error instanceof AppError)) {
        return { retry: false }
      }
      return checker.decide({
        error: input.error,
        attempts: input.attempts,
        elapsedMs: input.elapsedMs,
        lane: input.lane,
      })
    },
  }
}

/**
 * KB 항목 — 표의 행과 프롬프트 항목은 모양이 다릅니다.
 *
 * | 표(`kb_entry`) | 프롬프트 |
 * | --- | --- |
 * | `title` | `label` |
 * | `body` — 구조화된 데이터 | `body` — 문자열 |
 *
 * ⬜ **누가 옮기는지 정본에 없습니다.** 지금은 부르는 쪽(여기)이 합니다 →
 * `src/modules/chat-receiver/README.md` 「아직 아닌 것」.
 *
 * `summary` 만 옮기는 이유는 그것이 절차 한 단계를 한 문장으로 말한 것이기
 * 때문입니다. `steps[]` 까지 통째로 넣으면 프롬프트가 커지고, 연락처는
 * `contact_ref` 로 가리키기만 해서 그대로는 뜻이 없습니다
 * → 09-data-model.md §11.4.1.
 */
export function kbRowToPromptEntry(row: KbRow): KbEntry {
  const body = row.body as { summary?: unknown } | null
  return {
    kbEntryId: row.kbEntryId,
    kbVersion: row.kbVersion,
    label: row.title,
    body: typeof body?.summary === 'string' ? body.summary : '',
    // 참고 절차에만 붙습니다. 조건 라벨을 붙일 근거가 됩니다 → 11-chat-context.md §2.3
    ...(row.channelId ? { channelId: row.channelId } : {}),
  }
}

/** `kb-finder` 를 `chat-receiver` 의 `kb` 자리에 넣을 수 있게 감쌉니다 */
export function asKbSource(finder: KbFinder): KbSource {
  return {
    async find(query) {
      const groups = await finder.find(query)
      return {
        applied: groups.applied.map(kbRowToPromptEntry),
        reference: groups.reference.map(kbRowToPromptEntry),
      }
    },
  }
}

/**
 * KB 항목 — 표의 행을 플랜 생성이 받는 모양으로.
 *
 * 이쪽은 `body` 를 **그대로** 넘깁니다. 플랜 생성은 활성 조건(`requiresSlots`·
 * `after`·`actor`)을 읽어야 하고, 나머지 본문은 손대지 않고 `plan_step.body` 로
 * 옮기기 때문입니다 → `src/modules/planner/README.md`.
 */
export function kbRowToPlanStep(row: KbRow): KbStep {
  return {
    kbEntryId: row.kbEntryId,
    kbVersion: row.kbVersion,
    stepKey: row.stepKey,
    stepSeq: row.stepSeq,
    channelId: row.channelId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    effectiveFrom: row.effectiveFrom,
    body: (row.body ?? {}) as KbStep['body'],
  }
}
