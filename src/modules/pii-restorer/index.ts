/**
 * pii-restorer — 복원해도 되는지 심사하고 되돌린다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md
 * 근거: ADR-011(복원 위치를 코드가 지정) · ADR-013(챗 답변은 부분 복원) · ADR-023(층 C)
 */

export { restore, restoreValue, scopeFor } from "./restore";
export { parseToken, scopeOf, maskPartial } from "./policy";
export type {
  DenialEvent,
  DenialReason,
  ParsedToken,
  RestorableMapping,
  RestoreOptions,
  RestoreScope,
  RestoreSite,
} from "./types";
