/**
 * poll-checker — `poll_after_ms` 를 보고 다시 묻는다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-022(스트리밍을 쓰지 않는다) · ADR-023(층 C) · ADR-028(층 C 는 client-only)
 *
 * 서버의 `retry-checker` 와 짝입니다 — **같은 규칙(재시도 여부 하나만 본다)** 을 따릅니다.
 */

import "client-only";

export { decidePoll } from "./poll";
export type { PollInput, PollVerdict, StopReason } from "./types";
