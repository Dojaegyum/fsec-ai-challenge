import { describe, expect, it } from "vitest";
import { maskText } from "@/modules/pii-masker";
import { createSessionKey, openMapping, sealAll, sealMapping } from "./crypto";
import { isUlid, newUlid } from "./ulid";

describe("세션키", () => {
  it("꺼낼 수 없다 — 이게 이 모듈의 약속이다", async () => {
    const s = await createSessionKey();

    // extractable: false 라 브라우저가 export 를 거부합니다.
    // 이 테스트가 깨지면 「키는 이 브라우저에만 있다」가 부탁으로 내려간 것입니다.
    await expect(crypto.subtle.exportKey("raw", s.key)).rejects.toThrow();
    expect(s.key.extractable).toBe(false);
  });

  it("식별자는 ULID 이고 키마다 다르다", async () => {
    const a = await createSessionKey();
    const b = await createSessionKey();

    expect(isUlid(a.keyId)).toBe(true);
    expect(a.keyId).toHaveLength(26);
    expect(a.keyId).not.toBe(b.keyId);
  });

  it("AES-GCM 256 이다", async () => {
    const s = await createSessionKey();
    const algo = s.key.algorithm as AesKeyAlgorithm;

    expect(algo.name).toBe("AES-GCM");
    expect(algo.length).toBe(256);
  });
});

describe("봉하고 열기", () => {
  it("봉한 것을 같은 키로 열면 원문이 나온다", async () => {
    const s = await createSessionKey();
    const { mappings } = maskText("110-123-456789 로 보냈어요");

    const entry = await sealMapping(s, mappings[0]);
    await expect(openMapping(s, entry)).resolves.toBe("110-123-456789");
  });

  it("볼트에 올라가는 것에 원문이 없다", async () => {
    const s = await createSessionKey();
    const { mappings } = maskText("900101-1234567");

    const entry = await sealMapping(s, mappings[0]);
    expect(entry.ciphertext).not.toContain("900101");
    expect(entry.ciphertext).not.toContain("1234567");
    expect(entry.token).toBe("[주민번호-1]"); // 토큰은 개인정보가 아니라 평문
  });

  it("다른 키로는 못 연다", async () => {
    const mine = await createSessionKey();
    const other = await createSessionKey();
    const { mappings } = maskText("110-123-456789");

    const entry = await sealMapping(mine, mappings[0]);
    await expect(openMapping(other, entry)).rejects.toThrow(/열지 못했습니다/);
  });

  it("암호문이 손상되면 조용히 빈 값을 내지 않고 던진다", async () => {
    const s = await createSessionKey();
    const { mappings } = maskText("110-123-456789");
    const entry = await sealMapping(s, mappings[0]);

    const broken = { ...entry, ciphertext: entry.ciphertext.slice(0, -6) + "AAAAAA" };
    await expect(openMapping(s, broken)).rejects.toThrow();
  });

  it("너무 짧은 칸은 IV 를 못 떼므로 바로 던진다", async () => {
    const s = await createSessionKey();
    await expect(
      openMapping(s, { token: "[계좌-1]", ciphertext: btoa("short") }),
    ).rejects.toThrow(/너무 짧습니다/);
  });

  it("같은 원문이라도 봉할 때마다 암호문이 다르다 — IV 를 새로 뽑는다", async () => {
    const s = await createSessionKey();
    const { mappings } = maskText("110-123-456789");

    const a = await sealMapping(s, mappings[0]);
    const b = await sealMapping(s, mappings[0]);

    expect(a.ciphertext).not.toBe(b.ciphertext);
    await expect(openMapping(s, a)).resolves.toBe("110-123-456789");
    await expect(openMapping(s, b)).resolves.toBe("110-123-456789");
  });

  it("여러 개를 한 번에 봉해도 순서를 지킨다", async () => {
    const s = await createSessionKey();
    const { mappings } = maskText("110-123-456789 와 010-1234-5678");

    const entries = await sealAll(s, mappings);
    expect(entries.map((e) => e.token)).toEqual(["[계좌-1]", "[전화-1]"]);
    await expect(openMapping(s, entries[1])).resolves.toBe("010-1234-5678");
  });

  it("한글 원문도 그대로 돌아온다", async () => {
    const s = await createSessionKey();
    const entry = await sealMapping(s, {
      token: "[이름-1]",
      kind: "계좌",
      seq: 1,
      original: "김철수 · 서울특별시 중구",
    });
    await expect(openMapping(s, entry)).resolves.toBe("김철수 · 서울특별시 중구");
  });
});

describe("ULID", () => {
  it("시각 순으로 정렬된다", () => {
    const early = newUlid(1_700_000_000_000);
    const late = newUlid(1_800_000_000_000);
    expect(early < late).toBe(true);
  });

  it("헷갈리는 글자(I·L·O·U)를 쓰지 않는다", () => {
    for (let i = 0; i < 50; i++) {
      expect(newUlid()).not.toMatch(/[ILOU]/);
    }
  });

  it("모양이 아니면 거른다", () => {
    expect(isUlid("너무짧음")).toBe(false);
    expect(isUlid("IIIIIIIIIIIIIIIIIIIIIIIIII")).toBe(false);
  });
});
