/**
 * @vitest-environment jsdom
 */

/**
 * 시작 화면의 업로드 — **사건 화면이 이어받을 수 있게 남은 수를 적는가.**
 *
 * 계약: spec/frontend/08-14-screens.md §S-05 · spec/common/08-14-api.md §3.2
 * 근거: ADR-078(폴링의 주인은 셸) · CLAUDE.md 불변 규칙 5(막지 않는다)
 *
 * ⚠️ **2026-09-06 점검에서 시연 경로의 자료가 「처리중」에 굳었습니다.** 시작
 * 화면이 파일 셋을 차례로 올리는데, 사용자가 다 올라가기 전에 [이메일 없이
 * 시작하기]를 누르면 사건 화면은 **그 순간의 목록을 한 번만** 읽습니다. 뒤늦게
 * 올라간 파일은 목록에 없으니 셸 폴링도 그것을 묻지 않고, 영영 안 뜹니다.
 *
 * **단추를 잠그는 것은 답이 아닙니다**(불변 규칙 5) — 발급된 주소 앞에서
 * 사용자를 세우면 창을 닫은 사람은 사건을 영영 잃습니다(ADR-021). 그래서
 * 시작 화면은 **아직 서버에 없는 파일 수**만 남기고, 사건 화면이 그만큼
 * 목록을 다시 읽습니다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadResult } from "@/app/c/[token]/upload";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const KEY = `fin-ally:pending-uploads:${TOKEN}`;

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

/** 올리는 것만 가짜입니다 — 종류를 가리는 `kindOf` 는 실제 문을 씁니다 */
const uploadFile = vi.fn<(input: { caseToken: string; file: File }) => Promise<UploadResult>>();
vi.mock("@/app/c/[token]/upload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/c/[token]/upload")>()),
  uploadFile: (input: { caseToken: string; file: File }) => uploadFile(input),
}));

vi.mock("./open", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./open")>()),
  openCase: async () => ({ ok: true, linkToken: TOKEN }),
}));

/** 시연 자료 셋 — 실제와 같은 문(`pick`)을 지나도록 `File` 로 줍니다 */
vi.mock("./mock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./mock")>()),
  loadMockEvidence: async () => ({
    ok: true,
    files: [
      { slot: 0, file: new File(["a"], "통화녹음.wav", { type: "audio/wav" }) },
      { slot: 1, file: new File(["b"], "문자캡처.png", { type: "image/png" }) },
      { slot: 2, file: new File(["c"], "이체내역.png", { type: "image/png" }) },
    ],
  }),
}));

import Start from "./page";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  sessionStorage.clear();
  uploadFile.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** 글자로 단추를 찾아 누릅니다 — 화면이 실제로 그린 것만 눌립니다 */
const press = async (label: string) => {
  const found = [...host.querySelectorAll("button")].find((one) =>
    (one.textContent ?? "").trim().startsWith(label),
  );
  if (!found) throw new Error(`「${label}」 단추가 없습니다`);
  await act(async () => {
    found.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

/** 조건이 설 때까지 짧게 기다립니다 — 올리기는 약속(Promise) 사이로 진행됩니다 */
const until = async (check: () => boolean, tries = 40) => {
  for (let i = 0; i < tries; i += 1) {
    if (check()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error("기다린 조건이 서지 않았습니다");
};

/** 동의 → 시연 자료 셋 담기 → [다음] 으로 사건 만들기 */
const openCaseWithThreeFiles = async () => {
  await act(async () => {
    root.render(<Start />);
  });
  await press("Mock 파일로 실행");
  await until(() => host.textContent?.includes("통화녹음.wav") ?? false);
  await press("다음"); // 동의 전에는 전문 모달이 열립니다
  await press("전부 확인");
  await press("동의하고 계속하기");
  await press("다음");
};

describe("올리는 동안 사건 화면이 이어받을 수 있게 남긴다", () => {
  it("파일 셋을 올리는 동안 남은 수를 sessionStorage 에 적고, 다 올리면 지운다", async () => {
    let releaseThird = () => {};
    const held = new Promise<void>((r) => {
      releaseThird = r;
    });
    let n = 0;
    uploadFile.mockImplementation(async () => {
      n += 1;
      if (n === 3) await held;
      return { ok: true, evidenceId: `E${n}` };
    });

    await openCaseWithThreeFiles();

    // 셋째를 올리는 중 — **아직 서버에 없는 것이 하나** 남았습니다
    await until(() => sessionStorage.getItem(KEY) === "1");
    expect(sessionStorage.getItem(KEY)).toBe("1");

    await act(async () => {
      releaseThird();
      await held;
    });

    // 다 올렸으면 이어받을 것이 없습니다 — 남겨 두면 다음 사건까지 따라옵니다
    await until(() => sessionStorage.getItem(KEY) === null);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("못 올린 것이 있어도 표시를 지운다 — 사건 화면을 헛돌게 두지 않습니다", async () => {
    uploadFile.mockResolvedValue({
      ok: false,
      fail: { poll: false, reason: "error", retryable: true, message: "못 올렸습니다" },
    });

    await openCaseWithThreeFiles();

    await until(() => (host.textContent ?? "").includes("올리지 못했습니다"));
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("올리는 중에도 [이메일 없이 시작하기]가 잠기지 않는다 — 불변 규칙 5", async () => {
    uploadFile.mockImplementation(
      () => new Promise<UploadResult>(() => {}), // 영영 안 끝나는 올리기
    );

    await openCaseWithThreeFiles();
    await until(() => (host.textContent ?? "").includes("자료를 올리고 있습니다"));

    const enter = [...host.querySelectorAll("button")].find((one) =>
      (one.textContent ?? "").includes("이메일 없이 시작하기"),
    );
    expect(enter?.hasAttribute("disabled")).toBe(false);
    // 지금 들어가도 자료가 이어진다는 것을 화면이 말합니다
    expect(host.textContent).toContain("지금 들어가셔도 자료함에 이어서 표시됩니다");
  });
});
