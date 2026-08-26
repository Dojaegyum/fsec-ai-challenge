# 층 C · 서버와 이야기하는 넷 구현 계획

> **은퇴(2026-08-26)** — 태스크 10개가 2026-08-23 에 전부 끝났습니다. 네 모듈은 `src/modules/` 에 있고,
> 규칙은 각 모듈의 `README.md` 와 시험이 지킵니다. 남은 일은 [qa-readiness](08-23-qa-readiness.md) 가 잇습니다.
> 파일은 링크를 지키려 제자리에 둡니다 — 더 갱신하지 않습니다.

> **에이전트에게:** 이 계획은 태스크 단위로 실행합니다. 각 단계가 `- [ ]` 로 되어 있으니
> 하나씩 체크하며 나아가세요. 한 태스크가 끝날 때마다 커밋합니다.

**목표:** `case-opener` · `poll-checker` · `file-sender` · `chat-handler` 네 모듈을 만들어,
브라우저가 서버와 주고받는 규칙을 **화면에서 떼어낸 순수 함수**로 세운다.

**설계:** 네 모듈 모두 **판정만 합니다 — `fetch` 를 직접 부르지 않습니다.**
서버 응답(또는 그 요약)을 받아 「다음에 무엇을 할지」를 값으로 돌려주고,
실제 호출은 부른 쪽이 합니다. `retry-checker` 가 서버에서 같은 모양으로 서 있습니다 —
**판단만 돌려주고 기다리지도 다시 부르지도 않습니다.** 그래야 시험할 수 있습니다.

> **라우트가 아직 0개라도 이 넷은 지금 만들 수 있고 시험됩니다.** 계약이 정본이고
> 응답 모양이 §3 에 다 있어, 가짜 응답으로 규칙을 전부 검증할 수 있습니다.
> 라우트가 서면 그때 배선만 이으면 됩니다.

**기술:** TypeScript 5 · React 19 · Next 16 (App Router) · vitest 4 · Tailwind v4 (프로젝트 토큰)

> **2026-08-23 — 태스크 열 전부 끝났습니다. 층 C 가 11 / 11 입니다.**
> Task 1 이 「사람이 정해야 한다」고 올린 물음도 닫혔습니다 — 에러 본문에
> **`retryable` 을 싣기로** 했고, 그 값이 **§2 표의 값과 다르다**는 것을
> 계약에 표로 박았습니다 (에러 §3.1.1).
>
> 실행하며 계획과 다르게 간 자리 넷은 각 커밋 메시지에 있습니다 —
> `poll-checker` verdict 에 `retryable` 을 실은 것, `LinkHandoff`·`QuestionButtons` 를
> 계획 스케치가 아니라 **시안 마크업**으로 옮긴 것, `AnswerBubble` 을 화면에 안 붙인 것.

**스펙:**
[모듈 경계](../../spec/common/08-16-module-boundaries.md) ·
[모듈 명칭](../../spec/common/08-16-module-names.md) 층 C ·
[API 계약](../../spec/common/08-14-api.md) §3.2 §3.3 §3.4 §3.8 §3.9 §3.10 ·
[에러 계약](../../spec/backend/08-16-errors.md) §2 §3 ·
[화면 설계](../../spec/frontend/08-14-screens.md) §S-05 §S-06 §S-08 ·
[ADR-021](../../decisions/021-reentry-and-identity.md) ·
[ADR-022](../../decisions/022-chat-turn-boundaries.md) ·
[ADR-026](../../decisions/026-raw-upload-retention.md) ·
[ADR-035](../../decisions/035-screen-state-axes.md) ·
[ADR-039](../../decisions/039-link-token.md)

## 전역 제약

**모든 태스크에 걸립니다.** 태스크마다 다시 적지 않습니다.

| 제약 | 근거 |
| --- | --- |
| 모듈 폴더 이름은 [모듈 명칭](../../spec/common/08-16-module-names.md) 층 C **그대로**. **CI 가 막습니다** | [ADR-019](../../decisions/019-module-code-sync.md) |
| 밖에서는 `index.ts` 만 import 합니다 | [RFC-001](../../rfc/001-repo-structure.md) |
| **모듈이 `fetch` 를 직접 부르지 않습니다.** 판단만 돌려주고 호출은 부른 쪽이 합니다 | `retry-checker` 선례 · [ADR-028](../../decisions/028-runtime-and-module-shape.md) |
| **스트리밍·웹소켓을 쓰지 않습니다** | [ADR-022](../../decisions/022-chat-turn-boundaries.md) |
| **예외 종류로 분기하지 않습니다.** 재시도 여부 하나만 봅니다 | [에러 계약](../../spec/backend/08-16-errors.md) §2 |
| **`pii-masker` 를 건너뛴 전송 경로를 만들지 않습니다** | [PII 경계](../../spec/common/08-14-pii-boundary.md) · 불변 규칙 2 |
| 텍스트 하한 **12.5px**, 터치 목표 **44px** | [ADR-032](../../decisions/032-text-floor.md) |
| 색·크기는 **토큰만**. 빨강을 쓰지 않습니다 | [디자인 토큰](../../spec/frontend/design-system/08-16-tokens.md) |
| 층 C 모듈 `index.ts` 머리에 `import "client-only"` | [ADR-028](../../decisions/028-runtime-and-module-shape.md) |
| 모듈 README 끝에 **「판단이 필요했던 자리」 표**를 둡니다. 이 계획이 기본값을 고른 자리(예: `poll-checker` 의 「에러에서는 멈춘다」)가 그 표의 행입니다 | [RFC-001](../../rfc/001-repo-structure.md) 「모듈 하나의 파일 골격」 · `work-handler` 선례 |
| **모름은 실패가 아닙니다** | 불변 규칙 5 |

---

## Task 1: 에러 응답이 재시도 여부를 밝히게 한다

**`poll-checker` 가 지킬 규칙을 지금은 지킬 수 없습니다.**
[모듈 경계](../../spec/common/08-16-module-boundaries.md)가 이 모듈에 **「예외 종류로
분기하기」를 금지**하고 서버 `retry-checker` 와 **같은 규칙(`retryable` 하나만 본다)**
을 따르라고 하는데, [HTTP 응답 본문](../../spec/backend/08-16-errors.md) §3 에는
`code` · `message` · `audit_id` 만 있고 **`retryable` 이 없습니다.**

HTTP 상태로 유추할 수도 없습니다 — `IngestError` 는 **재시도 가능인데 422** 로 나가고,
`RateLimitedError` 는 **재시도 불가인데 429** 입니다. 상태만 보면 둘을 뒤집게 됩니다.

**Files:**
- Modify: `spec/backend/08-16-errors.md` §3 (응답 예시와 표 아래)
- Modify: `docs/plans/08-20-api-routes.md` (미결 표에 한 줄)

**Interfaces:**
- Produces: 에러 본문의 `retryable: boolean` — **자동 재시도가 아니라
  「다시 시도」 버튼을 보여줄지**를 정하는 데 씁니다(아래 Step 1 의 경고 참조).

- [x] **Step 0: 계획 문서를 먼저 커밋한다** (다른 계획 실행자가 이미 했으면 건너뜁니다)

```bash
git add docs/plans/08-22-layer-c-viewers.md docs/plans/08-22-layer-c-transport.md docs/plans/README.md
git commit -m "층 C 구현 계획 둘 — 보여주는 셋 · 서버와 이야기하는 넷"
```

**이 커밋이 먼저여야 합니다.** 바로 아래 Step 1 이 `spec/` 에 **이 계획을 가리키는 링크**를
심습니다. 계획 파일이 커밋에 없으면 워킹트리를 보는 로컬 검사기는 통과하고
**CI 에서만** 「가리키는 파일이 없습니다」로 깨집니다.

- [x] **Step 1: 응답 형식에 한 칸을 더한다 (초안)**

`spec/backend/08-16-errors.md` §3 의 예시와 표 사이에 붙입니다:

````markdown
> ⬜ **초안 — 본문에 `retryable` 을 싣습니다**
>
> 2026-08-22 제기 →
> [층 C 서버와 이야기하는 넷 계획](../../docs/plans/08-22-layer-c-transport.md) Task 1.
>
> **브라우저에도 `retry-checker` 의 짝(`poll-checker`)이 있는데, 지금 본문으로는
> 같은 규칙을 지킬 수 없습니다.** §2 의 재시도 표는 서버 안에서만 통하고,
> HTTP 상태로 유추하면 뒤집힙니다 — `IngestError` 는 **재시도 가능인데 422**,
> `RateLimitedError` 는 **재시도 불가인데 429** 입니다.
>
> ```jsonc
> {
>   "error": {
>     "code": "INGEST_FAILED",
>     "message": "파일을 읽지 못했습니다. 다른 파일로 시도해 주세요.",
>     "audit_id": "01J8XKR2N4P6T8V0W2Y4A6C8E0",
>     "retryable": false        // ← 더하는 칸. §2 표의 값을 그대로 옮깁니다
>   }
> }
> ```
>
> **값의 정본은 §2 표 하나입니다.** 서버가 그 값을 응답에 옮길 뿐이고,
> 브라우저는 **이 칸만 봅니다** — 예외 종류를 다시 분기하지 않습니다.
>
> `detail` 을 본문에 넣지 않는 규칙은 그대로입니다. `retryable` 은 **판단 결과**이지
> 내부 사정이 아니라, 밖으로 나가도 새는 것이 없습니다.
>
> **확정 전까지 `poll-checker` 는 보수적으로 굽니다** — 이 칸이 없으면 재시도하지
> 않고 사용자에게 넘깁니다. 틀려서 안 눌러 주는 쪽이, 틀려서 계속 때리는 쪽보다 낫습니다.
>
> ⚠️ **이 칸을 받아도 브라우저가 자동으로 다시 부르는 것은 아닙니다.** 바로 아래 §3.1 이
> 「클라이언트는 자동으로 다시 부르지 않습니다 — **누르는 것은 사용자가 합니다**」라고
> 정했고, §2.1 의 예산(20초·120초)은 **서버리스 함수 안**의 재시도에 건 것입니다.
> 브라우저는 이 칸을 **「다시 시도」 버튼을 보여줄지**에만 씁니다.
>
> ⚠️ **그렇다면 이 칸이 필요 없을 수도 있습니다.** §3.1 이 이미
> 「`Retry-After` 가 없는 오류에 재시도 버튼을 띄우지 마세요」라고 정해 두었으므로,
> **버튼 표시 신호로는 `Retry-After` 유무만으로 충분할 수 있습니다.**
> 그런데 [모듈 명칭](../common/08-16-module-names.md) 층 C 는 `poll-checker` 가
> 「실패를 **재시도**·표시로 가른다」고 적어 §3.1 과 어긋납니다 —
> **정본 둘이 어긋나는 자리라 사람이 정해야 합니다.**
>
> ⚠️ **§3.1 은 제목과 표도 서로 다릅니다.** 제목은 「`Retry-After` — **503 에만** 붙입니다」인데
> 표에는 **429 에도 붙는다**고 되어 있습니다. 위 결정과 함께 정리해 주세요.
````

