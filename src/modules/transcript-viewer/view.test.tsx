/**
 * `TranscriptView` 렌더 시험 — **금지 규칙만** 봅니다.
 *
 * 이 자리의 규칙은 `file-sender` 와 정반대입니다 — 저쪽은 가리고 여기는 펼칩니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TranscriptView } from "./index";
import type { RawLine } from "./types";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const LINES: RawLine[] = [
  { speaker: "A", text: "[이름-1] 고객님 되시죠", start_ms: 12_000 },
  { speaker: "B", text: "네 맞는데요", start_ms: 64_000 },
];

const MAPPINGS = [{ token: "[이름-1]", original: "김민수" }];

describe("여기서는 전체 복원이 허용된다", () => {
  it("토큰이 아니라 원문이 보인다 — 자기 통화를 대조하는 자리다", () => {
    const text = textOf(
      renderToStaticMarkup(<TranscriptView lines={LINES} mappings={MAPPINGS} />),
    );
    expect(text).toContain("김민수 고객님 되시죠");
    expect(text).not.toContain("[이름-1]");
  });
});

describe("못 펼쳐도 고장이 아니다", () => {
  const html = renderToStaticMarkup(<TranscriptView lines={LINES} mappings={[]} />);

  it("화면이 비지 않는다 — 나머지 줄은 그대로 보인다", () => {
    expect(textOf(html)).toContain("네 맞는데요");
  });

  it("왜 안 보이는지 말해 준다", () => {
    expect(textOf(html)).toContain("처음 시작하신 기기에서 열면 그대로 보입니다");
  });

  it("앰버로 알린다 — 빨강이 아니다", () => {
    expect(html).toContain("deadline-urgent");
    expect(html).not.toMatch(/destructive|text-red|bg-red/);
  });

  it("매핑이 있으면 그 안내가 안 뜬다", () => {
    const ok = textOf(renderToStaticMarkup(<TranscriptView lines={LINES} mappings={MAPPINGS} />));
    expect(ok).not.toContain("이 기기에는 열쇠가 없어");
  });
});

describe("시각은 녹음 안의 경과다 — 시계를 안 본다", () => {
  it("start_ms 를 mm:ss 로 옮긴다", () => {
    const text = textOf(renderToStaticMarkup(<TranscriptView lines={LINES} mappings={MAPPINGS} />));
    expect(text).toContain("00:12");
    expect(text).toContain("01:04");
  });
});

describe("가려서 보낸 것은 개수로만 밝힌다", () => {
  it("원문을 담지 않고 종류와 수만 적는다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <TranscriptView
          lines={LINES}
          mappings={MAPPINGS}
          tokens={[
            { token: "[이름-1]", kind: "name" },
            { token: "[계좌-1]", kind: "account" },
            { token: "[계좌-2]", kind: "account" },
          ]}
        />,
      ),
    );
    // 영문 코드가 아니라 토큰이 이미 가진 한국어 표기를 씁니다
    expect(text).toContain("이름 1 · 계좌 2");
    expect(text).not.toContain("account");
  });

  it("토큰을 안 넘기면 그 줄이 없다 — 헤더 막대를 쓰는 화면과 겹치지 않게", () => {
    const text = textOf(renderToStaticMarkup(<TranscriptView lines={LINES} mappings={MAPPINGS} />));
    expect(text).not.toContain("가려서");
  });
});
