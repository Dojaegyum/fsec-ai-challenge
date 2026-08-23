/**
 * case-opener — URL 토큰으로 사건을 연다 (층 C · 브라우저)
 *
 * 정본: spec/common/08-16-module-names.md 층 C
 * 근거: ADR-021(재진입) · ADR-035(화면 상태 두 축) · ADR-028(층 C 는 client-only) ·
 *       ADR-039(링크 토큰)
 *
 * **계정이 없어 이 자리가 인증을 통째로 대신합니다.**
 */

import "client-only";

export { isCaseToken, openCase } from "./open";
export { LinkHandoff } from "./handoff";
export type { CaseResponse, Focus, ScreenState, Side } from "./types";