- [x] **Step 2: 착수 문서의 미결 표에 한 줄을 더한다**

`docs/plans/08-20-api-routes.md` 「정본에 없어 채워야 하는 것」 표에:

```markdown
| **에러 본문의 `retryable`** | 브라우저 `poll-checker` 가 「재시도 여부 하나만 본다」를 지킬 수단이 없습니다 |
```

- [x] **Step 3: 검사기를 돌린다**

```bash
python .github/scripts/doc-integrity.py
```

기대: `OK`

- [x] **Step 4: 커밋**

```bash
git add spec/backend/08-16-errors.md docs/plans/08-20-api-routes.md
git commit -m "에러 본문에 retryable 을 싣는 초안 — 브라우저가 같은 규칙을 지킬 수단"
```

---

## Task 2: poll-checker — 다음에 언제 물을지 정한다

**Files:**
- Create: `src/modules/poll-checker/types.ts`
- Create: `src/modules/poll-checker/poll.ts`
- Create: `src/modules/poll-checker/poll.test.ts`

**Interfaces:**
- Consumes: `GET …/evidence/{id}` 응답 요약 ([API](../../spec/common/08-14-api.md) §3.3) ·
  에러 본문 ([에러](../../spec/backend/08-16-errors.md) §3)
- Produces: `decidePoll(input): PollVerdict` · 타입 `PollInput` · `PollVerdict` ·
  `StopReason`. Task 3 이 씁니다.

> **경계 표의 「내놓는 것: 갱신된 상태」와 §S-06 의 「단계 목록은 `poll-checker` 가 내준
> 값 그대로」는 이 태스크로 끝나지 않습니다.** `decidePoll` 은 다시 물을지만 정하고,
> 응답 본문(`ingest_status` · `progress.phase`)을 화면 상태로 옮기는 것은 **부른 쪽의 일**로
> 남습니다 — `chat.tsx` 의 `PendingBubble` `TODO(연결)` 이 그 자리입니다.
> 라우트가 붙는 날 그 배선까지가 한 작업입니다.

- [x] **Step 1: 계약 타입을 쓴다**

`src/modules/poll-checker/types.ts`:

```ts
/**
 * poll-checker — `poll_after_ms` 를 보고 다시 묻는다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.3 · spec/backend/08-16-errors.md §2 §3
 * 이름: spec/common/08-16-module-names.md 층 C 「서버와 이야기하는 자리」
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **스트리밍·웹소켓 쓰기** (ADR-022)
 *  · **예외 종류로 분기하기** — 재시도 여부 하나만 봅니다
 *  · **에러를 자동으로 다시 부르기** — 에러 §3.1 「누르는 것은 사용자가 합니다」
 *  · 스스로 기다리거나 다시 부르기 — 판단만 돌려줍니다
 *  · 간격을 여기서 지어내기 — 서버가 지시한 값만 씁니다
 */

export interface PollInput {
  /** HTTP 상태. `200` 이면 정상 진행입니다 */
  status: number;

  /** 처리가 끝났나 — §3.3 `ingest_status === "done"` */
  done: boolean;

  /**
   * 서버가 지시한 다음 호출 간격 — §3.3 `poll_after_ms`.
   *
   * **없으면 다시 묻지 않습니다.** 화면이 간격을 지어내면 서버의 부하 조절이 무의미해집니다.
   */
  pollAfterMs?: number;

  /**
   * 에러가 재시도 가능한가 — 에러 §2 표의 값.
   *
   * ⬜ **아직 응답 본문에 없습니다** → Task 1.
   * **이 값이 `true` 여도 자동으로 다시 부르지 않습니다** — 「다시 시도」 버튼을
   * 보여줄지에만 씁니다 (에러 §3.1).
   */
  retryable?: boolean;

  /**
   * `Retry-After` 헤더(초).
   *
   * 화면이 「N초 뒤 다시 시도할 수 있습니다」를 띄우는 데 씁니다 → 에러 §3.1.
   * **없는 오류에는 재시도 버튼을 띄우지 않습니다.**
   */
  retryAfterSec?: number;
}

/** 왜 멈추는가 */
export type StopReason =
  /** 처리가 끝났습니다 — 정상 종료 */
  | "done"
  /** 서버가 다음 간격을 지시하지 않았습니다 */
  | "no_interval"
  /** 에러 응답입니다. **자동으로 다시 부르지 않습니다** → 에러 §3.1 */
  | "error";

export type PollVerdict =
  | { readonly poll: true; readonly delayMs: number }
  | {
      readonly poll: false;
      readonly reason: StopReason;
      /**
       * 화면이 「N초 뒤 다시 시도할 수 있습니다」와 재시도 버튼을 그릴 때 씁니다.
       * `Retry-After` 가 온 응답에만 있습니다 — **누르는 것은 사용자입니다.**
       */
      readonly retryAfterSec?: number;
    };
```

- [x] **Step 2: 실패하는 시험을 쓴다**

`src/modules/poll-checker/poll.test.ts`:

```ts
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
```

- [x] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/poll-checker
```

기대: FAIL — `Cannot find module './poll'`

- [x] **Step 4: 최소 구현을 쓴다**

`src/modules/poll-checker/poll.ts`:

```ts
import type { PollInput, PollVerdict } from "./types";

/**
 * 다음에 다시 물을지, 언제 물을지 판단합니다. **기다리거나 다시 부르지 않습니다** —
 * 판단만 돌려주고 실제 대기와 재호출은 부른 쪽이 합니다 (`retry-checker` 와 같은 모양).
 *
 * **정상 진행(200)과 에러를 다르게 다룹니다.**
 *
 *  · 정상 진행 — 서버의 `poll_after_ms` 를 그대로 씁니다. **예산을 걸지 않습니다.**
 *    전사는 몇 분이 걸릴 수 있고, 부하 조절은 서버가 그 값으로 합니다 (§3.3).
 *
 *  · 에러 — **자동으로 다시 부르지 않습니다.** 에러 §3.1 이 「클라이언트는 자동으로
 *    다시 부르지 않습니다 … 누르는 것은 사용자가 합니다」라고 정했습니다.
 *    이 응답은 **서버가 이미 §2.1 의 예산 안에서 재시도한 뒤**에 나온 것이라,
 *    여기서 또 때리면 아픈 서버에 요청이 배로 늡니다. `Retry-After` 는 화면이
 *    「N초 뒤 다시 시도할 수 있습니다」를 띄우는 데 쓰라고 넘길 뿐입니다.
 *
 * **§2.1 의 예산(20초·120초)을 여기 가져오지 않습니다** — 그건 서버리스 함수 **안**의
 * 재시도에 건 것입니다.
 */
export function decidePoll(input: PollInput): PollVerdict {
  if (input.done) return { poll: false, reason: "done" };

  // ── 정상 진행 ────────────────────────────────────────────
  if (input.status >= 200 && input.status < 300) {
    if (typeof input.pollAfterMs !== "number") {
      // 간격을 지어내지 않습니다 — 서버의 부하 조절이 무의미해집니다
      return { poll: false, reason: "no_interval" };
    }
    return { poll: true, delayMs: input.pollAfterMs };
  }

  // ── 에러 ────────────────────────────────────────────────
  // 예외 종류를 분기하지 않고, 자동으로 다시 부르지도 않습니다 → 에러 §2 · §3.1
  return typeof input.retryAfterSec === "number"
    ? { poll: false, reason: "error", retryAfterSec: input.retryAfterSec }
    : { poll: false, reason: "error" };
}
```

- [x] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/poll-checker
```

기대: PASS — 8 passed

- [x] **Step 6: 커밋**

```bash
git add src/modules/poll-checker/
git commit -m "poll-checker — 재시도 여부 하나만 보고 다음 호출을 정한다 (에러 §2)"
```

---

## Task 3: poll-checker — 공개 API 와 README

**Files:**
- Create: `src/modules/poll-checker/index.ts`
- Create: `src/modules/poll-checker/README.md`

- [x] **Step 1: 공개 API 를 쓴다**

`src/modules/poll-checker/index.ts`:

