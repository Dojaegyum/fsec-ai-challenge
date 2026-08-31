/**
 * 업로드 시험 — 겨누는 것은 셋입니다.
 *
 *  · 세 걸음을 **순서대로** 밟는다 (§3.2)
 *  · 파일이 **우리 서버를 안 거친다** — `upload_url` 로 곧장
 *  · 계약이 정한 `kind` 밖은 **안 올린다** — 잘못된 값으로 올리면 전사기가
 *    다른 일을 합니다
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { screenName } from "@/modules/file-sender";

import { kindOf, mergeRail, uploadFile } from "./upload";

const TOKEN = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
const PUT_URL = "https://storage.example.com/put/01EV";

const SLOT = {
  evidence_id: "01EVIDENCE0000000000000000",
  upload_url: PUT_URL,
  upload_method: "PUT",
  expires_at: "2026-08-24T15:00:00+09:00",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** 부른 곳과 방법을 순서대로 들고 있는 가짜 `fetch` */
function spyFetch(reply: (url: string) => Response) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET" });
      return reply(url);
    }),
  );
  return calls;
}

const audio = () => new File(["소리"], "0812_수신전화.m4a", { type: "audio/mp4" });

afterEach(() => vi.unstubAllGlobals());

describe("세 걸음을 순서대로", () => {
  it("자리 받기 → 곧장 올리기 → 알리기", async () => {
    const calls = spyFetch((url) =>
      url === PUT_URL ? new Response(null, { status: 200 }) : json(SLOT, 201),
    );
    const sent = await uploadFile({ caseToken: TOKEN, file: audio() });

    expect(sent.ok).toBe(true);
    expect(sent.ok && sent.evidenceId).toBe(SLOT.evidence_id);

    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ url: `/api/cases/${TOKEN}/evidence`, method: "POST" });
    // **우리 서버를 안 거칩니다** — 서버리스 함수의 본문 크기 제한 때문입니다 (§3.2)
    expect(calls[1]).toEqual({ url: PUT_URL, method: "PUT" });
    expect(calls[2]).toEqual({
      url: `/api/cases/${TOKEN}/evidence/${SLOT.evidence_id}/complete`,
      method: "POST",
    });
  });

  it("자리를 못 받으면 파일을 안 보낸다", async () => {
    const calls = spyFetch(() => json({ error: { message: "지금은 받을 수 없습니다" } }, 503));
    const sent = await uploadFile({ caseToken: TOKEN, file: audio() });

    expect(calls).toHaveLength(1);
    expect(sent.ok).toBe(false);
  });

  it("올리기가 실패하면 완료를 알리지 않는다", async () => {
    const calls = spyFetch((url) =>
      url === PUT_URL ? new Response(null, { status: 403 }) : json(SLOT, 201),
    );
    const sent = await uploadFile({ caseToken: TOKEN, file: audio() });

    // 알렸다가는 **없는 파일을 읽으라고 시키는 것**이 됩니다
    expect(calls).toHaveLength(2);
    expect(sent.ok).toBe(false);
    expect(!sent.ok && sent.fail.retryable).toBe(true);
  });
});

describe("계약이 정한 종류만", () => {
  it("소리·사진·글만 받는다", () => {
    expect(kindOf("audio/mp4")).toBe("audio");
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf("text/plain")).toBe("text");
  });

  it("PDF 는 안 받는다 — 어디에 넣을지가 정본에 없습니다", () => {
    expect(kindOf("application/pdf")).toBeNull();
  });

  it("모르는 종류는 서버를 아예 안 부른다", async () => {
    const calls = spyFetch(() => json(SLOT, 201));
    const sent = await uploadFile({
      caseToken: TOKEN,
      file: new File(["x"], "통지.pdf", { type: "application/pdf" }),
    });

    expect(calls).toHaveLength(0);
    expect(sent.ok).toBe(false);
    // 다시 눌러도 같은 파일은 같은 결과입니다
    expect(!sent.ok && sent.fail.retryable).toBe(false);
  });
});

describe("이름도 경계를 지난다", () => {
  it("파일 이름 속 계좌번호가 가려진다", () => {
    // 「입금내역_110-2345-678901.png」처럼 이름에 계좌가 든 경우가 실제로 흔합니다
    const screened = screenName("입금내역_110-2345-678901.png");
    expect(screened.masked).toBe(true);
    expect(screened.safe).not.toContain("110-2345-678901");
    // 레일에 그리는 이름이 이것입니다 (`RailFile.name` 의 뜻)
    expect(screened.safe).toContain("[계좌-1]");
  });

  it("가릴 것이 없으면 이름이 그대로다", () => {
    const screened = screenName("0812_수신전화.m4a");
    expect(screened.masked).toBe(false);
    expect(screened.safe).toBe("0812_수신전화.m4a");
  });
});


/**
 * ## 서버 목록과 이 브라우저의 목록을 합치는 규칙
 *
 * 자료 레일이 브라우저 메모리만 보던 탓에, 새로고침하거나 시작 화면에서 올리고
 * 사건 화면으로 넘어오면 **서버에 멀쩡히 있는 자료가 안 보였습니다**(2026-08-31).
 * 서버 목록을 받아 오게 고치면서, 이번 세션에 올린 것을 덮지 않는 것이 관건입니다.
 */
describe("서버 목록과 로컬 목록을 합친다", () => {
  const server = (id: string, name = "통화 녹음 · 8/31 09:18") => ({
    id,
    evidence_id: id,
    name,
    status: "done" as const,
  });

  it("서버에 있는 것이 앞에 온다", () => {
    const got = mergeRail([server("E1"), server("E2")], []);

    expect(got.map((one) => one.id)).toEqual(["E1", "E2"]);
  });

  /** ADR-026 — 못 가려서 안 올린 파일도 목록에 남아야 합니다 */
  it("못 올린 파일은 서버에 없어도 남는다", () => {
    const blocked = { id: "local-1", name: "이체내역.png", status: "failed" as const };
    const got = mergeRail([server("E1")], [blocked]);

    expect(got.map((one) => one.id)).toEqual(["E1", "local-1"]);
  });

  /**
   * ⚠️ **여기가 틀리면 같은 파일이 두 줄로 그려집니다.** 방금 올린 줄은 `local-3`
   * 이고 서버에서 온 같은 파일은 증거 번호라, `id` 로 겹침을 보면 안 걸립니다
   */
  it("방금 올린 파일이 서버 목록에도 있으면 한 줄이다", () => {
    const justSent = { id: "local-3", evidence_id: "E1", name: "통화녹음.m4a", status: "done" as const };
    const got = mergeRail([server("E1")], [justSent]);

    expect(got).toHaveLength(1);
    expect(got[0].id).toBe("E1");
  });

  it("올리는 중인 파일은 서버에 아직 없어 그대로 남는다", () => {
    const sending = { id: "local-2", name: "녹음.m4a", status: "pending" as const };
    const got = mergeRail([server("E1")], [sending]);

    expect(got.map((one) => one.id)).toEqual(["E1", "local-2"]);
  });

  /**
   * **못 불러온 것과 자료가 없는 것은 다릅니다.** 목록을 못 받았을 때 로컬을
   * 지워 버리면, 방금 올린 것까지 화면에서 사라집니다
   */
  it("서버 목록이 비면 로컬을 그대로 둔다", () => {
    const mine = { id: "local-1", evidence_id: "E9", name: "녹음.m4a", status: "done" as const };
    const got = mergeRail([], [mine]);

    expect(got).toEqual([mine]);
  });
});
