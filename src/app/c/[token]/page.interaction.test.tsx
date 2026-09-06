/**
 * @vitest-environment jsdom
 */

/**
 * 워크스페이스 패널의 안내 — **낸 직후에도 서버의 말이 그대로 서 있는가.**
 *
 * 계약: spec/common/08-14-api.md §3.8 · §3.10 · spec/frontend/08-14-screens.md §S-06
 * 근거: ADR-077(L2 는 판독 결과로 판정한다) · CLAUDE.md 불변 규칙 6
 *
 * ⚠️ **검토 1회차가 잡은 자리입니다.** 안내를 판독 결과로 갈아끼우는 배선
 * (`artifact.settle`)이 **번들이 바뀔 때마다** 도는데, 부산물을 막 냈을 때의
 * 번들은 **그 부산물을 아직 모릅니다.** 그대로 갈아끼우면 서버가 방금 한 말이
 * 낸 순간에 사라집니다 — L3 「번호 없이 접수했다고 표시」는 판독이 뒤집을 것이
 * 아예 없는데도 일반 문구(「아직 완료로 기록하지 않았습니다.」)로 덮였습니다.
 *
 * 훅 단독 시험은 `artifact.interaction.test.tsx` 에 있습니다. 여기는 **화면
 * 전체를 마운트해** 셸의 효과 → 훅 → 패널까지가 이어지는지를 봅니다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const STEP_ID = "01J8STEP0000000000000000AA";

vi.mock("next/navigation", () => ({
  useParams: () => ({ token: TOKEN }),
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ push: vi.fn() }),
}));

import CasePage from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** §3.8 L3 응답 — **`verify_detail` 이 없습니다.** 문구 정본은 §3.8 */
const SELF_REPORT = "완료로 기록되지 않습니다. 접수번호를 확인하시면 알려주세요";

/** §3.10 합본 하나 — 지금 할 단계 하나가 열려 있습니다 */
const BUNDLE = {
  case_id: "01J8CASE000000000000000000",
  track: "victim",
  created_at: "2026-09-06T09:00:00+09:00",
  last_activity_at: "2026-09-06T09:10:00+09:00",
  purge_after: "2027-03-05",
  slots: { slots: [], next_question: null, tier_status: {} },
  deadlines: { deadlines: [] },
  plan: {
    is_superset: false,
    kb_version: "2026.09.4",
    generated_at: "2026-09-06T09:00:00+09:00",
    channels: [],
    steps: [
      {
        step_id: STEP_ID,
        seq: 10,
        title: "112에 신고합니다",
        state: "not_started",
        actor: "victim",
        conditional: null,
        body: {
          action: "call",
          contact: "112",
          step_key: "report-112",
          after: [],
          summary: "112에 전화해 피해 사실을 알리세요.",
        },
        citation: {
          kb_entry_id: "report-112",
          kb_version: "2026.09.4",
          legal_basis: "통신사기피해환급법 제3조",
          source_url: "https://www.law.go.kr/…",
          effective_from: "2020-01-01",
        },
        artifacts: [],
        required_artifact: { kind: "receipt_no", label: "112 접수번호" },
      },
    ],
  },
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/**
 * 주소로 갈라 답하는 가짜 서버. **부산물 응답만 시험이 정하고** 나머지는
 * 화면이 마운트되도록 비워 둡니다 — 못 받아도 화면은 진행합니다(불변 규칙 5)
 */
function server(artifactReply: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/artifacts")) return json(artifactReply);
      if (url.includes("/evidence")) return json({ evidence: [] });
      if (url.includes("/messages")) return json({ messages: [] });
      if (url.endsWith(`/api/cases/${TOKEN}`)) return json(BUNDLE);
      return json({});
    }),
  );
  return calls;
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

const draw = async () => {
  await act(async () => {
    root.render(<CasePage />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};

const press = async (label: string) => {
  const found = [...host.querySelectorAll("button")].find(
    (one) => (one.textContent ?? "").trim() === label,
  );
  if (!found) throw new Error(`「${label}」 단추가 없습니다`);
  await act(async () => {
    found.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
};

describe("낸 직후의 패널 — 서버의 말이 그대로 선다", () => {
  it("L3 자기 신고의 말이 일반 문구로 덮이지 않는다 — **회귀**", async () => {
    server({
      artifact_id: "01J8ART0000000000000000AA",
      verify_level: "L3",
      verify_result: "not_applicable",
      step_state: "unconfirmed",
      note: SELF_REPORT,
    });

    await draw();
    expect(host.textContent).toContain("112에 신고합니다");

    await press("번호 없이 접수했다고 표시");

    expect(host.textContent).toContain(SELF_REPORT);
    // 낡은 번들로 갈아끼우면 이 일반 문구가 뜹니다 — 서버는 이유를 말했는데도
    expect(host.textContent).not.toContain("아직 완료로 기록하지 않았습니다.");
  });

  it("L2 「읽는 중」도 그대로 선다 — 판독이 끝나야 바뀝니다", async () => {
    server({
      artifact_id: "01J8ART0000000000000000AB",
      verify_level: "L2",
      verify_result: "not_applicable",
      verify_detail: { reason: "reading_pending" },
      step_state: "unconfirmed",
      note: "올린 자료를 읽는 중입니다. 접수번호가 보이면 완료로 기록합니다",
    });

    await draw();
    await press("번호 없이 접수했다고 표시");

    expect(host.textContent).toContain("올린 자료를 읽는 중입니다");
  });
});
