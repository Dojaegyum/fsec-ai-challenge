/**
 * `Workspace` 렌더 시험 — **부산물을 낼 자리가 실제로 그려지는가.**
 *
 * 2026-08-26 까지 이 자리가 없어서 완료 판정이 시작되지 못했습니다. 패널은
 * 있었지만 시안 값을 하드코딩했고 버튼에 동작이 없었습니다. 그래서 이 시험은
 * **「서버가 준 것이 그려지는가」와 「낼 자리가 있는가」** 둘을 겨눕니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Workspace } from "./workspace";
import type { FullStep } from "./workspace";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const step = (over: Partial<FullStep> = {}): FullStep =>
  ({
    step_id: "01JSTEP",
    seq: 1,
    state: "not_started",
    title: "112에 신고합니다",
    body: {
      action: "call",
      summary: "112는 24시간 받습니다.",
      steps: [
        { text: "112로 전화해 신고합니다.", action: "call", contact: "112" },
        { text: "끊기 전에 사건접수번호를 받아 적으세요.", action: "write" },
      ],
      required_artifact: { kind: "receipt_no", label: "사건접수번호" },
      ...(over.body ?? {}),
    },
    ...over,
  }) as FullStep;

const draw = (props: Partial<Parameters<typeof Workspace>[0]> = {}) =>
  renderToStaticMarkup(<Workspace step={step()} onSubmit={() => {}} {...props} />);

describe("서버가 준 것을 그립니다 — 화면이 지어내지 않습니다", () => {
  it("KB 의 요약과 줄이 그대로 나온다", () => {
    const text = textOf(draw());
    expect(text).toContain("112는 24시간 받습니다.");
    expect(text).toContain("112로 전화해 신고합니다.");
    expect(text).toContain("끊기 전에 사건접수번호를 받아 적으세요.");
  });

  it("부산물 이름은 `required_artifact` 에서 온다", () => {
    expect(textOf(draw())).toContain("사건접수번호");
  });

  it("전화번호는 서버가 `contact_ref` 를 푼 값이다", () => {
    expect(textOf(draw())).toContain("112");
  });
});

describe("어떤 패널을 여는가 — `body.action` 하나가 정합니다", () => {
  const eyebrowOf = (action: string) =>
    textOf(draw({ step: step({ body: { action } } as Partial<FullStep>) }));

  it("`call` 은 통화 패널", () => {
    expect(eyebrowOf("call")).toContain("통화");
  });

  it("`upload` 는 제출 패널", () => {
    expect(eyebrowOf("upload")).toContain("제출");
  });

  it("`wait` 는 기다리기 패널", () => {
    expect(eyebrowOf("wait")).toContain("기다리기");
  });

  it("**표 밖이면 아무것도 안 그린다** — 모르는 것을 「읽기만 하면 되는 것」으로 바꾸지 않습니다", () => {
    // 서버가 새 `action` 을 추가했는데 화면이 아직 모르는 경우입니다.
    // `WS-read` 로 떨어뜨리면 해야 할 일을 안 해도 되는 것처럼 보입니다
    expect(draw({ step: step({ body: { action: "sign" } } as Partial<FullStep>) })).toBe("");
  });

  it("`action` 이 아예 없으면 안 그린다", () => {
    expect(draw({ step: step({ body: {} } as Partial<FullStep>) })).toBe("");
  });

  it("열린 단계가 없으면 안 그린다", () => {
    expect(draw({ step: null })).toBe("");
  });
});

describe("부산물을 낼 자리 — 셋을 늘 함께 냅니다", () => {
  it("접수번호 칸과 「했다고 표시」는 늘 있다", () => {
    const html = draw();
    expect(html).toContain('placeholder="접수번호"');
    expect(textOf(html)).toContain("번호 없이 했다고 표시");
  });

  it("**파일 올리기는 낼 자리가 있을 때만** 그린다", () => {
    // 개발 경로(`?view=`)에는 사건 토큰이 없어 올릴 곳이 없습니다
    expect(textOf(draw())).not.toContain("접수증·캡처 올리기");
    expect(textOf(draw({ onPickFile: () => {} }))).toContain("접수증·캡처 올리기");
  });

  it("보내는 중에는 버튼이 잠긴다 — 두 번 눌러 두 줄이 남지 않게", () => {
    const html = draw({ onPickFile: () => {}, busy: true });
    expect(html).toContain("disabled");
    expect(textOf(html)).toContain("올리는 중…");
  });
});

describe("판정을 그립니다 — L1 실패가 막다른 길이 아닙니다", () => {
  it("실패하면 서버가 준 다음 길을 그대로 보여준다", () => {
    const text = textOf(
      draw({
        verdict: {
          verify_result: "failed",
          step_state: "in_progress",
          next_options: [
            { level: "L2", label: "접수 문자 캡처를 올려주세요" },
            { level: "L3", label: "번호 없이 접수했다고 표시" },
          ],
        },
      }),
    );
    expect(text).toContain("접수 문자 캡처를 올려주세요");
    expect(text).toContain("번호 없이 접수했다고 표시");
  });

  it("`unconfirmed` 는 완료가 아니라고 말한다", () => {
    const text = textOf(
      draw({ verdict: { verify_result: "not_applicable", step_state: "unconfirmed" } }),
    );
    expect(text).toContain("아직 완료로 기록하지 않았습니다");
  });

  it("**서버가 `note` 를 주면 그것을 그린다** — 왜 완료가 아닌지는 서버가 말합니다", () => {
    // 「번호 없이 했다고 표시」를 누른 자리입니다. 이유를 안 그리면 사용자에게는
    // 버튼이 안 먹은 것처럼 보입니다 → 08-14-api.md §3.8 「L3 자기 신고」
    const text = textOf(
      draw({
        verdict: {
          verify_result: "not_applicable",
          step_state: "unconfirmed",
          note: "완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요",
        },
      }),
    );
    expect(text).toContain("완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요");
    // 화면이 지어낸 기본 문구가 대신 나오면 안 됩니다
    expect(text).not.toContain("아직 완료로 기록하지 않았습니다");
  });

  it("**끝났으면 열린 단계를 함께 보여준다** — 증거 연쇄가 눈에 보여야 합니다", () => {
    const text = textOf(
      draw({
        verdict: {
          verify_result: "passed",
          step_state: "done_verified",
          unlocked_steps: [{ step_id: "01JNEXT", title: "피해구제를 신청합니다" }],
        },
      }),
    );
    expect(text).toContain("이 단계는 끝났습니다");
    expect(text).toContain("피해구제를 신청합니다");
  });
});

/**
 * **눌러도 아무 일 없는 버튼을 그리지 않습니다** — 2026-08-27 에 실제로 눌러
 * 확인한 것입니다.
 *
 * 패널들이 시안을 옮길 때 「저장」·「나중에 할게요」 같은 버튼을 본문에 박아
 * 뒀는데, 실제 호출부는 `title` 과 `children` 만 넘깁니다. 그래서 동작 없는
 * 버튼이 화면에 그대로 떠 있었습니다. 진짜 조작부는 `children`(부산물 자리)
 * 으로 옵니다.
 */
