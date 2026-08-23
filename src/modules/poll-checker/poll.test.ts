import { describe, expect, it } from "vitest";
import { decidePoll } from "./poll";
import type { PollInput } from "./types";

const base: PollInput = {
  status: 200,
  done: false,
  pollAfterMs: 1500,
};

describe("정상 진행 중에는 서버가 시킨 간격으로 다시 묻는다", () => {
  it("서버가 지시한 값을 그대로 쓴다", () => {
    expect(decidePoll(base)).toEqual({ poll: true, delayMs: 1500 });
  });

  it("끝났으면 멈춘다", () => {
    expect(decidePoll({ ...base, done: true })).toEqual({
      poll: false,
      reason: "done",
    });
  });

  it("간격을 지시하지 않으면 지어내지 않고 멈춘다", () => {
    expect(decidePoll({ ...base, pollAfterMs: undefined })).toEqual({
      poll: false,
      reason: "no_interval",
    });
  });

  it("전사가 오래 걸려도 정상 진행이면 끊지 않는다", () => {
    // 몇 분이 걸려도 서버가 계속 진행 중이라고 하면 계속 묻습니다
    expect(decidePoll(base)).toEqual({ poll: true, delayMs: 1500 });
  });
});

describe("에러는 자동으로 다시 부르지 않는다 — 에러 §3.1", () => {
  it("어떤 에러든 폴링을 멈춘다 — 서버는 이미 재시도한 뒤다", () => {
    for (const status of [422, 429, 500, 502, 503]) {
      expect(decidePoll({ ...base, status }).poll).toBe(false);
    }
  });

  it("재시도 가능한 에러여도 스스로 다시 부르지 않는다", () => {
    const got = decidePoll({ ...base, status: 503, retryable: true });
    expect(got.poll).toBe(false);
  });

  it("Retry-After 는 화면 문구용으로 넘긴다 — 누르는 것은 사용자다", () => {
    const got = decidePoll({ ...base, status: 503, retryAfterSec: 10 });
    expect(got).toEqual({ poll: false, reason: "error", retryAfterSec: 10 });
  });

  it("Retry-After 가 없는 오류에는 재시도 버튼 근거도 주지 않는다", () => {
    expect(decidePoll({ ...base, status: 422 })).toEqual({
      poll: false,
      reason: "error",
    });
  });
});

describe("버튼을 띄울 근거는 retryable 이다 — 에러 §3.1.1", () => {
  it("재시도 가능한 에러는 그 사실과 대기 시간을 함께 넘긴다", () => {
    expect(
      decidePoll({ ...base, status: 503, retryable: true, retryAfterSec: 10 }),
    ).toEqual({ poll: false, reason: "error", retryable: true, retryAfterSec: 10 });
  });

  it("재시도 불가는 그대로 넘긴다 — 화면이 버튼을 안 띄웁니다", () => {
    expect(decidePoll({ ...base, status: 422, retryable: false })).toEqual({
      poll: false,
      reason: "error",
      retryable: false,
    });
  });

  it("서버가 어긋난 응답을 내도 retryable 을 따른다", () => {
    // retryable: true 인데 Retry-After 가 없는 것은 서버 결함입니다 (에러 §3.1.1).
    // 그때도 버튼은 띄우고, 시간만 안 보입니다
    expect(decidePoll({ ...base, status: 503, retryable: true })).toEqual({
      poll: false,
      reason: "error",
      retryable: true,
    });
  });
});
