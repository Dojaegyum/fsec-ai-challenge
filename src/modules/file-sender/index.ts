/**
 * file-sender — 파일을 pii-masker 에 태워 올리고 처리 상태를 추적한다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-023(층 C) · ADR-026(가리지 못한 파일은 올리지 않는다) ·
 *       ADR-028(층 C 는 client-only)
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
