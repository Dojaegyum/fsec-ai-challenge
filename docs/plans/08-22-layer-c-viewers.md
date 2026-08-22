# 층 C · 보여주는 넷 구현 계획

> **에이전트에게:** 이 계획은 태스크 단위로 실행합니다. 각 단계가 `- [ ]` 로 되어 있으니
> 하나씩 체크하며 나아가세요. 한 태스크가 끝날 때마다 커밋합니다.

**목표:** `plan-viewer` · `deadline-viewer` · `transcript-viewer` · `doc-filler` 네 모듈을 만들어,
지금 화면 파일에 **상수로 박힌 표시 규칙**을 서버 응답 형태로 받는 순수 함수와 렌더로 옮긴다.

**설계:** 각 모듈은 `types.ts`(계약) · 판정 `.ts`(순수 함수) · 렌더 `.tsx` · `index.ts`(공개 API)
골격을 따릅니다 — [`src/modules/work-handler/`](../../src/modules/work-handler/) 가 선례입니다.
**판정은 서버 응답만 받고 `fetch`·DOM 을 모릅니다.** 렌더는 판정 결과만 받습니다.
`src/app/c/[token]/*.tsx` 는 상수를 지우고 모듈을 부르는 자리로 바뀝니다.

**기술:** TypeScript 5 · React 19 · Next 16 (App Router) · vitest 4 · Tailwind v4 (프로젝트 토큰)

**스펙:**
[모듈 경계](../../spec/common/08-16-module-boundaries.md) ·
[모듈 명칭](../../spec/common/08-16-module-names.md) 층 C ·
[화면 설계](../../spec/frontend/08-14-screens.md) §S-07 §S-08 §S-10 ·
[기한 계산 규칙](../../spec/common/08-16-deadline-rules.md) ·
[API 계약](../../spec/common/08-14-api.md) §3.3 §3.6 §3.7 ·
[ADR-023](../../decisions/023-frontend-module-names.md) ·
[ADR-034](../../decisions/034-browser-shows-plaintext.md) ·
[ADR-037](../../decisions/037-doc-guidance-not-generation.md) ·
[ADR-042](../../decisions/042-submit-paths.md)

## 전역 제약

**모든 태스크에 걸립니다.** 태스크마다 다시 적지 않습니다.

| 제약 | 근거 |
| --- | --- |
| 모듈 폴더 이름은 [모듈 명칭](../../spec/common/08-16-module-names.md) 층 C **그대로**. 다른 이름을 만들면 **CI 가 막습니다** | [ADR-019](../../decisions/019-module-code-sync.md) |
| 밖에서는 `index.ts` 만 import 합니다. 하위 파일을 직접 부르지 않습니다 | [RFC-001](../../rfc/001-repo-structure.md) |
| **화면이 날짜를 세지 않습니다.** `Date` 산술로 D-day 를 만들지 마세요 | 불변 규칙 7 · [기한 규칙](../../spec/common/08-16-deadline-rules.md) |
| **빨강을 쓰지 않습니다.** 기한 임박은 앰버(`--deadline-urgent`) | [화면 설계](../../spec/frontend/08-14-screens.md) §S-07 |
| **판정과 렌더를 한 파일에 섞지 않습니다** | [경계 표](../../spec/common/08-16-module-boundaries.md) |
| 텍스트 하한 **12.5px**, 터치 목표 **44px**(`--size-touch`) | [ADR-032](../../decisions/032-text-floor.md) |
| 색·크기는 **토큰만** 씁니다. `src/app/globals.css` 가 값의 정본입니다 | [디자인 토큰](../../spec/frontend/design-system/08-16-tokens.md) |
| 문서·테스트 이름은 한국어, 식별자는 영문 | `CLAUDE.md` |
| 층 C 모듈 `index.ts` 머리에 `import "client-only"` 를 답니다 | [ADR-028](../../decisions/028-runtime-and-module-shape.md) |
| 모듈 README 끝에 **「판단이 필요했던 자리」 표**를 둡니다. 이 계획이 기본값을 고른 자리(예: `plan-viewer` 의 「`after` 없으면 전부 점」)가 그 표의 행입니다 | [RFC-001](../../rfc/001-repo-structure.md) 「모듈 하나의 파일 골격」 · `work-handler` 선례 |
| **모름은 실패가 아닙니다.** 값이 없으면 그 자리를 비우되 흐름을 막지 마세요 | 불변 규칙 5 |

---

## Task 1: 계약 구멍 셋을 정본에 올린다

**코드를 쓰기 전에 이것부터입니다.** 계약을 읽다 화면이 요구하는 값이 응답에 **없는** 자리를
셋 찾았습니다. 지어내면 안 되므로 정본에 물음표로 올리고 사람이 확정합니다.

**Files:**
- Modify: `spec/common/08-14-api.md` (§3.6 · §3.7 뒤에 「⬜ 미결」 블록)
- Modify: `spec/frontend/08-14-screens.md` (§S-07 상태 어휘 표에 `unconfirmed` 행)
- Modify: `docs/plans/08-20-api-routes.md` (「정본에 없어 채워야 하는 것」 표에 세 줄)

**Interfaces:**
- Produces: 아래 세 물음의 답. Task 2·5 가 이 답에 따라 기본값을 바꿉니다.

- [ ] **Step 0: 계획 문서를 먼저 커밋한다** (다른 계획 실행자가 이미 했으면 건너뜁니다)

```bash
git add docs/plans/08-22-layer-c-viewers.md docs/plans/08-22-layer-c-transport.md docs/plans/README.md
git commit -m "층 C 구현 계획 둘 — 보여주는 넷 · 서버와 이야기하는 넷"
```

**이 커밋이 먼저여야 합니다.** 바로 아래 Step 1 과 Task 9 가 `spec/` 에 **이 계획을
가리키는 링크**를 심습니다. 계획 파일이 커밋에 없으면 워킹트리를 보는 로컬 검사기는
통과하고 **CI 에서만** 「가리키는 파일이 없습니다」로 깨집니다.

- [ ] **Step 1: 세 구멍을 정본에 적는다**

`spec/common/08-14-api.md` 의 §3.6 마지막에 붙입니다:

```markdown
> ⬜ **미결 — `steps[]` 가 선행 사슬을 싣고 오는가**
>
> [화면 설계](../frontend/08-14-screens.md) §S-07 은 **「번호는 `body.after` 사슬에 있는
> 단계에만」** 붙이라고 합니다. 그런데 위 응답 예시의 `body` 에는 `after` 도 `step_key` 도
> 없습니다. `plan_step.body` 는 JSONB 라 KB 의 `after` 가 실려 올 **수도** 있지만,
> **예시가 계약이므로 지금은 없는 것으로 읽힙니다.**
>
> 없으면 화면은 **전부 점(•)** 으로 그립니다 — 없는 순서를 지어내지 않는 쪽이 안전합니다.
> 다만 그러면 진짜 순서가 있는 곳(신청 → 서류 → 접수증)이 안 보입니다.
```

같은 파일 §3.7 마지막에 붙입니다:

```markdown
> ⬜ **미결 — 잔여일을 누가 세는가**
>
> [화면 설계](../frontend/08-14-screens.md) §S-07 히어로 스트립은 **`D-2` 박스**를 그립니다.
> 그런데 [기한 규칙](08-16-deadline-rules.md)은 **「기준 시계는 서버. 클라이언트 시계를
> 신뢰하지 않습니다」** 이고 §S-07 도 「화면은 날짜를 세지 않습니다」입니다.
> **응답에는 `due_at` 만 있고 잔여일이 없습니다.**
>
> 화면이 `due_at` 에서 D-day 를 만들면 **사용자 기기의 날짜가 틀릴 때 기한을 놓칩니다.**
> `days_left: number` 를 응답에 넣는 것을 제안합니다 (지난 기한은 음수).
> 확정 전까지 `deadline-viewer` 는 **D-day 를 그리지 않고** 날짜 문자열만 보여줍니다.
```

`spec/frontend/08-14-screens.md` §S-07 「단계 상태 어휘 — 여섯」 표 아래에 붙입니다:

```markdown
> ⬜ **미결 — `unconfirmed` 가 어느 어휘로 보이는가**
>
> `plan_step.state` 다섯 중 `unconfirmed`(L3 자기 신고)에 대응하는 칸이 위 표에 없습니다.
> `done` 은 아닙니다 — 부산물이 판정하지 않았습니다. 지우지도 않습니다 —
> **리마인더 추적 대상으로 남습니다** ([API](../common/08-14-api.md) §3.8).
>
> 지금 구현은 **기호는 `○`(todo), 태그는 「미확인」** 으로 둡니다. 다만
> [모듈 명칭](08-16-module-names.md) 「상태·등급의 호칭」이 이미 경고했듯
> **「미확인」은 슬롯 배지(아직 모르는 정보)가 쓰는 말**이고, §S-08 의 전사 스팬도
> 같은 배지를 씁니다 — 단계 상태까지 같은 말을 쓰면 **셋이 한 화면에서 섞입니다.**
> 어휘를 늘릴지, 「증빙 대기」처럼 가를지, `todo` 에 태그만 얹을지는 **사람이 정합니다.**
>
> (이 표는 제목이 「여섯」인데 행이 다섯입니다 — 함께 정리해 주세요.)
```

- [ ] **Step 2: 착수 문서의 미결 표에 세 줄을 더한다**

`docs/plans/08-20-api-routes.md` 의 「정본에 없어 채워야 하는 것」 표에 추가:

```markdown
| **`steps[]` 의 선행 사슬** | §3.6 에 `after`·`step_key` 가 없습니다. 없으면 S-07 이 번호를 못 붙입니다 |
| **기한의 잔여일** | §3.7 에 `days_left` 가 없어, 화면이 세면 기기 시계를 믿게 됩니다 |
| **`unconfirmed` 의 화면 어휘** | S-07 상태 어휘 여섯에 대응 칸이 없습니다 |
```

- [ ] **Step 3: 검사기를 돌린다**

```bash
python .github/scripts/doc-integrity.py
```

기대: `OK` — 링크·앵커가 깨지지 않았습니다.

- [ ] **Step 4: 커밋**

```bash
git add spec/common/08-14-api.md spec/frontend/08-14-screens.md docs/plans/08-20-api-routes.md
git commit -m "화면이 요구하는데 응답에 없는 값 셋을 정본에 올린다 (S-07 번호·잔여일·unconfirmed)"
```

---

## Task 1b: 목업 상수를 §3 응답 모양의 픽스처로 옮긴다

**화면 교체 태스크(4·8·11, 그리고 [서버와 이야기하는 넷 계획](08-22-layer-c-transport.md)
7·9)가 상수를 지우고 나면 컴포넌트에 넘길 데이터가 필요합니다.** 라우트는 아직 없으므로,
지금 화면 상수의 값(**전부 예시입니다** — `CLAUDE.md`)을 **§3 응답 모양으로 옮겨** 한 파일에 둡니다.

**값을 새로 짓지 않습니다 — 모양만 계약에 맞춥니다.** 라우트가 서는 날 이 파일의 import 를
`fetch` 로 바꾸는 것이 배선의 전부가 됩니다.

> 번호가 `1b` 인 이유는 뒤 태스크 번호를 밀지 않기 위해서입니다 —
> [다음 계획](08-22-layer-c-transport.md)이 「그쪽 Task 8」처럼 번호로 가리킵니다.

**Files:**
- Create: `src/app/c/[token]/fixtures.ts`
  (모듈이 아니라 **화면 곁**입니다 — `src/modules/` 밖의 배치는 자유입니다 → [RFC-001](../../rfc/001-repo-structure.md))

**Interfaces:**
- Produces: `FIXTURE_PLAN` (§3.6 — 지금 `plan.tsx` 의 `STEPS` 여섯 줄) ·
  `FIXTURE_DEADLINES` (§3.7 예시) · `FIXTURE_EVIDENCE` (§3.3 완료 응답) ·
  `FIXTURE_MAPPINGS` (`RestorableMapping[]`) · `FIXTURE_DOC` (§3.12 모양 — 지금 `SECTIONS`) ·
  `FIXTURE_CASE` (§3.10 부분) · `FIXTURE_QUESTION` (§3.4 `next_question` — 지금 `CHOICES`)