describe("죽은 버튼을 그리지 않는다", () => {
  const DEAD = ["나중에 할게요", "나중에 올릴게요", "나중에 받을게요", "기억이 안 나요", "나중에 입력할게요"];

  for (const action of ["call", "visit", "write", "upload", "download", "wait", "read"]) {
    it(`\`${action}\` 패널에 죽은 버튼이 없다`, () => {
      const html = draw({ step: step({ body: { action } } as Partial<FullStep>) });
      const text = textOf(html);
      for (const dead of DEAD) expect(text).not.toContain(dead);
      // **버튼만 봅니다.** 「형식이 달라도 저장됩니다」는 이 유형이 늘 하는 말이고
      // (spec 「형식이 틀려도 막지 않습니다」 L1) 값에 딸린 것이 아니라 남깁니다 —
      // 글자로 금지하면 그 설명까지 함께 지워집니다
      const labels = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) =>
        textOf(m[1]),
      );
      expect(labels).not.toContain("저장");
      // 빈 글자 버튼도 안 됩니다 — 「받기」의 파일 이름이 안 오면 이름 없는 버튼이 남았습니다
      expect(labels.filter((one) => one.length === 0)).toEqual([]);
    });
  }

  it("「읽기」에 근거가 없으면 「근거 ·」 만 남기지 않는다", () => {
    const text = textOf(draw({ step: step({ body: { action: "read" } } as Partial<FullStep>) }));
    expect(text).not.toContain("근거 ·");
  });
});

/**
 * **KB 에 적힌 주소와 번호는 눌러서 갑니다** — 옮겨 적게 하면 그 사이에 틀립니다.
 * `payinfo.or.kr`·`msafer.or.kr` 은 KB 에 있는데 화면에 링크가 없었습니다.
 */
describe("바깥으로 나가는 자리 — 눌러서 갑니다", () => {
  const withUrl = (url: string) =>
    step({
      body: {
        action: "visit",
        steps: [{ text: "여기서 조회합니다.", action: "visit", url }],
      },
    } as Partial<FullStep>);

  it("단계의 `url` 이 링크가 된다 — 새 탭으로", () => {
    const html = draw({ step: withUrl("https://www.payinfo.or.kr") });
    expect(html).toContain('href="https://www.payinfo.or.kr"');
    expect(html).toContain('target="_blank"');
    // 사건 토큰이 주소에 실려 있어 나가는 곳에 알리지 않습니다
    expect(html).toContain('rel="noreferrer"');
    expect(textOf(html)).toContain("payinfo.or.kr 열기");
  });

  it("**`https:` 가 아니면 안 그립니다** — 주소를 그대로 `href` 에 태우는 자리입니다", () => {
    const html = draw({ step: withUrl("javascript:alert(1)") });
    expect(html).not.toContain("javascript:");
    expect(textOf(html)).not.toContain("열기");
  });

  it("전화번호는 `tel:` 로 걸립니다", () => {
    expect(draw()).toContain('href="tel:112"');
  });

  it("**설명이 붙은 번호는 링크로 만들지 않습니다** — 눌러도 안 걸리는 링크가 더 나쁩니다", () => {
    const html = draw({
      step: step({
        body: {
          action: "call",
          steps: [{ text: "전화합니다.", action: "call", contact: "1332 (평일 9~18시)" }],
        },
      } as Partial<FullStep>),
    });
    expect(html).not.toContain("href=\"tel:");
    expect(textOf(html)).toContain("1332 (평일 9~18시)");
  });
});


