/**
 * citation-checker — 인용 넷을 확인하고, 근거가 없으면 되묻기로 넘길지 판정한다.
 *
 * 정본: spec/backend/08-16-chat-context.md §6.1 · §6.2 · §6.3
 * 근거: ADR-015 · ADR-021
 *
 * 이 모듈이 CLAUDE.md 불변 규칙 1(LLM 은 절차를 창작하지 않는다)을 실제로 집행한다.
 * 다만 「이번 답변이 절차를 말했는가」를 판정하지는 않는다 → README.
 */

import type {
  CitationChecker,
  CitationInput,
  CitationOutcome,
  IssuedRef,
  ModelCitation,
  Violation,
} from './contract'

export type {
  CitationChecker,
  CitationInput,
  CitationOutcome,
  IssuedRef,
  ModelCitation,
  ModelReply,
  Violation,
} from './contract'

export function createCitationChecker(): CitationChecker {
  return {
    check(input: CitationInput): CitationOutcome {
      const { reply, issued, kbResultEmpty } = input

      // §6.2 의 4번을 먼저 본다. 모델이 근거 없음을 밝혔다면 형식을 따질 것이
      // 아니라 되묻기로 가야 한다 — 같은 프롬프트로 다시 불러도 같은 답이 온다 → §6.3
      if (reply.insufficient) {
        // 조회가 0건이면 슬롯을 채워도 나올 것이 없다. 절차를 말하지 않고 1332 로 보낸다
        return kbResultEmpty ? { kind: 'guide_1332' } : { kind: 'ask_slot' }
      }

      const issuedByRef = new Map(issued.map((one) => [one.ref, one]))
      const violations: Violation[] = []

      for (const citation of reply.citations) {
        const ref = citation.ref ?? ''
        const source = issuedByRef.get(ref)

        // 1. 이번 턴에 발급한 번호인가
        if (!source) {
          // 발급하지 않은 번호는 대조할 원본이 없으므로 나머지 검사를 하지 않는다
          violations.push({ rule: 'unknown_ref', ref })
          continue
        }

        // 2. kb- 항목의 식별자가 발급한 값과 같은가.
        //    사건 정보(case-)와 전사(t-)는 지식 베이스 항목이 아니라 대조 대상이 아니다 → §5
        if (isKbEntry(source) && !identifiersMatch(source, citation)) {
          violations.push({ rule: 'citation_swapped', ref })
        }

        // 3. why 가 비어 있지 않은가. 내용이 맞는지는 기계로 확인할 수 없어
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

/**
 * 발급 정보에 kb_entry_id 가 있으면 절차 항목이다.
 *
 * ref 의 접두(`kb-`)로 가르지 않는 이유는, 서버가 발급할 때 붙인 사실이
 * 모델이 써 보낸 문자열보다 믿을 만하기 때문이다.
 */
function isKbEntry(source: IssuedRef): boolean {
  return source.kbEntryId !== undefined
}

/** 항목과 버전이 둘 다 발급한 값과 같아야 한다. 버전도 근거의 일부다 → §7.1 */
function identifiersMatch(source: IssuedRef, citation: ModelCitation): boolean {
  return (
    citation.kbEntryId === source.kbEntryId &&
    citation.kbVersion === source.kbVersion
  )
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === ''
}