- [ ] **Step 1: 픽스처 파일을 쓴다**

`src/app/c/[token]/fixtures.ts`. 머리에 이 문단을 답니다:

```ts
/**
 * 화면용 견본 — **전부 예시 값입니다.** 전화번호·금액·기관명은 실제가 아닙니다
 * (`CLAUDE.md` 「목업·기획서에 등장하는 … 전부 예시입니다」).
 *
 * **모양은 API 계약 §3 그대로입니다.** 라우트가 서는 날 이 파일을 부르던 자리가
 * `fetch` 로 바뀌는 것이 배선의 전부입니다 — 그러라고 모양을 미리 맞춰 둡니다.
 *
 * 값의 출처는 지금 화면의 상수들입니다(`plan.tsx` STEPS · `evidence.tsx` TRANSCRIPT·FILES ·
 * `doc.tsx` SECTIONS · `chat.tsx` CHOICES). **새 값을 짓지 마세요.**
 */
```

`FIXTURE_PLAN` 은 §3.6 의 `steps[]` 모양으로, 지금 `STEPS` 여섯 줄을 그대로 옮깁니다:

```ts
import type { PlanStep } from "@/modules/plan-viewer";

export const FIXTURE_PLAN: { steps: PlanStep[] } = {
  steps: [
    { step_id: "m1", seq: 10, title: "국민은행에 지급정지 요청", state: "done_verified",
      conditional: null, body: { step_key: "bank-freeze-request" } },
    { step_id: "m2", seq: 20, title: "112 신고", state: "done_verified",
      conditional: null, body: { step_key: "report-112" } },
    { step_id: "m3", seq: 30, title: "피해구제 신청서 제출", state: "in_progress",
      conditional: null, body: { step_key: "relief-application" } },
    { step_id: "m4", seq: 40, title: "접수증 올리기", state: "not_started",
      conditional: null, body: { step_key: "receipt-upload", after: ["relief-application"] } },
    { step_id: "m5", seq: 50, title: "명의도용 점검", state: "not_started",
      conditional: null, body: { step_key: "identity-check" } },
    { step_id: "m6", seq: 60, title: "가상자산 환급 신청", state: "skipped",
      conditional: null, body: {} },
  ],
};
```

나머지 여섯도 같은 방식으로 옮깁니다 — `FIXTURE_DEADLINES` 는 §3.7 예시 셋
(`primary`·`grace`·`info`)을 그대로, `FIXTURE_EVIDENCE` 는 §3.3 완료 응답
(`transcript`·`pii_tokens`)을, `FIXTURE_DOC` 은 §3.12 모양으로 `SECTIONS` 를,
`FIXTURE_QUESTION` 은 §3.4 `next_question` 으로 `CHOICES` 를 옮깁니다.

> **`days_left` 를 픽스처에 넣지 마세요.** 아직 계약에 없는 칸입니다(Task 1) —
> 넣으면 D-day 가 화면에 떠서 「없으면 안 그린다」는 규칙을 시험할 수 없게 됩니다.

- [ ] **Step 2: 빌드가 통과하는지 확인한다**

```bash
cd src && npm run build
```

기대: exit 0 (아직 아무도 부르지 않으므로 화면은 그대로입니다)

- [ ] **Step 3: 커밋**

```bash
git add "src/app/c/[token]/fixtures.ts"
git commit -m "층 C 픽스처 — 목업 상수를 §3 응답 모양으로 옮긴다"
```

---

## Task 2: plan-viewer — 상태를 화면 어휘로 옮긴다

**Files:**
- Create: `src/modules/plan-viewer/types.ts`
- Create: `src/modules/plan-viewer/tone.ts`
- Create: `src/modules/plan-viewer/tone.test.ts`

**Interfaces:**
- Consumes: `GET /api/cases/{token}/plan` 의 `steps[]` ([API](../../spec/common/08-14-api.md) §3.6)
- Produces: `toneOf(step, hasOwnDeadline): StepTone` · `tagOf(step): string` ·
  타입 `PlanStep` · `StepTone` · `StepState`. Task 3·4 가 이 이름을 그대로 씁니다.

- [ ] **Step 1: 계약 타입을 쓴다**

`src/modules/plan-viewer/types.ts`:

```ts
/**
 * plan-viewer — 타임라인·단계·배지를 그린다 (층 C · 브라우저)
 *
 * 계약: spec/frontend/08-14-screens.md §S-07 · spec/common/08-14-api.md §3.6
 * 근거: ADR-023(층 C) · ADR-035(화면 상태 두 축)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · 사용자 체크만으로 완료 표시하기 (완료는 부산물이 판정합니다)
 *  · 조건부 단계를 지우기
 *  · T0 를 다른 것에 종속시키기 (T0 는 셸의 레일입니다 — ADR-036)
 */

/** `plan_step.state` 다섯 → 데이터 모델 §6 */
export type StepState =
  | "not_started"
  | "in_progress"
  | "done_verified"
  | "unconfirmed"
  | "skipped";

/** 화면 어휘 → 화면 설계 §S-07 「단계 상태 어휘」 */
export type StepTone = "done" | "now" | "todo" | "anytime" | "na";

/** `GET /plan` 의 `steps[]` 중 이 모듈이 쓰는 것만 */
export interface PlanStep {
  step_id: string;
  /** 내부 정렬값. **사용자에게 보이는 번호가 아닙니다** — 10·20·25 처럼 띄엄띄엄합니다 */
  seq: number;
  title: string;
  state: StepState | string;
  /** 슈퍼셋 플랜의 조건 라벨. 「카카오페이로 보냈다면」 */
  conditional: string | null;
  body: {
    text?: string;
    action?: string;
    /** KB 항목 식별자. 사슬을 잇는 열쇠입니다 */
    step_key?: string;
    /** 선행 사슬. **§3.6 예시에 없어 없을 수 있습니다** → Task 1 */
    after?: readonly string[];
  };
}
```

- [ ] **Step 2: 실패하는 시험을 쓴다**

`src/modules/plan-viewer/tone.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { tagOf, toneOf } from "./tone";
import type { PlanStep, StepState } from "./types";

const step = (state: StepState | string): PlanStep => ({
  step_id: "01J",
  seq: 10,
  title: "피해구제 신청서 제출",
  state,
  conditional: null,
  body: {},
});

describe("상태를 화면 어휘로 옮긴다", () => {
  it("부산물이 판정한 것만 증빙됨이다", () => {
    expect(toneOf(step("done_verified"), true)).toBe("done");
    expect(tagOf(step("done_verified"), "done")).toBe("증빙됨");
  });

  it("자기 신고는 증빙됨이 아니다 — 미확인으로 남는다", () => {
    expect(toneOf(step("unconfirmed"), true)).toBe("todo");
    expect(tagOf(step("unconfirmed"), "todo")).toBe("미확인");
  });

  it("건너뛴 단계는 지우지 않고 해당 없음으로 흐리게 둔다", () => {
    expect(toneOf(step("skipped"), false)).toBe("na");
    expect(tagOf(step("skipped"), "na")).toBe("해당 없음");
  });

  it("기한이 없는 단계는 언제든이다 — 태그도 언제든이다", () => {
    expect(toneOf(step("not_started"), false)).toBe("anytime");
    expect(tagOf(step("not_started"), "anytime")).toBe("언제든");
  });

  it("기한이 있는 미시작은 언제든이 아니다", () => {
    expect(toneOf(step("not_started"), true)).toBe("todo");
  });

  it("진행 중은 미시작으로 보이면 안 된다 — 그 자리는 기한 문자열이 대신한다", () => {
    expect(toneOf(step("in_progress"), true)).toBe("now");
    expect(tagOf(step("in_progress"), "now")).toBe("");
  });

  it("모르는 상태를 만나도 던지지 않는다 — 미시작으로 둔다", () => {
    expect(toneOf(step("무언가_새로_생긴_값"), true)).toBe("todo");
  });
});
```

- [ ] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/plan-viewer
```

기대: FAIL — `Cannot find module './tone'`

- [ ] **Step 4: 최소 구현을 쓴다**

`src/modules/plan-viewer/tone.ts`:

```ts
import type { PlanStep, StepTone } from "./types";

/**
 * 상태를 화면 어휘로 옮긴다.
 *
 * **`hasOwnDeadline` 을 받는 이유** — 「언제든(◇)」은 상태가 아니라
 * **기한이 없다는 사실**입니다. 기한 목록을 아는 쪽이 넣어 줍니다.
 * 이 모듈이 기한을 직접 조회하면 `deadline-viewer` 와 주인이 겹칩니다.
 */
export function toneOf(step: PlanStep, hasOwnDeadline: boolean): StepTone {
  switch (step.state) {
    case "done_verified":
      return "done";
    case "in_progress":
      return "now";
    case "skipped":
      return "na";
    // ⬜ `unconfirmed` 의 어휘는 미결입니다 → Task 1 · 화면 설계 §S-07
    case "unconfirmed":
      return "todo";
    case "not_started":
      return hasOwnDeadline ? "todo" : "anytime";
    default:
      // 모르는 값에 던지지 않습니다 — 새 상태가 생겨도 보드가 비지 않아야 합니다
      return "todo";
  }
}

/**
 * 색 하나로 가르지 않습니다 — 기호·태그·색 셋이 함께 갑니다 (§S-07).
 *
 * **태그는 화면 어휘(tone) 기준입니다** — 「언제든」은 상태가 아니라 어휘의 태그입니다.
 * `unconfirmed` 만 상태로 가립니다 → Task 1 미결.
 * `now` 의 태그는 어휘 표에서 D-day 입니다 — 서버가 준 기한 문자열(`deadlineLabel`)이
 * 그 자리를 대신하고, 없으면 비웁니다. **화면이 날짜를 만들지 않습니다.**
 */
export function tagOf(step: PlanStep, tone: StepTone): string {
  if (step.state === "unconfirmed") return "미확인";
  switch (tone) {
    case "done":
      return "증빙됨";
    case "now":
      return "";
    case "anytime":
      return "언제든";
    case "na":
      return "해당 없음";
    default:
      return "미시작";
  }
}
```

- [ ] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/plan-viewer
```

기대: PASS — 7 passed

- [ ] **Step 6: 커밋**

```bash
git add src/modules/plan-viewer/
git commit -m "plan-viewer — 상태 다섯을 화면 어휘로 옮긴다 (S-07)"
```

---

## Task 3: plan-viewer — 사슬에 있는 것에만 번호를 붙인다

**우리 단계는 절반이 순서가 없습니다.** 112 신고와 지급정지는 **동시에** 하는 것입니다.
전부 번호를 매기면 없는 순서를 지어내는 것이고, 사용자는 112 를 먼저 해야 한다고 읽습니다.

**Files:**
- Create: `src/modules/plan-viewer/order.ts`
- Create: `src/modules/plan-viewer/order.test.ts`

**Interfaces:**
- Consumes: `PlanStep` (Task 2)
- Produces: `numberSteps(steps): ReadonlyMap<string, number | null>` — 키는 `step_id`,
  값은 **사슬 안 위치**(1부터) 또는 `null`(순서 없음). Task 4 가 씁니다.

- [ ] **Step 1: 실패하는 시험을 쓴다**

