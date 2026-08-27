/**
 * 증거함 렌더 시험 — **실제 전사문에 남의 계좌번호가 끼워지던 것**을 막습니다.
 *
 * 계약: spec/frontend/08-14-screens.md §S-08 · spec/common/08-14-api.md §3.3
 * 근거: ADR-009(복원은 브라우저) · ADR-026(못 가리면 그 파일만 빼고 진행) ·
 *       ADR-034(화면은 원문) · ADR-050(열쇠 없는 기기)
 *
 * ⚠️ **2026-08-27 까지 되살리는 표가 조건 없이 개발용 예시였습니다.** 전사문 줄은
 * 서버에서 오는데 표만 픽스처라, 실제 피해자의 전사문에 `김민수`·`110-2345-678901`
 * 이 그려지고 바로 아래 푸터가 「이 화면은 원문입니다」라고 단언했습니다.
 * **사용자가 그 번호를 피해구제 신청서에 옮겨 적을 수 있었습니다.**
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { RailFile } from "@/modules/file-sender";

import EvidenceView from "./evidence";
import type { Uploads } from "./upload";

const textOf = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

const uploadsOf = (files: readonly RailFile[] = []): Uploads => ({
  files,
  busy: false,
  fail: null,
  add: async () => null,
  select: () => {},
  selectedId: files[0]?.id,
});

const railFile = (over: Partial<RailFile> = {}): RailFile => ({
  id: "local-1",
  name: "통화녹음.m4a",
  status: "done",
  evidence_id: "01J8XKQZ3M7N2P4R6T8V0W2Y4A",
  ...over,
});

describe("자료가 하나도 없어도 죽지 않는다", () => {
  it("빈 목록으로 열어도 렌더가 끝난다", () => {
    // ⚠️ `files[0]` 을 그냥 읽던 자리라 **화면이 통째로 죽었습니다.**
    // 빈 상태 분기가 아래에 이미 있었는데 그 앞줄이 먼저 터졌습니다
    const text = textOf(
      renderToStaticMarkup(<EvidenceView token="T" uploads={uploadsOf([])} restorable={[]} />),
    );
    expect(text).toContain("아직 올리신 자료가 없습니다");
  });

  it("증거가 관문이 아니라고 말한다", () => {
    const text = textOf(
      renderToStaticMarkup(<EvidenceView token="T" uploads={uploadsOf([])} restorable={[]} />),
    );
    expect(text).toContain("없어도 사건은");
  });
});

describe("실패의 뜻을 뭉개지 않는다", () => {
  it("올리다 끊긴 것을 「주민등록번호를 못 가려서」라고 말하지 않는다", () => {
    // `file-sender` 가 정확히 이 사고를 조심하라고 주석에 적어 둔 자리입니다.
    // 파일 속 주민번호 검출은 아직 미결이라 그 판정 자체가 일어나지 않습니다 (ADR-026)
    const text = textOf(
      renderToStaticMarkup(
        <EvidenceView
          token="T"
          uploads={uploadsOf([railFile({ status: "failed", evidence_id: undefined })])}
          restorable={[]}
        />,
      ),
    );
    expect(text).not.toContain("주민등록번호를 못 가려서");
    expect(text).toContain("올리지 못했습니다");
    // **막지 않습니다** — 사건은 그대로 진행됩니다 (불변 규칙 5)
    expect(text).toContain("사건은 그대로 진행됩니다");
  });

  it("갈림길에 실제로 누를 것이 있다", () => {
    // 「막지 않고 갈림길을 준다」가 갈림길 없이 문구만 남아 있었습니다
    const html = renderToStaticMarkup(
      <EvidenceView
        token="T"
        uploads={uploadsOf([railFile({ status: "failed", evidence_id: undefined })])}
        restorable={[]}
      />,
    );
    expect(html).toContain("다른 파일 올리기");
    // 「없이 진행」은 누를 것이 없어 버튼으로 두지 않습니다
    expect(html).not.toContain("없이 진행");
  });

  it("빨강을 쓰지 않는다 — 앰버까지입니다 (ADR-026)", () => {
    const html = renderToStaticMarkup(
      <EvidenceView
        token="T"
        uploads={uploadsOf([railFile({ status: "failed", evidence_id: undefined })])}
        restorable={[]}
      />,
    );
    expect(html).not.toMatch(/text-red|bg-red|border-red/);
  });
});

describe("픽스처 원문이 실서버 경로로 새지 않는다", () => {
  it("개발 경로가 아니면 예시 매핑을 쓰지 않는다", () => {
    // 이 사건에 없는 값을 「원문」이라고 말하면 그 번호가 서류로 옮겨 갑니다
    const html = renderToStaticMarkup(
      <EvidenceView token="T" uploads={uploadsOf([railFile()])} restorable={[]} />,
    );
    expect(html).not.toContain("김민수");
    expect(html).not.toContain("110-2345-678901");
  });
});

describe("열쇠가 없으면 그 이유를 말한다 — ADR-050", () => {
  it("잠긴 기기에서는 「원문입니다」라고 단언하지 않는다", () => {
    const text = textOf(
      renderToStaticMarkup(
        <EvidenceView token="T" uploads={uploadsOf([railFile()])} restorable={[]} locked />,
      ),
    );
    expect(text).toContain("여는 열쇠가 없습니다");
    expect(text).not.toContain("이 화면은 원문입니다");
  });
});
