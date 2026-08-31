/**
 * 기재 안내(S-10) 렌더 시험 — **화면이 값을 만들어 내지 않는가.**
 *
 * 계약: spec/frontend/08-14-screens.md §S-10 · spec/common/08-14-api.md §3.4
 * 근거: ADR-037(서류를 만들지 않는다) · ADR-042(제출처를 단정하지 않는다) ·
 *       ADR-027(키는 브라우저에만) · ADR-034(화면은 원문)
 *
 * ⚠️ **2026-08-31 까지 이 화면이 통째로 목업이었습니다.** 「이영희 ·
 * 010-4321-8765 · 110-2345-678901 · 김민수 · 3,000,000원 · 국민은행」이 상수로
 * 박혀 있고 값마다 복사 버튼이 붙어 있었습니다. 도달 경로가 없어 안 보였을
 * 뿐이고, 헤더에 화면 이동이 붙는 순간 **남의 계좌번호를 자기 피해구제
 * 신청서에 옮겨 적게 하는 화면**이 됐습니다 — 증거함에서 고친 그 결함입니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DocGuide, { buildSections } from "./doc";
import type { CaseSlot } from "./load";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const slot = (key: string, value: string | null, state = "confirmed"): CaseSlot => ({
  slot_key: key,
  state,
  value,
});

/** 목업에 박혀 있던 값들 — **어느 것도 다시 나오면 안 됩니다** */
const MOCKUP = [
  "이영희",
  "010-4321-8765",
  "younghee@naver.com",
  "352-0912-3456-73",
  "110-2345-678901",
  "김민수",
  "3,000,000원",
  "국민은행",
];

describe("사건이 말하지 않은 값은 화면에 없다", () => {
  it("빈 사건에서 목업 값이 한 글자도 안 나온다 — **회귀**", () => {
    const text = textOf(renderToStaticMarkup(<DocGuide caseToken="t" slots={[]} />));

    for (const one of MOCKUP) expect(text).not.toContain(one);
  });

  it("빈 사건에서도 서식 칸 이름은 그대로 보인다", () => {
    // **칸을 지우지 않았습니다.** 무엇을 적어야 하는지가 이 화면의 전부입니다
    const text = textOf(renderToStaticMarkup(<DocGuide caseToken="t" slots={[]} />));

    expect(text).toContain("생년월일");
    expect(text).toContain("사기이용계좌 입금내역");
    expect(text).toContain("직접 적으셔야 합니다");
  });

  it("복사할 값이 없으면 0 으로 셉니다 — 상수 9 가 아닙니다", () => {
    const text = textOf(renderToStaticMarkup(<DocGuide caseToken="t" slots={[]} />));

    expect(text).toContain("옮겨 적음 0 / 0");
  });

  /**
   * ⚠️ 전에는 「가까운 영업점에 서면 제출 · 국민은행」이 기본값이라 **사건의
   * 은행이 무엇이든** 그렇게 말했습니다 → ADR-042 ③
   */
  it("제출처를 모르면 그 카드를 아예 안 그린다", () => {
    const text = textOf(renderToStaticMarkup(<DocGuide caseToken="t" slots={[]} />));

    expect(text).not.toContain("어디에 내나요");
  });
});

describe("사건이 말한 값은 그대로 그린다", () => {
  const slots = [
    slot("org_name", "농협은행"),
    slot("amount", "3000000"),
    slot("occurred_at", "2026-08-14T14:02:00"),
  ];

  it("기관·금액·시각이 슬롯에서 온다", () => {
    const text = textOf(renderToStaticMarkup(<DocGuide caseToken="t" slots={slots} />));

    expect(text).toContain("농협은행");
    // 숫자만인 값은 서식에 옮겨 적기 좋게 끊습니다 — 복사되는 값은 숫자뿐입니다
    expect(text).toContain("3,000,000원");
    expect(text).toContain("2026. 8. 14. 14:02");
    // **국민은행이 아닙니다** — 전에는 무엇을 넣어도 국민은행이었습니다
    expect(text).not.toContain("국민은행");
  });

  it("「모름」으로 답한 칸은 직접 적는 칸으로 남는다 — 불변 규칙 5", () => {
    const text = textOf(
      renderToStaticMarkup(
        <DocGuide caseToken="t" slots={[slot("amount", null, "unknown")]} />,
      ),
    );

    expect(text).toContain("직접 적으셔야 합니다");
  });

  it("확인 전 값에는 「확인해 주세요」가 붙는다", () => {
    const got = buildSections([slot("org_name", "농협은행", "extracted")], []);
    const field = got.flatMap((s) => s.fields).find((f) => f.id === "o-bank");

    expect(field?.state).toBe("unread");
    expect(field?.note).toContain("확인해 주세요");
  });
});