`src/modules/plan-viewer/order.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { numberSteps } from "./order";
import type { PlanStep } from "./types";

const mk = (id: string, seq: number, key?: string, after?: string[]): PlanStep => ({
  step_id: id,
  seq,
  title: id,
  state: "not_started",
  conditional: null,
  body: { step_key: key, after },
});

describe("번호는 사슬에 있는 것에만 붙는다", () => {
  it("사슬이 하나도 없으면 전부 점이다 — 없는 순서를 지어내지 않는다", () => {
    const got = numberSteps([mk("a", 10, "report-112"), mk("b", 20, "bank-freeze")]);
    expect(got.get("a")).toBeNull();
    expect(got.get("b")).toBeNull();
  });

  it("사슬 밖 단계는 번호를 받지 않는다", () => {
    const got = numberSteps([
      mk("a", 10, "report-112"),
      mk("b", 20, "relief-application", ["report-112"]),
    ]);
    // report-112 는 남의 after 에 등장하므로 사슬 안이다
    expect(got.get("a")).toBe(1);
    expect(got.get("b")).toBe(2);
  });

  it("사슬 안 위치로 다시 센다 — step_seq 가 그대로 나오지 않는다", () => {
    const got = numberSteps([
      mk("a", 10, "relief-application", ["bank-freeze"]),
      mk("b", 25, "receipt-upload", ["relief-application"]),
      mk("c", 20, "bank-freeze"),
    ]);
    expect(got.get("c")).toBe(1);
    expect(got.get("a")).toBe(2);
    expect(got.get("b")).toBe(3);
  });

  it("사슬 안과 밖이 섞이면 밖은 null 이다", () => {
    const got = numberSteps([
      mk("chain1", 10, "bank-freeze"),
      mk("chain2", 20, "relief-application", ["bank-freeze"]),
      mk("free", 30, "identity-check"),
    ]);
    expect(got.get("chain1")).toBe(1);
    expect(got.get("chain2")).toBe(2);
    expect(got.get("free")).toBeNull();
  });

  it("step_key 가 없어도 던지지 않는다", () => {
    const got = numberSteps([mk("a", 10), mk("b", 20)]);
    expect(got.get("a")).toBeNull();
  });
});
```

- [ ] **Step 2: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/plan-viewer/order
```

기대: FAIL — `Cannot find module './order'`

- [ ] **Step 3: 최소 구현을 쓴다**

`src/modules/plan-viewer/order.ts`:

```ts
import type { PlanStep } from "./types";

/**
 * 사슬(`body.after`)에 있는 단계에만 번호를 붙인다 → 화면 설계 §S-07.
 *
 * **`step_seq` 를 그대로 보이지 않습니다.** 10·20·25 처럼 띄엄띄엄한 내부 정렬값이라
 * 「25번 다음이 30번」이 됩니다. 사슬 안에서 몇 번째인가로 **다시 셉니다.**
 *
 * **seq 로만 세지도 않습니다** — 「선행인데 seq 가 큰」 데이터에서 번호가 역전됩니다.
 * 선행이 모두 번호를 받은 것 중 seq 가 가장 작은 것부터 셉니다(위상 순서 + seq 동률).
 *
 * **사슬이 하나도 없으면 전부 `null` 입니다** — `after` 가 응답에 실려 오는지가
 * 아직 미결이라(→ Task 1), 없을 때 **번호를 지어내지 않는 쪽**을 기본으로 둡니다.
 */
export function numberSteps(
  steps: readonly PlanStep[],
): ReadonlyMap<string, number | null> {
  const out = new Map<string, number | null>();

  const referenced = new Set<string>();
  for (const s of steps) for (const key of s.body.after ?? []) referenced.add(key);

  const inChain = steps.filter((s) => {
    const hasAfter = (s.body.after?.length ?? 0) > 0;
    const isReferenced = s.body.step_key != null && referenced.has(s.body.step_key);
    return hasAfter || isReferenced;
  });

  const chainKeys = new Set(
    inChain.flatMap((s) => (s.body.step_key != null ? [s.body.step_key] : [])),
  );
  const numberedKeys = new Set<string>();
  const remaining = [...inChain].sort((a, b) => a.seq - b.seq);
  let n = 0;

  while (remaining.length > 0) {
    const i = remaining.findIndex((s) =>
      // 사슬 밖(플랜에 없는) 선행은 이미 충족된 것으로 봅니다 — 막지 않습니다
      (s.body.after ?? []).every((k) => !chainKeys.has(k) || numberedKeys.has(k)),
    );
    // 순환이면 남은 것 중 seq 가 가장 작은 것부터 — 던지지 않습니다
    const next = remaining.splice(i === -1 ? 0 : i, 1)[0];
    out.set(next.step_id, ++n);
    if (next.body.step_key != null) numberedKeys.add(next.body.step_key);
  }

  for (const s of steps) if (!out.has(s.step_id)) out.set(s.step_id, null);
  return out;
}
```

- [ ] **Step 4: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/plan-viewer
```

기대: PASS — 12 passed

- [ ] **Step 5: 커밋**

```bash
git add src/modules/plan-viewer/
git commit -m "plan-viewer — 사슬에 있는 것에만 번호를 붙인다. step_seq 를 보이지 않는다"
```

---

## Task 4: plan-viewer — 화면을 모듈로 옮긴다

**Files:**
- Create: `src/modules/plan-viewer/board.tsx`
- Create: `src/modules/plan-viewer/index.ts`
- Create: `src/modules/plan-viewer/README.md`
- Modify: `src/app/c/[token]/plan.tsx` — 상수 `STEPS`·`MARK` 를 지우고 모듈을 부릅니다

**Interfaces:**
- Consumes: `toneOf` · `tagOf` (Task 2) · `numberSteps` (Task 3)
- Produces: `StepRow` (React 컴포넌트, props `{ step, tone, tag, number, deadlineLabel }`) ·
  `PlanBoard` (props `{ steps, deadlineFor }`)

- [ ] **Step 1: 렌더를 옮긴다**

`src/modules/plan-viewer/board.tsx` 를 만들고, 지금 `src/app/c/[token]/plan.tsx` 의
`MARK` 상수와 단계 행 마크업을 옮깁니다. 값은 시안에서 온 것이라 임의로 다듬지 않되,
**알려진 어긋남이 둘 있습니다.**

| 자리 | 시안·현행 코드 | 화면 설계 §S-07 표 |
| --- | :---: | :---: |
| `todo` 기호 | `•` | `○` |
| `anytime` 기호 | `•` | `◇` |

**어느 쪽도 자동으로 이기지 않습니다** (`CLAUDE.md` 「spec과 아티팩트의 관계」 ·
[RFC-003](../../rfc/003-design-handoff.md)). **옮기기 전에 사람에게 물어 정한 값을 쓰고,
정해진 쪽을 코드 주석에 남기세요.** 아래 코드는 정해지기 전까지 **시안 값**을 씁니다.

```tsx
"use client";

import { numberSteps } from "./order";
import { tagOf, toneOf } from "./tone";
import type { PlanStep, StepTone } from "./types";

/** 상태 어휘 — 모양·글자·색 셋이 함께 갑니다 (색 하나로 가르지 않습니다) */
const MARK: Record<StepTone, { glyph: string; cls: string }> = {
  done: {
    glyph: "✓",
    cls: "border-[oklch(0.697_0.16_258.2/70%)] bg-[oklch(0.697_0.16_258.2/22%)] text-pii",
  },
  now: {
    glyph: "→",
    cls: "border-[oklch(0.77_0.117_70.9/70%)] bg-[oklch(0.77_0.117_70.9/20%)] text-deadline-urgent",
  },
  // ⬜ 시안·현행은 `•`, §S-07 표는 `○`·`◇` 입니다 — 사람이 정하기 전까지 시안 값입니다
  todo: { glyph: "•", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  anytime: { glyph: "•", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
  na: { glyph: "—", cls: "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3" },
};

export interface StepRowProps {
  step: PlanStep;
  tone: StepTone;
  tag: string;
  /** 사슬 안 위치. `null` 이면 상태 기호를 그립니다 */
  number: number | null;
  /** 서버가 준 기한 문자열. **화면이 만들지 않습니다** */
  deadlineLabel?: string | null;
  /** 부산물 한 줄 — 「◆ 통화 접수번호」. §3.6 `artifacts`·`required_artifact` 에서 */
  artifactLabel?: string | null;
}

export function StepRow({
  step,
  tone,
  tag,
  number,
  deadlineLabel,
  artifactLabel,
}: StepRowProps) {
  const mark = MARK[tone];
  return (
    <li
      className={`flex items-center gap-3 border-b border-hairline px-1.5 py-3 last:border-b-0 ${
        tone === "now" ? "rounded-[8px] bg-[oklch(0.77_0.117_70.9/8%)]" : ""
      } ${tone === "na" ? "opacity-50" : ""}`}
    >
      {/* 순번이 있으면 숫자, 없으면 상태 기호. **한 칸만 씁니다** —
          두 칸으로 나누면 어느 쪽이 순서인지가 더 헷갈립니다 (시안 설계 노트) */}
      <span
        {...(number === null ? { "aria-hidden": true } : {})}
        data-numeric={number === null ? undefined : true}
        className={`grid size-[21px] shrink-0 place-items-center rounded-full border text-[11px] font-[700] ${mark.cls}`}
      >
        {number === null ? mark.glyph : number}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={`block text-[14.5px] ${
            tone === "now" ? "font-[620] text-ink-1" : "text-ink-2"
          }`}
        >
          {step.title}
        </span>
        {step.conditional && (
          <span className="block text-[12.5px] text-ink-3">{step.conditional}</span>
        )}
        {/* 완료를 판정한 것이 무엇인지 — 사용자 체크가 아니라 부산물입니다 */}
        {artifactLabel && (
          <span className="block text-[12.5px] text-ink-3">{artifactLabel}</span>
        )}
      </span>

      <span
        data-numeric
        className={`shrink-0 text-[12.5px] ${
          tone === "done"
            ? "text-pii"
            : tone === "now"
              ? "font-[620] text-deadline-urgent"
              : "text-ink-3"
        }`}
      >
        {/* D-day 가 태그 자리를 대신하는 것은 **`now` 에만** 해당합니다 */}
        {tone === "now" ? (deadlineLabel ?? tag) : tag}
      </span>
    </li>
  );
}
```

- [ ] **Step 2: 머리말을 목록 위에 둔다**

같은 파일에 `PlanBoard` 를 더합니다. **머리말 문장은 §S-07 이 정한 그대로입니다 —
고쳐 쓰지 마세요.**

```tsx
export interface PlanBoardProps {
  steps: readonly PlanStep[];
  /** 그 단계의 기한 문자열. 없으면 `null`. **서버가 준 값만** */
  deadlineFor?: (stepId: string) => string | null;
  /** 그 단계에 기한이 있는가 — `toneOf` 가 「언제든」을 가릅니다 */
  hasDeadline?: (stepId: string) => boolean;
  /** 그 단계의 부산물 한 줄. 「◆ 통화 접수번호」 */
  artifactFor?: (stepId: string) => string | null;
}

export function PlanBoard({
  steps,
  deadlineFor,
  hasDeadline,
  artifactFor,
}: PlanBoardProps) {
  const numbers = numberSteps(steps);
  const numbered = [...numbers.values()].some((n) => n !== null);

  return (
    <section>
      {numbered && (
        <p className="mb-2 text-[13px] leading-[1.6] text-ink-3">
          번호가 붙은 것만 순서대로입니다. 나머지는 순서와 상관없습니다.
        </p>
      )}
      <ul className="flex flex-col">
        {steps.map((s) => {
          const tone = toneOf(s, hasDeadline?.(s.step_id) ?? false);
          return (
            <StepRow
              key={s.step_id}
              step={s}
              tone={tone}
              tag={tagOf(s, tone)}
              number={numbers.get(s.step_id) ?? null}
              deadlineLabel={deadlineFor?.(s.step_id) ?? null}
              artifactLabel={artifactFor?.(s.step_id) ?? null}
            />
          );
        })}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: 공개 API 와 README 를 쓴다**

`src/modules/plan-viewer/index.ts`:

```ts
/**
 * plan-viewer — 타임라인·단계·상태 배지를 그린다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-035(화면 상태 두 축)
 *
 * 판정은 `tone.ts`·`order.ts`, 렌더는 `board.tsx` 입니다. **둘을 섞지 마세요.**
 */

import "client-only";

