/**
 * citation-checker — 인용 셋을 확인하고, 근거가 없으면 되묻기로 넘길지 판정한다.
 *
 * 정본: spec/backend/08-16-chat-context.md §6.1 · §6.2 · §6.3
 * 근거: ADR-015 · ADR-028
 *
 * 이 모듈이 CLAUDE.md 불변 규칙 1(LLM 은 절차를 창작하지 않는다)을 실제로 집행한다.
 * 다만 「이번 답변이 절차를 말했는가」를 판정하지는 않는다 → README.
 */

import type {
  CitationChecker,
  CitationInput,
  CitationOutcome,
  Violation,
} from './types'

export function createCitationChecker(): CitationChecker {
  return {
    check(input: CitationInput): CitationOutcome {
      const { reply, issued, kbResultEmpty } = input

      // §6.2 의 3번을 먼저 본다. 모델이 근거 없음을 밝혔다면 형식을 따질 것이
      // 아니라 되묻기로 가야 한다 — 같은 프롬프트로 다시 불러도 같은 답이 온다 → §6.3
      if (reply.insufficient) {
        // 조회가 0건이면 슬롯을 채워도 나올 것이 없다. 절차를 말하지 않고 1332 로 보낸다
        return kbResultEmpty ? { kind: 'guide_1332' } : { kind: 'ask_slot' }
      }

      const issuedRefs = new Set(issued)
      const violations: Violation[] = []

      for (const citation of reply.citations) {
        const ref = citation.ref ?? ''

        // 1. 이번 턴에 발급한 번호인가
        if (!issuedRefs.has(ref)) {
          violations.push({ rule: 'unknown_ref', ref })
          continue
        }

        // 2. why 가 비어 있지 않은가. 내용이 맞는지는 기계로 확인할 수 없어
        //    형식 검사까지만 한다 → §5.1 · §6.2
        if (isBlank(citation.why)) {
          violations.push({ rule: 'why_empty', ref })
        }
      }

      if (violations.length > 0) {
        return { kind: 'retry', violations }
      }

      // 인용이 비어 있어도 여기로 온다. 「인용이 비면 에러」로 만들면
      // 인사말에도 발동한다 → §6.1
      return { kind: 'pass' }
    },
  }
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}
