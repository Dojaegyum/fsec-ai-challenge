/**
 * 랜딩 ③ 「화면 소개」 렌더 시험 — **실제 화면 컴포넌트를 그림의 자격으로만 세운다.**
 *
 * 계약: spec/frontend/08-14-screens.md §S-04 「스크롤 네 마디」 ③
 * 근거: ADR-029(스크롤 허용 · 행동은 하나 · ③은 기능 목록이 아니다)
 *
 * 2026-09-06 까지 이 자리는 와이어프레임 장식이었습니다. 실물로 바꾸면서 지켜야 할 것:
 *  · 장면 넷은 **보이기만** 합니다 — `inert` 라 눌리지도, 탭 순서에 들지도 않습니다.
 *    그래야 랜딩의 행동이 여전히 [지금 시작하기] 하나입니다
 *  · 스크롤해 내려왔을 때 **이미 다 그려진 채**여야 합니다 — 안쪽 등장 계단을 끕니다
 *  · 값은 `?view=` 개발 경로와 같은 픽스처입니다 — **새 값을 짓지 않습니다**
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import LandingScenes from "./scenes";

const html = renderToStaticMarkup(<LandingScenes />);
const textOf = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const text = textOf(html);

describe("장면 넷 — 챗 · 할 일 · 증거함 · 서류", () => {
  it("넷이 각자 자리로 그려진다", () => {
    for (const id of ["chat", "todo", "evidence", "doc"]) {
      expect(html).toContain(`data-scene="${id}"`);
    }
    expect(html.match(/data-scene="/g)?.length).toBe(4);
  });

  it("그림 자리는 전부 inert · aria-hidden — 눌리지도 읽히지도 않습니다", () => {
    const frames = html.match(/<div[^>]*data-scene-frame[^>]*>/g) ?? [];
    expect(frames.length).toBe(4);
    for (const frame of frames) {
      expect(frame).toMatch(/\binert(=""|\b)/);
      expect(frame).toContain('aria-hidden="true"');
    }
  });

  it("안쪽 등장 계단은 꺼 둔다 — 내려왔을 때 이미 서 있어야 합니다", () => {
    const frames = html.match(/<div[^>]*data-scene-frame[^>]*>/g) ?? [];
    for (const frame of frames) expect(frame).toContain(".rise]:animate-none");
  });
});

describe("값은 개발 경로의 픽스처 그대로", () => {
  it("챗은 되묻기 문항까지 그린다 — 진술 → 절차가 보이는 장면", () => {
    expect(text).toContain("돈이 어떻게 나갔나요?");
    expect(text).toContain("아까 검찰이라면서 전화가 와서");
  });

  it("할 일 레일은 단계 제목을 그린다", () => {
    expect(text).toContain("피해구제 신청서 제출");
  });

  it("증거함은 자료 레일의 파일을 그린다", () => {
    expect(text).toContain("0812_수신전화.m4a");
  });
});

describe("설명은 한 줄 — ③은 기능 목록이 아닙니다 (ADR-029)", () => {
  it("장면마다 캡션 문단이 하나뿐이다", () => {
    const cards = html.split('data-scene="').slice(1);
    for (const card of cards) {
      const captions = card.match(/data-scene-caption/g) ?? [];
      expect(captions.length).toBe(1);
    }
  });
});