describe("이 기기에 짝이 없는 값은 토큰으로 남는다 — ADR-027", () => {
  const tokened = [slot("counterpart_account", "[계좌-1]")];

  it("매핑이 없으면 토큰 그대로 보이고 복사가 막힌다", () => {
    const text = textOf(
      renderToStaticMarkup(<DocGuide caseToken="t" slots={tokened} restorable={[]} />),
    );

    expect(text).toContain("[계좌-1]");
    expect(text).toContain("이 기기에선 복사 안 됨");
    // **토큰을 서식에 옮겨 적게 하면 안 됩니다**
    expect(text).toContain("이 기기에서는 값이 가려져 보입니다");
  });

  it("매핑이 있으면 원문으로 펼쳐진다 — `doc-field` 는 전체 복원 자리입니다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <DocGuide
          caseToken="t"
          slots={tokened}
          restorable={[{ token: "[계좌-1]", original: "302-1111-222222" }]}
        />,
      ),
    );

    expect(text).toContain("302-1111-222222");
    expect(text).not.toContain("[계좌-1]");
    // 열린 사건에서는 「가려져 보입니다」를 말하지 않습니다
    expect(text).not.toContain("이 기기에서는 값이 가려져 보입니다");
  });

  it("토큰이 하나도 없는 사건에 「가려져 보입니다」를 말하지 않는다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <DocGuide caseToken="t" slots={[slot("org_name", "농협은행")]} restorable={[]} />,
      ),
    );

    expect(text).not.toContain("이 기기에서는 값이 가려져 보입니다");
  });
});

describe("금액·시각을 우리가 해석해 바꾸지 않는다", () => {
  it("사용자가 말한 그대로가 들어오면 그대로 둔다", () => {
    const got = buildSections([slot("amount", "300만원쯤")], []);
    const field = got.flatMap((s) => s.fields).find((f) => f.id === "o-amount");

    expect(field?.display).toBe("300만원쯤");
  });

  it("못 읽는 시각은 받은 그대로 낸다", () => {
    const got = buildSections([slot("occurred_at", "저녁 무렵")], []);
    const field = got.flatMap((s) => s.fields).find((f) => f.id === "o-when");

    expect(field?.display).toBe("저녁 무렵");
  });
});

/**
 * ## 시연 경로(`?view=doc`)가 실제로 값을 그리는가
 *
 * 픽스처 슬롯은 `counterpart_account` 를 `[계좌-1]` 로 들고 있습니다. 매핑을
 * 안 내려주면 화면이 토큰만 그리고 복사 버튼이 사라져, **무엇을 보여주려던
 * 화면인지 알 수 없게** 됩니다 — `?view=plan` 워크스페이스가 비어 있던 것과 같은 종류입니다.
 */
describe("시연 픽스처가 그려진다", () => {
  it("픽스처 매핑을 주면 서류 칸에 값이 그려진다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <DocGuide
          caseToken="t"
          slots={[slot("counterpart_account", "[계좌-1]"), slot("org_name", "농협은행")]}
          restorable={[{ token: "[계좌-1]", original: "110-2345-678901" }]}
        />,
      ),
    );

    expect(text).toContain("110-2345-678901");
    expect(text).toContain("농협은행");
    expect(text).toContain("옮겨 적음 0 / 3");
  });
});
