/**
 * `PlanBoard` 렌더 시험 — **금지 규칙만** 봅니다.
 *
 * 레이아웃(간격·정렬)은 시험하지 않습니다. 시안이 바뀌면 같이 바뀌어야 하는 것이라
 * 못 박으면 디자인을 막습니다. **어기면 계약이 깨지는 것**만 여기 둡니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PlanBoard } from "./index";
import type { PlanStep } from "./types";

/** 태그를 걷어낸 **보이는 글자**. 클래스 문자열의 `%`·색값에 걸리지 않게 */
const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const step = (over: Partial<PlanStep> & { step_id: string }): PlanStep => ({
  seq: 10,
  title: "단계",
  state: "not_started",
  conditional: null,
  body: {},
  ...over,
});

const CHAIN: PlanStep[] = [
  step({ step_id: "a", title: "피해구제 신청서 제출", body: { step_key: "relief" } }),
  step({ step_id: "b", title: "접수증 올리기", seq: 20, body: { after: ["relief"] } }),
];

const LOOSE: PlanStep[] = [
  step({ step_id: "a", title: "112 신고", body: { step_key: "report-112" } }),
  step({ step_id: "b", title: "지급정지 요청", seq: 20, body: { step_key: "freeze" } }),
];

describe("빨강을 쓰지 않는다", () => {
  it("어느 상태에서도 빨강 토큰이 나오지 않는다", () => {
    const html = renderToStaticMarkup(
      <PlanBoard
        steps={[
          step({ step_id: "1", state: "done_verified" }),
          step({ step_id: "2", state: "in_progress" }),
          step({ step_id: "3", state: "skipped" }),
          step({ step_id: "4", state: "unconfirmed" }),
        ]}
      />,
    );
    // 기한 임박도 앰버입니다 — 빨강은 파괴적 동작 확인(`--destructive`)에만 남깁니다
    expect(html).not.toMatch(/destructive|text-red|bg-red|border-red/);
  });
});

describe("없는 순서를 지어내지 않는다", () => {
  it("사슬이 없으면 번호도, 「순서대로」 안내 줄도 없다", () => {
    const text = textOf(renderToStaticMarkup(<PlanBoard steps={LOOSE} />));
    expect(text).not.toContain("번호가 붙은 것만 순서대로");
  });

  it("사슬이 있으면 그때만 안내 줄이 뜬다", () => {
    const text = textOf(renderToStaticMarkup(<PlanBoard steps={CHAIN} />));
    expect(text).toContain("번호가 붙은 것만 순서대로");
  });
});

describe("건너뛴 단계를 지우지 않는다", () => {
  it("해당 없음도 목록에 남는다 — 왜 없는지가 정보다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <PlanBoard steps={[step({ step_id: "x", title: "가상자산 환급 신청", state: "skipped" })]} />,
      ),
    );
    expect(text).toContain("가상자산 환급 신청");
    expect(text).toContain("해당 없음");
  });
});

describe("화면이 날짜를 만들지 않는다", () => {
  it("서버가 준 기한 문자열이 없으면 그 자리는 빈다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <PlanBoard steps={[step({ step_id: "n", state: "in_progress" })]} />,
      ),
    );
    expect(text).not.toMatch(/D-\d/);
  });

  it("서버가 준 값이 있으면 그대로 보인다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <PlanBoard
          steps={[step({ step_id: "n", state: "in_progress" })]}
          deadlineFor={() => "8월 20일까지"}
        />,
      ),
    );
    expect(text).toContain("8월 20일까지");
  });
});

describe("조건부 단계를 지우지 않는다", () => {
  it("조건 라벨이 함께 보인다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <PlanBoard
          steps={[
            step({
              step_id: "c",
              title: "간편송금 사업자에 지급정지 요청",
              conditional: "카카오페이로 보냈다면",
            }),
          ]}
        />,
      ),
    );
    expect(text).toContain("카카오페이로 보냈다면");
  });
});