/**
 * 일곱 유형을 **이 호출부로** 통과시킵니다.
 *
 * 이번 결함은 패널 안이 아니라 **호출부와 패널 사이의 틈**에서 났습니다 —
 * `Workspace` 는 `title` 과 `children` 만 넘기는데 패널들은 안 받은 값
 * (`script`·`exitLabel`·`fileLabel`·`from`·`to`·`source`…)을 조건 없이 그려서,
 * 빈 상자와 라벨 없는 버튼과 **없는 것을 가리키는 지시문**이 남았습니다.
 * 패널 단독 시험(`panels.test.tsx`)만으로는 이 틈이 안 잡힙니다.
 */
const emptyBoxes = (html: string) =>
  [...html.matchAll(/<(div|p|span)\b([^>]*)>\s*<\/\1>/g)]
    .map((m) => m[2])
    .filter((attrs) => /class="[^"]*(bg-|border|rounded)/.test(attrs));

const buttonLabels = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]));

const SEVEN: readonly [string, string][] = [
  ["call", "통화"],
  ["visit", "외부 이동"],
  ["write", "받아적기"],
  ["upload", "제출"],
  ["download", "받기"],
  ["wait", "기다리기"],
  ["read", "읽기"],
];

describe("일곱 유형이 호출부를 통과합니다 — 빈 자리를 남기지 않고", () => {
  /** 유형만 바꿔 같은 본문을 통과시킵니다 — `step()` 의 `over.body` 는 본문을 통째로 갈아탑니다 */
  const drawAction = (action: string) =>
    draw({
      step: step({
        body: {
          action,
          summary: "112는 24시간 받습니다.",
          steps: [{ text: "끊기 전에 사건접수번호를 받아 적으세요." }],
          required_artifact: { kind: "receipt_no", label: "사건접수번호" },
        },
      } as Partial<FullStep>),
    });

  for (const [action, eyebrow] of SEVEN) {
    it(`\`${action}\` → ${eyebrow} · 빈 상자가 없다`, () => {
      const html = drawAction(action);
      expect(textOf(html)).toContain(eyebrow);
      expect(emptyBoxes(html)).toEqual([]);
    });

    it(`\`${action}\` → ${eyebrow} · **라벨이 빈 버튼이 없다**`, () => {
      for (const label of buttonLabels(drawAction(action))) {
        expect(label).not.toBe("");
        expect(label).not.toMatch(/^[↗◆·—\s]+$/);
      }
    });

    it(`\`${action}\` → ${eyebrow} · 폭이 박힌 막대가 없다`, () => {
      // 화면은 날짜를 세지 않습니다(불변 규칙 7)
      expect(drawAction(action)).not.toMatch(/w-\[\d+(\.\d+)?%\]/);
    });
  }

  it("**「계좌번호는 그대로 적혀 있습니다」는 어느 유형에서도 안 나온다**", () => {
    // `WS-call` 은 `allowsFullRestore: false` 입니다 — 원문이 올 수 없는 패널이라
    // 값이 채워질 자리가 아니라 계약상 영원히 거짓인 문장이었습니다(불변 규칙 2)
    for (const [action] of SEVEN) {
      expect(textOf(drawAction(action))).not.toContain("계좌번호는 그대로 적혀 있습니다");
    }
  });

  it("서버가 준 본문은 일곱 어디서나 그대로 나온다", () => {
    for (const [action] of SEVEN) {
      expect(textOf(drawAction(action))).toContain("112는 24시간 받습니다.");
    }
  });
});

describe("부산물 칸은 **완료 개념이 있는 유형에만** 냅니다", () => {
  const has = (action: string) =>
    draw({ step: step({ body: { action } } as Partial<FullStep>) }).includes(
      'placeholder="접수번호"',
    );

  it("`call`·`visit`·`write`·`upload`·`download` 에는 낸다", () => {
    for (const action of ["call", "visit", "write", "upload", "download"]) {
      expect(has(action)).toBe(true);
    }
  });

  it("**`read`·`wait` 에는 안 낸다** — 완료 개념이 없는 유형입니다", () => {
    // spec 「WS-read 에 체크박스를 두지 마세요」·「WS-wait 은 사용자가 하지 않음」 ·
    // panel.ts 의 규칙 표 `hasCompletion: false`. 읽기만 하면 되는 자리에
    // 「번호 없이 했다고 표시」를 두면 **아무 절차도 안 밟고 단계가 「미확인」이 됩니다**
    for (const action of ["read", "wait"]) {
      expect(has(action)).toBe(false);
      expect(textOf(draw({ step: step({ body: { action } } as Partial<FullStep>) }))).not.toContain(
        "번호 없이 했다고 표시",
      );
    }
  });
});
