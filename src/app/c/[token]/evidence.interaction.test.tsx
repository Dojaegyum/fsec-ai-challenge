/**
 * @vitest-environment jsdom
 */

/**
 * 자료함 상호작용 시험 — **조회가 끊겼을 때 화면이 멈추지 않는가.**
 *
 * 계약: spec/common/08-14-api.md §3.3 · §3.1(에러) · CLAUDE.md 불변 규칙 5
 *
 * ⚠️ **조회가 한 번 실패하면 「개인정보 보호 처리중」에 영영 멈췄습니다.**
 * 실패하면 폴링이 서는 것은 맞는데(§3.1 — 에러 응답을 스스로 다시 부르지
 * 않습니다), 실패했다는 말도, 사용자가 다시 물을 길도 없었습니다. 새로고침
 * 말고는 할 것이 없었습니다.
 *
 * 그리고 **레일의 처리 상태가 서버 응답으로 안 바뀌었습니다** — 오른쪽에
 * 전사문이 다 떠 있는데 왼쪽 줄은 계속 깜빡였습니다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RailFile } from "@/modules/file-sender";

import EvidenceView from "./evidence";
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

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

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

describe("조회가 끊겨도 화면이 멈추지 않는다 — §3.1", () => {
  it("**실패를 말하고 「다시 확인」을 낸다** — 조용한 「처리중」이 아니라", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );

    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} />);

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

  it("「다시 확인」을 누르면 처음부터 다시 묻는다", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        if (calls === 1) throw new TypeError("network");
        return json({
          evidence_id: "01EVIDENCE",
          ingest_status: "done",
          transcript: [{ speaker: "A", text: "[계좌-1] 로 보내라", start_ms: 0 }],
          pii_tokens: [{ token: "[계좌-1]", kind: "계좌" }],
          shortfalls: [],
        });
      }),
    );

    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf()} />);
    const retry = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("다시 확인"),
    );
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.textContent).toContain("[계좌-1] 로 보내라");
  });
});

describe("처리 상태의 주인은 서버다 — 레일도 그 값으로", () => {
  it("전사가 끝나면 레일 줄을 done 으로 맞춘다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          evidence_id: "01EVIDENCE",
          ingest_status: "done",
          transcript: [],
          pii_tokens: [],
          shortfalls: [],
        }),
      ),
    );
    const mark = vi.fn();

    await draw(<EvidenceView token={TOKEN} uploads={uploadsOf(mark)} />);

    expect(mark).toHaveBeenCalledWith("01EVIDENCE", "done");
  });
});
