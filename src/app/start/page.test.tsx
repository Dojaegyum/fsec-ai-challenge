/**
 * `/start` 자료 슬롯 렌더 시험 — **눌러서 아무 일도 안 일어나는 것**을 막습니다.
 *
 * 계약: spec/frontend/08-14-screens.md §S-05 「자료 — 종류가 곧 안내입니다」 ·
 *       spec/common/08-14-api.md §3.2
 * 근거: ADR-026(신분증은 안 받습니다) · CLAUDE.md 불변 규칙 5
 *
 * ⚠️ **2026-08-27 까지 슬롯 넷에 `onClick` 도 파일 입력도 없었습니다.** 계약은
 * 여기를 증거 자리로 못박아 두었는데 모양만 배포돼 있었고, 타입도 빌드도 시험도
 * 전부 통과했습니다 — **그릴 것이 없다는 사실은 렌더를 봐야만 드러납니다.**
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { kindOf } from "@/app/c/[token]/upload";

import { EvidenceSlots, UploadNote } from "./page";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** 고른 자료 한 장. **컴포넌트는 이름만 읽습니다** — 파일 자체는 위로 올라갑니다 */
const pickedOne = (slot: number, name: string) => ({
  id: slot + 1,
  slot,
  name,
  file: new File([], name, { type: "image/png" }),
});

const draw = (over: Partial<Parameters<typeof EvidenceSlots>[0]> = {}) =>
  renderToStaticMarkup(
    <EvidenceSlots
      picked={[]}
      busy={false}
      rejected={null}
      onPick={() => {}}
      onUnpick={() => {}}
      {...over}
    />,
  );

describe("슬롯은 실제로 파일을 고를 수 있어야 한다", () => {
  it("슬롯마다 파일 선택 입력이 하나씩 있다", () => {
    // 종류 넷 → 입력 넷. 하나라도 빠지면 그 종류는 영영 못 올립니다
    expect(draw().match(/type="file"/g)).toHaveLength(4);
  });

  it("받는 종류가 전부 §3.2 의 kind 로 옮겨진다", () => {
    const accepts = [...draw().matchAll(/accept="([^"]+)"/g)].map((m) => m[1]);
    expect(accepts).toHaveLength(4);
    // `image/*` → `image`. 표 밖의 것을 적어 두면 전사기가 다른 일을 합니다
    for (const one of accepts) {
      expect(kindOf(one.replace("*", "png"))).not.toBeNull();
    }
  });

  it("통화 녹음만 소리를 받고 나머지는 사진이다 — 종류가 곧 분류입니다", () => {
    const accepts = [...draw().matchAll(/accept="([^"]+)"/g)].map((m) => m[1]);
    expect(accepts[0]).toBe("audio/*");
    expect(accepts.slice(1)).toEqual(["image/*", "image/*", "image/*"]);
  });
});

describe("고른 것과 올린 것을 섞지 않는다", () => {
  it("아무것도 안 골랐으면 「아직 올리지 않았습니다」를 말하지 않는다", () => {
    expect(textOf(draw())).not.toContain("아직 올리지 않았습니다");
  });

  it("고른 것이 있으면 이름과 함께 **아직 안 올라갔다**고 말한다", () => {
    const text = textOf(draw({ picked: [pickedOne(1, "카톡대화.png")] }));
    expect(text).toContain("카톡대화.png");
    // 사건이 없으면 올릴 주소가 없습니다 — 그 사실을 숨기면 올라간 줄 압니다
    expect(text).toContain("아직 올리지 않았습니다");
  });

  it("고른 것은 뺄 수 있다", () => {
    expect(textOf(draw({ picked: [pickedOne(0, "통화.m4a")] }))).toContain("빼기");
  });
});

describe("막지 않고 말합니다 — 불변 규칙 5", () => {
  it("못 받는 종류를 골라도 슬롯은 그대로 그려진다", () => {
    const html = draw({ rejected: "이 종류의 파일은 아직 받지 못합니다." });
    expect(html.match(/type="file"/g)).toHaveLength(4);
    expect(textOf(html)).toContain("이 종류의 파일은 아직 받지 못합니다.");
  });

  it("할 말이 없으면 그 줄 자체가 없다", () => {
    expect(draw()).not.toContain('role="alert"');
  });

  it("없어도 진행된다고 늘 적어 둔다", () => {
    expect(textOf(draw())).toContain("없어도 괜찮습니다");
  });
});

describe("신분증은 받지 않습니다 — ADR-026", () => {
  it("업로드 자리에 그 말이 있다", () => {
    // 받은 뒤 거르는 것보다 안 받는 것이 낫습니다. **업로드 자리에** 적어야 합니다
    expect(textOf(draw())).toContain("신분증·주민등록증은 올리지 마세요");
  });
});

describe("사건을 만드는 중에는 손대지 못한다", () => {
  it("busy 면 슬롯 버튼이 잠긴다", () => {
    // 올리는 중에 새로 고르면 그 파일은 이번 발급에 안 실립니다
    expect(draw({ busy: true }).match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("자료가 어떻게 됐는지 발급 화면이 말한다", () => {
  const note = (over: Partial<Parameters<typeof UploadNote>[0]> = {}) =>
    textOf(
      renderToStaticMarkup(
        <UploadNote total={2} sending={1} done={false} notSent={[]} {...over} />,
      ),
    );

  it("올리는 중에는 **주소가 이미 유효하다**고 함께 말한다", () => {
    // 자료를 다 올릴 때까지 기다리게 두면, 그 사이 창을 닫은 사용자는
    // 만들어진 사건의 주소를 영영 잃습니다 (ADR-021)
    const text = note();
    expect(text).toContain("올리고 있습니다");
    expect(text).toContain("주소는 이미 유효합니다");
  });

  it("끝나기 전에는 실패를 말하지 않는다", () => {
    expect(note()).not.toContain("올리지 못했습니다");
  });

  it("다 올렸으면 몇 개인지 말한다", () => {
    const text = note({ sending: 0, done: true });
    expect(text).toContain("2");
    expect(text).toContain("함께 올렸습니다");
  });

  it("못 올린 것은 이름으로 말하고, 사건은 그대로 간다", () => {
    const text = note({ sending: 0, done: true, notSent: ["통화.m4a"] });
    expect(text).toContain("통화.m4a");
    // **막지 않습니다** — 자료가 없어도 절차 안내는 나갑니다 (불변 규칙 5)
    expect(text).toContain("사건은 그대로 진행됩니다");
  });

  it("빨강을 쓰지 않는다 — 앰버까지입니다", () => {
    const html = renderToStaticMarkup(
      <UploadNote total={1} sending={0} done notSent={["x.png"]} />,
    );
    expect(html).not.toMatch(/text-red|bg-red|border-red/);
  });
});
