/**
 * `DeadlineBadge`·`WaitCard` 렌더 시험 — **금지 규칙만** 봅니다.
 *
 * 이 모듈의 핵심은 「하지 않는 것」이라, 렌더도 그 셋을 지키는지만 겨눕니다:
 * 날짜를 세지 않기 · 지난 기한 지우지 않기 · 두 달을 카운트다운으로 만들지 않기.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeadlineBadge, DeadlinePair, WaitCard } from "./index";
import type { Deadline } from "./types";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const mk = (over: Partial<Deadline> = {}): Deadline => ({
  deadline_id: "01J",
  title: "피해구제 신청서 제출",
  kind: "primary",
  due_at: "2026-08-20T23:59:59+09:00",
  status: "open",
  ...over,
});

describe("화면이 날짜를 세지 않는다", () => {
  it("서버가 잔여일을 안 주면 D-day 를 그리지 않는다", () => {
    const text = textOf(renderToStaticMarkup(<DeadlineBadge deadline={mk()} />));
    expect(text).toContain("8월 20일까지");
    expect(text).not.toMatch(/D-\d/);
  });

  it("서버가 준 값만 그린다", () => {
    const text = textOf(renderToStaticMarkup(<DeadlineBadge deadline={mk({ days_left: 2 })} />));
    expect(text).toBe("8월 20일까지 · D-2");
  });

  it("날짜를 못 읽으면 아무것도 안 그린다 — Invalid Date 를 내보내지 않는다", () => {
    expect(renderToStaticMarkup(<DeadlineBadge deadline={mk({ due_at: "" })} />)).toBe("");
  });
});

describe("본 기한과 유예를 합치지 않는다", () => {
  it("나란히 두 배지로 나온다", () => {
    const grace = mk({
      deadline_id: "02J",
      kind: "grace",
      due_at: "2026-09-03T23:59:59+09:00",
      days_left: 11,
    });
    const text = textOf(
      renderToStaticMarkup(
        <DeadlinePair primary={mk({ status: "missed" })} grace={grace} />,
      ),
    );
    expect(text).toContain("본 기한 8월 20일 · 지남");
    expect(text).toContain("유예 9월 3일까지 · D-11");
  });
});

describe("제도 시간은 급한 일이 아니다", () => {
  const notice = mk({
    kind: "info",
    title: "채권소멸공고",
    due_at: "2026-10-30T23:59:59+09:00",
    days_left: 60,
  });

  it("info 배지에는 D-day 가 없다 — 잔여일이 와도", () => {
    const text = textOf(renderToStaticMarkup(<DeadlineBadge deadline={notice} />));
    expect(text).toBe("채권소멸공고 10월 30일");
  });

  it("info 배지에 앰버를 쓰지 않는다", () => {
    const html = renderToStaticMarkup(<DeadlineBadge deadline={notice} />);
    expect(html).not.toContain("deadline-urgent");
  });
});

describe("공고 대기 카드 — 두 달을 세지 않는다", () => {
  const card = (
    <WaitCard
      deadline={mk({ kind: "info", title: "채권소멸공고", due_at: "2026-10-30T23:59:59+09:00" })}
      startAt="2026-08-30T00:00:00+09:00"
      progress={0.45}
    />
  );

  it("D-n 도 퍼센트도 그리지 않는다", () => {
    const text = textOf(renderToStaticMarkup(card));
    expect(text).not.toMatch(/D[-+]\d/);
    expect(text).not.toContain("%");
  });

  it("앰버를 쓰지 않는다 — 사용자 기한이 아니다", () => {
    expect(renderToStaticMarkup(card)).not.toContain("deadline-urgent");
  });

  it("빨강도 쓰지 않는다", () => {
    expect(renderToStaticMarkup(card)).not.toMatch(/destructive|text-red|bg-red/);
  });

  it("달력 앵커는 장식이라 낭독기에 안 읽힌다 — 뜻은 글자가 싣는다", () => {
    const html = renderToStaticMarkup(card);
    // 막대·점을 감싼 상자에 aria-hidden 이 붙어 있어야 합니다 (ADR-048 조건)
    expect(html).toContain('aria-hidden="true"');
    const text = textOf(html);
    expect(text).toContain("8월 30일 공고 시작");
    expect(text).toContain("지금");
    expect(text).toContain("10월 30일 만료 예정");
  });

  it("기다림이 정상이라고 말한다 — 보드를 비우지 않는다", () => {
    expect(textOf(renderToStaticMarkup(card))).toContain("연락이 없는 것이 정상입니다");
  });
});
