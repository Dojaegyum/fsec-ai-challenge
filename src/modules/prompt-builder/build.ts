/**
 * prompt-builder — 7블록을 순서대로 조립하고 비신뢰 블록에 격리 태그를 씌운다.
 *
 * 정본: spec/backend/08-17-system-prompt.md (지시문·블록 순서)
 *       spec/backend/08-16-chat-context.md §3 §4
 * 근거: ADR-013 · ADR-015 · ADR-028
 *
 * 이 모듈은 문자열 두 개와 발급 목록을 만들 뿐입니다.
 * 조회도, 모델 호출도, 토큰화도, 날짜 계산도 하지 않습니다.
 */

import type {
  BlockRenderer,
  BuiltPrompt,
  CaseStateItem,
  HistoryTurn,
  IssuedRef,
  KbEntryForPrompt,
  PromptBlock,
  PromptBuilder,
  PromptInput,
  PromptItem,
  TalkLine,
} from './types'
import { createXmlRenderer } from './xml-renderer'
import { OUTPUT_FORMAT, SYSTEM_PROMPT } from './system-prompt'

export function createPromptBuilder(
  deps: { renderer?: BlockRenderer } = {},
): PromptBuilder {
  const renderer = deps.renderer ?? createXmlRenderer()

  return {
    build(input: PromptInput): BuiltPrompt {
      const issued: IssuedRef[] = []

      // 참조 번호를 참고 절차부터 매긴다.
      //
      // 프롬프트에 먼저 나오는(=덜 바뀌는) 블록에 낮은 번호를 준다. 적용 절차부터
      // 매기면 그쪽 항목이 하나 늘 때마다 참고 절차의 번호가 전부 밀려, 앞부분이
      // 통째로 달라지고 캐시가 깨진다 → 08-17-system-prompt.md 「캐싱이 구조를 정했습니다」.
      const reference = kbBlock('kb_reference', input.kbReference, issued)
      const applied = kbBlock('kb_applied', input.kbApplied, issued)
      const talk = caseTalkBlock(input.caseTalk, issued)
      const state = caseStateBlock(input.caseState, issued)
      const history = historyBlock(input.history)

      const sections: string[] = ['# 5. 답변에 필요한 절차·사건 정보·대화']

      // 비어 있는 블록은 제목째 뺀다. 빈 태그를 넣으면 모델이
      // "자료가 있는데 비었다"로 읽는다
      addSection(sections, '## 참고 절차', reference, renderer)
      addSection(sections, '## 적용 절차', applied, renderer)
      addSection(sections, '## 사건 대화', talk, renderer)
      addSection(sections, '## 사건 정보', state, renderer)

      // 날짜는 블록이 아니라 한 줄이다. 사건 정보가 비어도 넣는다 —
      // 오늘이 며칠인지는 언제나 알아야 한다
      sections.push('', `현재 날짜: ${input.currentDate}`)

      addSection(sections, '## [대화 내역]', history, renderer)

      sections.push('', OUTPUT_FORMAT)

      return {
        system: SYSTEM_PROMPT,
        user: sections.join('\n'),
        issued,
        counts: {
          applied: input.kbApplied.length,
          reference: input.kbReference.length,
          talkLines: input.caseTalk.length,
          historyTurns: input.history.length,
        },
      }
    },
  }
}

function addSection(
  out: string[],
  heading: string,
  block: PromptBlock | null,
  renderer: BlockRenderer,
): void {
  if (!block) return
  out.push('', heading, '', renderer.render(block))
}

/**
 * 절차 블록. 적용·참고가 번호를 나눠 쓴다 —
 * 허용 집합이 둘의 합집합이라 겹치면 안 된다 → 08-16-chat-context.md §6.2.
 */
function kbBlock(
  tag: string,
  entries: readonly KbEntryForPrompt[],
  issued: IssuedRef[],
): PromptBlock | null {
  if (entries.length === 0) return null

  const items: PromptItem[] = entries.map((entry) => {
    const ref = `kb-${countOf(issued, 'kb-') + 1}`
    issued.push({
      ref,
      label: entry.label,
      kbEntryId: entry.kbEntryId,
      kbVersion: entry.kbVersion,
    })

    const attrs: Record<string, string> = { ref, label: entry.label }
    // 참고 절차에만 붙는다. 조건 라벨을 붙일 근거가 된다 → §2.3
    if (entry.channelId) attrs.channel = entry.channelId

    return { tag: 'entry', attrs, text: entry.body }
  })

  // kb_entry_id·kb_version 을 태그에 넣지 않는다. 모델이 되받지 않으므로
  // 줄 필요가 없고, 주면 옮겨 적으려다 형식이 틀린다 → §5
  return { tag, trusted: true, items }
}

function caseStateBlock(
  entries: readonly CaseStateItem[],
  issued: IssuedRef[],
): PromptBlock | null {
  if (entries.length === 0) return null

  const items: PromptItem[] = entries.map((entry) => {
    const ref = `case-${countOf(issued, 'case-') + 1}`
    issued.push({ ref, label: entry.label })
    return {
      tag: 'item',
      attrs: { ref, label: entry.label },
      text: entry.value,
    }
  })

  return { tag: 'case_state', trusted: true, items }
}

/** 사기범이 한 말이 그대로 들어 있다. **신뢰 표시를 달지 않는다** */
function caseTalkBlock(
  lines: readonly TalkLine[],
  issued: IssuedRef[],
): PromptBlock | null {
  if (lines.length === 0) return null

  const items: PromptItem[] = lines.map((line) => {
    const ref = `t-${countOf(issued, 't-') + 1}`
    issued.push({ ref, label: `사건 대화 ${ref}` })
    return {
      tag: 'line',
      attrs: { ref, speaker: line.speaker },
      text: line.text,
    }
  })

  return { tag: 'case_talk', trusted: false, items }
}

/**
 * 우리와 주고받은 대화. **참조 번호를 붙이지 않는다** —
 * 이력을 인용할 일이 확인되지 않았고, 접두가 늘면 인용 검증도 함께 늘어난다.
 */
function historyBlock(turns: readonly HistoryTurn[]): PromptBlock | null {
  if (turns.length === 0) return null

  const items: PromptItem[] = turns.map((turn) => ({
    tag: 'turn',
    attrs: { speaker: turn.speaker },
    text: turn.text,
  }))

  return { tag: 'history', trusted: false, items }
}

function countOf(issued: readonly IssuedRef[], prefix: string): number {
  return issued.filter((one) => one.ref.startsWith(prefix)).length
}
