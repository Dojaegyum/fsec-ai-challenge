/**
 * kb-finder — KB 를 `applied`·`reference` 두 묶음으로 조회한다.
 *
 * **공개 API 입니다.** 밖에서는 이 파일만 import 합니다 → RFC-001 「모듈 하나의 파일 골격」.
 */

import 'server-only'

export { createKbFinder } from './find'
export type {
  KbFinder,
  KbGroups,
  KbQuery,
  KbRow,
  KbStore,
  Track,
} from './types'
