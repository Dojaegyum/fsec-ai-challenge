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
 * | `body` — 구조화된 데이터 · `legal_basis` | `body` — 문자열 |
 *
 * **어느 칸이 가는지는 11-chat-context.md §2.5 가 정합니다** (2026-09-06 · ADR-080).
 * 옮기는 것은 부르는 쪽인 이 파일입니다 — `kb-finder` 와 `chat-receiver` 는 서로를 모릅니다.
 *
 * ## 2026-09-06 까지는 `summary` 한 칸만 갔습니다
 *
 * 그래서 서류·수수료(`steps`)·자율배상 수치(`caveat`)·접수증(`required_artifact`)처럼
 * 사람이 KB 에 써 둔 지식을 챗이 「자료에 없다」고 답했습니다. **작업 패널은 같은 칸을
 * 그대로 그리는데 챗만 몰랐습니다.** 적용 절차에만 넉넉히 넣고 참고 절차는 요약만
 * 두는 이유는 크기입니다 — 참고 절차는 다른 유형의 것이라 스무 개가 넘고, 그쪽까지
 * 넣으면 한 턴 입력이 3,000 토큰 가까이 늘어납니다(적용 절차만은 약 950 토큰).
 *
 * **`caveat` 은 예외입니다 — 참고 절차에도 갑니다** (2026-09-06 · ADR-084). 채널이
 * 아직 정해지지 않은 사건의 챗이 「자율배상 얼마나 받나」에 「안내할 수치가 없다」고
 * 답했는데, 그 41건·0.1%·평균 116일(불변 규칙 8)은 참고 절차 행의 `caveat` 에 있었습니다.
 * 참고 절차 스무 개 중 `caveat` 이 있는 것은 넷뿐이라 늘어나는 입력은 200 토큰 안입니다.
 *
 * **연락처와 `deadline` 은 여기서도 안 나갑니다.** 번호는 09-data-model.md §11.4.4 가
 * 막혔을 때만 주기로 했고, 기한은 계산기의 것이라 문장은 `summary` 가 맡습니다
 * (RFC-002 「적재 전 자기점검」). `steps[].contact_ref`·`url` 도 글자로 뜻이 없어 뺍니다.
 */
export type KbGroup = 'applied' | 'reference'

export function kbRowToPromptEntry(row: KbRow, group: KbGroup): KbEntry {
  const body = (typeof row.body === 'object' && row.body !== null ? row.body : {}) as {
    summary?: unknown
    steps?: unknown
    caveat?: unknown
    required_artifact?: unknown
  }

  const lines: string[] = []
  const summary = text(body.summary)
  if (summary) lines.push(summary)

  if (group === 'applied') {
    // 「서류는 뭘 내야 하나요」「수수료 있어요」의 답이 여기 있습니다
    const steps = Array.isArray(body.steps)
      ? body.steps
          .map((one) => text((one as { text?: unknown } | null)?.text))
          .filter((one): one is string => one !== null)
      : []
    if (steps.length > 0) {
      lines.push(`할 일: ${steps.map((one, index) => `${index + 1}) ${one}`).join(' ')}`)
    }

    // 지시문 3)「OO이 오면 올려주세요」가 여기서 근거를 얻습니다 — 없으면 모델은
    // 무엇을 올리라고 할지 모릅니다(완료는 부산물로 판정 · 불변 규칙 6)
    const artifact = text((body.required_artifact as { label?: unknown } | null | undefined)?.label)
    if (artifact) lines.push(`남기는 것: ${artifact}`)

  }

  // 기대치를 낮추는 말 — 자율배상 41건·0.1%·116일이 여기 있습니다 (불변 규칙 8).
  // 참고 절차에도 보낸다 → ADR-084. 채널이 아직 정해지지 않은 사건의 챗도 이 수치를 봐야 한다
  const caveat = text(body.caveat)
  if (caveat) lines.push(`주의: ${caveat}`)

  if (group === 'applied') {
    // 「무슨 법이에요」— 인용 카드에만 붙던 조문을 모델도 봅니다
    const basis = text(row.legalBasis)
    if (basis) lines.push(`근거: ${basis}`)
  }

  return {
    kbEntryId: row.kbEntryId,
    kbVersion: row.kbVersion,
    label: row.title,
    body: lines.join('\n'),
    // 참고 절차에만 붙습니다. 조건 라벨을 붙일 근거가 됩니다 → 11-chat-context.md §2.3
    ...(row.channelId ? { channelId: row.channelId } : {}),
  }
}

/** 문자열이고 비어 있지 않을 때만 — 「null」「undefined」가 글자로 새지 않게 */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** `kb-finder` 를 `chat-receiver` 의 `kb` 자리에 넣을 수 있게 감쌉니다 */
export function asKbSource(finder: KbFinder): KbSource {
  return {
    async find(query) {
      const groups = await finder.find(query)
      return {
        applied: groups.applied.map((row) => kbRowToPromptEntry(row, 'applied')),
        reference: groups.reference.map((row) => kbRowToPromptEntry(row, 'reference')),
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
