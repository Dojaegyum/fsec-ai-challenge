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
 *
 * **정규식을 여기서 새로 만들지 마세요.** 패턴을 두 곳에 두면 어긋난 쪽이 조용히
 * 새는 쪽이 됩니다 — 못 잡는 것이 있으면 `pii-masker` 를 고칩니다.
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
 * 왜 실패했나 — **낱말이 같은 두 실패를 가릅니다.**
 *
 * | | |
 * | --- | --- |
 * | `transfer` | 못 올렸거나 서버가 못 읽었다 (§3.3 `ingest_status: "failed"`) |
 * | `masking` | **가릴 수 없는 정보가 있어 안 올렸다** (ADR-026). 아직 세우는 자리가 없습니다 |
 */
export type FailCause = "transfer" | "masking";

/**
 * 파일이 「못 가려서 제외됨」 상태일 때의 갈림길 — §S-08 `failed` 행.
 *
 * **막는 것이 아니라 갈림길을 주는 것입니다** (ADR-026). 파일 하나를 빼도
 * T0 는 그대로 돌고, **사용자가 뭘 잘못한 것이 아닙니다** — 그래서 앰버이고
 * 빨강이 아니며, 문구도 사용자를 탓하지 않습니다.
 *
 * ## 왜 `cause` 를 받나 — **낱말만 같은 두 실패가 있습니다**
 *
 * ⚠️ 이 경고가 이 파일에 이미 적혀 있었는데도 **그대로 일어났습니다.**
 * 서버의 `ingest_status: "failed"` 는 데이터 모델상 **STT·OCR 실패**
 * (`INGEST_FAILED` — 「파일을 읽지 못했습니다」)이고, 「못 가려서 제외」는
 * **브라우저가 세우는 다른 상태**입니다 — 그런데 낱말이 같아서 둘이 뭉쳤고,
 * 전사가 실패한 사용자에게 **「가릴 수 없는 정보가 있어 올리지 않았습니다」라는
 * 거짓 문구**가 나갔습니다 (2026-08-27 실측).
 *
 * 이제 **부르는 쪽이 이유를 말합니다.** 기본은 `transfer`(못 올렸거나 못 읽었다)이고,
 * `masking` 은 **그 판정을 실제로 한 자리**에서만 넘깁니다.
 *
 * ⬜ **`masking` 을 세우는 자리는 아직 없습니다** — 파일 속 주민번호 검출이 미결이라
 * (ADR-026 「남은 것」) 그 판정 자체가 일어나지 않습니다. 검출이 서면 그때 붙습니다.
 */
export function forkFor(status: string, cause: FailCause = "transfer"): Fork | null {
  if (status !== "failed") return null;
  return {
    // **일어난 일을 그대로 말합니다.** 「가릴 수 없는 정보가 있어」는 `masking` 일
    // 때만 참이고, 그 상태는 아직 아무도 세우지 않습니다
    message:
      cause === "masking"
        ? "이 파일은 가릴 수 없는 정보가 있어 올리지 않았습니다. 없이도 진행됩니다."
        : "이 파일은 올리지 못했습니다. 없이도 진행됩니다.",
    choices: ["다른 파일 올리기", "없이 진행"],
  };
}
