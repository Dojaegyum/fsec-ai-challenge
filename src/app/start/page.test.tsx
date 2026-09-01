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

import { ConsentClauses, EvidenceSlots, UploadNote } from "./page";

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

/**
 * ── 동의 전문 4항 ────────────────────────────────────────────────
 *
 * 2026-08-30 까지 4항은 *「제3자에게 제공하지 않습니다 … 위탁이 생기면 이 문서에
 * 명시합니다」* 였습니다. **그때 이미 위탁이 있었습니다.**
 *
 * | 무엇을 | 어디로 | 무엇이 나가나 |
 * | --- | --- | --- |
 * | 답변 생성 | 외부 언어모델 (`lib/llm.ts`) | 토큰으로 가린 뒤의 글 |
 * | 음성·이미지 판독 | 외부 전사 서비스 (`TRANSCRIBER_URL`) | **원본 파일 그대로** — `flows/read-evidence.ts` 가 전사 **뒤에** 가립니다 |
 *
 * 동의 전문이 사실과 다르면 그것은 문구 문제가 아니라 **받지 않은 동의로
 * 처리하는 것**입니다. 그래서 이 글에는 시험이 붙습니다.
 */
describe("동의 전문 4항은 실제 흐름을 적는다", () => {
  const clauses = () =>
    textOf(renderToStaticMarkup(<ConsentClauses checks={[]} onToggle={() => {}} />));

  it("위탁 사실과 수탁 업무가 적혀 있다", () => {
    const text = clauses();
    expect(text).toContain("위탁하고 있습니다");
    // 수탁자 셋이 이름으로 나옵니다 — 「어딘가에 맡깁니다」는 표기가 아닙니다
    expect(text).toContain("Vercel · Supabase");
    expect(text).toContain("xAI (Grok)");
    expect(text).toContain("전사·판독 서버");
    // 무슨 업무를 맡겼는지도 함께
    expect(text).toContain("앱 실행 · 사건 저장 · 올리신 파일 보관");
    expect(text).toContain("답변과 안내문 생성");
    expect(text).toContain("통화 녹음 전사 · 이미지 판독 · 이름 탐지");
  });

  it("「제3자에게 제공하지 않습니다」만 남겨 두지 않는다", () => {
    const text = clauses();
    // 옛 문구입니다. 이 말만 남으면 **위탁이 있는데 없다고 말하는 것**입니다
    expect(text).not.toContain("위탁이 생기면");
    expect(text).toContain("제공·판매하지 않습니다");
  });

  it("원본이 가려지기 전에 나가는 것을 숨기지 않는다", () => {
    // 여기가 이 문구의 존재 이유입니다 — 통화 녹음은 **가리기 전**에 나갑니다
    expect(clauses()).toContain("가리기 전의 원본 음성·이미지");
  });

  it("가려서 나가는 것과 가리기 전에 나가는 것을 가른다", () => {
    // 언어모델 쪽은 토큰뿐입니다 — 둘을 뭉치면 어느 쪽도 못 믿습니다
    expect(clauses()).toContain("토큰으로 가린 뒤의 글만");
  });

  it("국외 이전 가능성을 덮지 않고, 근거 조문과 함께 적는다", () => {
    const text = clauses();
    expect(text).toContain("국외");
    // 처리위탁(제3호)이라 별도 동의 없이 가되 **처리방침 공개**가 필요합니다
    // → docs/research/13 §4
    expect(text).toContain("개인정보 보호법 제28조의8 제1항 제3호");
    expect(text).toContain("고지를 갈음합니다");
  });

  it("ADR-043 의 두 약속이 그대로 적혀 있다", () => {
    const text = clauses();
    // 운영은 국내에서만 · 빌린 국외 GPU 에는 합성 데이터만
    expect(text).toContain("국내에서만 처리하는 것을 원칙");
    expect(text).toContain("합성(가짜) 자료만");
  });

  /**
   * ## 원칙만 적으면 읽는 사람은 국내로 읽습니다
   *
   * 전사·판독 서버는 **미국 버지니아**에 있습니다 — 2026-08-31 에 그 서버의
   * OCI 메타데이터(`us-ashburn-1`)로 확인했습니다. 그전까지 이 글은 소재지를
   * 「국내 원칙 · 국외일 수 있음」으로만 적었고, **원본 음성·이미지가 실제로
   * 국경을 넘는다는 사실**이 어디에도 없었습니다.
   */
  it("전사 서버가 지금 어디 있는지 단정해 적는다 — **회귀**", () => {
    const text = clauses();

    expect(text).not.toContain("국내 원칙 · 국외일 수 있음");
    expect(text).toContain("국외 (미국 버지니아)");
    // 원칙과 지금을 **나눠** 적습니다 — 원칙만 있으면 국내로 읽힙니다
    expect(text).toContain("지금 이 서비스의 전사·판독 서버는 미국에 있습니다");
  });

  /**
   * ## 1항이 4항과 부딪히고 있었습니다
   *
   * 1항이 *「계좌·전화·이름은 전송 전 브라우저에서 토큰으로 치환되며」* 라고
   * 적었는데, 브라우저 1차는 **정규식이라 한국 이름을 못 잡습니다.** 그리고
   * 올리신 녹음·이미지는 **읽어야 가릴 수 있어** 원본이 전사 서버를 지납니다 —
   * 4항이 그렇게 적고 있습니다. 같은 모달 안에서 두 조항이 다른 말을 했습니다.
   */
  it("1항이 이름을 브라우저가 가린다고 말하지 않는다 — **회귀**", () => {
    const text = clauses();

    expect(text).not.toContain("계좌·전화·이름은 전송 전 브라우저에서");
    // 어디서 가리는지를 나눠 적습니다
    expect(text).toContain("이 브라우저에서, 보내기 전에");
    expect(text).toContain("이름처럼 모양으로 못 가리는 것");
  });

  it("1항이 4항과 같은 말을 한다 — 원문이 전사까지 간다", () => {
    const text = clauses();

    expect(text).toContain("전사·판독까지는 원문");
    expect(text).toContain("가리기 전의 원본 음성·이미지");
  });

  it("주민등록번호를 안 받는다는 말은 그대로다 — ADR-026", () => {
    expect(clauses()).toContain("주민등록번호는 수집하지 않습니다");
  });

  it("조항은 다섯이다 — 화면이 「확인 N / 5」를 그립니다", () => {
    // 늘리면 `checks` 다섯 칸과 「N개 항목 확인 남음」이 어긋납니다 (ADR-031)
    const html = renderToStaticMarkup(<ConsentClauses checks={[]} onToggle={() => {}} />);
    expect(html.match(/확인했습니다/g)).toHaveLength(5);
  });
});