```ts
/**
 * poll-checker — `poll_after_ms` 를 보고 다시 묻는다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-022(스트리밍을 쓰지 않는다) · ADR-023(층 C)
 *
 * 서버의 `retry-checker` 와 짝입니다 — **같은 규칙(재시도 여부 하나만 본다)** 을 따릅니다.
 */

import "client-only";

export { decidePoll } from "./poll";
export type { PollInput, PollVerdict, StopReason } from "./types";
```

- [x] **Step 2: README 를 쓴다**

`src/modules/poll-checker/README.md`:

```markdown
# poll-checker

서버에 다시 물을지, 언제 물을지 정합니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | 서버 응답·에러의 요약 |
| 내놓는 것 | 「다시 물어라 + 몇 ms 뒤」 또는 「멈춰라 + 왜」 |
| 절대 하지 않는 것 | **스트리밍·웹소켓** · **예외 종류로 분기** · 스스로 기다리기 · 간격 지어내기 |

## 왜 스트리밍이 아닌가

Vercel 서버리스는 장시간 연결에 제약이 있습니다. 서버가 `poll_after_ms` 로
다음 호출 시점을 지시해 부하를 조절합니다 → [API](../../../spec/common/08-14-api.md) §3.3.
챗도 같습니다 — 근거 검증이 끝난 뒤 한 번에 나갑니다
([ADR-022](../../../decisions/022-chat-turn-boundaries.md)).

## 정상 진행에는 예산이 없습니다

전사는 몇 분이 걸릴 수 있습니다. 폴링은 §3.3 이 정한 정상 경로라 끊을 이유가 없고,
에러 §2.1 의 예산(20초·120초)은 **서버리스 함수 안의 재시도**에 건 것입니다.

## 에러에서는 다시 부르지 않습니다

「클라이언트는 자동으로 다시 부르지 않습니다」 — 에러 §3.1. 서버가 이미 재시도한
뒤의 응답이라, 여기서 또 때리면 아픈 서버에 요청이 배로 늡니다. `Retry-After` 가
있으면 그 값을 화면 문구(「N초 뒤 다시 시도할 수 있습니다」)로 넘기고,
**누르는 것은 사용자가 합니다.**

브라우저의 에러 자동 재시도를 허용할지는 [모듈 명칭](../../../spec/common/08-16-module-names.md)
층 C(「실패를 재시도·표시로 가른다」)와 §3.1 이 어긋나는 자리라 **사람이 정합니다**
→ [계획 Task 1](../../../docs/plans/08-22-layer-c-transport.md). 그 전까지는 멈추는 쪽입니다.
```

- [x] **Step 3: 빌드가 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [x] **Step 4: 커밋**

```bash
git add src/modules/poll-checker/
git commit -m "poll-checker — 공개 API 와 README"
```

---

## Task 4: case-opener — 토큰을 보고 첫 화면을 고른다

**계정이 없어 이 자리가 인증을 통째로 대신합니다.** 토큰 규격은
[ADR-039](../../decisions/039-link-token.md)가 정했습니다 — 128비트 · Crockford Base32 · 26자.

**Files:**
- Create: `src/modules/case-opener/types.ts`
- Create: `src/modules/case-opener/open.ts`
- Create: `src/modules/case-opener/open.test.ts`

**Interfaces:**
- Consumes: `GET /api/cases/{case_token}` ([API](../../spec/common/08-14-api.md) §3.10)
- Produces: `isCaseToken(value): boolean` · `openCase(response): ScreenState` ·
  타입 `CaseResponse` · `ScreenState` · `Focus` · `Side`

- [x] **Step 1: 계약 타입을 쓴다**

`src/modules/case-opener/types.ts`:

```ts
/**
 * case-opener — URL 토큰으로 사건을 연다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.10 · spec/frontend/08-14-screens.md §S-05
 * 근거: ADR-021(재진입) · ADR-035(화면 상태 두 축) · ADR-039(링크 토큰)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · 토큰을 외부로 흘리기
 *  · **잃은 링크를 복구해 주는 척하기** (재발급 경로는 없습니다 — ADR-039 ⑥)
 */

/** 본문이 무엇을 보여주나 → ADR-035. `src/app/c/[token]/state.ts` 와 같은 값입니다 */
export type Focus = "chat" | "plan" | "evidence" | "doc";

/** 오른쪽 350px 열 */
export type Side = "casefile" | "work";

export interface ScreenState {
  focus: Focus;
  side: Side;
}

/** §3.10 응답 중 첫 화면을 고르는 데 쓰는 부분만 */
export interface CaseResponse {
  case_id: string;
  track: string;
  plan?: {
    steps?: readonly {
      step_id: string;
      state: string;
    }[];
  };
}
```

- [x] **Step 2: 실패하는 시험을 쓴다**

`src/modules/case-opener/open.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isCaseToken, openCase } from "./open";
import type { CaseResponse } from "./types";

const withSteps = (...states: string[]): CaseResponse => ({
  case_id: "01J8XKR5000000000000000000",
  track: "victim",
  plan: { steps: states.map((state, i) => ({ step_id: `s${i}`, state })) },
});

describe("링크 토큰을 알아본다", () => {
  it("26자 Crockford Base32 를 받는다", () => {
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQRS")).toBe(true);
  });

  it("헷갈리는 네 글자는 토큰에 없다 — I·L·O·U", () => {
    expect(isCaseToken("0123456789ABCDEFGHIKMNPQRS")).toBe(false);
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQRU")).toBe(false);
  });

  it("길이가 다르면 아니다", () => {
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQR")).toBe(false);
    expect(isCaseToken("0123456789ABCDEFGHJKMNPQRST")).toBe(false);
  });

  it("소문자도 받는다 — 사용자가 손으로 옮겨 적을 수 있다", () => {
    expect(isCaseToken("0123456789abcdefghjkmnpqrs")).toBe(true);
  });

  it("빈 값에 던지지 않는다", () => {
    expect(isCaseToken("")).toBe(false);
  });
});

describe("첫 화면은 서버가 지목하지 않는다 — 사실로 고른다", () => {
  it("플랜이 있으면 곧장 플랜으로 연다", () => {
    expect(openCase(withSteps("not_started")).focus).toBe("plan");
  });

  it("플랜이 비어 있으면 챗으로 연다", () => {
    expect(openCase(withSteps()).focus).toBe("chat");
  });

  it("플랜 자체가 없어도 던지지 않는다", () => {
    const got = openCase({ case_id: "01J", track: "victim" });
    expect(got).toEqual({ focus: "chat", side: "casefile" });
  });

  it("지금 할 단계가 있으면 오른쪽을 작업으로 연다", () => {
    expect(openCase(withSteps("done_verified", "in_progress")).side).toBe("work");
  });

  it("할 것이 남았으면 작업으로 연다", () => {
    expect(openCase(withSteps("done_verified", "not_started")).side).toBe("work");
  });

  it("전부 끝났으면 사건 파일로 연다", () => {
    expect(openCase(withSteps("done_verified", "skipped")).side).toBe("casefile");
  });

  it("증거함으로는 열지 않는다 — 눌러서 가는 곳이지 도착지가 아니다", () => {
    for (const states of [[], ["not_started"], ["done_verified"]]) {
      expect(openCase(withSteps(...states)).focus).not.toBe("evidence");
    }
  });
});
```

- [x] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/case-opener
```

기대: FAIL — `Cannot find module './open'`

- [x] **Step 4: 최소 구현을 쓴다**

`src/modules/case-opener/open.ts`:

```ts
import type { CaseResponse, ScreenState } from "./types";

/**
 * Crockford Base32 — `0-9A-Z` 에서 **`I`·`L`·`O`·`U` 를 뺀** 32글자 → ADR-039 ②.
 *
 * ⚠️ **ULID 와 길이가 같습니다(26자).** 겉으로 구분이 안 되니 코드에서 섞지 마세요 —
 * 다른 점은 길이가 아니라 **시간 정보가 없다**는 것입니다.
 */
const TOKEN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/i;

/** 이 값이 링크 토큰처럼 생겼나. **있는 토큰인지는 서버만 압니다** */
export function isCaseToken(value: string): boolean {
  return TOKEN.test(value);
}

/** 아직 남은 일이 있는 상태 → 데이터 모델 §6 */
const OPEN_STATES = new Set(["not_started", "in_progress", "unconfirmed"]);

/**
 * 첫 화면을 고릅니다.
 *
 * **서버가 지목하지 않습니다** — §3.10 이 `focus`·`side` 를 응답에 넣지 않기로 했고,
 * 화면 구조가 바뀔 때마다 서버를 고치게 두지 않으려는 것입니다.
 *
 * ```
 * focus   plan.steps 가 비어 있지 않으면       → 'plan',  그 밖 → 'chat'
 * side    plan.steps 에 지금 할 단계가 있으면  → 'work',  그 밖 → 'casefile'
 * ```
 *
 * **`focus: "evidence"` 로는 열지 않습니다** — 증거함은 눌러서 가는 곳이지
 * 재진입의 도착지가 아닙니다.
 */
export function openCase(response: CaseResponse): ScreenState {
  const steps = response.plan?.steps ?? [];

  return {
    focus: steps.length > 0 ? "plan" : "chat",
    side: steps.some((s) => OPEN_STATES.has(s.state)) ? "work" : "casefile",
  };
}
```

- [x] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/case-opener
```

기대: PASS — 12 passed

- [x] **Step 6: 커밋**

```bash
git add src/modules/case-opener/
git commit -m "case-opener — 토큰을 알아보고 첫 화면을 규칙으로 고른다 (§3.10 · ADR-039)"
```

