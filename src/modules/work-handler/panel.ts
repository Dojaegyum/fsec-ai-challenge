/**
 * 유형 판정 — `body.action` 하나로 정해집니다.
 *
 * spec/frontend/08-17-workspace-panels.md 「유형은 어디서 오는가」의 표를 옮긴 것입니다.
 *
 * **프론트가 추론하지 않습니다.** 이전 초안은 `actor`·`channel`·`required_artifact`를
 * 조합해 파생하는 안이었고, 근거가 세 필드에 흩어져 절차가 늘면 어긋났습니다
 * → ADR-024.
 */

import type { Exit, PanelId, PanelRule, PlanStep, StepAction } from "./types";

const ACTION_TO_PANEL: Record<StepAction, PanelId> = {
  call: "WS-call",
  visit: "WS-visit",
  write: "WS-write",
  upload: "WS-upload",
  download: "WS-download",
  wait: "WS-wait",
  read: "WS-read",
};

/**
 * 표 밖의 값이면 `null`입니다.
 *
 * **`WS-read`로 떨어뜨리지 않습니다.** 모르는 것을 「읽기만 하면 되는 것」으로
 * 바꾸면, 사용자가 해야 할 일을 안 해도 되는 것처럼 보게 됩니다.
 *
 * ⬜ **`confirm`(전사 검수)이 위 표에 없습니다.** 2026-08-20 에 계약상 여덟째 값으로
 * 정해졌지만(ADR-038) **패널 화면이 아직 없습니다** — `transcriber` 가 서고 실제
 * 오독률을 재기 전에는 만들지 않기로 했습니다.
 *
 * 그래서 지금 `panelFor("confirm")` 은 `null` 이고, **그 단계는 화면에 아무것도
 * 그리지 않습니다.** KB 에 `action: "confirm"` 항목이 아직 없어 터지지는 않지만,
 * **넣는 순간 조용히 사라집니다.** 화면을 만들 때 이 표에 한 줄을 더하세요.
 */
export function panelFor(action: string | undefined | null): PanelId | null {
  if (!action) return null;
  return ACTION_TO_PANEL[action as StepAction] ?? null;
}

export function panelForStep(step: PlanStep): PanelId | null {
  return panelFor(step.body?.action);
}

/**
 * 유형마다 다른 것 → 워크스페이스 패널 「유형별로 다른 것」.
 *
 * 렌더가 이걸 보고 화면을 고릅니다. **이 표에 없는 규칙을 컴포넌트에 흩뿌리지 마세요** —
 * 흩어지면 패널이 늘 때마다 어디를 봐야 할지 알 수 없습니다.
 */
const RULES: Record<PanelId, PanelRule> = {
  "WS-call": {
    hasCompletion: true,
    userActs: true,
    exits: true,
    allowsFullRestore: false,
    note: "받아적기 칸이 통화 시작과 함께 떠 있어야 합니다. 끊고 나서 띄우면 늦습니다",
  },
  "WS-visit": {
    hasCompletion: true,
    userActs: true,
    exits: true,
    allowsFullRestore: false,
    note: "무엇을 들고 돌아와야 하는지를 나가기 전에 보여줍니다",
  },
  "WS-write": {
    hasCompletion: true,
    userActs: true,
    exits: false,
    allowsFullRestore: false,
    note: "형식이 틀려도 막지 않습니다. 저장하고 표시만 합니다 (L1)",
  },
  "WS-upload": {
    hasCompletion: true,
    userActs: true,
    exits: false,
    allowsFullRestore: false,
    note: "pii-masker 를 거치지 않은 업로드 경로를 만들지 마세요 (L2)",
  },
  "WS-download": {
    hasCompletion: true,
    userActs: true,
    exits: false,
    allowsFullRestore: true,
    note: "PII 전체 복원이 허용된 유일한 작업 패널입니다. 브라우저에서만",
  },
  "WS-wait": {
    hasCompletion: false,
    userActs: false,
    exits: false,
    allowsFullRestore: false,
    note: "카운트다운을 만들지 마세요. 환급은 진행 단계 설명입니다",
  },
  "WS-read": {
    hasCompletion: false,
    userActs: false,
    exits: false,
    allowsFullRestore: false,
    note: "완료 개념이 없습니다. 체크박스를 두지 마세요",
  },
};

export function panelRule(panel: PanelId): PanelRule {
  return RULES[panel];
}

/**
 * 나갈 곳은 두 갈래입니다 → 워크스페이스 패널 「나갈 곳은 두 갈래입니다」.
 *
 * **둘 다 없어도 절차는 나갑니다.** 기관을 특정 못 했거나 번호·경로가 아직
 * 확인 안 된 경우이고, 그때는 화면이 「어느 은행인지」를 되물으면 됩니다
 * → 데이터 모델 §11.4.3.
 */
export function exitFor(step: PlanStep): Exit {
  const contact = step.body?.contact;
  if (contact) return { kind: "contact", value: contact };

  const url = step.body?.url;
  if (url) return { kind: "url", value: url, label: step.body?.url_label ?? null };

  return { kind: "none" };
}
