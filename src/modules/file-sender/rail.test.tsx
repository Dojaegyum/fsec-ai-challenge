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
  it("갈림길을 넘기면 둘 다 그린다", () => {
    const text = textOf(
      renderToStaticMarkup(<FileRail files={FILES} onRetry={() => {}} onSkip={() => {}} />),
    );
    expect(text).toContain("다른 파일 올리기");
    expect(text).toContain("없이 진행");
  });

  it("**안 넘기면 그 버튼을 안 그린다** — 눌러도 아무 일이 없는 버튼을 두지 않습니다", () => {
    // 2026-08-27 까지 부르는 쪽이 핸들러를 안 넘겨서 죽은 버튼 둘이 켜져 있었습니다.
    // 「막지 않고 갈림길을 준다」가 갈림길 없이 문구만 남은 상태였습니다
    const text = textOf(renderToStaticMarkup(<FileRail files={FILES} />));
    expect(text).not.toContain("다른 파일 올리기");
    expect(text).not.toContain("없이 진행");
    // 그래도 **무슨 일이 있었는지는 말합니다** — 목록에서 지우지 않습니다
    expect(text).toContain("올리지 못했습니다");
  });

  it("일어나지 않은 판정을 말하지 않는다", () => {
    // 파일 속 주민번호 검출은 미결이라(ADR-026) 그 판정 자체가 안 일어납니다.
    // 기본 문구가 그것을 단정하면 전사 실패한 사용자에게 거짓말이 됩니다
    const text = textOf(renderToStaticMarkup(<FileRail files={FILES} />));
    expect(text).not.toContain("주민번호를 못 가렸습니다");
    expect(text).not.toContain("가릴 수 없는 정보가 있어");
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

describe("개인정보 보호 처리중에는 원본이 어디 있는지 밝힌다", () => {
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
