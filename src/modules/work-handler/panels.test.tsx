/**
 * 패널 일곱 렌더 시험 — **안 받은 값을 가리키지 않는가.**
 *
 * 2026-08-27 까지 패널들은 호출부가 **넘기지도 않은 값**(`script`·`exitLabel`·
 * `fileLabel`·`from`·`to`·`source`…)을 조건 없이 그렸습니다. 호출부인
 * `workspace.tsx` 는 `title` 과 `children` 만 넘깁니다.
 *
 * 그래서 화면에 남은 것이
 *  · 빈 상자와 **라벨이 빈 전폭 검은 버튼**
 *  · 「돌아오실 때 이걸 들고 오세요 ◆」 뒤의 빈칸 · 「근거 · 」 뒤의 빈칸
 *  · 어느 사건에서나 38% 인 진행 막대
 *  · 그리고 **없는 것을 가리키는 지시문** — 「계좌번호는 그대로 적혀 있습니다.
 *    보고 읽으시면 됩니다」가 지급정지 요청 통화 중인 사람 앞에.
 *
 * 이 시험은 **일곱을 전부 세워 놓고** 그 모양이 하나도 없는지 봅니다.
 * 짝인 `workspace.test.tsx` 는 같은 것을 호출부로 통과시켜 봅니다 —
 * 결함이 패널 안이 아니라 **호출부와 패널 사이의 틈**에서 났기 때문입니다.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CallPanel,
  DownloadPanel,
  ReadPanel,
  UploadPanel,
  VisitPanel,
  WaitPanel,
  WritePanel,
} from "./panels";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/**
 * 내용이 없는데 **테두리·바탕·모서리를 가진** 요소 — 화면에는 빈 상자로 보입니다.
 *
 * 골격의 여백용 `<div class="mt-3">` 은 눈에 안 보이므로 세지 않습니다.
 */
const emptyBoxes = (html: string) =>
  [...html.matchAll(/<(div|p|span)\b([^>]*)>\s*<\/\1>/g)]
    .map((m) => m[2])
    .filter((attrs) => /class="[^"]*(bg-|border|rounded)/.test(attrs));

/** 버튼마다 사람이 읽게 되는 글자. 빈 문자열이면 **누르라고 내놓은 빈 칸**입니다 */
const buttonLabels = (html: string) =>
  [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => textOf(m[1]));

/** 「◆」·「↗」 같은 장식만 남은 라벨도 빈 것과 같습니다 */
const isBlankLabel = (label: string) => label === "" || /^[↗◆·—\s]+$/.test(label);

const T = "송금한 은행에 지급정지 요청";

/** 일곱을 **값 없이** 세웁니다 — 호출부가 오늘 실제로 넘기는 것이 `title` 뿐입니다 */
const BARE: readonly [string, (p: { title: string }) => React.ReactElement][] = [
  ["통화", CallPanel],
  ["외부 이동", VisitPanel],
  ["받아적기", WritePanel],
  ["제출", UploadPanel],
  ["받기", DownloadPanel],
  ["기다리기", WaitPanel],
  ["읽기", ReadPanel],
];

/** 같은 일곱을 **값은 다 주고 동작은 안 주고** 세웁니다 — 죽은 버튼이 나오는 자리입니다 */
const WITH_VALUES: readonly [string, React.ReactElement][] = [
  ["통화", <CallPanel key="call" title={T} script="접수번호를 불러 달라고 하세요" />],
  [
    "외부 이동",
    <VisitPanel
      key="visit"
      title={T}
      bring="사건사고사실확인원"
      why="피해구제 신청에 필요합니다"
      exitLabel="은행 앱 열기"
      note="돌아오시면 이어서 안내합니다"
    />,
  ],
  ["받아적기", <WritePanel key="write" title={T} why="접수번호가 다음 단계의 열쇠입니다" />],
  ["제출", <UploadPanel key="upload" title={T} />],
  [
    "받기",
    <DownloadPanel
      key="download"
      title={T}
      fields={[{ label: "예금주", value: "홍길동" }]}
      fileLabel="신청서 내려받기"
    />,
  ],
  [
    "기다리기",
    <WaitPanel key="wait" title={T} body="금융감독원이 진행합니다" footer="사용자가 할 일은 없습니다" />,
  ],
  ["읽기", <ReadPanel key="read" title={T} body="자율배상은 대상 진단까지입니다" source="통신사기피해환급법 제4조" />],
];

describe("값을 안 넘기면 — 빈 상자도 죽은 버튼도 남지 않습니다", () => {
  for (const [eyebrow, Panel] of BARE) {
    const html = () => renderToStaticMarkup(<Panel title={T} />);

    it(`${eyebrow} — 눈썹과 제목은 나온다`, () => {
      const text = textOf(html());
      expect(text).toContain(eyebrow);
      expect(text).toContain(T);
    });

    it(`${eyebrow} — 내용 없는 상자를 그리지 않는다`, () => {
      expect(emptyBoxes(html())).toEqual([]);
    });

    it(`${eyebrow} — **동작을 안 받았으면 버튼이 아예 없다**`, () => {
      // 눌러도 아무 일이 없는 버튼은 「막지 않음」이 아니라 「막힌 것처럼 보임」입니다
      expect(buttonLabels(html())).toEqual([]);
    });
  }
});