---

## Task 5: case-opener — 발급 직후 복사·공유

**「잃은 링크를 복구해 주는 척하지 않습니다」** — 재발급 경로가 없기 때문에
**발급 순간에 확실히 넘기는 것**이 이 모듈의 나머지 절반입니다.

**Files:**
- Create: `src/modules/case-opener/handoff.tsx`
- Create: `src/modules/case-opener/index.ts`
- Create: `src/modules/case-opener/README.md`
- Modify: `src/app/c/[token]/page.tsx` — `CASE_TOKEN` 상수와 **그 사용처 넷**
- Modify: `src/app/c/[token]/state.ts` — `Focus`·`Side`·`ScreenState` 를 모듈에서 재수출
- Modify: `src/app/c/[token]/doc.tsx` — `caseId` prop 이름을 `caseToken` 으로

**Interfaces:**
- Consumes: `isCaseToken` · `openCase` (Task 4)
- Produces: `LinkHandoff` (props `{ url, onCopied }`)

> **`LinkHandoff` 는 새로 그리는 것이 아니라 옮기는 것입니다.** `src/app/start/page.tsx` 의
> 발급(2/2) 절에 **시안 1a 확정본의 카드가 이미 서 있습니다.** 아래 코드와 시안 마크업이
> 다르면 **시안 쪽으로 맞추세요** — 디자인 정본은 핸드오프입니다
> ([RFC-003](../../rfc/003-design-handoff.md) · [ADR-030](../../decisions/030-design-handoff.md)).
> 「나에게 문자로」(`sms:`)처럼 시안에 없는 것을 더할지는 **사람이 정합니다.**
> 화면에 실제로 끼우는 것은 Task 10 입니다.

- [x] **Step 1: 넘기는 카드를 쓴다**

`src/modules/case-opener/handoff.tsx`:

```tsx
"use client";

import { useState } from "react";

/**
 * 발급 직후 링크를 넘기는 자리 — 화면 설계 §S-05 「발급」.
 *
 * **재발급 경로가 없습니다** (ADR-039 ⑥). 그래서 이 순간에 확실히 넘겨야 하고,
 * **잃었을 때 복구해 주는 척하면 안 됩니다** — 그건 토큰이 곧 인증이라는 전제를 깹니다.
 */
export function LinkHandoff({
  url,
  onCopied,
}: {
  url: string;
  onCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
    } catch {
      // 클립보드가 막혀 있어도 실패가 아닙니다 — 아래 주소가 그대로 보입니다
      setCopied(false);
    }
  };

  return (
    <section className="rounded-[13px] border border-hairline bg-surface-low p-4">
      <h3 className="text-[15px] font-[620] text-ink-1">이 주소를 저장해 두세요</h3>
      <p className="mt-1.5 text-[13.5px] leading-[1.6] text-ink-3">
        이 주소가 사건을 여는 유일한 열쇠입니다. 잃으면 다시 만들어 드릴 수 없어,
        지금 문자로 보내 두시는 것이 가장 안전합니다.
      </p>

      {/* 줄바꿈해서라도 **전부 보입니다** — 복사가 실패해도 손으로 옮길 수 있게 (§S-05).
          가로 스크롤로 두면 숨은 부분을 옮겨 적다 잃습니다 */}
      <p
        data-numeric
        className="mt-3 break-all rounded-[9px] bg-chip px-3 py-2 text-[13px] text-ink-2"
      >
        {url}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] bg-ink-1 px-5 text-[14px] font-[660] text-ground"
        >
          {copied ? "복사했습니다" : "주소 복사"}
        </button>
        <a
          href={`sms:?body=${encodeURIComponent(url)}`}
          className="inline-flex min-h-[var(--size-touch)] items-center rounded-[10px] border border-hairline px-5 text-[14px] text-ink-2"
        >
          나에게 문자로
        </a>
      </div>
    </section>
  );
}
```

- [x] **Step 2: 공개 API 와 README 를 쓴다**

`src/modules/case-opener/index.ts`:

```ts
/**
 * case-opener — URL 토큰으로 사건을 연다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-021(재진입) · ADR-035(화면 상태 두 축) · ADR-039(링크 토큰)
 *
 * **계정이 없어 이 자리가 인증을 통째로 대신합니다.**
 */

import "client-only";

export { isCaseToken, openCase } from "./open";
export { LinkHandoff } from "./handoff";
export type { CaseResponse, Focus, ScreenState, Side } from "./types";
```

`src/modules/case-opener/README.md`:

```markdown
# case-opener

URL 토큰으로 사건을 열고, 발급 직후 복사·공유를 제공합니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | URL 토큰 · `GET /api/cases/{case_token}` 응답 |
| 내놓는 것 | 사건 세션 · 첫 화면 |
| 절대 하지 않는 것 | 토큰을 외부로 흘리기 · **잃은 링크를 복구해 주는 척하기** |

## `key-handler` 의 「키」와 헷갈리지 마세요

이쪽은 **URL 에 박혀 돌아다니는 사건 토큰**이고, 저쪽은 **절대 클라이언트를 떠나지 않는
복호화 키**입니다. 이름이 비슷하지만 정반대 물건입니다.

## 첫 화면을 서버가 지목하지 않습니다

`focus`·`side` 는 응답에 없습니다. **응답의 사실로 여기서 고릅니다** —
화면 구조가 바뀔 때마다 서버를 고치게 두지 않으려는 것입니다
→ [API](../../../spec/common/08-14-api.md) §3.10.

## 토큰은 ULID 가 아닙니다

둘 다 26자 Crockford Base32 라 겉으로 구분이 안 됩니다. **다른 점은 시간 정보가
없다는 것**이고, 그래서 비슷한 시각의 사건을 좁혀 찔러볼 수 없습니다
→ [ADR-039](../../../decisions/039-link-token.md).
```

- [x] **Step 3: 화면의 하드코딩 토큰을 지운다**

`src/app/c/[token]/page.tsx` 에서 `const CASE_TOKEN = "7fK2p";` 를 지우고,
Next 의 경로 파라미터를 씁니다. 개발용 `?view=` 스위치는 그대로 둡니다 — 아직 서버가 없습니다.

```tsx
// page.tsx — 클라이언트 컴포넌트라 훅으로 받습니다
import { useParams } from "next/navigation";
import { isCaseToken } from "@/modules/case-opener";

// …컴포넌트 안에서
const token = String(useParams().token ?? "");
// 형태가 아니면 서버를 부르지 않습니다 — 열거 시도에 왕복을 태우지 않습니다.
// 라우트가 없는 지금은 쓰는 곳이 없어도 됩니다 — fetch 가 붙는 날 그 앞의 관문이 됩니다
const looksReal = isCaseToken(token);
```

**`CASE_TOKEN` 을 쓰던 자리 넷을 전부 바꿉니다.** 하나만 고치면 빌드가 깨집니다.

| 자리 | 바꾼 뒤 |
| --- | --- |
| `copyUrl` 의 `https://finally.kr/c/${CASE_TOKEN}` | `window.location.href` — 도메인을 하드코딩하지 않습니다 |
| 헤더 칩 `사건 {CASE_TOKEN}` | `사건 {token.slice(0, 5)}…` — 26자를 다 쓰면 칩이 넘칩니다 |
| `<DocGuide caseId={CASE_TOKEN} />` **두 곳**(본문·유령) | `<DocGuide caseToken={token} … />` — **prop 이름도 함께 바꿉니다**(`doc.tsx`). `caseId` 라는 이름에 링크 토큰을 담으면 [ADR-039](../../decisions/039-link-token.md) ② 「코드에서 섞지 마세요」 위반이 **이 계획의 지시로** 생깁니다 |

> ⚠️ `<DocGuide>` 의 나머지 props 는 [보여주는 셋 계획](08-22-layer-c-viewers.md) Task 11 이
> 함께 고칩니다. **같은 날 실행한다면 이 태스크를 먼저** 끝내세요 — `page.tsx` 는
> 두 계획이 모두 만지는 유일한 파일입니다.

그리고 `src/app/c/[token]/state.ts` 의 `Focus`·`Side`·`ScreenState` **정의를 지우고**
재수출로 바꿉니다 — 같은 타입의 정의가 둘이면 한쪽만 고친 날 조용히 갈라집니다.

```ts
export type { Focus, Side, ScreenState } from "@/modules/case-opener";
```

`FROM_HANDOFF_PHASE` 는 화면 사정이라 그대로 둡니다.

파일 머리 주석의 `⬜ CASE_TOKEN 을 실제 경로 파라미터로` 줄을 지우고
「ADR-039 로 확정, case-opener 가 검사합니다」로 바꿉니다.

- [x] **Step 4: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [x] **Step 5: 커밋**

```bash
git add src/modules/case-opener/ "src/app/c/[token]/page.tsx"
git commit -m "case-opener — 발급 직후 넘기기 + 하드코딩 토큰 제거 (ADR-039)"
```

---

## Task 6: file-sender — 세 단계 흐름을 값으로 만든다

**업로드는 presigned 방식이라 세 단계입니다** — 자리 요청 → 직접 PUT → 완료 통지.
모듈은 **어느 단계인지와 다음에 무엇을 할지**만 정하고, 실제 전송은 부른 쪽이 합니다.

**Files:**
- Create: `src/modules/file-sender/types.ts`
- Create: `src/modules/file-sender/send.ts`
- Create: `src/modules/file-sender/send.test.ts`

**Interfaces:**
- Consumes: `maskText(text, ctx?): MaskResult` from `@/modules/pii-masker` ·
  [API](../../spec/common/08-14-api.md) §3.2 §3.8
