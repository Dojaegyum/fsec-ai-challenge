import { describe, expect, it } from "vitest";
import { forkFor, nextStep, screenName } from "./send";
import type { UploadSlot } from "./types";

const slot: UploadSlot = {
  evidence_id: "01J8XKR6",
  upload_url: "https://example.test/put",
  upload_method: "PUT",
  expires_at: "2026-08-22T14:35:00+09:00",
};

describe("파일 이름도 경계를 지난다", () => {
  it("이름에 든 계좌번호를 가린다", () => {
    const got = screenName("입금내역_110-2345-678901.png");
    expect(got.safe).not.toContain("110-2345-678901");
    expect(got.masked).toBe(true);
  });

  it("가릴 것이 없으면 그대로 둔다", () => {
    const got = screenName("통화녹음.m4a");
    expect(got.safe).toBe("통화녹음.m4a");
    expect(got.masked).toBe(false);
  });

  it("빈 이름에 던지지 않는다", () => {
    expect(screenName("").safe).toBe("");
  });
});

const toEvidence = { kind: "evidence" } as const;

describe("세 단계를 순서대로 짚는다", () => {
  it("처음에는 자리를 요청한다", () => {
    expect(nextStep({ phase: "idle", target: toEvidence })).toEqual({
      do: "request-slot",
    });
  });

  it("자리를 받으면 서버를 거치지 않고 직접 올린다", () => {
    expect(nextStep({ phase: "slot-requested", target: toEvidence, slot })).toEqual({
      do: "put-file",
      url: "https://example.test/put",
      method: "PUT",
    });
  });

  it("올린 뒤에 완료를 알린다", () => {
    expect(nextStep({ phase: "uploaded", target: toEvidence, slot })).toEqual({
      do: "notify-complete",
      evidenceId: "01J8XKR6",
    });
  });

  it("알린 뒤에는 진행 상태를 묻는다", () => {
    expect(
      nextStep({ phase: "notified", target: toEvidence, evidenceId: "01J8XKR6" }),
    ).toEqual({ do: "poll", evidenceId: "01J8XKR6" });
  });
});

describe("증거와 부산물을 함께 맡는다 — §3.8", () => {
  it("처리까지 끝난 증거함 업로드는 거기서 끝난다", () => {
    expect(
      nextStep({ phase: "ingested", target: toEvidence, evidenceId: "01J8XKR6" }),
    ).toEqual({ do: "done" });
  });

  it("단계 증빙이면 처리 뒤 부산물로 붙인다 — sms_capture", () => {
    expect(
      nextStep({
        phase: "ingested",
        target: { kind: "step-artifact", stepId: "01J8XKRD" },
        evidenceId: "01J8XKR6",
      }),
    ).toEqual({ do: "post-artifact", stepId: "01J8XKRD", evidenceId: "01J8XKR6" });
  });
});

describe("가리지 못한 파일은 막지 않고 갈림길을 준다", () => {
  it("실패하면 두 갈래를 준다 — 막는 것이 아니다", () => {
    const got = forkFor("failed");
    expect(got?.choices).toEqual(["다른 파일 올리기", "없이 진행"]);
  });

  it("사용자가 잘못한 것처럼 말하지 않는다", () => {
    expect(forkFor("failed")?.message).not.toMatch(/잘못|오류|실패하셨/);
  });

  it("진행 중에는 갈림길이 없다", () => {
    expect(forkFor("processing")).toBeNull();
    expect(forkFor("done")).toBeNull();
  });
});
