"use client";

/**
 * 단계의 부산물을 내는 자리 — §3.8.
 *
 * 계약: spec/common/08-14-api.md §3.8 · spec/backend/08-14-completion-hook.md
 * 근거: CLAUDE.md 불변 규칙 6 — **완료는 사용자의 체크가 아니라 부산물로 판정합니다**
 *
 * ## 2026-08-26 까지 이 자리가 없었습니다
 *
 * 서버는 `POST …/steps/{id}/artifacts` 를 갖추고 있었고 완수 검증도 돌고
 * 있었는데, **화면에서 그것을 부르는 코드가 하나도 없었습니다.** 워크스페이스
 * 패널의 「입력」·「올리기」 버튼은 `onClick` 이 없는 껍데기였습니다.
 *
 * 결과는 조용한 쪽으로 나빴습니다 — 사용자가 무엇을 해도 단계가 완료되지
 * 않고, **`after` 사슬로 묶인 다음 단계가 영영 안 열립니다.** 기한도 따라서
 * 안 섭니다(기한은 플랜에 있는 단계에만 붙습니다).
 *
 * ## 세 갈래 중 완료를 만드는 것은 하나입니다
 *
 * | 낸 것 | 레벨 | 결과 |
 * | --- | --- | --- |
 * | 파일을 올림 | L2 | **`done_verified`** — 올린 것 자체가 증빙입니다 |
 * | 접수번호를 적음 | L1 | 접수번호 **모양**이면 `done_verified`, 아니면 `in_progress` |
 * | 했다고만 말함 | L3 | `unconfirmed` — **완료가 아닙니다** |
 *
 * **L1 은 「형식이 맞나」가 아니라 「받아 적었나」를 묻습니다** → ADR-056.
 * 형식 정본이 없어서 내린 결론이 아니라 부산물 원리가 원래 그것입니다 —
 * 접수번호는 절차를 밟지 않으면 생기지 않습니다. 형식 대조는 할 수 있을 때만
 * 얹는 덤이고, 지금은 아무 기관도 못 얹습니다(`format_unchecked`).
 *
 * 모양에서 걸려도 막히지 않습니다 — 서버가 `next_options` 로 L2·L3 를 함께 냅니다.
 *
 * ## 실패해도 사용자를 막지 않습니다
 *
 * L1 실패는 **에러가 아닙니다**(§3.8 *"L1 실패가 에러가 아닙니다"*). 그래서
 * 이 훅은 실패를 던지지 않고 `verdict` 로 돌려줍니다 — 화면은 그 옆에
 * 다음 길을 그립니다.
 */

import { useCallback, useState } from "react";

import { postJson } from "./load";
import type { LoadFail } from "./load";

/** §3.8 이 정한 셋 */
export type ArtifactSubmission =
  | { kind: "receipt_no"; value: string }
  | { kind: "sms_capture" | "receipt_doc"; evidenceId: string }
  | { kind: "other"; selfReported: true };

/** §3.8 응답 그대로 */
export interface ArtifactVerdict {
  artifact_id: string;
  verify_level: "L1" | "L2" | "L3";
  verify_result: "passed" | "failed" | "not_applicable";
  verify_detail?: { reason: string };
  step_state: "done_verified" | "in_progress" | "unconfirmed";
  /** L1 이 실패했을 때 서버가 함께 내는 다음 길 */
  next_options?: readonly { level: "L2" | "L3"; label: string }[];
  /** **증거 연쇄** — 이 부산물로 열린 단계들 */
  unlocked_steps?: readonly { step_id: string; title: string; reason: string }[];
  note?: string;
}

export interface ArtifactSend {
  /** 지금 보내는 중인 단계. 없으면 `null` */
  readonly sendingStepId: string | null;
  /** 마지막 판정. 화면이 이걸 보고 다음 길을 그립니다 */
  readonly verdict: ArtifactVerdict | null;
  readonly fail: LoadFail | null;
  submit(stepId: string, submission: ArtifactSubmission): Promise<ArtifactVerdict | null>;
  /** 판정 표시를 걷습니다 — 사용자가 다음 단계로 넘어갈 때 */
  clear(): void;
}

/** 코드는 낙타 표기, 계약은 밑줄 표기 — 옮기는 곳을 여기 하나로 둡니다 */
function toBody(one: ArtifactSubmission): Record<string, unknown> {
  switch (one.kind) {
    case "receipt_no":
      return { kind: "receipt_no", value: one.value };
    case "sms_capture":
    case "receipt_doc":
      return { kind: one.kind, evidence_id: one.evidenceId };
    case "other":
      return { kind: "other", self_reported: true };
  }
}

/**
 * 부산물을 내고 판정을 받습니다.
 *
 * `onPlanChanged` 는 **단계가 열렸을 때만** 부릅니다. 매번 부르면 화면이
 * 아무 일도 없었는데 다시 그려지고, 사용자가 적던 것이 사라질 수 있습니다.
 *
 * ⚠️ **화면마다 부르지 마세요** — `useChatSend`·`useUploads` 와 같은 이유로,
 * 전환 중 사본이 함께 그려질 때 훅이 둘이면 사본이 빈 상태를 보여줍니다.
 */
export function useArtifact(
  caseToken: string | null,
  onPlanChanged?: () => void,
): ArtifactSend {
  const [sendingStepId, setSendingStepId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<ArtifactVerdict | null>(null);
  const [fail, setFail] = useState<LoadFail | null>(null);

  const submit = useCallback(
    async (stepId: string, submission: ArtifactSubmission) => {
      if (!caseToken || sendingStepId !== null) return null;

      setSendingStepId(stepId);
      setFail(null);

      const sent = await postJson(
        `/api/cases/${caseToken}/steps/${stepId}/artifacts`,
        toBody(submission),
      );

      setSendingStepId(null);

      if (!sent.ok) {
        // **낸 것을 지우지 않습니다** — 사용자가 적은 번호는 입력칸에 남습니다.
        // 다시 보내는 것은 사용자가 합니다 (에러 계약 §3.1)
        setFail(sent.fail);
        return null;
      }

      // **깊이 검사하지 않습니다** — 모양은 서버가 지키는 계약입니다
      // (`load.ts` 의 `toBundle` 과 같은 이유)
      const got = sent.json as ArtifactVerdict;
      setVerdict(got);

      // 사슬이 실제로 움직였을 때만 플랜을 다시 읽습니다
      if (got.unlocked_steps?.length || got.step_state === "done_verified") {
        onPlanChanged?.();
      }

      return got;
    },
    [caseToken, onPlanChanged, sendingStepId],
  );

  const clear = useCallback(() => {
    setVerdict(null);
    setFail(null);
  }, []);

  return { sendingStepId, verdict, fail, submit, clear };
}