export { toneOf, tagOf } from "./tone";
export { numberSteps } from "./order";
export { PlanBoard, StepRow } from "./board";
export type { PlanBoardProps, StepRowProps } from "./board";
export type { PlanStep, StepState, StepTone } from "./types";
```

`src/modules/plan-viewer/README.md`:

```markdown
# plan-viewer

타임라인·단계·상태 배지를 그립니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | `GET /api/cases/{token}/plan` 의 `steps[]` |
| 내놓는 것 | 타임라인·단계·배지 |
| 절대 하지 않는 것 | 사용자 체크만으로 완료 표시 · 조건부 단계 지우기 · **T0 를 다른 것에 종속시키기** |

## 번호를 아무 데나 붙이지 않습니다

우리 단계는 **절반이 순서가 없습니다.** 112 신고와 지급정지 요청은 동시에 하는 것입니다.
`body.after` 사슬에 있는 것에만 번호를 붙이고, 그 번호는 **사슬 안 위치**입니다 —
`step_seq`(10·20·25)를 그대로 보이면 「25번 다음이 30번」이 됩니다.

**`after` 가 응답에 실려 오는지가 아직 미결입니다** → [계획 Task 1](../../../docs/plans/08-22-layer-c-viewers.md).
없으면 전부 점으로 그립니다 — 없는 순서를 지어내지 않습니다.

## 기한은 여기서 만들지 않습니다

`deadlineFor`·`hasDeadline` 을 **밖에서 받습니다.** 이 모듈이 기한을 조회하면
`deadline-viewer` 와 주인이 겹치고, **화면이 날짜를 세는 길**이 열립니다.
```

- [ ] **Step 4: 화면을 모듈로 갈아 끼운다**

`src/app/c/[token]/plan.tsx` 에서 `STEPS`·`MARK`·`type Tone` 을 지우고,
단계 목록 자리를 아래로 바꿉니다. **히어로 스트립과 진행 레일(`RAIL`)은 그대로 둡니다** —
아직 서버 값이 없어 이번 태스크의 범위가 아닙니다.

```tsx
import { FIXTURE_DEADLINES, FIXTURE_PLAN } from "./fixtures";
import { PlanBoard } from "@/modules/plan-viewer";

// …본문 안에서
<PlanBoard
  steps={FIXTURE_PLAN.steps}
  hasDeadline={(id) => FIXTURE_DEADLINES.deadlines.some((d) => d.step_id === id)}
  // 서버가 잔여일을 주기 전까지는 날짜 문자열만 — 화면이 세지 않습니다 (Task 1)
  deadlineFor={(id) =>
    FIXTURE_DEADLINES.deadlines.find((d) => d.step_id === id && d.kind === "primary")
      ? "8월 20일까지"
      : null
  }
  artifactFor={(id) => (id === "m1" ? "◆ 통화 접수번호" : id === "m2" ? "◆ 사건접수번호" : null)}
/>
```

파일 머리 주석의 `TODO(연결)` 줄에 「단계 목록은 `plan-viewer` 로 옮겼습니다 —
데이터는 `fixtures.ts`, 라우트가 서면 그 자리가 `fetch` 입니다」를 더합니다.

- [ ] **Step 5: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [ ] **Step 6: 커밋**

```bash
git add src/modules/plan-viewer/ "src/app/c/[token]/plan.tsx"
git commit -m "plan-viewer — 단계 목록을 화면에서 모듈로 옮긴다"
```

---

## Task 5: deadline-viewer — 갈래를 나누고, 날짜를 세지 않는다

**이 모듈의 핵심은 「하지 않는 것」입니다.** 날짜를 세지 않고, 지난 기한을 지우지 않고,
환급을 카운트다운으로 만들지 않습니다.

**Files:**
- Create: `src/modules/deadline-viewer/types.ts`
- Create: `src/modules/deadline-viewer/group.ts`
- Create: `src/modules/deadline-viewer/group.test.ts`

**Interfaces:**
- Consumes: `GET /api/cases/{token}/deadlines` ([API](../../spec/common/08-14-api.md) §3.7)
- Produces: `groupDeadlines(list): DeadlineGroups` · `ddayLabel(d): string | null` ·
  `isCountdown(d): boolean` · 타입 `Deadline` · `DeadlineKind`

- [ ] **Step 1: 계약 타입을 쓴다**

`src/modules/deadline-viewer/types.ts`:

```ts
/**
 * deadline-viewer — 기한을 표시한다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.7 · spec/common/08-16-deadline-rules.md
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **날짜를 계산하기** (기준 시계는 서버입니다. 기기 시계가 틀리면 기한을 놓칩니다)
 *  · 지난 기한을 지우기 (유예 14일이 남아 있을 수 있습니다)
 *  · 환급을 카운트다운으로 만들기 (통상 3~6개월 — 매일 실망을 줍니다)
 */

/** §3.7 · 데이터 모델 §8.1 */
export type DeadlineKind = "primary" | "grace" | "info";

export interface Deadline {
  deadline_id: string;
  step_id?: string;
  title: string;
  kind: DeadlineKind | string;
  /** 서버가 계산한 만료 시점 */
  due_at: string;
  status: string;
  /** 본 기한을 넘겼을 때 무슨 일이 생기는지 */
  on_miss?: string;
  /** 추가 기간이 주어지는 조건 */
  condition?: string;
  /** `info` 가 사용자 기한이 아님을 밝히는 자리 */
  note?: string;
  /**
   * 서버가 센 잔여일. 지난 기한은 음수.
   *
   * ⬜ **아직 §3.7 에 없습니다** → 계획 Task 1.
   * **없으면 D-day 를 그리지 않습니다** — 화면이 대신 세면 기기 시계를 믿게 됩니다.
   */
  days_left?: number;
}

export interface DeadlineGroups {
  /** 놓치면 되돌릴 수 없는 것 */
  readonly primary: readonly Deadline[];
  /** 본 기한을 넘겼을 때 주어지는 기간. **본 기한과 합치지 않습니다** */
  readonly grace: readonly Deadline[];
  /** 사용자가 지킬 기한이 아닌 것 */
  readonly info: readonly Deadline[];
}
```

- [ ] **Step 2: 실패하는 시험을 쓴다**

`src/modules/deadline-viewer/group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ddayLabel, groupDeadlines, isCountdown } from "./group";
import type { Deadline } from "./types";

const mk = (over: Partial<Deadline> = {}): Deadline => ({
  deadline_id: "01J",
  title: "피해구제 신청서 제출",
  kind: "primary",
  due_at: "2026-08-20T23:59:59+09:00",
  status: "open",
  ...over,
});

describe("갈래를 나눈다", () => {
  it("본 기한과 추가 기간을 합치지 않는다", () => {
    const got = groupDeadlines([mk(), mk({ deadline_id: "02J", kind: "grace" })]);
    expect(got.primary).toHaveLength(1);
    expect(got.grace).toHaveLength(1);
  });

  it("모르는 kind 를 버리지 않는다 — 본 기한으로 둔다", () => {
    const got = groupDeadlines([mk({ kind: "무언가_새로_생긴_값" })]);
    expect(got.primary).toHaveLength(1);
  });

  it("지난 기한도 목록에서 지우지 않는다 — 유예가 남아 있을 수 있다", () => {
    const got = groupDeadlines([mk({ status: "missed" })]);
    expect(got.primary).toHaveLength(1);
  });
});

describe("화면이 날짜를 세지 않는다", () => {
  it("서버가 센 값이 없으면 D-day 를 그리지 않는다", () => {
    expect(ddayLabel(mk())).toBeNull();
  });

  it("서버가 센 값이 있으면 그대로 옮긴다", () => {
    expect(ddayLabel(mk({ days_left: 2 }))).toBe("D-2");
  });

  it("오늘은 D-0 이 아니라 오늘이다", () => {
    expect(ddayLabel(mk({ days_left: 0 }))).toBe("오늘");
  });

  it("지난 기한은 지우지 않고 지난 것으로 표시한다", () => {
    expect(ddayLabel(mk({ days_left: -3 }))).toBe("D+3");
  });
});

describe("환급을 카운트다운으로 만들지 않는다", () => {
  it("info 는 카운트다운이 아니다", () => {
    expect(isCountdown(mk({ kind: "info", days_left: 60 }))).toBe(false);
  });

  it("본 기한은 카운트다운이다", () => {
    expect(isCountdown(mk({ days_left: 2 }))).toBe(true);
  });

  it("센 값이 없으면 카운트다운을 만들지 않는다", () => {
    expect(isCountdown(mk())).toBe(false);
  });
});
```

- [ ] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/deadline-viewer
```

기대: FAIL — `Cannot find module './group'`

- [ ] **Step 4: 최소 구현을 쓴다**

`src/modules/deadline-viewer/group.ts`:

```ts
import type { Deadline, DeadlineGroups } from "./types";

/** 본 기한·추가 기간·안내를 가릅니다. **합치지 않습니다** → 데이터 모델 §8.1 */
export function groupDeadlines(list: readonly Deadline[]): DeadlineGroups {
  const primary: Deadline[] = [];
  const grace: Deadline[] = [];
  const info: Deadline[] = [];

  for (const d of list) {
    if (d.kind === "grace") grace.push(d);
    else if (d.kind === "info") info.push(d);
    // 모르는 값을 버리지 않습니다 — 기한 목록이 조용히 비면 사용자가 권리를 잃습니다
    else primary.push(d);
  }

  return { primary, grace, info };
}

/**
 * D-day 문자열. **서버가 센 값이 없으면 `null` 입니다.**
 *
 * `due_at` 에서 직접 세지 마세요 — 기준 시계는 서버이고, 사용자 기기의 날짜가
 * 틀리면 기한을 놓칩니다 → spec/common/08-16-deadline-rules.md 「계산의 전제」.
 */
export function ddayLabel(d: Deadline): string | null {
  if (typeof d.days_left !== "number") return null;
  if (d.days_left > 0) return `D-${d.days_left}`;
  if (d.days_left === 0) return "오늘";
  return `D+${Math.abs(d.days_left)}`;
}

/**
 * 카운트다운으로 그려도 되는가.
 *
 * **`info` 는 안 됩니다.** 환급 타임라인은 통상 3~6개월이라
 * 카운트다운으로 만들면 매일 실망을 줍니다 — 진행 단계 설명으로 보여줍니다.
 */
export function isCountdown(d: Deadline): boolean {
  return d.kind !== "info" && typeof d.days_left === "number";
}
```

- [ ] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/deadline-viewer
```

기대: PASS — 10 passed

- [ ] **Step 6: 커밋**

```bash
git add src/modules/deadline-viewer/
git commit -m "deadline-viewer — 갈래를 나누되 날짜를 세지 않는다 (기한 규칙)"
```

---

## Task 6: deadline-viewer — 표시와 공개 API

**Files:**
- Create: `src/modules/deadline-viewer/list.tsx`
- Create: `src/modules/deadline-viewer/index.ts`
- Create: `src/modules/deadline-viewer/README.md`

**Interfaces:**
- Consumes: `groupDeadlines` · `ddayLabel` · `isCountdown` (Task 5)
- Produces: `DeadlineList` (props `{ deadlines }`) · `DeadlineBadge` (props `{ deadline }`)

- [ ] **Step 1: 렌더를 쓴다**

`src/modules/deadline-viewer/list.tsx`:

```tsx
"use client";

import { ddayLabel, groupDeadlines, isCountdown } from "./group";
import type { Deadline } from "./types";

/** 놓치면 되돌릴 수 없는 것만 앰버입니다. **빨강을 쓰지 않습니다** */
export function DeadlineBadge({ deadline }: { deadline: Deadline }) {
  const label = ddayLabel(deadline);
  if (label === null) return null;

  const urgent = isCountdown(deadline) && deadline.kind === "primary";
  return (
    <span
      data-numeric
      className={`inline-flex min-h-[26px] items-center rounded-[9px] border px-2.5 text-[13px] font-[660] ${
        urgent
          ? "border-[oklch(0.77_0.117_70.9/45%)] text-deadline-urgent"
          : "border-[oklch(0.305_0.013_267.1/70%)] text-ink-3"
      }`}
    >
      {label}
    </span>
  );
}

