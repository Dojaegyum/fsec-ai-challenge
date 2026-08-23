import { parseToken, restore } from "@/modules/pii-restorer";
import type { DenialEvent, RestorableMapping } from "@/modules/pii-restorer";
import type { PiiToken, RawLine, TokenCount, TranscriptLine } from "./types";

/**
 * 전사를 원문으로 펼칩니다.
 *
 * **`site: "transcript"` 는 전체 복원입니다** — 사용자가 자기 통화를 대조하는
 * 자리라 부분 복원이면 대조가 안 됩니다 → spec/backend/08-16-chat-context.md §8.
 *
 * **펼치지 못해도 실패가 아닙니다.** 다른 기기에서 열면 매핑이 없어 토큰이 그대로
 * 남습니다 — 그때도 화면은 그려지고, 안내 문구는 부르는 쪽이 붙입니다.
 *
 * 남은 토큰을 정규식으로 다시 긁지 않고 `onDenied` 만으로 `unresolved` 를 채웁니다.
 * 패턴을 두 곳에 두면 어긋난 쪽이 조용히 새는 쪽이 됩니다.
 */
export function readTranscript(
  lines: readonly RawLine[],
  mappings: readonly RestorableMapping[],
  onDenied?: (event: DenialEvent) => void,
): TranscriptLine[] {
  const pool = [...mappings];

  return lines.map((line) => {
    const unresolved: string[] = [];
    const text = restore(line.text, pool, {
      site: "transcript",
      onDenied: (event) => {
        unresolved.push(event.token);
        onDenied?.(event);
      },
    });
    return { speaker: line.speaker, text, start_ms: line.start_ms, unresolved };
  });
}

/**
 * 종류별 개수. **원문을 담지 않습니다** — 「서버로는 이름 1 · 계좌 1 을
 * 가려서 보냈습니다」를 헤더에 적는 데 씁니다 → 화면 설계 §S-08.
 *
 * 화면에 보이는 종류 이름은 **토큰 표기**(「[이름-1]」의 「이름」)에서 얻습니다.
 * §3.3 의 `kind` 는 영문 코드(`name`·`account`)라 그대로 내보내면
 * **「name 1 · account 1」** 이 됩니다 — 어휘를 여기서 새로 만들지 않고
 * 토큰이 이미 가진 한국어 표기를 씁니다.
 */
export function countTokens(tokens: readonly PiiToken[]): TokenCount[] {
  const seen = new Map<string, number>();
  for (const t of tokens) {
    const kind = parseToken(t.token)?.kind ?? t.kind;
    seen.set(kind, (seen.get(kind) ?? 0) + 1);
  }
  return [...seen].map(([kind, count]) => ({ kind, count }));
}