describe("값을 다 주고 동작을 안 줘도 — 죽은 «주» 버튼은 안 그립니다", () => {
  for (const [eyebrow, element] of WITH_VALUES) {
    it(`${eyebrow} — 라벨만으로 버튼을 만들지 않는다`, () => {
      const html = renderToStaticMarkup(element);
      // `WS-visit` 의 「{exitLabel} ↗」·`WS-download` 의 「{fileLabel}」이 여기서 났습니다
      expect(buttonLabels(html)).toEqual([]);
      expect(html).not.toMatch(/>\s*↗\s*</);
    });

    it(`${eyebrow} — 빈 상자·빈 라벨이 없다`, () => {
      const html = renderToStaticMarkup(element);
      expect(emptyBoxes(html)).toEqual([]);
      for (const label of buttonLabels(html)) expect(isBlankLabel(label)).toBe(false);
    });

    it(`${eyebrow} — **폭이 박힌 막대가 없다**`, () => {
      // 화면은 날짜를 세지 않습니다(불변 규칙 7). 진행률은 서버가 계산해 내립니다
      const html = renderToStaticMarkup(element);
      expect(html).not.toMatch(/w-\[\d+(\.\d+)?%\]/);
      expect(html).not.toMatch(/style="[^"]*width/);
    });
  }
});

describe("통화 — 없는 것을 읽으라고 하지 않습니다", () => {
  it("대본이 없으면 대본 상자가 없다", () => {
    const html = renderToStaticMarkup(<CallPanel title={T} />);
    expect(emptyBoxes(html)).toEqual([]);
  });

  it("**「계좌번호는 그대로 적혀 있습니다」가 대본 없이는 안 나온다**", () => {
    const text = textOf(renderToStaticMarkup(<CallPanel title={T} />));
    expect(text).not.toContain("계좌번호는 그대로 적혀 있습니다");
    expect(text).not.toContain("보고 읽으시면 됩니다");
  });

  it("**대본이 와도 안 나온다** — `WS-call` 은 `allowsFullRestore: false` 입니다", () => {
    // panel.ts 의 규칙 표 · spec 「WS-download 가 PII 전체 복원이 허용된 유일한 작업
    // 패널입니다」 · 불변 규칙 2. 계좌번호 원문이 이 패널에 올 수 없으므로,
    // 「그대로 적혀 있다」는 값이 채워질 자리가 아니라 계약상 영원히 거짓입니다
    const text = textOf(
      renderToStaticMarkup(<CallPanel title={T} script="접수번호를 불러 달라고 하세요" />),
    );
    expect(text).toContain("접수번호를 불러 달라고 하세요");
    expect(text).not.toContain("계좌번호는 그대로 적혀 있습니다");
  });

  it("받아적기 칸을 제 손으로 그리지 않는다 — 칸이 둘이 되면 하나는 가짜입니다", () => {
    const html = renderToStaticMarkup(<CallPanel title={T} script="대본" />);
    expect(html).not.toContain("<input");
  });

  it("부산물 자리는 `children` 으로 온다", () => {
    const html = renderToStaticMarkup(
      <CallPanel title={T}>
        <p>사건접수번호</p>
      </CallPanel>,
    );
    expect(textOf(html)).toContain("사건접수번호");
  });
});

describe("외부 이동 — 들고 올 것과 나갈 곳", () => {
  it("들고 올 것이 없으면 「돌아오실 때 이걸 들고 오세요」도 없다", () => {
    const text = textOf(renderToStaticMarkup(<VisitPanel title={T} />));
    expect(text).not.toContain("돌아오실 때 이걸 들고 오세요");
    expect(text).not.toContain("◆");
  });

  it("나갈 곳이 없으면 **화살표 하나짜리 전폭 버튼**이 없다", () => {
    const html = renderToStaticMarkup(<VisitPanel title={T} exitLabel="은행 앱 열기" />);
    expect(html).not.toMatch(/>\s*↗\s*</);
    expect(buttonLabels(html)).toEqual([]);
  });

  it("값과 동작이 오면 정상으로 그린다", () => {
    const html = renderToStaticMarkup(
      <VisitPanel
        title={T}
        bring="사건사고사실확인원"
        why="피해구제 신청에 필요합니다"
        exitLabel="은행 앱 열기"
        onExit={() => {}}
        onLater={() => {}}
      />,
    );
    const text = textOf(html);
    expect(text).toContain("돌아오실 때 이걸 들고 오세요");
    expect(text).toContain("사건사고사실확인원");
    expect(buttonLabels(html)).toEqual(["은행 앱 열기 ↗", "나중에 할게요"]);
  });

  it("「나중에」는 **막지 않되 받는 손이 있을 때만** 그린다", () => {
    expect(buttonLabels(renderToStaticMarkup(<VisitPanel title={T} />))).toEqual([]);
    expect(
      buttonLabels(renderToStaticMarkup(<VisitPanel title={T} onLater={() => {}} />)),
    ).toEqual(["나중에 할게요"]);
  });
});