- Produces: `screenName(name): NameCheck` · `nextStep(state): SendStep` ·
  `forkFor(status): Fork | null` · 타입 `SendTarget` · `SendState` · `SendStep` ·
  `Fork` · `EvidenceStatus`

- [x] **Step 1: 계약 타입을 쓴다**

`src/modules/file-sender/types.ts`:

```ts
/**
 * file-sender — 파일을 pii-masker 에 태워 올리고 처리 상태를 추적한다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.2 §3.8 · spec/frontend/08-14-screens.md §S-08
 * 근거: ADR-023(층 C) · ADR-026(가리지 못한 파일은 올리지 않는다)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **`pii-masker` 를 건너뛴 업로드 경로 만들기**
 *  · 업로드를 관문으로 만들기 — 증거가 없어도 T0 는 그대로 돕니다
 */

/**
 * §3.3 `ingest_status` — 처리 상태.
 *
 * **이 모듈이 주인입니다** — 경계 표에서 「업로드 + **처리 상태**」가 `file-sender` 의
 * 내놓는 것이고, `transcript-viewer` 는 전사만 그립니다.
 */
export type EvidenceStatus = "pending" | "processing" | "done" | "failed";

/** §3.2 1단계 응답 */
export interface UploadSlot {
  evidence_id: string;
  upload_url: string;
  upload_method: string;
  expires_at: string;
}

/**
 * 이 업로드가 어디에 붙나 — 증거함(§3.2) 또는 **단계 부산물**(§3.8 `sms_capture`).
 *
 * **증거와 부산물을 함께 맡습니다** — 엔드포인트는 다르지만 클라이언트 동작이 같습니다
 * → [모듈 명칭](../../spec/common/08-16-module-names.md) 층 C.
 */
export type SendTarget =
  | { kind: "evidence" }
  | { kind: "step-artifact"; stepId: string };

/** 지금 어느 단계인가 */
export type SendState =
  | { phase: "idle"; target: SendTarget }
  | { phase: "slot-requested"; target: SendTarget; slot: UploadSlot }
  | { phase: "uploaded"; target: SendTarget; slot: UploadSlot }
  | { phase: "notified"; target: SendTarget; evidenceId: string }
  | { phase: "ingested"; target: SendTarget; evidenceId: string };

/** 다음에 무엇을 할까 */
export type SendStep =
  | { do: "request-slot" }
  | { do: "put-file"; url: string; method: string }
  | { do: "notify-complete"; evidenceId: string }
  | { do: "poll"; evidenceId: string }
  /** §3.8 — 처리가 끝난 증거를 단계 부산물로 붙입니다 (`sms_capture`) */
  | { do: "post-artifact"; stepId: string; evidenceId: string }
  | { do: "done" };

/** 파일 이름에 원문이 남아 있는지 본 결과 */
export interface NameCheck {
  /** 네트워크로 나가도 되는 이름 */
  safe: string;
  /** 가려진 것이 있었나 */
  masked: boolean;
}

/** 처리가 `failed` 일 때 사용자에게 주는 갈림길 — **막는 것이 아닙니다** */
export interface Fork {
  message: string;
  choices: readonly string[];
}
```

- [x] **Step 2: 실패하는 시험을 쓴다**

`src/modules/file-sender/send.test.ts`:

```ts
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
```

- [x] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/file-sender
```

기대: FAIL — `Cannot find module './send'`

- [x] **Step 4: 최소 구현을 쓴다**

`src/modules/file-sender/send.ts`:

```ts
import { maskText } from "@/modules/pii-masker";
import type { Fork, NameCheck, SendState, SendStep } from "./types";

/**
 * 파일 **이름**도 경계를 지납니다. 「입금내역_110-2345-678901.png」처럼
 * 이름 자체에 계좌가 든 경우가 실제로 흔합니다.
 *
 * ⚠️ **이것으로 파일 속 주민번호까지 걸러지지는 않습니다.** 이미지·음성 안의 검출
 * 방법은 ADR-026 이 **「착수 전 가장 큰 미결」** 로 남긴 TODO(미정)입니다.
 *
 * 확실한 것은 방향뿐입니다 — **검출·차단은 업로드 전, 사용자 기기 안에서** 일어나야
 * 합니다 (ADR-026 결정 하나·둘 · 데이터 모델 §3 「저장되는 원본은 이미 가려진 사본」).
 * **서버가 받은 뒤 걸러 주는 구조를 여기 가정하지 마세요** — 그 순간 주민등록번호가
 * 든 원본이 서버에 존재한 적이 있게 되고, ADR-026 이 피해 가려던 문제가 되살아납니다.
 */
export function screenName(name: string): NameCheck {
  if (name === "") return { safe: "", masked: false };
  const result = maskText(name);
  return { safe: result.masked, masked: result.added.length > 0 };
}

/**
 * 다음에 무엇을 할지 정합니다. **직접 보내지 않습니다** — 부른 쪽이 합니다.
 *
 * 파일이 API 서버를 거치지 않고 객체 저장소로 직접 갑니다 (§3.2) —
 * 서버리스 함수의 본문 크기·실행 시간 제한 때문입니다.
 */
export function nextStep(state: SendState): SendStep {
  switch (state.phase) {
    case "idle":
      return { do: "request-slot" };
    case "slot-requested":
      return {
        do: "put-file",
        url: state.slot.upload_url,
        method: state.slot.upload_method,
      };
    case "uploaded":
      return { do: "notify-complete", evidenceId: state.slot.evidence_id };
    case "notified":
      return { do: "poll", evidenceId: state.evidenceId };
    case "ingested":
      // 증거와 부산물을 **함께** 맡습니다 — 여기가 그 갈림길입니다 (§3.8)
      return state.target.kind === "step-artifact"
        ? {
            do: "post-artifact",
            stepId: state.target.stepId,
            evidenceId: state.evidenceId,
          }
        : { do: "done" };
  }
}

/**
 * 파일이 「못 가려서 제외됨」 상태일 때의 갈림길 — §S-08 `failed` 행.
 *
 * **막는 것이 아니라 갈림길을 주는 것입니다** (ADR-026). 파일 하나를 빼도
 * T0 는 그대로 돌고, **사용자가 뭘 잘못한 것이 아닙니다** — 그래서 앰버이고
 * 빨강이 아니며, 문구도 사용자를 탓하지 않습니다.
 *
 * ⚠️ **이 상태를 누가 어떻게 세우는지는 미정입니다** (ADR-026 「남은 것」 — 브라우저
 * 검출 방법이 TODO). 서버의 `ingest_status: "failed"` 는 데이터 모델상 **STT·OCR 실패**
 * (`INGEST_FAILED` — 「파일을 읽지 못했습니다」)라 낱말만 같습니다 —
 * **같은 것이라고 단정하지 마세요.** 뭉치면 진짜 전사 실패가 났을 때 화면에
 * 「가릴 수 없는 정보가 있어 올리지 않았습니다」라는 **거짓 문구**가 나갑니다.
 * 그 구분은 검출 방법이 정해질 때 사람이 정합니다.
 */
export function forkFor(status: string): Fork | null {
  if (status !== "failed") return null;
  return {
    message: "이 파일은 가릴 수 없는 정보가 있어 올리지 않았습니다. 없이도 진행됩니다.",
    choices: ["다른 파일 올리기", "없이 진행"],
  };
}
```

- [x] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/file-sender
```

기대: PASS — 12 passed

> `screenName` 시험이 실패하면 `pii-masker` 의 `findHits` 가 `110-2345-678901` 을 잡는지
> 확인하세요. 참고로 이 견본은 13자리가 Luhn 을 통과해 **계좌가 아니라 카드로** 잡힙니다
> (`patterns.ts` 의 카드 패턴이 계좌보다 먼저) — 어느 쪽이든 가려지므로 시험은 통과합니다.
> 안 잡힌다면 **여기서 정규식을 새로 만들지 마세요** — 패턴을 두 곳에 두면 어긋난 쪽이
> 조용히 새는 쪽이 됩니다. `pii-masker` 를 고칩니다.

- [x] **Step 6: 커밋**

```bash
git add src/modules/file-sender/
git commit -m "file-sender — 세 단계 흐름과 갈림길. 이름도 경계를 지난다 (§3.2 · ADR-026)"
```

---

## Task 7: file-sender — 자료 레일과 공개 API

**Files:**
- Create: `src/modules/file-sender/rail.tsx`
- Create: `src/modules/file-sender/index.ts`
- Create: `src/modules/file-sender/README.md`
- Modify: `src/app/c/[token]/evidence.tsx` — `FILES`·`DOT`·`type Status` 를 지웁니다

**Interfaces:**
- Consumes: `forkFor` · `EvidenceStatus` (Task 6)
- Produces: `FileRail` (props `{ files, selectedId, onSelect, onRetry, onSkip }`) ·
  `StatusDot` (props `{ status }`) · 타입 `RailFile`

> **자료 레일은 선택 UI 를 겸합니다** — 지금 화면에서 파일을 누르면 오른쪽 전사 본문이
> 그 파일로 바뀝니다(시안 1d 의 두 칸 구조). 그 동작을 잃지 않도록 `selectedId`·`onSelect`
> 를 받습니다.

- [x] **Step 1: 상태 점과 자료 레일을 쓴다**

`src/modules/file-sender/rail.tsx`. **점은 색뿐이라 아래 한 줄이 항상 같은 것을 말로
말합니다** (§S-08) — 그래서 라벨이 딸려 갑니다.

