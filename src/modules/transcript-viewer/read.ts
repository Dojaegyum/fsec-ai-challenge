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

/**
 * §3.3 `shortfalls[]` 한 코드 → 사람이 읽는 한 줄. **에러가 아닙니다** —
 * 불변 규칙 5 「모름은 실패가 아니다」와 같은 자리입니다.
 *
 * 어휘는 `modules/transcriber` 의 `Shortfall`(서버·층 1) 과 뜻이 같아야 하지만
 * **여기서 다시 옮겨 적습니다** — 층 C 는 서버 모듈을 import 하지 않습니다
 * (`doc.tsx` 의 `SubmitPath` 와 같은 이유: 세 곳이 같은 모양을 약속하되
 * 갈라 둡니다). `no_org_allowlist` 는 `flows/read-evidence.ts` 가 여기 더하는
 * 코드입니다.
 */
const SHORTFALL_TEXT: Readonly<Record<string, string>> = {
  empty: "이 자료에서는 읽어낸 줄이 없습니다.",
  no_speakers: "누가 말한 줄인지는 갈라내지 못했습니다.",
  no_confidence: "판독 신뢰도를 받지 못했습니다.",
  no_pieces: "낱말 단위로는 못 갈라 줄 단위로만 보입니다.",
  no_anchors: "원본에서 이 줄의 자리를 찾지 못했습니다.",
  no_layout: "대화창의 좌·우 구조를 갈라내지 못했습니다.",
  truncated: "내용이 길어 앞부분만 읽었습니다.",
  no_org_allowlist: "기관 이름 목록을 불러오지 못해 일부 기관명이 가려졌을 수 있습니다.",
};

/**
 * 못 읽은 것을 **한 번씩만** 사람이 읽는 문장으로. 모르는 코드는 지어내지
 * 않고 조용히 뺍니다 — `not_applicable`(글로 올린 자료) 도 여기서 빠집니다,
 * 「읽을 것이 없다」는 사용자에게 알릴 「못 읽음」이 아니기 때문입니다.
 */
export function shortfallMessages(shortfalls: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of shortfalls) {
    const text = SHORTFALL_TEXT[code];
    if (!text || seen.has(code)) continue;
    seen.add(code);
    out.push(text);
  }
  return out;
}
