import { describe, expect, it } from "vitest";
import { assertNoLeak, maskText } from "./mask";
import { findHits, passesLuhn } from "./patterns";

/**
 * 이 파일의 번호는 전부 형식만 맞춘 가짜입니다.
 * 실제 계좌·주민번호를 테스트에 넣지 마세요.
 */

describe("주민번호", () => {
  it("하이픈이 있어도 없어도 잡는다", () => {
    expect(maskText("주민번호는 900101-1234567 입니다").masked).toBe(
      "주민번호는 [주민번호-1] 입니다",
    );
    expect(maskText("9001011234567").masked).toBe("[주민번호-1]");
  });

  it("2000년대생·외국인등록번호도 잡는다", () => {
    expect(maskText("051231-3234567").masked).toBe("[주민번호-1]");
    expect(maskText("980101-7234567").masked).toBe("[주민번호-1]");
  });

  it("있을 수 없는 월·일은 주민번호로 보지 않는다", () => {
    // 13월 → 주민번호 아님. 13자리 연속이라 계좌로 내려간다
    const r = maskText("901301-1234567");
    expect(r.mappings.some((m) => m.kind === "주민번호")).toBe(false);
  });
});

describe("카드", () => {
  it("Luhn 을 통과하면 카드로 잡는다", () => {
    expect(passesLuhn("4111111111111111")).toBe(true);
    expect(maskText("4111-1111-1111-1111").masked).toBe("[카드-1]");
  });

  it("Luhn 을 못 넘기면 카드가 아니다", () => {
    expect(passesLuhn("4111111111111112")).toBe(false);
    const r = maskText("4111-1111-1111-1112");
    expect(r.mappings.some((m) => m.kind === "카드")).toBe(false);
  });

  /**
   * 2026-08-24. 하한을 13 → 14 로 올린 이유가 이 한 줄입니다.
   *
   * 목업이 계좌로 쓰는 값인데 13자리이고 Luhn 을 통과해서 `[카드-1]` 이 됐습니다.
   * 카드가 계좌보다 먼저 오기 때문입니다.
   */
  it("13자리 계좌번호를 카드로 집지 않는다", () => {
    expect(passesLuhn("110-2345-678901")).toBe(true);
    const r = maskText("110-2345-678901 로 보냈어요");
    expect(r.mappings.some((m) => m.kind === "카드")).toBe(false);
    // **가려지는 것은 그대로입니다** — 이름표만 제자리로 옵니다
    expect(r.masked).toBe("[계좌-1] 로 보냈어요");
  });

  it("실제 카드 자릿수(15·16)는 그대로 잡는다", () => {
    expect(maskText("4111-1111-1111-1111").masked).toBe("[카드-1]");
    // 아멕스 15자리
    expect(maskText("3782 822463 10005").masked).toBe("[카드-1]");
  });
});

describe("전화", () => {
  it("휴대폰과 지역번호를 잡는다", () => {
    expect(maskText("010-1234-5678 로 연락").masked).toBe("[전화-1] 로 연락");
    expect(maskText("02-123-4567").masked).toBe("[전화-1]");
    expect(maskText("031-1234-5678").masked).toBe("[전화-1]");
  });

  it("대표번호는 가리지 않는다 — 개인을 식별하지 않고 절차 분기의 입력이다", () => {
    // ADR-011 토큰화 제외 목록의 취지. 어느 기관에 전화했는지가 분기 입력
    expect(maskText("1588-1234 로 전화했어요").masked).toBe(
      "1588-1234 로 전화했어요",
    );
    expect(maskText("1661-1234").masked).toBe("1661-1234");
  });

  it("신고 번호는 자릿수가 짧아 애초에 안 걸린다", () => {
    const text = "112 에 신고하고 1332 와 1394 에도 전화했습니다";
    expect(maskText(text).masked).toBe(text);
  });
});