```tsx
"use client";

import { forkFor } from "./send";
import type { EvidenceStatus } from "./types";

const DOT: Record<EvidenceStatus, { cls: string; label: string }> = {
  pending: { cls: "border border-[oklch(0.305_0.013_267.1/70%)]", label: "대기 중" },
  processing: { cls: "bg-pii animate-pulse", label: "가리는 중" },
  done: { cls: "bg-pii", label: "전사 완료" },
  failed: { cls: "bg-deadline-urgent", label: "제외 — 주민번호를 못 가렸습니다" },
};

export function StatusDot({ status }: { status: EvidenceStatus }) {
  const dot = DOT[status] ?? DOT.pending;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot.cls}`} />
      <span className="text-[13px] text-ink-3">{dot.label}</span>
    </span>
  );
}

export interface RailFile {
  /** 목록 키. **업로드 전(차단 포함)에도 필요하므로 로컬 id 입니다** */
  id: string;
  /** §3.2 로 자리를 받은 뒤에만 있습니다 — 못 가려서 안 올린 파일에는 없습니다 */
  evidence_id?: string;
  /** `screenName` 을 지난 이름 */
  name: string;
  status: EvidenceStatus;
  /** §3.3 `progress.percent` */
  percent?: number;
}

export function FileRail({
  files,
  selectedId,
  onSelect,
  onRetry,
  onSkip,
}: {
  files: readonly RailFile[];
  /** 전사 본문이 보여주는 파일 — 레일이 선택 UI 를 겸합니다 (시안 1d) */
  selectedId?: string;
  onSelect?: (id: string) => void;
  onRetry?: (id: string) => void;
  onSkip?: (id: string) => void;
}) {
  return (
    <ul className="flex w-full flex-col gap-2 md:w-[220px]">
      {files.map((f) => {
        const fork = forkFor(f.status);
        return (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => onSelect?.(f.id)}
              aria-current={f.id === selectedId ? "true" : undefined}
              className={`w-full rounded-[11px] border bg-surface-low p-3 text-left ${
                f.id === selectedId ? "border-[oklch(1_0_0/25%)]" : "border-hairline"
              }`}
            >
              <span className="block truncate text-[13.5px] text-ink-1" title={f.name}>
                {f.name}
              </span>
              <span className="mt-1.5 block">
                <StatusDot status={f.status} />
              </span>

              {f.status === "processing" && (
                <span className="mt-1 block text-[12.5px] leading-[1.6] text-ink-3">
                  {typeof f.percent === "number" && (
                    <span data-numeric>가리는 중 {f.percent}% · </span>
                  )}
                  원본은 아직 이 브라우저 안에 있습니다
                </span>
              )}
            </button>

            {fork && (
              // **막는 것이 아니라 갈림길입니다** — 앰버이고 빨강이 아닙니다
              <div className="mt-2 px-3">
                <p className="text-[12.5px] leading-[1.6] text-deadline-urgent">
                  {fork.message}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => onRetry?.(f.id)}
                    className="min-h-[var(--size-touch)] rounded-[9px] border border-hairline px-3 text-[12.5px] text-ink-2"
                  >
                    {fork.choices[0]}
                  </button>
                  <button
                    type="button"
                    onClick={() => onSkip?.(f.id)}
                    className="min-h-[var(--size-touch)] rounded-[9px] border border-hairline px-3 text-[12.5px] text-ink-2"
                  >
                    {fork.choices[1]}
                  </button>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

- [x] **Step 2: 공개 API 와 README 를 쓴다**

`src/modules/file-sender/index.ts`:

```ts
/**
 * file-sender — 파일을 pii-masker 에 태워 올리고 처리 상태를 추적한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-026(가리지 못한 파일은 올리지 않는다)
 *
 * **증거와 부산물을 함께 맡습니다** — 엔드포인트는 다르지만
 * (`/evidence` · `/steps/{id}/artifacts`) 클라이언트 동작이 같습니다.
 */

import "client-only";

export { screenName, nextStep, forkFor } from "./send";
export { FileRail, StatusDot } from "./rail";
export type { RailFile } from "./rail";
export type {
  EvidenceStatus,
  Fork,
  NameCheck,
  SendState,
  SendStep,
  SendTarget,
  UploadSlot,
} from "./types";
```

`src/modules/file-sender/README.md`:

```markdown
# file-sender

파일을 가리고, 올리고, 상태를 추적합니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | 파일 |
| 내놓는 것 | 업로드 + 처리 상태 |
| 절대 하지 않는 것 | **`pii-masker` 를 건너뛴 업로드 경로 만들기** · 업로드를 관문으로 만들기 |

## 브라우저가 볼 수 있는 것과 없는 것

`screenName` 은 **파일 이름**을 가립니다 — 「입금내역_110-2345-678901.png」처럼
이름에 계좌가 든 경우가 흔합니다.

**이미지·음성 안의 주민번호 검출은 미결입니다** — [ADR-026](../../../decisions/026-raw-upload-retention.md)이
「착수 전 가장 큰 미결」로 남겼고, 확실한 것은 **업로드 전에, 기기 안에서** 일어나야
한다는 방향뿐입니다(결정 하나·둘). 못 가린 파일은 **서버로 가지 않고**, 그때
`forkFor` 가 갈림길을 냅니다 — **막는 것이 아닙니다.** 파일 하나를 빼도 T0 는 그대로 돕니다.

**서버의 `ingest_status: "failed"` 와 낱말이 같지만 다른 것입니다** — 그쪽은 STT·OCR
실패(「파일을 읽지 못했습니다」)입니다. 뭉치면 진짜 전사 실패에 **거짓 문구**가 나갑니다.

## `transcript-viewer` 와 규칙이 정반대입니다

하나는 가리고 하나는 펼칩니다. 같은 화면(S-08)에 나란히 서지만 방향이 반대라
모듈을 갈라 두었습니다.
```

- [x] **Step 3: 화면을 모듈로 갈아 끼운다**

`src/app/c/[token]/evidence.tsx` 에서:

1. **`FILES`·`DOT`·`type Status` 셋을 함께 지웁니다.** ([보여주는 셋 계획](08-22-layer-c-viewers.md)
   Task 8 이 이 셋을 남겨 뒀습니다 — `DOT` 의 유일한 사용처가 이 레일이라 거기서
   지우면 빌드가 깨지기 때문입니다.)
2. 자료 레일 목록을 `<FileRail files={FIXTURE_EVIDENCE.files} selectedId={selected}
   onSelect={setSelected} />` 로 바꿉니다 (픽스처는 보여주는 셋 계획 Task 1b).
   **「＋ 올리기」 버튼과 「신분증은 올리지 마세요」 문구는 화면에 남습니다.**
3. 전사 본문 쪽(`<TranscriptView>`)은 **건드리지 않습니다** — 앞 계획의 몫입니다.

- [x] **Step 4: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [x] **Step 5: 커밋**

```bash
git add src/modules/file-sender/ "src/app/c/[token]/evidence.tsx"
git commit -m "file-sender — 자료 레일을 화면에서 모듈로 옮긴다 (S-08)"
```

---

## Task 8: chat-handler — 응답을 버블과 버튼으로 옮긴다

**질문은 한 번에 하나 · 전부 버튼 · 「모름」 상시**입니다.
그리고 **인용 번호와 판단 근거를 화면에 쓰지 않습니다** ([ADR-022](../../decisions/022-chat-turn-boundaries.md) 결정 셋).

**Files:**
- Create: `src/modules/chat-handler/types.ts`
- Create: `src/modules/chat-handler/turn.ts`
- Create: `src/modules/chat-handler/turn.test.ts`

**Interfaces:**
- Consumes: `POST …/messages` 응답 ([API](../../spec/common/08-14-api.md) §3.9) ·
  `next_question` ([API](../../spec/common/08-14-api.md) §3.4) ·
  `restore` from `@/modules/pii-restorer`
- Produces: `outgoing(utterance, ctx?): OutgoingMessage` ·
  `toTurn(response, mappings): Turn` · `sourceNote(citations): string | null` ·
  타입 `ChatResponse` · `Turn` · `NextQuestion` · `OutgoingMessage`

> **나가는 발화와 들어오는 응답을 둘 다 맡습니다.** 경계 표가 이 모듈의 「받는 것」을
> **발화**라고 적었습니다 — 나가는 쪽에 마스킹 자리가 없으면, 라우트가 붙는 날
> 컴포저가 사용자 입력을 그대로 `fetch` 에 태우게 되고 **계좌·전화가 원문으로 경계를
> 넘는 것이 기본값**이 됩니다 (불변 규칙 2).

- [x] **Step 1: 계약 타입을 쓴다**

`src/modules/chat-handler/types.ts`:

```ts
/**
 * chat-handler — 발화를 보내고 응답을 표시한다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.9 (응답) · §3.4 (`next_question`)
 *       spec/frontend/08-14-screens.md §S-06
 * 근거: ADR-022(챗 한 턴의 경계) · ADR-034(화면은 원문을 보여준다)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **인용 번호·판단 근거를 화면에 쓰기** (근거 화면은 보류 상태입니다 — ADR-022 셋)
 *  · **「모름」 없애기** — 선택지에 항상 있습니다
 *  · 응답을 스트리밍하기 (근거 검증이 끝난 뒤 한 번에 나갑니다)
 */

/** §3.4 에 정의가 하나 있고 여기서는 참조만 합니다 */
export interface NextQuestion {
  slot_key: string;
  text: string;
  /** §3.4 가 넷으로 못박았습니다 — `| string` 을 붙이면 계약이 사라집니다 */
  input: "buttons" | "text" | "date" | "amount";
  options?: readonly string[];
}

/** §3.9 `citations[]` — `kb-` 만 법령 근거를 답니다 */
export interface Citation {
  ref: string;
  label: string;
  why?: string;
  kb_entry_id?: string;
  kb_version?: string;
  legal_basis?: string;
  source_url?: string;
  effective_from?: string;
}

export interface ChatResponse {
  message_id: string;
  reply: string;
  citations?: readonly Citation[];
  referenced_steps?: readonly string[];
  referenced_deadlines?: readonly string[];
  next_question?: NextQuestion | null;
}

/** 경계 너머로 나갈 발화 — **`content` 말고는 보내지 않습니다** */
export interface OutgoingMessage {
  /** `POST …/messages` 의 `content` 로 보낼 것 */
  content: string;
  /** 이번 발화에서 새로 생긴 매핑. **보내기 전에** 볼트에 올립니다 → API §3.11 */
  added: PiiMapping[];
  /** 다음 발화에 `MaskContext` 로 이어 넘길 전체 매핑 */
  mappings: PiiMapping[];
}

/** 화면이 그리는 한 턴 */
export interface Turn {
  message_id: string;
  /** **원문입니다** — 종류별 부분 복원을 지난 뒤 (ADR-034 · §3.9) */
  reply: string;
  question: NextQuestion | null;
  /** 「이 답변은 …를 보고 썼습니다」 한 줄. 인용 번호를 쓰지 않습니다 */
  sourceNote: string | null;
  /** 오른쪽 열을 작업으로 돌릴 단계들 */
  referencedSteps: readonly string[];
}
```

- [x] **Step 2: 실패하는 시험을 쓴다**

`src/modules/chat-handler/turn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { outgoing, sourceNote, toTurn } from "./turn";
import type { ChatResponse } from "./types";

const answer: ChatResponse = {
  message_id: "01J8XKRE",
  reply: "[계좌-1] 로 보내신 건은 지급정지가 걸렸습니다.",
  citations: [
    {
      ref: "kb-2",
      label: "피해구제 신청서 제출",
      kb_entry_id: "relief-application",
      legal_basis: "통신사기피해환급법 시행령 제3조",
      effective_from: "2026-07-01",
    },
    { ref: "case-3", label: "피해구제 신청 기한" },
  ],
  referenced_steps: ["01J8XKRD"],
};

const mapping = [{ token: "[계좌-1]", original: "1102345678901", label: "국민" }];

describe("답변을 화면에 옮긴다", () => {
  it("답변의 토큰을 원문으로 되돌린다", () => {
    const got = toTurn(answer, mapping);
    expect(got.reply).not.toContain("[계좌-1]");
  });

  it("인용 번호를 화면에 쓰지 않는다", () => {
    const got = toTurn(answer, mapping);
    expect(got.sourceNote).not.toContain("kb-2");
    expect(got.sourceNote).not.toContain("case-3");
  });

  it("판단 근거를 사용자 응답에 넣지 않는다", () => {
    const withWhy: ChatResponse = {
      ...answer,
      citations: [{ ref: "kb-2", label: "피해구제 신청서 제출", why: "다음 단계라서" }],
    };
    const got = toTurn(withWhy, mapping);
    expect(got.sourceNote).not.toContain("다음 단계라서");
  });

  it("가리킨 단계를 그대로 넘긴다 — 오른쪽 열이 그걸로 열린다", () => {
    expect(toTurn(answer, mapping).referencedSteps).toEqual(["01J8XKRD"]);
  });
});

describe("근거는 매뉴얼 항목만 밝힌다", () => {
  it("kb- 항목만 센다 — 사건 정보와 전사는 지식베이스가 아니다", () => {
    expect(sourceNote(answer.citations!)).toBe("피해구제 신청서 제출");
  });

  it("kb- 가 없으면 아무 말도 하지 않는다", () => {
    expect(sourceNote([{ ref: "case-3", label: "피해구제 신청 기한" }])).toBeNull();
  });

  it("인용이 없어도 던지지 않는다", () => {
    expect(sourceNote([])).toBeNull();
  });
});

describe("되묻기는 에러가 아니다", () => {
  const asking: ChatResponse = {
    message_id: "01J8XKRF",
    reply: "정확한 안내를 위해 하나만 확인하겠습니다.",
    citations: [],
    next_question: {
      slot_key: "channel",
      text: "어떻게 보내셨나요?",
      input: "buttons",
      options: ["계좌이체", "간편송금", "모름·기억 안 남"],
    },
  };

  it("질문을 그대로 넘긴다", () => {
    expect(toTurn(asking, []).question?.slot_key).toBe("channel");
  });

  it("「모름」 선택지를 지우지 않는다", () => {
    const got = toTurn(asking, []);
    expect(got.question?.options).toContain("모름·기억 안 남");
  });

  it("질문이 없으면 null 이다 — 실행 보드는 그대로 열린다", () => {
    expect(toTurn(answer, mapping).question).toBeNull();
  });
});

describe("발화도 경계를 지나서 나간다", () => {
  it("계좌가 든 발화가 그대로 나가지 않는다", () => {
    const got = outgoing("352-0987-654321 로 보냈어요");
    expect(got.content).not.toContain("352-0987-654321");
    expect(got.added.length).toBeGreaterThan(0);
  });

  it("가릴 것이 없으면 그대로 나간다", () => {
    expect(outgoing("이제 뭘 해야 하나요").content).toBe("이제 뭘 해야 하나요");
  });
});
```

- [x] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/chat-handler
```

기대: FAIL — `Cannot find module './turn'`

- [x] **Step 4: 최소 구현을 쓴다**

`src/modules/chat-handler/turn.ts`:

```ts
import { maskText } from "@/modules/pii-masker";
import type { MaskContext, PiiMapping } from "@/modules/pii-masker";
import { restore } from "@/modules/pii-restorer";
import type { RestorableMapping } from "@/modules/pii-restorer";
import type { ChatResponse, Citation, OutgoingMessage, Turn } from "./types";

/**
 * 발화를 경계 너머로 보낼 모양으로 만듭니다. 전송 자체는 부른 쪽이 하지만,
 * **부칠 것은 반드시 이 함수의 `content` 여야 합니다** — 여기를 지나지 않은 발화를
 * 네트워크에 태우면 **불변 규칙 2 위반**입니다.
 *
 * **순서가 계약입니다** — `added` 매핑을 볼트에 먼저 올리고(§3.11) 그 다음에 발화를
 * 보냅니다. 거꾸로 하면 브라우저가 못 푸는 토큰이 사건에 남습니다.
 */
export function outgoing(utterance: string, ctx?: MaskContext): OutgoingMessage {
  const r = maskText(utterance, ctx);
  return { content: r.masked, added: r.added, mappings: r.mappings };
}

/**
 * 이 답변이 무엇을 보고 쓰였는지 한 줄.
 *
 * **`kb-` 만 셉니다** — 사건 정보(`case-`)와 전사(`t-`)는 지식베이스 항목이 아니라
 * 법령 근거로 표시하면 안 됩니다 (§3.9).
 *
 * **`ref` 번호와 `why` 를 화면에 쓰지 않습니다** — 인용 번호는 서버가 이번 턴
 * 프롬프트에 발급한 내부 번호이고, `why` 는 판단 근거라 사용자 응답에 넣지 않습니다
 * (ADR-022 결정 셋 · API §5.4).
 */
export function sourceNote(citations: readonly Citation[]): string | null {
  const labels = citations
    .filter((c) => c.ref.startsWith("kb-"))
    .map((c) => c.label)
    .filter((label) => label.length > 0);

  return labels.length > 0 ? labels.join(" · ") : null;
}

/**
 * 한 턴을 화면이 쓰는 모양으로 옮깁니다.
 *
 * **`site: "chat-answer"` 는 종류별 부분 복원입니다** — 계좌는 `국민 ****7890`,
 * 주민번호는 복원하지 않습니다. 인젝션으로 값을 캐내려는 시도를 막는 자리입니다
 * (§3.9 「`reply` 안의 토큰은 종류별로 부분 복원됩니다」).
 */
export function toTurn(
  response: ChatResponse,
  mappings: readonly RestorableMapping[],
): Turn {
  return {
    message_id: response.message_id,
    reply: restore(response.reply, [...mappings], { site: "chat-answer" }),
    question: response.next_question ?? null,
    sourceNote: sourceNote(response.citations ?? []),
    referencedSteps: response.referenced_steps ?? [],
  };
}
```

- [x] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/chat-handler
```

기대: PASS — 12 passed

- [x] **Step 6: 커밋**

```bash
git add src/modules/chat-handler/
git commit -m "chat-handler — 한 턴을 화면 모양으로 옮긴다. 인용 번호를 쓰지 않는다 (ADR-022)"
```

---

## Task 9: chat-handler — 버블·버튼과 공개 API

**Files:**
- Create: `src/modules/chat-handler/stream.tsx`
- Create: `src/modules/chat-handler/index.ts`
- Create: `src/modules/chat-handler/README.md`
- Modify: `src/app/c/[token]/chat.tsx` — `CHOICES` 상수를 지웁니다

**Interfaces:**
- Consumes: `toTurn` · `sourceNote` (Task 8)
- Produces: `AnswerBubble` (props `{ turn }`) · `QuestionButtons` (props `{ question, onPick }`)

- [x] **Step 1: 답변 버블을 쓴다**

`src/modules/chat-handler/stream.tsx`:

```tsx
"use client";

import type { NextQuestion, Turn } from "./types";

export function AnswerBubble({ turn }: { turn: Turn }) {
  return (
    <div className="max-w-[46ch] rounded-[14px] bg-surface p-3.5">
      <p className="text-[15px] leading-[1.75] text-ink-1">{turn.reply}</p>
      {turn.sourceNote && (
        // 인용 **번호**가 아니라 매뉴얼 **이름**입니다. 판단 근거는 여기 오지 않습니다
        <p className="mt-2 text-[12.5px] leading-[1.6] text-ink-4">
          {turn.sourceNote} 을 보고 안내했습니다
        </p>
      )}
    </div>
  );
}
```

- [x] **Step 2: 질문 버튼을 쓴다**

같은 파일에 더합니다. **질문은 한 번에 하나이고 전부 버튼입니다.**

```tsx
export function QuestionButtons({
  question,
  onPick,
}: {
  question: NextQuestion;
  onPick?: (value: string) => void;
}) {
  return (
    <div className="max-w-[46ch]">
      <p className="text-[15px] leading-[1.7] text-ink-1">{question.text}</p>

      {question.input === "buttons" && question.options && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onPick?.(option)}
              className="min-h-[var(--size-touch)] rounded-[10px] border border-hairline px-4 text-[14px] text-ink-2"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

> **`options` 를 여기서 걸러내지 마세요.** 「모름·기억 안 남」이 항상 들어 있고,
> 없으면 그건 **서버 쪽 스펙 위반**입니다 (§3.4). 화면이 대신 채우면 그 위반이 가려집니다.

- [x] **Step 3: 공개 API 와 README 를 쓴다**

`src/modules/chat-handler/index.ts`:

```ts
/**
 * chat-handler — 발화를 보내고 응답을 표시한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-022(챗 한 턴의 경계) · ADR-023(층 C) · ADR-034(화면은 원문)
 */

import "client-only";

export { outgoing, toTurn, sourceNote } from "./turn";
export { AnswerBubble, QuestionButtons } from "./stream";
export type {
  ChatResponse,
  Citation,
  NextQuestion,
  OutgoingMessage,
  Turn,
} from "./types";
```

`src/modules/chat-handler/README.md`:

```markdown
# chat-handler

발화를 보내고 응답을 표시합니다. 슬롯 질문을 버튼으로 그립니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | 발화 |
| 내놓는 것 | 응답 · 슬롯 질문 버튼 |
| 절대 하지 않는 것 | **인용 번호·판단 근거를 화면에 쓰기** · **「모름」 없애기** |

## 인용 번호는 우리 것이 아닙니다

`ref`(`kb-2` · `case-3`)는 서버가 **이번 턴 프롬프트에 발급한 내부 번호**입니다.
화면에 쓰면 사용자에게 아무 뜻이 없고, 근거 화면은 아직 보류 상태입니다
([ADR-022](../../../decisions/022-chat-turn-boundaries.md) 결정 셋).
매뉴얼 **이름**만 한 줄로 밝힙니다.

## 「모름」을 지우지 마세요

`options` 에 「모름·기억 안 남」이 **항상** 들어갑니다. 없으면 서버 쪽 스펙 위반이고,
화면이 대신 채워 넣으면 그 위반이 가려집니다 → [API](../../../spec/common/08-14-api.md) §3.4.

## 스트리밍하지 않습니다

근거 검증(`citation-checker`)이 끝난 뒤 한 번에 나갑니다. 흘려보내면
**검증 전 문장이 이미 화면에 찍힙니다** ([ADR-022](../../../decisions/022-chat-turn-boundaries.md)).

## 나가는 발화는 반드시 `outgoing()` 을 지납니다

`fetch` 에 태울 것은 **`outgoing().content` 뿐**입니다. 사용자 입력을 그대로 보내는 경로를
만들면 계좌·전화가 원문으로 경계를 넘습니다 (불변 규칙 2).
**순서도 계약입니다** — `added` 매핑을 볼트에 먼저 올리고(§3.11) 그 다음에 발화를 보냅니다.
```

- [x] **Step 4: 화면을 모듈로 갈아 끼운다**

`src/app/c/[token]/chat.tsx` 에서 `CHOICES` 상수를 지우고, `Bubble` 안의 답변 표시를
`<AnswerBubble turn={…} />`, 선택지를 `<QuestionButtons … />` 로 바꿉니다.
`PendingBubble`·`MiniChat` 은 이 화면의 UI 상태라 **그대로 둡니다.**

- [x] **Step 5: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [x] **Step 6: 검사기와 커밋**

```bash
python .github/scripts/doc-integrity.py
git add src/modules/chat-handler/ "src/app/c/[token]/chat.tsx"
git commit -m "chat-handler — 챗 스트림을 화면에서 모듈로 옮긴다 (S-06)"
```

---

## Task 10: 모듈을 화면에 잇는다 — 첫 화면 규칙과 발급 카드

**여기까지의 여덟 모듈 중 둘은 아직 아무 화면도 부르지 않습니다.** `openCase` 는 죽은
코드로 끝나고, `LinkHandoff` 는 이미 서 있는 발급 카드와 **두 벌**이 됩니다.
라우트 없이도 이을 수 있는 것을 잇습니다.

**Files:**
- Modify: `src/app/c/[token]/page.tsx` — 첫 `focus`/`side` 를 `openCase()` 로
- Modify: `src/app/start/page.tsx` — 발급(2/2)의 주소 카드를 `LinkHandoff` 로

**Interfaces:**
- Consumes: `openCase` · `LinkHandoff` (Task 4·5) ·
  `FIXTURE_CASE` ([보여주는 셋 계획](08-22-layer-c-viewers.md) Task 1b)

- [x] **Step 1: 첫 화면을 규칙으로 정한다**

`page.tsx` 의 `focus`/`side` 초기값을 바꿉니다 — `?view=` 가 **있으면** 지금처럼 그 값
(개발용 스위치 유지), **없으면** `openCase(FIXTURE_CASE)` 가 고른 값.

```tsx
import { openCase } from "@/modules/case-opener";
import { FIXTURE_CASE } from "./fixtures";

// 서버 시그널이 없어도 첫 화면은 **규칙**이 고릅니다 (§3.10)
const opened = openCase(FIXTURE_CASE);
const [focus, setFocus] = useState<Focus>(wanted ? devFocus : opened.focus);
const [side, setSide] = useState<Side>(wanted ? devSide : opened.side);
```

라우트가 서면 `FIXTURE_CASE` 자리가 `GET /api/cases/{token}` 응답이 됩니다.
파일 머리 주석의 `TODO(연결)` 에 「첫 화면은 `case-opener` 가 고른다 — 남은 것은 `fetch`」를
적습니다.

- [x] **Step 2: 발급 카드를 모듈로 잇는다**

`src/app/start/page.tsx` 발급(2/2) 절의 **「내 사건 주소」 카드**를
`<LinkHandoff url={caseUrl} />` 로 바꿉니다.

**이메일 선택란·복구 불가 고지·CTA 두 개는 화면에 그대로 둡니다** — 그건 S-05 의 일이지
모듈의 일이 아닙니다.

> ⚠️ **시안(발급 1a 확정본)의 마크업과 `LinkHandoff` 가 다르면 모듈 쪽을 시안으로 맞춥니다** —
> 디자인 정본은 핸드오프입니다 ([RFC-003](../../rfc/003-design-handoff.md) ·
> [ADR-030](../../decisions/030-design-handoff.md)). 「나에게 문자로」(`sms:`)처럼 **시안에
> 없는 것을 더할지는 사람이 정합니다.**

- [x] **Step 3: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [x] **Step 4: 커밋**

```bash
git add "src/app/c/[token]/page.tsx" src/app/start/page.tsx
git commit -m "openCase·LinkHandoff 를 화면에 잇는다 — 첫 화면은 규칙이 고른다 (§3.10)"
```

> **여전히 미접속인 것 둘** — `deadline-viewer` 의 `DeadlineBadge`·`DeadlinePair` 와
> `chat-handler` 의 `AnswerBubble` 입니다. 앞의 둘은 `days_left` 를 서버가 아직 안 주고,
> `AnswerBubble` 은 S-06 의 말풍선이 아직 목업 문구라 `Turn` 이 없습니다.
> (`DeadlineList` 는 2026-08-23 에 **만들지 않기로** 정해져 지웠습니다 —
> [보여주는 셋 계획](08-22-layer-c-viewers.md).)

---

## 끝나면 무엇이 달라져 있나

| | 전 | 후 |
| --- | --- | --- |
| 층 C 구현 | 7 / 11 (보여주는 셋 뒤) | **11 / 11** |
| 이 넷의 시험 | 0 | 약 44개 |
| 라우트가 서면 | 화면을 새로 짜야 함 | **배선을 잇는다** — 규칙은 시험까지 서 있고, 픽스처 자리를 `fetch` 로 바꾸면 됩니다. `PendingBubble` 의 진행 단계 연결(§S-06)과 발화·파일이 실제로 이 모듈들을 지나게 하는 일이 남습니다 |
| 계약 구멍 | 재시도 여부가 브라우저에 안 옴 | **확정** — 에러 §3.1.1 에 `retryable`. 서버 구현만 남음 |

**이 넷은 라우트가 없어도 완성됩니다.** 서버 응답을 가짜로 넣어 규칙을 전부
검증했기 때문에, 라우트가 서는 날 붙이는 것은 `fetch` 한 줄씩입니다.

**앞선 계획** — `plan-viewer` · `deadline-viewer` · `transcript-viewer` 는
[층 C 보여주는 셋 계획](08-22-layer-c-viewers.md)에 있습니다. Task 7 이 그쪽 Task 8 을
선행으로 씁니다.
