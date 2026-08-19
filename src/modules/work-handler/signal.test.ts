import { describe, expect, it, vi } from "vitest";
import {
  applySignal,
  closePanel,
  emptyPanelState,
  openStep,
  pickStep,
} from "./signal";
import { exitFor, panelFor, panelRule } from "./panel";
import type { PlanStep } from "./types";

const step = (
  step_id: string,
  seq: number,
  action: string,
  state = "not_started",
): PlanStep => ({ step_id, seq, state, body: { action } });

/** 표준 트랙 비슷하게 — 앞은 끝났고 뒤가 남은 모양 */
const 플랜: PlanStep[] = [
  step("s1", 1, "call", "done_verified"),
  step("s2", 2, "write", "not_started"),
  step("s3", 3, "visit", "in_progress"),
  step("s4", 4, "upload", "skipped"),
  step("s5", 5, "wait", "unconfirmed"),
];

describe("유형 판정", () => {
  it("일곱을 그대로 옮긴다", () => {
    expect(panelFor("call")).toBe("WS-call");
    expect(panelFor("visit")).toBe("WS-visit");
    expect(panelFor("write")).toBe("WS-write");
    expect(panelFor("upload")).toBe("WS-upload");
    expect(panelFor("download")).toBe("WS-download");
    expect(panelFor("wait")).toBe("WS-wait");
    expect(panelFor("read")).toBe("WS-read");
  });

  it("일곱 밖이면 null — WS-read 로 떨어뜨리지 않는다", () => {
    // 모르는 것을 「읽기만 하면 되는 것」으로 바꾸면
    // 사용자가 해야 할 일을 안 해도 되는 것처럼 보게 됩니다.
    expect(panelFor("sign")).toBeNull();
    expect(panelFor(undefined)).toBeNull();
    expect(panelFor(null)).toBeNull();
  });
});

describe("고르기", () => {
  it("아직 안 끝난 것 중 seq 가 가장 작은 하나", () => {
    expect(pickStep(["s3", "s2", "s5"], 플랜)?.step_id).toBe("s2");
  });

  it("done_verified 와 skipped 는 후보에서 빠진다", () => {
    expect(pickStep(["s1", "s4", "s5"], 플랜)?.step_id).toBe("s5");
  });

  it("unconfirmed 와 in_progress 는 아직 안 끝난 것이다", () => {
    expect(pickStep(["s5"], 플랜)?.step_id).toBe("s5");
    expect(pickStep(["s3"], 플랜)?.step_id).toBe("s3");
  });

  it("여러 단계를 언급해도 하나만 고른다", () => {
    // "지급정지를 걸고 3영업일 안에 신청하세요" — 지금 할 것은 앞의 하나
    const picked = pickStep(["s2", "s3", "s5"], 플랜);
    expect(picked?.step_id).toBe("s2");
  });

  it("고를 것이 없으면 null", () => {
    expect(pickStep([], 플랜)).toBeNull();
    expect(pickStep(["s1", "s4"], 플랜)).toBeNull();
  });

  it("플랜에 없는 step_id 는 무시한다 — 모델이 지어낼 수 있다", () => {
    expect(pickStep(["없는-단계"], 플랜)).toBeNull();
    expect(pickStep(["없는-단계", "s2"], 플랜)?.step_id).toBe("s2");
  });

  it("모르는 action 은 후보에서 빼고 다음으로 넘어간다", () => {
    const 신형 = [...플랜, step("s0", 0, "sign")];
    expect(pickStep(["s0", "s2"], 신형)?.step_id).toBe("s2");
  });
});

describe("밀려난 이유를 알린다", () => {
  it("이미 끝난 단계", () => {
    const onSkipped = vi.fn();
    pickStep(["s1"], 플랜, { onSkipped });
    expect(onSkipped).toHaveBeenCalledWith({
      stepId: "s1",
      reason: "already_done",
    });
  });

  it("플랜에 없는 단계", () => {
    const onSkipped = vi.fn();
    pickStep(["없음"], 플랜, { onSkipped });
    expect(onSkipped.mock.calls[0][0].reason).toBe("not_in_plan");
  });

  it("모르는 action", () => {
    const onSkipped = vi.fn();
    pickStep(["s0"], [...플랜, step("s0", 0, "sign")], { onSkipped });
    expect(onSkipped.mock.calls[0][0].reason).toBe("unknown_action");
  });

  it("콜백을 안 줘도 터지지 않는다", () => {
    expect(() => pickStep(["없음"], 플랜)).not.toThrow();
  });
});

