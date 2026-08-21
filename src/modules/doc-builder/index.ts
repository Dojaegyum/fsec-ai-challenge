/**
 * doc-builder — 기재 항목과 값을 짝지어 낸다. **문서를 조판하지 않는다** (층 3)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001.
 *
 * 서류를 만들어 주지 않습니다 → ADR-037. 서버가 완성 문서를 내려주는 구조는
 * spec/common/08-14-pii-boundary.md 규칙 6 위반이기도 합니다.
 */

export { createDocBuilder } from './build'
export type {
  BuildInput,
  CaseSlotValue,
  DocBuilder,
  DocGuide,
  FieldState,
  FormDefinition,
  FormField,
  FormSection,
  GuideField,
  GuideSection,
} from './types'
