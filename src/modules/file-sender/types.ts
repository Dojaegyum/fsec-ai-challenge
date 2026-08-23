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
 * → 모듈 명칭 층 C.
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
