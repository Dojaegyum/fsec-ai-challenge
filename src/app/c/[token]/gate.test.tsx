/**
 * 로딩·실패 화면 렌더 시험 — **금지 규칙만** 봅니다.
 *
 * 빨강 안 쓰기 · 자동 재시도 안 하기 · 링크를 복구해 주는 척 안 하기.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CaseFailed, CaseLoading } from "./gate";
import type { LoadFail } from "./load";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const mk = (over: Partial<LoadFail> = {}): LoadFail => ({
  poll: false,
  reason: "error",
  message: "사건을 불러오지 못했습니다.",
  ...over,
});

describe("버튼은 서버가 허락할 때만", () => {
  it("retryable 을 말하지 않았으면 「다시 시도」가 없다", () => {
    const html = renderToStaticMarkup(<CaseFailed fail={mk()} onRetry={() => {}} />);
    expect(textOf(html)).not.toContain("다시 시도");
  });

  it("retryable: false 면 역시 없다", () => {
    const html = renderToStaticMarkup(<CaseFailed fail={mk({ retryable: false })} onRetry={() => {}} />);
    expect(textOf(html)).not.toContain("다시 시도");
  });

  it("retryable: true 일 때만 뜬다", () => {
    const html = renderToStaticMarkup(<CaseFailed fail={mk({ retryable: true })} onRetry={() => {}} />);
    expect(textOf(html)).toContain("다시 시도");
  });
});

describe("몇 초 뒤인지는 서버가 말한 값이다", () => {
  it("Retry-After 가 있으면 그대로 적는다", () => {
    const text = textOf(
      renderToStaticMarkup(<CaseFailed fail={mk({ retryAfterSec: 5 })} onRetry={() => {}} />),
    );
    expect(text).toContain("5초 뒤");
  });

  it("없으면 그 줄 자체가 없다", () => {
    const text = textOf(renderToStaticMarkup(<CaseFailed fail={mk()} onRetry={() => {}} />));
    // `\d+초` 로만 보면 **숫자만 빠진 「초 뒤 다시 시도할 수 있습니다」를 놓칩니다** —
    // 조건을 지워 실제로 확인했습니다. 문구 전체가 없어야 합니다
    expect(text).not.toContain("초 뒤");
  });
});

describe("빨강을 쓰지 않는다", () => {
  it("실패도 앰버까지다", () => {
    const html = renderToStaticMarkup(
      <CaseFailed fail={mk({ retryable: true, retryAfterSec: 5 })} onRetry={() => {}} />,
    );
    expect(html).not.toMatch(/destructive|text-red|bg-red|border-red/);
  });
});

describe("링크를 복구해 주는 척하지 않는다", () => {
  it("재발급이 없다는 것을 말한다 → ADR-039 ⑥", () => {
    const text = textOf(renderToStaticMarkup(<CaseFailed fail={mk()} onRetry={() => {}} />));
    expect(text).toContain("다시 발급해 드릴 수 없습니다");
  });
});

describe("기다리는 동안 무엇을 하는지 말한다", () => {
  it("점 3개·스켈레톤이 아니라 문장이다 → ADR-022", () => {
    const text = textOf(renderToStaticMarkup(<CaseLoading />));
    expect(text).toContain("사건을 불러오고 있습니다");
    expect(text).toContain("한 번에 읽어서");
  });
});