describe("패널 상태", () => {
  it("남은 것이 있으면 그 단계로 바꾼다", () => {
    const next = applySignal(emptyPanelState(), ["s3"], 플랜);
    expect(next).toEqual({ stepId: "s3", panel: "WS-visit" });
  });

  it("남은 것이 없으면 그대로 둔다 — 닫지 않는다", () => {
    // referenced_steps 는 "감사합니다" 같은 발화에서 비어 있습니다.
    // 그때 패널이 사라지면 사용자가 적고 있던 접수번호를 잃습니다.
    const 열려있음 = { stepId: "s2", panel: "WS-write" as const };

    expect(applySignal(열려있음, [], 플랜)).toEqual(열려있음);
    expect(applySignal(열려있음, ["s1", "s4"], 플랜)).toEqual(열려있음);
    expect(applySignal(열려있음, ["없는-단계"], 플랜)).toEqual(열려있음);
  });

  it("아무것도 안 열린 상태에서 시그널이 비어도 그대로다", () => {
    expect(applySignal(emptyPanelState(), [], 플랜)).toEqual(emptyPanelState());
  });

  it("보드에서 직접 누르면 챗 시그널과 같은 결과다", () => {
    const 시작 = emptyPanelState();
    expect(openStep(시작, "s3", 플랜)).toEqual(applySignal(시작, ["s3"], 플랜));
  });

  it("이미 끝난 단계를 보드에서 눌러도 패널이 바뀌지 않는다", () => {
    const 열려있음 = { stepId: "s2", panel: "WS-write" as const };
    expect(openStep(열려있음, "s1", 플랜)).toEqual(열려있음);
  });

  it("사용자가 닫으면 비워진다 — 닫는 것은 사용자만 한다", () => {
    expect(closePanel()).toEqual({ stepId: null, panel: null });
  });
});

describe("유형별 규칙", () => {
  it("WS-read 는 완료 개념이 없다 — 체크박스를 두지 마세요", () => {
    expect(panelRule("WS-read").hasCompletion).toBe(false);
  });

  it("WS-wait 은 사용자가 하는 일이 없다", () => {
    expect(panelRule("WS-wait").userActs).toBe(false);
    expect(panelRule("WS-wait").hasCompletion).toBe(false);
  });

  it("전체 복원이 허용되는 패널은 WS-download 하나뿐이다", () => {
    const 허용 = (
      [
        "WS-call",
        "WS-visit",
        "WS-write",
        "WS-upload",
        "WS-download",
        "WS-wait",
        "WS-read",
      ] as const
    ).filter((p) => panelRule(p).allowsFullRestore);

    expect(허용).toEqual(["WS-download"]);
  });

  it("밖으로 내보내는 것은 통화와 외부 이동뿐이다", () => {
    expect(panelRule("WS-call").exits).toBe(true);
    expect(panelRule("WS-visit").exits).toBe(true);
    expect(panelRule("WS-write").exits).toBe(false);
  });
});

describe("나갈 곳", () => {
  const withBody = (body: PlanStep["body"]): PlanStep => ({
    step_id: "s",
    seq: 1,
    state: "not_started",
    body,
  });

  it("기관별 연락처가 있으면 그쪽이다", () => {
    expect(exitFor(withBody({ action: "call", contact: "1588-0000" }))).toEqual({
      kind: "contact",
      value: "1588-0000",
    });
  });

  it("기관 무관 주소는 라벨과 함께", () => {
    expect(
      exitFor(
        withBody({
          action: "visit",
          url: "https://www.gov.kr/x",
          url_label: "정부24에서 발급",
        }),
      ),
    ).toEqual({
      kind: "url",
      value: "https://www.gov.kr/x",
      label: "정부24에서 발급",
    });
  });

  it("둘 다 없어도 터지지 않는다 — 그때도 절차는 나간다", () => {
    expect(exitFor(withBody({ action: "call", contact: null }))).toEqual({
      kind: "none",
    });
    expect(exitFor(withBody({ action: "read" }))).toEqual({ kind: "none" });
  });

  it("연락처가 주소보다 앞선다 — 기관을 아는 쪽이 더 정확하다", () => {
    expect(
      exitFor(
        withBody({ action: "visit", contact: "앱 > 신고", url: "https://x" }),
      ),
    ).toEqual({ kind: "contact", value: "앱 > 신고" });
  });
});