/**
 * 시연에서 파일을 손으로 고르지 않으려고 두는 자리 → `mock.ts`.
 *
 * **동작을 안 받으면 버튼을 안 그립니다.** `work-handler/panels.tsx` 가 적어 둔
 * 것과 같은 규칙입니다 — *"안 받은 값을 가리키는 것을 그리지 않습니다."*
 * 눌러도 아무 일 없는 버튼이 이 저장소에서 실제로 두 번 나왔습니다.
 */
describe("Mock 파일로 실행", () => {
  it("동작을 받으면 버튼이 그려진다", () => {
    expect(textOf(draw({ onMock: () => {} }))).toContain("Mock 파일로 실행");
  });

  it("**동작을 안 받으면 안 그린다** — 눌러도 아무 일 없는 버튼을 만들지 않습니다", () => {
    expect(textOf(draw())).not.toContain("Mock 파일로 실행");
  });

  it("사건을 만드는 중에는 못 누른다 — 슬롯 버튼과 같은 규칙", () => {
    const html = draw({ onMock: () => {}, busy: true });
    // 슬롯 넷 + Mock 하나. 하나라도 안 잠기면 그 사이에 목록이 바뀝니다
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(5);
  });

  /**
   * **화면이 예시라고 말합니다.** 심사위원이 실제 피해자 자료로 읽으면 안 되고,
   * ADR-043 이 「합성 데이터만 올립니다」를 절대 조건으로 걸어 둔 것과도 맞습니다.
   */
  it("Mock 으로 담긴 줄에는 표시가 붙는다", () => {
    const html = draw({
      picked: [{ ...pickedOne(0, "통화녹음.wav"), mock: true }],
    });
    expect(textOf(html)).toContain("Mock");
  });

  it("사람이 고른 줄에는 그 표시가 없다", () => {
    const html = draw({ picked: [pickedOne(1, "카톡캡처.png")] });
    expect(textOf(html)).not.toContain("Mock");
  });
});
