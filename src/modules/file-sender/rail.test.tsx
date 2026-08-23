/**
 * `FileRail`·`StatusDot` 렌더 시험 — **금지 규칙만** 봅니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FileRail, StatusDot } from "./index";
import type { RailFile } from "./rail";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const FILES: RailFile[] = [
  { id: "a", name: "0812_수신전화.m4a", status: "done" },
  { id: "b", name: "0813_재통화.m4a", status: "processing", percent: 74 },
  { id: "d", name: "신분증_사진.jpg", status: "failed" },
  { id: "e", name: "이체내역.png", status: "pending" },
];

describe("색만으로 상태를 가르지 않는다", () => {
  it("점 곁에 라벨이 항상 붙는다", () => {
    for (const status of ["pending", "processing", "done", "failed"] as const) {
      const text = textOf(renderToStaticMarkup(<StatusDot status={status} />));
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("점 자체는 낭독기에 안 읽힌다 — 글자가 대신 말한다", () => {
    expect(renderToStaticMarkup(<StatusDot status="done" />)).toContain('aria-hidden="true"');
  });
});

describe("못 가린 파일을 막지 않는다", () => {
  it("갈림길 둘을 함께 준다", () => {
    const text = textOf(renderToStaticMarkup(<FileRail files={FILES} />));
    expect(text).toContain("다른 파일 올리기");
    expect(text).toContain("없이 진행");
  });

  it("사용자를 탓하지 않는다", () => {
    const text = textOf(renderToStaticMarkup(<FileRail files={FILES} />));
    expect(text).not.toMatch(/잘못|오류/);
  });

  it("실패한 파일도 목록에서 지우지 않는다", () => {
    const text = textOf(renderToStaticMarkup(<FileRail files={FILES} />));
    expect(text).toContain("신분증_사진.jpg");
  });
});

describe("가리는 중에는 원본이 어디 있는지 밝힌다", () => {
  it("브라우저 안에 있다고 말한다", () => {
    const text = textOf(renderToStaticMarkup(<FileRail files={FILES} />));
    expect(text).toContain("원본은 아직 이 브라우저 안에 있습니다");
  });
});

describe("빨강을 쓰지 않는다", () => {
  it("제외된 파일에도 앰버까지만 쓴다", () => {
    const html = renderToStaticMarkup(<FileRail files={FILES} />);
    expect(html).not.toMatch(/destructive|text-red|bg-red|border-red/);
    expect(html).toContain("deadline-urgent");
  });
});
