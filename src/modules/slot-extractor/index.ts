/**
 * slot-extractor — 전사·OCR 결과에서 슬롯 값을 추출한다 (층 1)
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001.
 *
 * **`slot-checker` 와 다른 모듈입니다.** 값을 뽑는 것은 LLM(층 1),
 * 충분한지 판정하는 것은 규칙(층 3) → spec/common/08-16-module-names.md.
 */

import 'server-only'

export { createSlotExtractor } from './extract'
export { SLOT_VALUE_TYPE } from './types'
export type {
  /**
   * 9유형의 값 정의입니다(카드는 ADR-055 로 아홉째). **밖에서도 이 이름을 씁니다** — 문진
   * 선택지를 값으로 되돌리는 곳(lib/questions.ts)이 같은 유니온을 봐야 유형이 두 군데로
   * 갈라지지 않습니다 → 03-channel-matrix.md.
   */
  ChannelId,
  ExtractInput,
  ExtractResult,
  ExtractedSlot,
  LlmClient,
  SlotExtractor,
  SlotKey,
  SlotValueType,
} from './types'