describe("계좌", () => {
  it("하이픈으로 끊긴 것과 붙여 쓴 것을 모두 잡는다", () => {
    expect(maskText("110-123-456789 로 보냈어요").masked).toBe(
      "[계좌-1] 로 보냈어요",
    );
    expect(maskText("100212345678").masked).toBe("[계좌-1]");
  });

  it("13자리가 주민번호 형태와 겹치면 주민번호로 본다", () => {
    // 붙여 쓴 13자리는 둘 중 무엇인지 형태만으로 가릴 수 없습니다.
    // 어느 쪽으로 틀리는 게 안전한가로 정했습니다 —
    // 계좌를 주민번호로 보면 챗에서 부분 복원이 안 될 뿐이지만,
    // 주민번호를 계좌로 보면 부분 복원이 일어나 생년월일이 화면에 뜹니다.
    const r = maskText("1002123456789");
    expect(r.mappings[0].kind).toBe("주민번호");
    expect(r.masked).not.toContain("1002123456789");
  });

  it("날짜를 계좌로 보지 않는다", () => {
    const text = "2026-08-18 에 송금했습니다";
    expect(maskText(text).masked).toBe(text);
  });

  it("금액을 계좌로 보지 않는다 — 금액은 토큰화 제외 대상이다", () => {
    const text = "1000000000원을 보냈습니다";
    expect(maskText(text).masked).toBe(text);
    expect(maskText("3,000,000원").masked).toBe("3,000,000원");
  });

  /**
   * ⚠️ **금액 판정이 낱말을 먹고 계좌를 통과시켰습니다** (2026-08-31).
   *
   * 「숫자 뒤 네 글자가 원·만·억으로 시작하면 금액」이라고만 봐서
   * **「원래」·「만나서」·「억울」** 같은 흔한 낱말에 걸렸습니다. 걸리면 그 숫자는
   * 계좌가 아니라고 판정돼 **가려지지 않고 외부 LLM 으로 나갔습니다** — 불변 규칙 2.
   *
   * 열 자리가 넘는 수 뒤의 「만·억」은 금액 단위가 될 수 없습니다(열 자리 × 만 = 조 단위).
   * 그래서 **바로 뒤의 「원」만** 금액으로 봅니다. 놓치면 원문이 새고, 과하게 잡으면
   * 금액이 가려질 뿐입니다 — 기울일 방향이 정해져 있습니다.
   */
  it("**낱말이 금액 단위로 시작해도 계좌를 통과시키지 않는다**", () => {
    for (const [text, leak] of [
      ["계좌 110-234-567890 원래 제 것입니다", "110-234-567890"],
      ["신한 110-234-567890 만원 보냈어요", "110-234-567890"],
      ["3020123456 억울해요", "3020123456"],
      ["제 계좌 3020123456만 기억나요", "3020123456"],
    ] as const) {
      const r = maskText(text);
      expect(r.masked).not.toContain(leak);
      expect(r.mappings.map((one) => one.original)).toContain(leak);
    }
  });

  /**
   * ⚠️ **전사문의 계좌번호에 쉼표가 끼어 통과했습니다** (2026-09-01).
   *
   * 음성인식기가 마지막 묶음을 수로 읽어 천 단위 쉼표를 넣습니다 — 시연용 합성
   * 통화를 실제로 전사해 보니 `국민은행 110-234-567,890.` 이 나왔습니다. 그러면
   * 하이픈 패턴이 `110-234-567` 까지만 잡고, 그건 아홉 자리라 「열 자리 이상」
   * 조건에 걸려 **계좌가 아니라고 판정**됩니다.
   *
   * **쉼표를 그냥 허용하면 금액이 계좌로 잡힙니다.** 금액은 토큰화 제외 대상이라
   * 가려 버리면 피해 금액이 `[계좌-1]` 이 되고 플랜도 기한도 못 셉니다.
   *
   * 가르는 지점은 **하이픈**입니다. 한국에서 계좌는 하이픈으로 끊고 금액은 쉼표로
   * 끊습니다 — 둘이 섞이는 것은 **하이픈으로 끊긴 계좌에 쉼표가 잘못 끼어든 것**
   * 뿐입니다. 그래서 하이픈이 있을 때만 그 안의 쉼표를 자릿수 구분으로 안 봅니다.
   *
   * 전사 경로는 `pii-tokenizer/transcript-digits.ts` 가 이미 잡습니다(ADR-052).
   * 여기는 **사용자가 직접 적었을 때**와 서버 2차(`findHits` 를 그대로 씁니다)의 몫입니다.
   */
  it("**하이픈 사이에 쉼표가 끼어도 계좌로 본다** — 전사문이 실제로 그렇게 옵니다", () => {
    for (const [text, leak] of [
      ["국민은행 110-234-567,890.", "110-234-567,890"],
      ["안전계좌 110-234-567,890 으로 보내세요", "110-234-567,890"],
      // 전각으로 적혀 와도 같습니다 — 접힘 표가 전각 쉼표를 ASCII 로 내립니다
      ["국민은행 １１０-２３４-５６７，８９０", "１１０-２３４-５６７，８９０"],
    ] as const) {
      const r = maskText(text);
      expect(r.masked).not.toContain(leak);
      expect(r.mappings.map((one) => one.original)).toContain(leak);
    }
  });

  it("**쉼표만 있는 수는 금액이다** — 하이픈이 없으면 건드리지 않습니다", () => {
    for (const text of [
      "32,000,000원을 보냈습니다",
      "1,234,567,890원이 빠져나갔어요",
      "3,200만 원 정도 있습니다",
      "잔액이 412,530 남았습니다",
    ]) {
      expect(maskText(text).masked).toBe(text);
    }
  });

  it("날짜와 전화는 그대로다 — 이 변경이 건드리지 않습니다", () => {
    expect(maskText("2026-09-01 에 송금했습니다").masked).toBe("2026-09-01 에 송금했습니다");
    const phone = maskText("010-1234-5678 로 전화가 왔어요");
    expect(phone.mappings[0]?.kind).toBe("전화");
  });

  /**
   * ⚠️ **공백으로 끊어 적은 계좌가 그대로 나갔습니다** (2026-09-03).
   *
   * 하이픈 대신 띄어쓰기로 끊어 적는 사람이 있습니다. 은행 앱에서 복사하면
   * 하이픈이 붙지만, 보고 옮겨 적거나 문자에서 긁어 오면 `3333 05 1122334`
   * 처럼 됩니다. 하이픈 패턴은 하이픈을 요구하고 붙임 패턴은 붙어 있기를
   * 요구해서 **어느 쪽도 안 잡았고**, 가려지지 않은 계좌가 외부 모델로
   * 나갔습니다 — 불변 규칙 2 위반입니다.
   */
  it("**공백으로 끊어 적은 계좌도 잡는다**", () => {
    for (const [text, leak] of [
      ["3333 05 1122334 로 보내래요", "3333 05 1122334"],
      ["계좌번호 110 234 567890 입니다", "110 234 567890"],
      ["1002 123 456789 이 사기범 계좌예요", "1002 123 456789"],
    ] as const) {
      const r = maskText(text);
      expect(r.masked).not.toContain(leak);
      expect(r.mappings.map((one) => one.original)).toContain(leak);
      expect(r.mappings[0].kind).toBe("계좌");
    }
  });

  it("공백을 허용해도 날짜·전화는 건드리지 않는다", () => {
    // 여덟 자리 — 「열 자리 이상」에 못 미칩니다
    expect(maskText("2026 08 18 에 송금했습니다").masked).toBe("2026 08 18 에 송금했습니다");
    // 전화가 먼저 가져갑니다 — 이름표가 바뀌면 §3.9 부분 복원 규칙이 달라집니다
    expect(maskText("010 1234 5678 로 전화가 왔어요").mappings[0]?.kind).toBe("전화");
  });

  it("진짜 금액은 그대로 둔다 — 조사가 붙어도", () => {
    for (const text of [
      "1000000000원을 보냈습니다",
      "1000000000원 보냈습니다",
      "1000000000원이 빠져나갔어요",
      "1000000000 원 입니다",
    ]) {
      expect(maskText(text).masked).toBe(text);
    }
  });
});

