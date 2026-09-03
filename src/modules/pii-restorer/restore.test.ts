import { describe, expect, it, vi } from "vitest";
import { maskText } from "@/modules/pii-masker";
import { restore, scopeFor } from "./restore";
import { parseToken, scopeOf } from "./policy";
import type { RestorableMapping } from "./types";

const 계좌: RestorableMapping = {
  token: "[계좌-1]",
  original: "110-123-456789",
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

/**
 * ⚠️ **이 모듈이 폐기된 규칙을 계속 돌리고 있었습니다** (2026-09-03 에 발견).
 *
 * [ADR-034](../../../decisions/034-browser-shows-plaintext.md)가 2026-08-19 에
 * 「복원 범위」 표를 **한 줄로 줄였습니다** — *브라우저가 보여주는 것은 전부 원문.*
 * 스펙도 그렇게 고쳐졌는데(`08-14-pii-boundary.md` 「복원 위치와 범위」) 코드는
 * 안 따라와서, **같은 계좌번호가 자료함에서는 온전히, 챗에서는 `****6789`** 로
 * 보였습니다. 사용자는 그것을 「보안」이 아니라 고장으로 읽고, 더 나쁘게는
 * **자기가 준 값을 자기가 검토하지 못합니다.**
 *
 * 이 파일이 그 규칙을 시험으로 못 박고 있어서 더 안 보였습니다 — 시험이 옛
 * 결정을 지키고 있으면 고치는 사람이 「일부러 그런 것」으로 읽습니다.
 */
describe("브라우저면 전부, 아니면 하나도 — ADR-034", () => {
  it("브라우저가 그리는 일곱 자리는 **전부** 전체 복원", () => {
    for (const site of [
      "slot-value",
      "doc-field",
      "user-input",
      "transcript",
      // 아래 셋이 2026-09-03 까지 부분이거나 아예 없었습니다
      "chat-answer",
      "analysis-text",
      "plan-text",
    ]) {
      expect(scopeFor(site)).toBe("full");
      expect(restore("[계좌-1]", 매핑, { site })).toBe("110-123-456789");
    }
  });

  it("서류 초안에서는 주민번호도 전체 복원 — 실제로 필요한 곳이다", () => {
    expect(restore("[주민번호-1]", 매핑, { site: "doc-field" })).toBe(
      "900101-1234567",
    );
  });

  /**
   * **주민번호도 예외가 아닙니다** → ADR-034. [ADR-026](../../../decisions/026-raw-upload-retention.md)이
   * 애초에 수집하지 않기로 했으므로 복원할 값이 우리에게 없고, 있다면 그건
   * 수집이 새고 있다는 뜻이지 표시 규칙으로 덮을 일이 아닙니다.
   */
  it("챗 답변의 주민번호·카드도 원문으로 보인다 — 종류로 가르지 않습니다", () => {
    expect(restore("[주민번호-1]", 매핑, { site: "chat-answer" })).toBe(
      "900101-1234567",
    );
    expect(restore("[카드-1]", 매핑, { site: "chat-answer" })).toBe(
      "4111111111111111",
    );
  });

  it("목록에 없는 자리는 복원하지 않는다 — 기본값이 거부다", () => {
    expect(restore("[계좌-1]", 매핑, { site: "어딘가-새-화면" })).toBe("[계좌-1]");
    expect(scopeOf("어딘가-새-화면")).toBe("none");
  });
});

/**
 * ## 인젝션 방어의 자리가 옮겨졌습니다
 *
 * 예전에는 **부분 복원**이 마지막 방어선처럼 서 있었습니다. ADR-034 는 그것을
 * 걷어내면서 방어를 **다른 둘**에 맡깁니다 —
 *
 * 1. **나가는 것은 언제나 토큰**입니다 (불변 규칙 2 · `pii-tokenizer`).
 *    모델이 무엇을 뱉든 그것은 **사용자 자기 화면에서** 풀립니다
 * 2. **매핑에 없는 토큰은 안 풀립니다.** 모델이 지어낸 `[계좌-9]` 는 그대로 남습니다
 *
 * 즉 인젝션으로 끌어낼 수 있는 최대치는 **그 사용자 자신이 이미 준 값**입니다.
 */
describe("인젝션이 성공해도", () => {
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
    // **아직 목록에 없는 화면**입니다 — `plan-text` 는 ADR-034 로 목록에
    // 들어왔으므로 더 이상 거부 자리가 아닙니다
    restore("[계좌-1]", 매핑, { site: "어딘가-새-화면", onDenied });

    expect(onDenied).toHaveBeenCalledWith({
      token: "[계좌-1]",
      site: "어딘가-새-화면",
      reason: "field_not_allowed",
    });
  });

  it("매핑에 없으면 not_in_mapping", () => {
    const onDenied = vi.fn();
    restore("[계좌-9]", 매핑, { site: "chat-answer", onDenied });

    expect(onDenied.mock.calls[0][0].reason).toBe("not_in_mapping");
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
    // 매핑에 없는 토큰입니다 — 열쇠가 없는 기기에서 이 모양이 됩니다
    const out = restore("주민번호는 [주민번호-9] 입니다", 매핑, {
      site: "chat-answer",
    });
    expect(out).toContain("[주민번호-9]");
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

  it("챗 답변 자리에서도 그대로 되돌린다 — 자리마다 다르지 않습니다", () => {
    const { masked, mappings } = maskText("110-123-456789 · 010-1234-5678");
    expect(restore(masked, mappings, { site: "chat-answer" })).toBe(
      "110-123-456789 · 010-1234-5678",
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