describe("받아적기 — 입력칸은 하나여야 합니다", () => {
  it("제 입력칸과 「저장」을 그리지 않는다", () => {
    // 위엣칸은 아무 데도 안 보내서, 사용자가 접수번호를 치고 「저장」을 누르면 사라졌습니다
    const html = renderToStaticMarkup(<WritePanel title={T} why="접수번호가 열쇠입니다" />);
    expect(html).not.toContain("<input");
    expect(buttonLabels(html)).not.toContain("저장");
  });

  it("「형식이 달라도 저장됩니다」는 남는다 — 값에 딸린 문장이 아닙니다", () => {
    const text = textOf(renderToStaticMarkup(<WritePanel title={T} />));
    expect(text).toContain("형식이 달라도 저장됩니다");
    expect(text).toContain("확인 필요");
  });
});

describe("제출 — 올리는 길은 하나입니다", () => {
  it("**받는 손이 없는 드롭존을 그리지 않는다**", () => {
    const html = renderToStaticMarkup(<UploadPanel title={T} />);
    expect(textOf(html)).not.toContain("끌어다 놓거나 눌러서 선택");
    expect(html).not.toContain("<input");
  });

  it("「올려도 되는 이유」는 남는다", () => {
    const text = textOf(renderToStaticMarkup(<UploadPanel title={T} />));
    expect(text).toContain("브라우저에서 가린 뒤");
  });
});

describe("받기 — 원문이 있을 때만 원문이라고 말합니다", () => {
  it("기재 항목이 없으면 상자도 경고도 없다", () => {
    const html = renderToStaticMarkup(<DownloadPanel title={T} />);
    expect(emptyBoxes(html)).toEqual([]);
    expect(textOf(html)).not.toContain("이 화면은 원문입니다");
  });

  it("파일 이름만 오고 받는 동작이 없으면 **글자 없는 검은 버튼**을 안 그린다", () => {
    const html = renderToStaticMarkup(<DownloadPanel title={T} fileLabel="신청서 내려받기" />);
    expect(buttonLabels(html)).toEqual([]);
  });

  it("항목과 동작이 오면 원문과 경고를 함께 그린다", () => {
    const html = renderToStaticMarkup(
      <DownloadPanel
        title={T}
        fields={[{ label: "예금주", value: "홍길동" }]}
        fileLabel="신청서 내려받기"
        onDownload={() => {}}
      />,
    );
    const text = textOf(html);
    expect(text).toContain("예금주");
    expect(text).toContain("홍길동");
    expect(text).toContain("이 화면은 원문입니다");
    expect(buttonLabels(html)).toEqual(["신청서 내려받기"]);
  });
});

describe("기다리기 — 카운트다운을 만들지 않습니다", () => {
  it("**폭이 박힌 진행 막대가 없다**", () => {
    // spec 「WS-wait 에 진행률 막대를 D-day 처럼 쓰지 마세요」 · panel.ts 의
    // `WS-wait` 규칙 「카운트다운을 만들지 마세요」 · 불변 규칙 7
    const html = renderToStaticMarkup(
      <WaitPanel title={T} body="금융감독원이 진행합니다" footer="할 일은 없습니다" />,
    );
    expect(html).not.toMatch(/w-\[\d+(\.\d+)?%\]/);
    expect(html).not.toMatch(/style="[^"]*width/);
    expect(html).not.toContain("aria-hidden");
  });

  it("본문과 꼬리말은 값이 올 때만 그린다", () => {
    expect(emptyBoxes(renderToStaticMarkup(<WaitPanel title={T} />))).toEqual([]);
    const text = textOf(renderToStaticMarkup(<WaitPanel title={T} body="공고가 돕니다" />));
    expect(text).toContain("공고가 돕니다");
  });
});

describe("읽기 — 빈 「근거 ·」를 남기지 않습니다", () => {
  it("근거가 없으면 줄째 없다 — 근거 없는 안내는 불변 규칙 1 이 막는 모양입니다", () => {
    const text = textOf(renderToStaticMarkup(<ReadPanel title={T} body="사각지대가 있습니다" />));
    expect(text).toContain("사각지대가 있습니다");
    expect(text).not.toContain("근거");
  });

  it("근거가 오면 그린다", () => {
    const text = textOf(
      renderToStaticMarkup(<ReadPanel title={T} source="통신사기피해환급법 제4조" />),
    );
    expect(text).toContain("근거 · 통신사기피해환급법 제4조");
  });

  it("완료 개념이 없는 유형이라 버튼이 없다", () => {
    const html = renderToStaticMarkup(<ReadPanel title={T} body="읽기만 하면 됩니다" />);
    expect(buttonLabels(html)).toEqual([]);
    expect(html).not.toContain('type="checkbox"');
  });
});