export function DeadlineList({ deadlines }: { deadlines: readonly Deadline[] }) {
  const { primary, grace, info } = groupDeadlines(deadlines);

  const row = (d: Deadline, extra?: string) => (
    <li key={d.deadline_id} className="flex items-start gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-[1.5] text-ink-1">{d.title}</span>
        {extra && <span className="mt-0.5 block text-[13px] text-ink-3">{extra}</span>}
      </span>
      <DeadlineBadge deadline={d} />
    </li>
  );

  return (
    <div className="flex flex-col gap-4">
      {primary.length > 0 && <ul>{primary.map((d) => row(d, d.on_miss))}</ul>}
      {grace.length > 0 && (
        <ul className="border-t border-hairline pt-2">
          {grace.map((d) => row(d, d.condition))}
        </ul>
      )}
      {info.length > 0 && (
        <ul className="border-t border-hairline pt-2 opacity-80">
          {/* `info` 는 사용자가 지킬 기한이 아닙니다 — `note` 가 그렇게 밝힙니다 */}
          {info.map((d) => row(d, d.note))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 공개 API 와 README 를 쓴다**

`src/modules/deadline-viewer/index.ts`:

```ts
/**
 * deadline-viewer — 기한을 표시한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · 불변 규칙 7(날짜는 규칙이 센다)
 */

import "client-only";

export { groupDeadlines, ddayLabel, isCountdown } from "./group";
export { DeadlineList, DeadlineBadge } from "./list";
export type { Deadline, DeadlineGroups, DeadlineKind } from "./types";
```

`src/modules/deadline-viewer/README.md`:

```markdown
# deadline-viewer

기한을 표시합니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | `GET /api/cases/{token}/deadlines` |
| 내놓는 것 | D-day · 유예 · `info` |
| 절대 하지 않는 것 | **날짜 계산** · 지난 기한 지우기 · 환급을 카운트다운으로 만들기 |

## 왜 D-day 가 안 뜨나

`days_left` 가 응답에 없으면 **일부러 안 그립니다.** `due_at` 에서 화면이 직접 세면
사용자 기기의 날짜가 틀렸을 때 기한을 놓칩니다 — 기준 시계는 서버입니다.

`days_left` 는 **아직 §3.7 에 없습니다** → [계획 Task 1](../../../docs/plans/08-22-layer-c-viewers.md).
```

- [ ] **Step 3: 빌드가 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [ ] **Step 4: 커밋**

```bash
git add src/modules/deadline-viewer/
git commit -m "deadline-viewer — 표시와 공개 API. days_left 가 없으면 D-day 를 그리지 않는다"
```

---

## Task 7: transcript-viewer — 전사를 원문으로 펼친다

**여기는 전체 복원이 허용되는 자리입니다** — 사용자가 자기 통화를 대조하는 곳입니다.
그리고 **복원된 원문을 서버로 되돌려 보내지 않습니다.**

**Files:**
- Create: `src/modules/transcript-viewer/types.ts`
- Create: `src/modules/transcript-viewer/read.ts`
- Create: `src/modules/transcript-viewer/read.test.ts`

**Interfaces:**
- Consumes: `restore(text, mappings, options): string` from `@/modules/pii-restorer` ·
  `RestorableMapping { token, original, label? }`
- Produces: `readTranscript(lines, mappings, onDenied?): TranscriptLine[]` ·
  `countTokens(tokens): TokenCount[]` · 타입 `RawLine` · `TranscriptLine` · `PiiToken`
  (`ingest_status` 는 이 모듈이 다루지 않습니다 — `file-sender` 몫)

- [ ] **Step 1: 계약 타입을 쓴다**

`src/modules/transcript-viewer/types.ts`:

```ts
/**
 * transcript-viewer — 전사·OCR 결과를 보여준다 (층 C · 브라우저)
 *
 * 계약: spec/frontend/08-14-screens.md §S-08 · spec/common/08-14-api.md §3.3
 * 근거: ADR-034(화면은 원문을 보여준다) · ADR-023(층 C)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **복원된 원문을 서버로 되돌려 보내기**
 *  · OCR·전사를 여기서 하기 (그건 서버 `transcriber` 의 일입니다)
 */

/** §3.3 `transcript[]` — **토큰화된 상태로 내려옵니다** */
export interface RawLine {
  speaker: string;
  text: string;
  start_ms: number;
}

/** 화면에 그리는 한 줄. `text` 는 **원문**입니다 (ADR-034) */
export interface TranscriptLine {
  speaker: string;
  text: string;
  start_ms: number;
  /** 이 줄에서 펼치지 못한 토큰. 다른 기기에서 열었을 때 생깁니다 */
  unresolved: readonly string[];
}

/** §3.3 `pii_tokens[]` */
export interface PiiToken {
  token: string;
  kind: string;
}

/** 헤더의 「서버로는 이름 1 · 계좌 1 을 가려서 보냈습니다」 */
export interface TokenCount {
  kind: string;
  count: number;
}
```

- [ ] **Step 2: 실패하는 시험을 쓴다**

`src/modules/transcript-viewer/read.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { countTokens, readTranscript } from "./read";
import type { RawLine } from "./types";

const lines: RawLine[] = [
  { speaker: "A", text: "[이름-1] 고객님 되시죠", start_ms: 0 },
  { speaker: "B", text: "네 맞는데요", start_ms: 2100 },
];

const mapping = [{ token: "[이름-1]", original: "이영희" }];

describe("전사를 원문으로 펼친다", () => {
  it("여기서는 전체 복원이 허용된다 — 사용자가 자기 통화를 대조하는 자리다", () => {
    const got = readTranscript(lines, mapping);
    expect(got[0].text).toBe("이영희 고객님 되시죠");
  });

  it("매핑에 없는 토큰은 토큰 그대로 남기고 던지지 않는다", () => {
    const got = readTranscript(lines, []);
    expect(got[0].text).toBe("[이름-1] 고객님 되시죠");
    expect(got[0].unresolved).toEqual(["[이름-1]"]);
  });

  it("다른 기기에서 열어도 화면이 비지 않는다 — 고장이 아니다", () => {
    const got = readTranscript(lines, []);
    expect(got).toHaveLength(2);
    expect(got[1].text).toBe("네 맞는데요");
  });

  it("토큰이 없는 줄은 그대로다", () => {
    const got = readTranscript(lines, mapping);
    expect(got[1].unresolved).toEqual([]);
  });
});

describe("무엇이 가려져 나갔는지 개수로 밝힌다", () => {
  it("종류별로 센다", () => {
    const got = countTokens([
      { token: "[이름-1]", kind: "name" },
      { token: "[계좌-1]", kind: "account" },
      { token: "[계좌-2]", kind: "account" },
    ]);
    expect(got).toEqual([
      { kind: "이름", count: 1 },
      { kind: "계좌", count: 2 },
    ]);
  });

  it("없으면 빈 목록이다", () => {
    expect(countTokens([])).toEqual([]);
  });
});
```

- [ ] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/transcript-viewer
```

기대: FAIL — `Cannot find module './read'`

- [ ] **Step 4: 최소 구현을 쓴다**

`src/modules/transcript-viewer/read.ts`:

```ts
import { parseToken, restore } from "@/modules/pii-restorer";
import type { DenialEvent, RestorableMapping } from "@/modules/pii-restorer";
import type { PiiToken, RawLine, TokenCount, TranscriptLine } from "./types";

/**
 * 전사를 원문으로 펼칩니다.
 *
 * **`site: "transcript"` 는 전체 복원입니다** — 사용자가 자기 통화를 대조하는
 * 자리라 부분 복원이면 대조가 안 됩니다 → spec/backend/08-16-chat-context.md §8.
 *
 * **펼치지 못해도 실패가 아닙니다.** 다른 기기에서 열면 매핑이 없어 토큰이 그대로
 * 남습니다 — 그때도 화면은 그려지고, 안내 문구는 부르는 쪽이 붙입니다.
 */
export function readTranscript(
  lines: readonly RawLine[],
  mappings: readonly RestorableMapping[],
  onDenied?: (event: DenialEvent) => void,
): TranscriptLine[] {
  const pool = [...mappings];

  return lines.map((line) => {
    const unresolved: string[] = [];
    const text = restore(line.text, pool, {
      site: "transcript",
      onDenied: (event) => {
        unresolved.push(event.token);
        onDenied?.(event);
      },
    });
    return { speaker: line.speaker, text, start_ms: line.start_ms, unresolved };
  });
}

/**
 * 종류별 개수. **원문을 담지 않습니다** — 「서버로는 이름 1 · 계좌 1 을
 * 가려서 보냈습니다」를 헤더에 적는 데 씁니다 → 화면 설계 §S-08.
 *
 * 화면에 보이는 종류 이름은 **토큰 표기**(「[이름-1]」의 「이름」)에서 얻습니다.
 * §3.3 의 `kind` 는 영문 코드(`name`·`account`)라 그대로 내보내면
 * **「name 1 · account 1」** 이 됩니다 — 어휘를 여기서 새로 만들지 않고
 * 토큰이 이미 가진 한국어 표기를 씁니다.
 */
export function countTokens(tokens: readonly PiiToken[]): TokenCount[] {
  const seen = new Map<string, number>();
  for (const t of tokens) {
    const kind = parseToken(t.token)?.kind ?? t.kind;
    seen.set(kind, (seen.get(kind) ?? 0) + 1);
  }
  return [...seen].map(([kind, count]) => ({ kind, count }));
}
```

- [ ] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/transcript-viewer
```

기대: PASS — 6 passed

> `pii-restorer` 의 `onDenied` 는 **매핑에 없는 토큰에도 불립니다** —
> `restore.ts` 의 `not_in_mapping` 분기(「모든 토큰의 원래 값을 나열하라」류 시도를 막는
> 검사)가 그 사건입니다. 그래서 `readTranscript` 는 남은 토큰을 정규식으로 다시 긁지 않고
> 이 콜백만으로 `unresolved` 를 채웁니다 — 패턴을 두 곳에 두면 어긋난 쪽이 조용히
> 새는 쪽이 됩니다.

- [ ] **Step 6: 커밋**

```bash
git add src/modules/transcript-viewer/
git commit -m "transcript-viewer — 전사를 원문으로 펼친다. 못 펼쳐도 실패가 아니다 (ADR-034)"
```

---

## Task 8: transcript-viewer — 화면을 모듈로 옮긴다

**Files:**
- Create: `src/modules/transcript-viewer/view.tsx`
- Create: `src/modules/transcript-viewer/index.ts`
- Create: `src/modules/transcript-viewer/README.md`
- Modify: `src/app/c/[token]/evidence.tsx` — **`TRANSCRIPT` 만** 지웁니다 (아래 Step 3)

**Interfaces:**
- Consumes: `readTranscript` · `countTokens` (Task 7)
- Produces: `TranscriptView` (props `{ lines, mappings, tokens }`)

> **상태 점(`StatusDot`)은 이 모듈이 맡지 않습니다.** [경계 표](../../spec/common/08-16-module-boundaries.md)에서
> 「업로드 + **처리 상태**」는 `file-sender` 의 내놓는 것이고, 이 모듈은 「토큰화 전사 → 화면」입니다.
> 실제로도 지금 `evidence.tsx` 의 `DOT` 은 **자료 레일에서만** 쓰입니다(전사 본문은 안 씁니다) —
> 그래서 `EvidenceStatus` 타입과 점 렌더는 둘 다
> [서버와 이야기하는 넷 계획](08-22-layer-c-transport.md) Task 7 의 `file-sender` 로 갑니다.

- [ ] **Step 1: 전사 본문을 옮긴다**

`src/modules/transcript-viewer/view.tsx`. **화면이 다시 가리거나 풀지 않습니다** — 값이 이미 원문입니다.

```tsx
"use client";

import { countTokens, readTranscript } from "./read";
import type { PiiToken, RawLine } from "./types";
import type { RestorableMapping } from "@/modules/pii-restorer";

export interface TranscriptViewProps {
  lines: readonly RawLine[];
  mappings: readonly RestorableMapping[];
  /** §3.3 `pii_tokens[]` — 헤더의 개수 표시에 씁니다 */
  tokens?: readonly PiiToken[];
}

export function TranscriptView({ lines, mappings, tokens = [] }: TranscriptViewProps) {
  const read = readTranscript(lines, mappings);
  const counts = countTokens(tokens);
  const stuck = read.some((l) => l.unresolved.length > 0);

  return (
    <div className="flex flex-col gap-3">
      {counts.length > 0 && (
        <p className="text-[13px] leading-[1.6] text-ink-3">
          서버로는 {counts.map((c) => `${c.kind} ${c.count}`).join(" · ")} 을 가려서
          보냈습니다.
        </p>
      )}

      {stuck && (
        // **고장이 아닙니다** — 다른 기기라 매핑이 없는 것입니다 (S-11 과 같은 어휘)
        <p className="rounded-[10px] border border-[oklch(0.77_0.117_70.9/45%)] bg-[oklch(0.77_0.117_70.9/6%)] px-3 py-2 text-[13px] leading-[1.6] text-deadline-urgent">
          이 기기에는 열쇠가 없어 일부를 원래대로 보여드리지 못했습니다. 처음
          시작하신 기기에서 열면 그대로 보입니다.
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {read.map((line) => (
          <li key={`${line.speaker}-${line.start_ms}`} className="flex gap-3">
            <span className="w-6 shrink-0 text-[13px] text-ink-4">{line.speaker}</span>
            <span className="min-w-0 text-[15px] leading-[1.7] text-ink-2">
              {line.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
```

- [ ] **Step 2: 공개 API 와 README 를 쓴다**

`src/modules/transcript-viewer/index.ts`:

```ts
/**
 * transcript-viewer — 전사·OCR 결과를 보여준다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-034(화면은 원문을 보여준다)
 */

import "client-only";

export { readTranscript, countTokens } from "./read";
export { TranscriptView } from "./view";
export type { TranscriptViewProps } from "./view";
export type { PiiToken, RawLine, TokenCount, TranscriptLine } from "./types";
```

`src/modules/transcript-viewer/README.md`:

```markdown
# transcript-viewer

전사·OCR 결과를 보여줍니다. **층 C(브라우저)** 입니다.

| | |
| --- | --- |
| 받는 것 | 토큰화된 전사 (`GET …/evidence/{id}` §3.3) + 브라우저의 복원 매핑 |
| 내놓는 것 | 화면 (**전체 복원**) |
| 절대 하지 않는 것 | **복원된 원문을 서버로 되돌려 보내기** · 여기서 OCR 하기 |

## `file-sender` 와 규칙이 정반대입니다

하나는 가리고 하나는 펼칩니다. 이 자리는 사용자가 **자기 통화를 대조하는 곳**이라
전체 복원이 허용됩니다 — 부분 복원이면 대조가 안 됩니다.

## 못 펼쳐도 고장이 아닙니다

다른 기기에서 열면 복호화 키가 없어 토큰이 그대로 남습니다. 그때도 화면은 그려지고,
「처음 시작하신 기기에서 열면 그대로 보입니다」를 함께 보여줍니다.
```

- [ ] **Step 3: 화면을 모듈로 갈아 끼운다**

`src/app/c/[token]/evidence.tsx` 에서 **`TRANSCRIPT` 만** 지우고 전사 본문 자리를
`<TranscriptView lines={FIXTURE_EVIDENCE.transcript} mappings={FIXTURE_MAPPINGS}
tokens={FIXTURE_EVIDENCE.pii_tokens} />` 로 바꿉니다 (픽스처는 Task 1b).

> ⚠️ **`DOT`·`type Status`·`FILES` 는 지우지 않습니다.** `DOT` 의 **유일한 사용처가
> 자료 레일**(`FILES.map` 안의 `DOT[f.status]`)이고, 그 레일은 `file-sender` 의 몫이라
> [다음 계획](08-22-layer-c-transport.md) Task 7 이 셋을 함께 걷어냅니다.
> 여기서 지우면 남겨 둔 레일이 컴파일되지 않아 **바로 다음 단계의 빌드가 깨집니다.**

- [ ] **Step 4: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [ ] **Step 5: 커밋**

```bash
git add src/modules/transcript-viewer/ "src/app/c/[token]/evidence.tsx"
git commit -m "transcript-viewer — 전사 본문을 화면에서 모듈로 옮긴다"
```

---

## Task 9: doc-filler — 입력 계약 초안을 정본에 올린다

> ⚠️ **2026-08-22 갱신 — 이 태스크는 다시 봐야 합니다.**
> 계획을 쓴 뒤 `main` 에 **`doc-builder`(층 3)가 구현돼 들어왔습니다**
> (`src/modules/doc-builder/`). 그 모듈이 이미 `DocGuide` · `GuideSection` · `GuideField` ·
> `FieldState` 타입을 내놓고 있으므로, **§3.12 초안을 새로 지어내지 말고
> `src/modules/doc-builder/types.ts` 의 산출 모양을 그대로 계약으로 올리세요.**
> 아래 초안은 그 모듈이 없던 시점에 화면이 요구하는 것에서 뽑은 것이라 **대조가 필요합니다.**

**아직 정해지지 않은 것은 「그 값을 어느 경로로 내려주나」입니다.** `doc-builder` 는 서 있지만
「기재 항목과 값」을 내려주는 엔드포인트가 [API 계약](../../spec/common/08-14-api.md) §2 에
없습니다. **초안을 올리고 사람이 확정합니다.**

**확정 전에 만들지 않는 것은 서버 쪽**(`doc-builder`·라우트)입니다 — 브라우저 쪽(Task 10·11)은
이 초안 모양대로 진행하되, 계약 타입을 §3.12 그대로 두어 **초안이 바뀌면 `types.ts` 한 곳만
고치면 되게** 합니다. 사람이 「초안 기준 선구현도 안 된다」고 정하면 Task 10 앞에서 멈춥니다.

**Files:**
- Modify: `spec/common/08-14-api.md` — §2 엔드포인트 표에 한 줄, §3.12 신설
- Modify: `docs/plans/08-20-api-routes.md` — 미결 표에 한 줄

**Interfaces:**
- Produces: `GET /api/cases/{case_token}/doc` 응답 계약(초안). Task 10 이 이 모양을 씁니다.

- [ ] **Step 1: 엔드포인트 표에 한 줄을 더한다**

`spec/common/08-14-api.md` §2 표의 `POST …/vault` 아래:

```markdown
| `GET` | `/api/cases/{case_token}/doc` | **서류 기재 안내** (`F-08`). 계약은 **§3.12** — ⬜ 초안 |
```

- [ ] **Step 2: §3.12 를 초안으로 쓴다**

§3.11 뒤에 붙입니다. **값은 토큰으로 내려옵니다** — 서버는 원문을 갖고 있지 않습니다.

````markdown
### 3.12 `GET /api/cases/{case_token}/doc` — 서류 기재 안내 (`F-08`)

> ⬜ **초안입니다. 사람이 확정해야 합니다** →
> [층 C 보여주는 넷 계획](../../docs/plans/08-22-layer-c-viewers.md) Task 9.
>
> 모양은 **이미 서 있는 화면**(`src/app/c/[token]/doc.tsx`)이 요구하는 것에서 뽑았습니다.
> 화면이 먼저 있고 계약이 없던 자리라, 화면을 계약에 맞추는 것이 아니라
> **화면이 실제로 필요로 하는 것**을 적었습니다.

**서류를 조판해 내려주지 않습니다** → [ADR-037](../../decisions/037-doc-guidance-not-generation.md).
항목과 값을 짝지어 줄 뿐이고, 조판은 하지 않습니다.

```jsonc
// 응답 200
{
  "form_id": "relief-application-form1",
  "form_name": "피해구제신청서 (별지 제1호서식)",
  "citation": {
    "kb_entry_id": "relief-application",
    "kb_version": "2026.08.1",
    "legal_basis": "통신사기피해환급법 시행령 제3조",
    "source_url": "https://www.law.go.kr/...",
    "effective_from": "2026-07-01"
  },

  // 배열 순서가 곧 권장 순서입니다. 화면이 정렬하지 않습니다 → ADR-042
  // 비어 있으면 화면이 카드를 **아예 그리지 않습니다** — 「모른다」를 「없다」로 그리지 않습니다
  "submit": [
    { "how": "branch", "text": "국민은행 영업점 창구", "url": "https://..." }
  ],

  // 구획 순서는 **서식 실물 그대로**입니다. 채우는 순서가 아닙니다
  "sections": [
    {
      "section_id": "victim",
      "name": "피해자",
      "fields": [
        { "field_id": "v-name",  "label": "성명",
          "state": "confirmed", "value": "[이름-3]" },
        { "field_id": "v-birth", "label": "생년월일",
          "state": "unknown",
          "note": "직접 적으셔야 합니다 — 주민등록번호가 아닙니다" },
        { "field_id": "v-amount", "label": "금액",
          "state": "confirmed", "value": "3000000" }
      ]
    }
  ]
}
```

| 칸 | 뜻 |
| --- | --- |
| `label` | **서식 칸 이름 그대로.** 서버가 다듬지 않습니다 — 사용자가 실물과 대조합니다 |
| `state` | `confirmed`(확인됨) · `unread`(읽은 값, 확인 필요) · `unknown`(직접 적음) · `staff`(신청인이 적지 않는 란) |
| `value` | **토큰 또는 원문.** 개인정보는 토큰(`[이름-3]`), [토큰화 제외 목록](08-14-pii-boundary.md)에 있는 금액·기관명·시각은 원문 |
| `note` | 그 칸을 어떻게 채우는지. `unknown` 일 때 필수 |

**`value` 가 토큰인 것이 정상입니다.** 서버는 원문을 갖고 있지 않고,
**브라우저의 `doc-filler` 가 볼트 매핑으로 펼칩니다**
→ [ADR-009](../../decisions/009-restore-mapping-location.md) · [ADR-034](../../decisions/034-browser-shows-plaintext.md).

**`state: "unknown"` 을 결함으로 세지 않습니다.** 환급받을 계좌는 **원래 알 수 없는 값**입니다.
화면은 「저희가 채운 값 0」이 아니라 「전부 직접 적습니다」로 말합니다 → §S-10.

> ⬜ **미결 — 서식 1차 대조.** 별지 제1호서식은 **2차 출처로 확보됐습니다**
> (2026-08-20 · [research/01](../../docs/research/01-환급절차-기한.md) §5 에 칸 이름 전문 · `U-17`).
> **남은 것은 법제처 1차 대조**입니다 — 시행일 표기가 없어 어느 개정본인지 확인되지
> 않았습니다(법령 API `OC` 키 승인 대기). 대조가 끝나면 KB 항목으로 등재하고
> `label` 을 그 칸 이름 그대로 부릅니다. **런타임에 모델이 서식을 읽어 안내하는 구조를
> 만들지 마세요** → 불변 규칙 1.
````

> ⚠️ **`spec/frontend/08-14-screens.md` §S-10 은 아직 「원본이 미확인(`U-17`)」이라고 말합니다** —
> 2026-08-20 확보 이후 갱신되지 않은 낡은 서술입니다. **이 계획이 임의로 고치지 않습니다**
> (`CLAUDE.md` 「어긋난 걸 발견하면 임의로 맞추지 말고 사람에게 알리세요」).
> 갱신 여부를 사람에게 확인하세요.

- [ ] **Step 3: 착수 문서의 미결 표에 한 줄을 더한다**

`docs/plans/08-20-api-routes.md` 「정본에 없어 채워야 하는 것」 표에:

```markdown
| **서류 기재 안내 경로** | §3.12 초안을 올렸습니다. `doc-builder`(층 3) 미구현 — 확정 필요 |
```

- [ ] **Step 4: 검사기를 돌린다**

```bash
python .github/scripts/doc-integrity.py
```

기대: `OK`

- [ ] **Step 5: 커밋**

```bash
git add spec/common/08-14-api.md docs/plans/08-20-api-routes.md
git commit -m "서류 기재 안내 §3.12 초안 — 화면이 요구하는 것에서 뽑았다 (ADR-037)"
```

---

## Task 10: doc-filler — 값을 브라우저에서 펼친다

**Files:**
- Create: `src/modules/doc-filler/types.ts`
- Create: `src/modules/doc-filler/fill.ts`
- Create: `src/modules/doc-filler/fill.test.ts`

**Interfaces:**
- Consumes: §3.12 응답(Task 9) · `restore` from `@/modules/pii-restorer`
- Produces: `fillSections(sections, mappings): FilledSection[]` · `summarize(sections): FillSummary`
  · 타입 `DocField` · `FilledField` · `FieldState`

- [ ] **Step 1: 계약 타입을 쓴다**

`src/modules/doc-filler/types.ts`:

```ts
/**
 * doc-filler — 기재 안내에 뜨는 값을 브라우저에서 원문으로 복원한다 (층 C · 브라우저)
 *
 * 계약: spec/common/08-14-api.md §3.12 (⬜ 초안) · spec/frontend/08-14-screens.md §S-10
 * 근거: ADR-037(서류를 만들지 않는다) · ADR-009(매핑은 브라우저) · ADR-042(제출 경로 둘)
 *
 * 절대 하지 않는 것 — spec/common/08-16-module-boundaries.md
 *  · **서버가 만든 완성 문서를 그대로 받기** (F-08 위반)
 */

/** §3.12 `fields[].state` */
export type FieldState = "confirmed" | "unread" | "unknown" | "staff";

/** 서버가 준 것. `value` 는 토큰일 수 있습니다 */
export interface DocField {
  field_id: string;
  /** 서식 칸 이름 **그대로**. 다듬지 마세요 */
  label: string;
  state: FieldState | string;
  value?: string;
  note?: string;
}

export interface DocSection {
  section_id: string;
  name: string;
  fields: readonly DocField[];
}

/** 펼친 뒤. **`raw` 는 복사되는 원문이라 끊지 않습니다** */
export interface FilledField extends DocField {
  /** 복사 대상. 복원 실패 시 `undefined` */
  raw?: string;
  /**
   * 읽기 좋게 끊은 표시용 값 — 「352-0912-3456-73」. 없으면 `raw` 를 그대로 보입니다.
   *
   * ⬜ **§3.12 에 주인이 없습니다** — 서버가 끊어 주는지, 화면이 끊는지 미정입니다.
   * Task 9 의 초안 표에 `display` 행을 ⬜ 로 함께 올리세요.
   */
  display?: string;
  /** 다른 기기에서 보이는 칩. 「이름·3」 — **대괄호 토큰을 그대로 보이지 않습니다** */
  masked?: string;
  /** 이 칸을 펼치지 못했나. **에러가 아닙니다** */
  unresolved: boolean;
}

export interface FilledSection {
  section_id: string;
  name: string;
  fields: readonly FilledField[];
}

/** 「전부 직접 적습니다」를 말하기 위한 셈 */
export interface FillSummary {
  total: number;
  /** 사용자가 직접 적어야 하는 칸 */
  byHand: number;
  /** **`0` 을 드러내지 않습니다** — 아래 README */
  filled: number;
}
```

- [ ] **Step 2: 실패하는 시험을 쓴다**

`src/modules/doc-filler/fill.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fillSections, summarize } from "./fill";
import type { DocSection } from "./types";

const sections: DocSection[] = [
  {
    section_id: "victim",
    name: "피해자",
    fields: [
      { field_id: "v-name", label: "성명", state: "confirmed", value: "[이름-3]" },
      {
        field_id: "v-birth",
        label: "생년월일",
        state: "unknown",
        note: "직접 적으셔야 합니다 — 주민등록번호가 아닙니다",
      },
      { field_id: "v-amount", label: "금액", state: "confirmed", value: "3000000" },
    ],
  },
];

const mapping = [{ token: "[이름-3]", original: "이영희" }];

describe("값을 브라우저에서 펼친다", () => {
  it("토큰을 원문으로 되돌린다", () => {
    const got = fillSections(sections, mapping);
    expect(got[0].fields[0].raw).toBe("이영희");
    expect(got[0].fields[0].unresolved).toBe(false);
  });

  it("금액은 원래 토큰이 아니다 — 그대로 둔다", () => {
    const got = fillSections(sections, mapping);
    expect(got[0].fields[2].raw).toBe("3000000");
  });

  it("직접 적는 칸에는 값이 없다 — 결함이 아니다", () => {
    const got = fillSections(sections, mapping);
    expect(got[0].fields[1].raw).toBeUndefined();
    expect(got[0].fields[1].unresolved).toBe(false);
  });

  it("펼치지 못하면 칩만 남기고 던지지 않는다 — 다른 기기다", () => {
    const got = fillSections(sections, []);
    expect(got[0].fields[0].unresolved).toBe(true);
    expect(got[0].fields[0].raw).toBeUndefined();
    // 대괄호 토큰을 그대로 보이지 않습니다 — 칩은 「이름·3」
    expect(got[0].fields[0].masked).toBe("이름·3");
  });

  it("구획 순서를 바꾸지 않는다 — 서식 실물과 대조하는 순서다", () => {
    const got = fillSections(sections, mapping);
    expect(got.map((s) => s.section_id)).toEqual(["victim"]);
    expect(got[0].fields.map((f) => f.field_id)).toEqual([
      "v-name",
      "v-birth",
      "v-amount",
    ]);
  });
});

describe("모름을 실패로 세지 않는다", () => {
  it("직접 적는 칸 수를 센다", () => {
    expect(summarize(sections)).toEqual({ total: 3, byHand: 1, filled: 2 });
  });

  it("전부 직접 적는 구획도 셈이 된다", () => {
    const refund: DocSection[] = [
      {
        section_id: "refund",
        name: "피해환급금 입금계좌",
        fields: [
          { field_id: "r-bank", label: "금융회사", state: "unknown", note: "적으세요" },
        ],
      },
    ];
    expect(summarize(refund)).toEqual({ total: 1, byHand: 1, filled: 0 });
  });
});
```

- [ ] **Step 3: 시험이 실패하는지 확인한다**

```bash
cd src && npx vitest run modules/doc-filler
```

기대: FAIL — `Cannot find module './fill'`

- [ ] **Step 4: 최소 구현을 쓴다**

`src/modules/doc-filler/fill.ts`:

```ts
import { parseToken, restore } from "@/modules/pii-restorer";
import type { RestorableMapping } from "@/modules/pii-restorer";
import type {
  DocSection,
  FillSummary,
  FilledField,
  FilledSection,
} from "./types";

/** `[이름-3]` 처럼 생겼는가 */
const looksLikeToken = (value: string) => /^\[[^\]]+\]$/.test(value.trim());

/**
 * 값을 브라우저에서 펼칩니다.
 *
 * **`site: "doc-field"` 는 전체 복원입니다** — 주민번호가 실제로 필요한 자리이고,
 * 부분 복원이면 서류에 옮겨 적을 수 없습니다 → pii-restorer/types.ts.
 *
 * **구획과 칸의 순서를 바꾸지 않습니다.** 서식 실물과 1:1 로 대조하는 순서입니다.
 */
export function fillSections(
  sections: readonly DocSection[],
  mappings: readonly RestorableMapping[],
): FilledSection[] {
  const pool = [...mappings];

  return sections.map((section) => ({
    section_id: section.section_id,
    name: section.name,
    fields: section.fields.map((field): FilledField => {
      if (field.value == null || field.value === "") {
        // 직접 적는 칸입니다. **결함이 아닙니다**
        return { ...field, unresolved: false };
      }

      const opened = restore(field.value, pool, { site: "doc-field" });

      // 토큰이 그대로 남았다면 이 기기에 열쇠가 없는 것입니다
      if (looksLikeToken(field.value) && opened === field.value) {
        const parsed = parseToken(field.value.trim());
        return {
          ...field,
          // 칩은 「이름·3」 — 대괄호 토큰 표기를 사용자에게 그대로 보이지 않습니다 (시안)
          masked: parsed ? `${parsed.kind}·${parsed.seq}` : field.value,
          unresolved: true,
        };
      }

      return { ...field, raw: opened, unresolved: false };
    }),
  }));
}

/**
 * 몇 칸을 직접 적어야 하나.
 *
 * **`filled` 를 화면에 `0` 으로 드러내지 마세요** → 화면 설계 §S-10.
 * 환급받을 계좌는 원래 알 수 없는 값이라, `0` 이 뜨면 우리가 실패한 것처럼 읽힙니다.
 * 「전부 직접 적습니다」처럼 **사용자가 할 일**로 바꿔 말합니다.
 */
export function summarize(sections: readonly DocSection[]): FillSummary {
  let total = 0;
  let byHand = 0;

  for (const section of sections) {
    for (const field of section.fields) {
      if (field.state === "staff") continue; // 신청인이 적지 않는 란
      total += 1;
      if (field.state === "unknown") byHand += 1;
    }
  }

  return { total, byHand, filled: total - byHand };
}
```

- [ ] **Step 5: 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run modules/doc-filler
```

기대: PASS — 7 passed

- [ ] **Step 6: 커밋**

```bash
git add src/modules/doc-filler/
git commit -m "doc-filler — 값을 브라우저에서 펼친다. 못 펼쳐도 칩으로 남긴다 (§3.12 초안)"
```

---

## Task 11: doc-filler — 화면을 모듈로 옮긴다

**Files:**
- Create: `src/modules/doc-filler/guide.tsx`
- Create: `src/modules/doc-filler/index.ts`
- Create: `src/modules/doc-filler/README.md`
- Modify: `src/app/c/[token]/doc.tsx` — `SECTIONS` 상수를 지우고 props 로 받습니다
- Modify: `src/app/c/[token]/page.tsx` — `<DocGuide>` 호출부 **두 곳**(본문·유령 렌더)

**Interfaces:**
- Consumes: `fillSections` · `summarize` (Task 10)
- Produces: `FieldRow` (props `{ field, onCopy }`) · `SubmitCard` (props `{ paths }`)

- [ ] **Step 1: 제출 경로 카드를 옮긴다**

`src/modules/doc-filler/guide.tsx`. **화면이 정렬하지 않고, 비면 아예 그리지 않습니다.**

```tsx
"use client";

import type { FilledField } from "./types";

/** §3.12 `submit[]` — 배열 순서가 곧 권장 순서입니다 (ADR-042) */
export interface SubmitPath {
  how: "branch" | "app" | string;
  text: string;
  url?: string;
}

export function SubmitCard({ paths }: { paths: readonly SubmitPath[] }) {
  // **비어 있으면 카드를 아예 그리지 않습니다** — 「모른다」를 「없다」로 그리지 않습니다
  if (paths.length === 0) return null;

  // 하나뿐이면 「먼저」를 붙이지 않습니다 — 다른 길이 있는 것처럼 읽힙니다
  const prefix = (i: number) => (paths.length === 1 ? "" : i === 0 ? "먼저 " : "안 되면 ");

  return (
    <section className="rounded-[13px] border border-hairline bg-surface-low p-4">
      <h3 className="text-[15px] font-[620] text-ink-1">어디에 내나요</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {paths.map((p, i) => (
          <li key={`${p.how}-${i}`} className="text-[14px] leading-[1.6] text-ink-2">
            {prefix(i)}
            {p.text}
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="ml-2 text-pii underline underline-offset-[3px]"
              >
                찾기
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: 칸 한 줄을 옮긴다**

같은 파일에 더합니다. **복사가 이 화면의 핵심 동작입니다** — 계좌번호를 손으로 옮겨
적다 틀리는 것이 실제 사고 원인입니다.

```tsx
/** 화면(`doc.tsx`)이 관리하는 복사 상태 — **모듈은 저장하지 않습니다** */
export type CopyState = "idle" | "copied" | "flash" | "failed";

export function FieldRow({
  field,
  copyState = "idle",
  onCopy,
}: {
  field: FilledField;
  copyState?: CopyState;
  onCopy?: (field: FilledField) => void;
}) {
  const shown = field.display ?? field.raw;
  return (
    <li className="grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 border-b border-[oklch(0.305_0.013_267.1/40%)] py-[11px] last:border-b-0">
      <span className="text-[13px] leading-[1.45] text-ink-3">{field.label}</span>

      <span className="min-w-0">
        {shown !== undefined ? (
          <>
            {/* 복사가 거부되면 화면이 이 앵커로 값을 골라 줍니다 — 지우면 폴백이 죽습니다 */}
            <span
              id={`docval-${field.field_id}`}
              data-numeric
              className="text-[15px] font-[600] leading-[1.45] text-ink-1 selection:bg-[oklch(0.697_0.16_258.2/35%)]"
            >
              {shown}
            </span>
            {/* 색만으로 가르지 않습니다 — 앰버 + `!` + 글자 (§3.12 `unread`) */}
            {field.state === "unread" && (
              <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] leading-[1.5] text-deadline-urgent">
                <span
                  aria-hidden
                  className="grid size-[14px] shrink-0 place-items-center rounded-full border border-[oklch(0.77_0.117_70.9/50%)] bg-[oklch(0.77_0.117_70.9/20%)] text-[10px] font-bold"
                >
                  !
                </span>
                {field.note ?? "읽은 값 — 확인해 주세요"}
              </span>
            )}
            {copyState === "failed" && (
              <span className="mt-0.5 block text-[12.5px] leading-[1.5] text-ink-2">
                이 브라우저가 복사를 막았습니다.{" "}
                <b className="font-[620] text-ink-1">값을 골라 뒀으니</b> 그대로 옮겨 주세요.
              </span>
            )}
          </>
        ) : field.unresolved ? (
          <span className="inline-flex items-center rounded-[6px] border border-[oklch(0.697_0.16_258.2/40%)] bg-pii-bg px-2 text-[13px] text-pii">
            {field.masked}
          </span>
        ) : (
          <span className="justify-self-start border-b border-dashed border-[oklch(0.305_0.013_267.1/70%)] pb-0.5 text-[13.5px] text-ink-3">
            {field.note}
          </span>
        )}
      </span>

      {field.raw !== undefined && onCopy ? (
        <button
          type="button"
          onClick={() => onCopy(field)}
          className={`inline-flex min-h-[var(--size-touch)] shrink-0 items-center rounded-[9px] border px-3.5 text-[13px] transition-colors duration-200 ${
            copyState === "copied" || copyState === "flash"
              ? "border-[oklch(0.697_0.16_258.2/45%)] bg-[oklch(0.697_0.16_258.2/14%)] font-[620] text-pii"
              : "border-hairline bg-chip text-ink-2 hover:border-[oklch(1_0_0/25%)]"
          }`}
        >
          {copyState === "failed"
            ? "직접 복사"
            : copyState === "flash"
              ? "복사됨 ✓"
              : copyState === "copied"
                ? "✓ 복사됨"
                : "복사"}
        </button>
      ) : field.unresolved ? (
        <span className="text-[12.5px] text-ink-4">이 기기에선 복사 안 됨</span>
      ) : (
        <span />
      )}
    </li>
  );
}
```

> **`id="docval-…"` 앵커를 지우지 마세요.** 지금 화면은 클립보드가 거부될 때 그 앵커로
> 값을 선택해 줍니다(`doc.tsx` 의 `selectValue`). 앵커가 없으면 **폴백이 조용히 죽어**
> 사용자는 아무 일도 안 일어난 화면을 봅니다.

- [ ] **Step 3: 공개 API 와 README 를 쓴다**

`src/modules/doc-filler/index.ts`:

```ts
/**
 * doc-filler — 기재 안내에 뜨는 값을 브라우저에서 원문으로 복원한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-037(서류를 만들지 않는다) · ADR-009(매핑은 브라우저)
 */

import "client-only";

export { fillSections, summarize } from "./fill";
export { FieldRow, SubmitCard } from "./guide";
export type { CopyState, SubmitPath } from "./guide";
export type {
  DocField,
  DocSection,
  FieldState,
  FillSummary,
  FilledField,
  FilledSection,
} from "./types";
```

`src/modules/doc-filler/README.md`:

```markdown
# doc-filler

기재 안내에 뜨는 값을 **브라우저에서** 원문으로 복원합니다. **층 C** 입니다.

| | |
| --- | --- |
| 받는 것 | 초안 + 복원 매핑 (`GET …/doc` §3.12 — ⬜ 초안) |
| 내놓는 것 | 완성 문서 |
| 절대 하지 않는 것 | **서버가 만든 완성 문서를 그대로 받기** (F-08 위반) |

## 서류를 만들어 주지 않습니다

무엇을 어느 칸에 적는지 값과 함께 보여줄 뿐입니다 → [ADR-037](../../../decisions/037-doc-guidance-not-generation.md).
별지 제1호서식은 **2차 출처로 확보됐고 1차 대조가 남았습니다**(`U-17`).
**틀린 서류는 반려 → 3영업일 상실**입니다.

## `0` 을 드러내지 마세요

`summarize().filled` 가 `0` 인 구획이 있습니다 — 환급받을 계좌는 **원래 알 수 없는 값**입니다.
그 자리에 `0` 이 뜨면 우리가 실패한 것처럼 읽힙니다. **「전부 직접 적습니다」** 처럼
사용자가 할 일로 바꿔 말하세요 → 불변 규칙 5 의 화면판.

## 순서를 바꾸지 마세요

구획 순서는 **서식 실물 그대로**입니다. 사용자가 실물과 1:1 로 대조하라고 그렇게 둔 것이지
「이 순서로 하세요」가 아닙니다. **구획에 번호를 매기지 마세요.**
```

- [ ] **Step 4: 화면을 모듈로 갈아 끼운다**

`src/app/c/[token]/doc.tsx` 에서 `SECTIONS`·`type Field`·`type Section`·`type SubmitPath`
를 지우고, `DocGuide` 가 `sections`·`submit` 을 props 로 받게 고칩니다. **복사 상태 관리
(`copiedMem`·`readCopied`·`writeCopied`)는 화면에 그대로 둡니다** — 그건 이 화면의 UI
상태이지 모듈의 일이 아닙니다. 그 상태를 `FieldRow` 의 `copyState` 로 넘깁니다.

**그리고 `src/app/c/[token]/page.tsx` 의 `<DocGuide caseId={…} />` 두 곳**(본문과 유령 렌더)을
`<DocGuide sections={FIXTURE_DOC.sections} submit={FIXTURE_DOC.submit} />` 로 바꿉니다
(픽스처는 Task 1b). 안 고치면 지운 상수의 기본값이 사라져 **빌드가 깨집니다.**

> ⚠️ **`page.tsx` 는 [서버와 이야기하는 넷 계획](08-22-layer-c-transport.md) Task 5 도 고칩니다** —
> 두 계획이 같은 파일을 만지는 유일한 자리입니다. 같은 날 함께 실행한다면
> **그쪽 Task 5 를 먼저** 끝내고 이 태스크를 하세요.

머리말 문장은 §S-10 이 정한 그대로 유지합니다:

```
칸 순서는 서식에 적힌 그대로라 실물과 나란히 대조하실 수 있습니다.
채우는 순서는 없습니다 — 아는 것부터 하셔도 됩니다.
```

- [ ] **Step 5: 빌드와 시험이 통과하는지 확인한다**

```bash
cd src && npx vitest run && npm run build
```

기대: 시험 전부 통과 · 빌드 exit 0

- [ ] **Step 6: 검사기와 커밋**

```bash
python .github/scripts/doc-integrity.py
git add src/modules/doc-filler/ "src/app/c/[token]/doc.tsx"
git commit -m "doc-filler — 기재 안내를 화면에서 모듈로 옮긴다 (S-10)"
```

---

## 끝나면 무엇이 달라져 있나

| | 전 | 후 |
| --- | --- | --- |
| 층 C 구현 | 3 / 11 | **7 / 11** |
| 이 넷의 시험 | 0 | 약 35개 |
| 화면의 표시 규칙 | `*.tsx` 안 상수 | 모듈의 순수 함수 — 서버 응답이 오면 그대로 이어집니다 |
| 계약 구멍 | 넷이 조용히 있었음 | 정본에 올라가 사람이 볼 수 있음 |

**남는 것 넷** — `case-opener` · `poll-checker` · `file-sender` · `chat-handler` 는
[층 C 서버와 이야기하는 넷 계획](08-22-layer-c-transport.md)에 있습니다.

## 이 계획이 덮지 않는 것 — 여섯

**스펙에 있는데 여기 태스크가 없는 자리입니다.** 빠뜨린 것이 아니라 **재료가 없어서**이고,
지어내지 않기로 한 것들입니다. **이 표가 그 전수 목록입니다** — 여기 없는데 태스크도 없으면
그건 누락입니다.

| 무엇 | 스펙 | 왜 못 하나 |
| --- | --- | --- |
| **히어로 스트립의 D-day 박스** | §S-07 「첫 줄이 답입니다」 | `days_left` 가 응답에 없습니다(Task 1). 지금 화면의 목업은 그대로 두고, 그 값이 확정되면 `deadline-viewer` 의 `DeadlineBadge` 를 그 자리에 끼웁니다 |
| **공고 대기 카드** | §S-07 「앰버를 쓰지 않습니다」 | 채권소멸 공고 구간인지 판정할 값이 `GET /plan` 에 없습니다. 「그 자리의 일은 통지 해독」이라는 규칙만 있고 **무엇을 보고 그 국면임을 아는지**가 정해지지 않았습니다. **시안도 없습니다** |
| **사건 진행 레일 (타임라인)** | [모듈 명칭](../../spec/common/08-16-module-names.md) `plan-viewer` 「**타임라인**·단계·상태 배지」 | 지금 어느 국면인지 판정할 값이 §3.6 에 없습니다 — 공고 대기 카드와 **같은 구멍**입니다. 레일 목업(`RAIL`)은 화면에 그대로 둡니다 |
| **대응 경과 타이머** | [기한 규칙](../../spec/common/08-16-deadline-rules.md) 「표시 규칙」 첫 줄 | 기산 시점과 경과값을 주는 응답이 없습니다. **화면이 세면 「화면이 날짜를 세지 않는다」 위반**입니다 |
| **사칭 정황 구간 · 미확인 표기** | §S-08 「전사 본문」 | 근거 스팬은 `case-reader`(층 1)가 내는데 **미구현**이고, §3.3 응답에도 그 자리가 없습니다 |
| **전사의 화자 이름** | §S-08 (시안: 「상대방 · 나」) | §3.3 은 `speaker: "A"/"B"` 뿐입니다 — **누가 「나」인지 서버가 밝히는 칸이 없습니다.** Task 1 과 같은 방식으로 정본에 물어야 합니다. 그때까지 `TranscriptView` 는 §3.3 값을 그대로 보입니다 |

**여섯 다 「값이 오면 그리는」 자리라, 지금 만들면 가짜 데이터에 맞춘 렌더가 됩니다.**
`days_left` 가 확정되면 첫째는 바로 붙고, 나머지는 각각 플랜 응답·`case-reader`·§3.3 보완을
기다립니다. 그때 이 표에서 지우고 태스크로 옮기세요.

> 시각 표시(「00:12」)는 `start_ms` 의 표기 변환이라 **기한 계산이 아닙니다** — 넣어도 됩니다.
> 화자 **이름**만 계약 구멍입니다.

**렌더가 통째로 미접속인 것 하나** — `deadline-viewer` 의 `DeadlineList`·`DeadlineBadge` 는
`days_left` 가 확정되기 전이라 **어느 화면에도 세우지 않습니다.** 모듈은 서고 시험도 도는데
화면에는 안 붙은 상태로 끝나는 것이 맞습니다.
