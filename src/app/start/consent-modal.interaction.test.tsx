// @vitest-environment jsdom
/**
 * 동의 모달의 키보드·낭독기 동작 — 시험.
 *
 * 검증 대상: spec/frontend/design-system/08-16-accessibility.md (대화상자) ·
 *            WCAG 2.1.2(키보드 함정 없음) · 2.4.3(포커스 순서)
 *
 * 2026-09-06 배포본 점검에서 모달이 열려도 포커스가 뒤 화면(Q1·[다음])에 남아 있었고
 * Esc 로 닫히지 않았습니다 — 낭독기 사용자는 Tab 을 11번 눌러야 동의 문서에 닿았습니다.
 * `aria-modal` 표시는 아무것도 옮기지 않습니다. 옮기는 것은 코드입니다.
 *
 * 정적 HTML 로는 못 봅니다 — 포커스는 상태이고 키 입력은 사건입니다. 그래서 이 파일만
 * jsdom 입니다 (`vitest.config.mts` 참고).
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConsentModal } from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  opener = document.createElement("button");
  opener.textContent = "동의 전문 보기";
  document.body.appendChild(opener);
  opener.focus();

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  opener.remove();
});

function open(onClose = vi.fn()) {
  act(() => {
    root.render(
      <ConsentModal
        checks={[false, false, false, false, false]}
        onToggle={() => {}}
        onCheckAll={() => {}}
        onAgree={() => {}}
        onClose={onClose}
      />,
    );
  });
  return onClose;
}

const key = (init: KeyboardEventInit) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });

describe("동의 모달 — 키보드·낭독기", () => {
  it("열리면 포커스가 대화상자 안으로 들어간다", () => {
    open();
    const dialog = host.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(dialog!.contains(document.activeElement)).toBe(true);
  });

  it("Esc 로 닫힌다", () => {
    const onClose = open();

    key({ key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Tab 이 대화상자 밖으로 나가지 않는다 — 마지막에서 첫 단추로", () => {
    open();
    const buttons = host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
    const last = buttons[buttons.length - 1];
    last.focus();

    key({ key: "Tab" });

    expect(document.activeElement).toBe(buttons[0]);
  });

  it("Shift+Tab 은 첫 단추에서 마지막으로", () => {
    open();
    const buttons = host.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
    buttons[0].focus();

    key({ key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
  });

  it("닫히면 포커스가 열었던 단추로 돌아간다", () => {
    open();
    expect(document.activeElement).not.toBe(opener);

    act(() => root.render(null));

    expect(document.activeElement).toBe(opener);
  });
});