describe("토큰화하지 않는 것", () => {
  it("기관명은 그대로 남는다 — 8유형 분기의 입력이다", () => {
    const r = maskText("카카오페이로 300만원을 보냈어요");
    expect(r.masked).toBe("카카오페이로 300만원을 보냈어요");
    expect(r.mappings).toHaveLength(0);
  });

  it("이름은 1차에서 만들지 않는다 — NER 2차의 몫이다", () => {
    const r = maskText("김철수 라는 사람이 전화했어요");
    expect(r.masked).toBe("김철수 라는 사람이 전화했어요");
  });
});

describe("토큰 번호", () => {
  it("같은 값이 다시 나오면 같은 토큰을 쓴다", () => {
    const r = maskText("110-123-456789 로 보내고 110-123-456789 를 확인했어요");
    expect(r.masked).toBe("[계좌-1] 로 보내고 [계좌-1] 를 확인했어요");
    expect(r.mappings).toHaveLength(1);
  });

  it("다른 값이면 번호가 올라간다", () => {
    const r = maskText("110-123-456789 와 220-456-789012");
    expect(r.masked).toBe("[계좌-1] 와 [계좌-2]");
  });

  it("종류마다 번호를 따로 센다", () => {
    const r = maskText("110-123-456789 · 010-1234-5678");
    expect(r.masked).toBe("[계좌-1] · [전화-1]");
  });

  it("이어서 부르면 번호가 1로 리셋되지 않는다", () => {
    const first = maskText("110-123-456789 로 보냈어요");
    const second = maskText("220-456-789012 도 있어요", first);

    expect(second.masked).toBe("[계좌-2] 도 있어요");
    expect(second.added).toHaveLength(1);
    expect(second.mappings).toHaveLength(2);
  });

  it("이어서 부를 때 같은 값이면 앞선 토큰을 그대로 쓴다", () => {
    const first = maskText("110-123-456789");
    const second = maskText("다시 110-123-456789 확인", first);

    expect(second.masked).toBe("다시 [계좌-1] 확인");
    expect(second.added).toHaveLength(0);
  });
});

