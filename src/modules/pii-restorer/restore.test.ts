import { describe, expect, it, vi } from "vitest";
import { maskText } from "@/modules/pii-masker";
import { restore, scopeFor } from "./restore";
import { maskPartial, parseToken, scopeOf } from "./policy";
import type { RestorableMapping } from "./types";

const 계좌: RestorableMapping = {
  token: "[계좌-1]",
  original: "110-123-456789",
  label: "국민",
};
const 주민번호: RestorableMapping = {
  token: "[주민번호-1]",
  original: "900101-1234567",
};
const 전화: RestorableMapping = {
  token: "[전화-1]",
  original: "010-1234-5678",
};
const 이름: RestorableMapping = { token: "[이름-1]", original: "김철수" };
const 카드: RestorableMapping = {
  token: "[카드-1]",
  original: "4111111111111111",
};

const 매핑 = [계좌, 주민번호, 전화, 이름, 카드];

describe("자리마다 범위가 다르다", () => {
  it("슬롯 칸·서류 필드·사용자 입력·전사는 전체 복원", () => {
    for (const site of ["slot-value", "doc-field", "user-input", "transcript"]) {
      expect(scopeFor(site)).toBe("full");
      expect(restore("[계좌-1]", 매핑, { site })).toBe("110-123-456789");
    }
  });

  it("서류 초안에서는 주민번호도 전체 복원 — 실제로 필요한 곳이다", () => {
    expect(restore("[주민번호-1]", 매핑, { site: "doc-field" })).toBe(
      "900101-1234567",
    );
  });

  it("분석 결과와 플랜 설명은 복원하지 않는다", () => {
    for (const site of ["analysis-text", "plan-text"]) {
      expect(restore("[계좌-1]", 매핑, { site })).toBe("[계좌-1]");
    }
  });

  it("목록에 없는 자리는 복원하지 않는다 — 기본값이 거부다", () => {
    expect(restore("[계좌-1]", 매핑, { site: "어딘가-새-화면" })).toBe("[계좌-1]");
    expect(scopeOf("어딘가-새-화면")).toBe("none");
  });
});

describe("챗 답변은 부분 복원", () => {
  it("계좌는 뒷 4자리만, 기관명이 있으면 앞에 붙는다", () => {
    expect(restore("[계좌-1] 로 보내셨죠", 매핑, { site: "chat-answer" })).toBe(
      "국민 ****6789 로 보내셨죠",
    );
  });

  it("기관명이 없으면 뒷 4자리만 나간다", () => {
    const 라벨없음 = [{ token: "[계좌-1]", original: "110-123-456789" }];
    expect(restore("[계좌-1]", 라벨없음, { site: "chat-answer" })).toBe("****6789");
  });

  it("전화는 앞 3자리와 뒷 4자리만", () => {
    expect(restore("[전화-1]", 매핑, { site: "chat-answer" })).toBe(
      "010-****-5678",
    );
  });

  it("이름은 가운데를 가린다", () => {
    expect(maskPartial("이름", "김철수")).toBe("김O수");
    expect(maskPartial("이름", "김수")).toBe("김O");
    expect(maskPartial("이름", "김철수영")).toBe("김OO영");
  });

  it("주민번호는 한 자리도 나가지 않는다", () => {
    expect(restore("[주민번호-1]", 매핑, { site: "chat-answer" })).toBe(
      "[주민번호-1]",
    );
  });

  it("카드도 나가지 않는다 — 표에 없는 종류는 펼치지 않는다", () => {
    expect(restore("[카드-1]", 매핑, { site: "chat-answer" })).toBe("[카드-1]");
  });
});

describe("인젝션이 성공해도", () => {
  it("모델이 토큰을 다 뱉어도 계좌 뒷자리와 이름 일부만 나간다", () => {
    // chat-context §8.3 의 예시 그대로
    const 답변 = "요청하신 값은 [계좌-1], [주민번호-1] 입니다";
    expect(restore(답변, 매핑, { site: "chat-answer" })).toBe(
      "요청하신 값은 국민 ****6789, [주민번호-1] 입니다",
    );
  });

  it("모델이 지어낸 토큰은 매핑에 없어 복원되지 않는다", () => {
    const 답변 = "[계좌-9] 와 [주민번호-7] 입니다";
    expect(restore(답변, 매핑, { site: "chat-answer" })).toBe(
      "[계좌-9] 와 [주민번호-7] 입니다",
    );
  });

  it("전체 복원 자리에서도 지어낸 토큰은 복원되지 않는다", () => {
    expect(restore("[계좌-9]", 매핑, { site: "doc-field" })).toBe("[계좌-9]");
  });
});

describe("거부를 알린다", () => {
  it("목록 밖 자리는 field_not_allowed", () => {
    const onDenied = vi.fn();
    restore("[계좌-1]", 매핑, { site: "plan-text", onDenied });

    expect(onDenied).toHaveBeenCalledWith({
      token: "[계좌-1]",
      site: "plan-text",
      reason: "field_not_allowed",
    });
  });

  it("매핑에 없으면 not_in_mapping", () => {
    const onDenied = vi.fn();
    restore("[계좌-9]", 매핑, { site: "chat-answer", onDenied });

    expect(onDenied.mock.calls[0][0].reason).toBe("not_in_mapping");
  });

  it("챗 답변의 주민번호는 kind_not_allowed", () => {
    const onDenied = vi.fn();
    restore("[주민번호-1]", 매핑, { site: "chat-answer", onDenied });

    expect(onDenied.mock.calls[0][0].reason).toBe("kind_not_allowed");
  });

  it("여러 번 거부되면 그만큼 알린다 — 반복이 공격 신호다", () => {
    const onDenied = vi.fn();
    restore("[계좌-9] [계좌-8] [계좌-7]", 매핑, {
      site: "chat-answer",
      onDenied,
    });

    expect(onDenied).toHaveBeenCalledTimes(3);
  });

  it("콜백을 안 줘도 터지지 않는다", () => {
    expect(() => restore("[계좌-9]", 매핑, { site: "chat-answer" })).not.toThrow();
  });
});

describe("되돌리지 못한 토큰", () => {
  it("지우지 않고 그대로 둔다 — 빈칸이면 값이 없는 줄 안다", () => {
    const out = restore("주민번호는 [주민번호-1] 입니다", 매핑, {
      site: "chat-answer",
    });
    expect(out).toContain("[주민번호-1]");
    expect(out).not.toBe("주민번호는  입니다");
  });
});

describe("pii-masker 와 맞물린다", () => {
  it("가린 것을 그대로 되돌린다", () => {
    const { masked, mappings } = maskText(
      "110-123-456789 로 300만원 보냈고 010-1234-5678 입니다",
    );
    expect(masked).toBe("[계좌-1] 로 300만원 보냈고 [전화-1] 입니다");

    expect(restore(masked, mappings, { site: "transcript" })).toBe(
      "110-123-456789 로 300만원 보냈고 010-1234-5678 입니다",
    );
  });

  it("같은 텍스트를 챗 답변 자리에 두면 부분만 나간다", () => {
    const { masked, mappings } = maskText("110-123-456789 · 010-1234-5678");
    expect(restore(masked, mappings, { site: "chat-answer" })).toBe(
      "****6789 · 010-****-5678",
    );
  });
});

describe("토큰 뜯기", () => {
  it("종류와 번호를 나눈다", () => {
    expect(parseToken("[계좌-12]")).toEqual({ kind: "계좌", seq: 12 });
  });

  it("모양이 아니면 null", () => {
    expect(parseToken("계좌-1")).toBeNull();
    expect(parseToken("[계좌]")).toBeNull();
  });
});
