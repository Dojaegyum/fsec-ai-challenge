/**
 * @vitest-environment jsdom
 */

/**
 * 자료함 상호작용 시험 — **셸이 준 조회 상태를 화면이 어떻게 말하는가.**
 *
 * 계약: spec/common/08-14-api.md §3.3 · §3.1(에러) · CLAUDE.md 불변 규칙 5
 * 근거: ADR-078(폴링의 주인은 셸)
 *
 * ⚠️ **조회가 한 번 실패하면 「개인정보 보호 처리중」에 영영 멈췄습니다.**
 * 실패하면 폴링이 서는 것은 맞는데(§3.1 — 에러 응답을 스스로 다시 부르지
 * 않습니다), 실패했다는 말도, 사용자가 다시 물을 길도 없었습니다.
 *
 * ⚠️ **그리고 2026-09-06 까지 이 화면이 폴링을 직접 돌렸습니다.** 화면을 떠나면
 * 폴링이 함께 죽어 「처리중」이 25분 넘게 굳었습니다. 이제 묻는 것은 셸
 * (`useEvidenceReads` · `page.tsx`)이고, 이 화면은 **받은 상태를 그리고 「다시 확인」을
 * 셸에 알리기만** 합니다 — 그래서 여기서는 `fetch` 를 세우지 않습니다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RailFile } from "@/modules/file-sender";

import EvidenceView from "./evidence";
import type { EvidenceState } from "./load";
import type { Uploads } from "./upload";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const FILES: readonly RailFile[] = [
  { id: "f1", evidence_id: "01EVIDENCE", name: "통화녹음.wav", status: "processing" },
];

function uploadsOf(mark = vi.fn()): Uploads {
  return {
    files: FILES,
    busy: false,
    fail: null,
    add: async () => null,
    select: () => {},
    selectedId: "f1",
    mark,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const draw = async (ui: React.ReactElement) => {
  await act(async () => {
    root.render(ui);
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const FAILED: EvidenceState = {
  phase: "failed",
  fail: { poll: false, reason: "error", retryable: true, message: "전사 상태를 확인하지 못했습니다." },
};

const readOf = (over: Record<string, unknown> = {}): EvidenceState => ({
  phase: "ready",
  read: {
    evidence_id: "01EVIDENCE",
    ingest_status: "done",
    transcript: [{ speaker: "A", text: "[계좌-1] 로 보내라", start_ms: 0 }],
    pii_tokens: [{ token: "[계좌-1]", kind: "계좌" }],
    shortfalls: [],
    ...over,
  },
  verdict: { poll: false, reason: "done" },
});

describe("조회가 끊겨도 화면이 멈추지 않는다 — §3.1", () => {
  it("**실패를 말하고 「다시 확인」을 낸다** — 조용한 「처리중」이 아니라", async () => {
    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} server={FAILED} again={() => {}} />);

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("전사 상태를 확인하지 못했습니다");
    const retry = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("다시 확인"),
    );
    expect(retry).toBeTruthy();
    // 멈춘 **본문**이 「처리중」이라고 말하면 사용자는 영영 기다립니다.
    // 왼쪽 레일의 줄 라벨은 별개입니다 — 올리던 순간의 상태라 그대로 둡니다
    expect(host.textContent).not.toContain("끝나면 전사가 여기 뜹니다");
  });

  it("「다시 확인」을 누르면 셸에 알린다 — 다시 묻는 것은 셸이다", async () => {
    const again = vi.fn();
    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} server={FAILED} again={again} />);
    const retry = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("다시 확인"),
    );
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(again).toHaveBeenCalledTimes(1);
  });

  it("서버를 직접 부르지 않는다 — 폴링은 셸의 몫이다", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);

    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} server={{ phase: "loading" }} again={() => {}} />);

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("처리 상태의 주인은 서버다", () => {
  it("레일 줄이 아직 processing 이어도 서버가 done 이면 전사문을 그린다", async () => {
    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} server={readOf()} again={() => {}} />);

    expect(host.textContent).toContain("[계좌-1] 로 보내라");
    expect(host.textContent).not.toContain("끝나면 전사가 여기 뜹니다");
  });

  it("서버가 failed 라 하면 「읽어내지 못했습니다」 — 올리기 실패와 뭉치지 않는다", async () => {
    await draw(
      <EvidenceView
        token={TOKEN}
        uploads={uploadsOf()}
        server={readOf({ ingest_status: "failed", reason: "empty", transcript: undefined })}
        again={() => {}}
      />,
    );

    expect(host.textContent).toContain("읽어내지 못했습니다");
    expect(host.textContent).not.toContain("올리지 못했습니다");
  });
});

/**
 * §3.3 `shortfalls[]` 회귀 — 감사(2026-09-06). 서버는 이미 내고 있었는데
 * (`flows/read-evidence.ts`) 이 화면이 응답을 받고도 버리고 있었습니다.
 */
describe("기계가 못 읽은 것을 숨기지 않는다 — §3.3 shortfalls", () => {
  it("전사 목록 아래에 무엇을 못 읽었는지 말한다", async () => {
    await draw(
      <EvidenceView
        token={TOKEN}
        uploads={uploadsOf()}
        server={readOf({ shortfalls: ["no_layout", "truncated"] })}
        again={() => {}}
      />,
    );

    expect(host.textContent).toContain("대화창의 좌·우 구조를 갈라내지 못했습니다.");
    expect(host.textContent).toContain("내용이 길어 앞부분만 읽었습니다.");
  });

  it("못 읽은 것이 없으면 그 줄이 없다 — 지어내지 않는다", async () => {
    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} server={readOf()} again={() => {}} />);

    expect(host.textContent).not.toContain("갈라내지 못했습니다");
  });
});