describe("겹칠 때", () => {
  it("주민번호가 계좌보다 먼저 잡힌다", () => {
    const hits = findHits("900101-1234567");
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("주민번호");
  });

  it("여러 종류가 섞여도 자리를 침범하지 않는다", () => {
    const r = maskText(
      "제 번호는 010-1234-5678 이고 주민번호는 900101-1234567, 계좌는 110-123-456789 입니다",
    );
    expect(r.masked).toBe(
      "제 번호는 [전화-1] 이고 주민번호는 [주민번호-1], 계좌는 [계좌-1] 입니다",
    );
  });
});

describe("누출 검사", () => {
  it("정상 마스킹은 통과한다", () => {
    const r = maskText("110-123-456789 로 보냈어요");
    expect(() => assertNoLeak(r.masked, r.mappings)).not.toThrow();
  });

  it("원문이 남아 있으면 던진다", () => {
    const r = maskText("110-123-456789 로 보냈어요");
    expect(() => assertNoLeak("110-123-456789", r.mappings)).toThrow(
      /원문이 남아 있습니다/,
    );
  });
});

describe("빈 입력", () => {
  it("가릴 것이 없으면 원문 그대로 돌려준다", () => {
    expect(maskText("").masked).toBe("");
    expect(maskText("어제 전화가 왔어요").masked).toBe("어제 전화가 왔어요");
  });
});
